// Chat-evidence retrieval — orchestrates query rewriting + multi-query
// BM25 + RRF fusion behind a single interface. The Strapi-coupled adapter
// (`getChatEvidenceForVideo`) is a one-line wrapper over the deep
// primitive (`getChatEvidence`) so the testable surface stays narrow.
//
// Used by the per-video chat path (`askAboutVideoService`,
// `prepareChatPrompt` in learning.ts). Digest chat and library chat have
// their own retrieval shapes and stay out of this module.

import { chat } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import {
  loadStoredIndex,
  searchBM25,
  searchBM25MultiQuery,
  type BM25Index,
  type TranscriptChunk,
} from '#/lib/services/transcript';
import { withRetry } from '#/lib/retry';
import {
  OLLAMA_HOST,
  OLLAMA_CHAT_MODEL as CHAT_MODEL,
} from '#/lib/env';
import type { StrapiVideo } from '#/lib/services/videos';

// How many retrieved chunks to include in the chat prompt. 8 * ~150 words
// ≈ 1,200 words of retrieved content, plus the always-included sections /
// takeaways — stays well under the model's context even for the smallest
// local quant.
const CHAT_TOP_K = 8;

// How many alternative phrasings of the user's query to ask for. The
// original is always included, so total query count = REWRITE_COUNT + 1.
// 3-5 is the industry sweet spot.
const REWRITE_COUNT = 4;

const ollamaAdapterChat = createOllamaChat(CHAT_MODEL, OLLAMA_HOST);

function logPhase(
  videoId: string,
  phase: string,
  extra?: Record<string, unknown>,
) {
  const ts = new Date().toISOString().slice(11, 23);
  const body = extra ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [chat ${videoId}] ${phase}${body}`);
}

function ms(start: number): string {
  return `${Math.round(performance.now() - start)}ms`;
}

// Ask the local model to expand the user's question into several alternative
// phrasings that capture the same intent with different vocabulary. The
// original is always included — rewrites augment, never replace. Failures
// fall back to the original query alone so retrieval still happens.
export async function rewriteQuery(
  videoId: string,
  original: string,
): Promise<string[]> {
  const trimmed = original.trim();
  if (trimmed.length === 0) return [];
  // Skip rewriting for very short or very long queries — the marginal value
  // is low and the latency is non-trivial.
  if (trimmed.length < 4 || trimmed.length > 400) return [trimmed];

  const started = performance.now();
  const rewriteSystem = [
    'You rewrite search queries. Given a user question about a YouTube video, output several alternative phrasings that capture the same intent using different vocabulary (synonyms, paraphrases, related terms).',
    'Output ONE phrasing per line. No numbering, no bullets, no quotes, no explanation.',
    `Produce exactly ${REWRITE_COUNT} alternative phrasings. Keep each under 15 words.`,
  ].join('\n');
  try {
    const text = (await withRetry(
      () =>
        chat({
          adapter: ollamaAdapterChat,
          messages: [
            { role: 'system', content: rewriteSystem },
            { role: 'user', content: `Original question: ${trimmed}\n\nAlternative phrasings:` },
          ] as never,
          stream: false,
        }),
      { attempts: 2 },
    )) as string;
    const rewrites = text
      .split('\n')
      .map((l) => l.replace(/^[-•\d.)\s"'`]+/, '').replace(/["'`]+$/, '').trim())
      .filter((l) => l.length > 0 && l.length < 200 && l.toLowerCase() !== trimmed.toLowerCase());
    const deduped = Array.from(new Set(rewrites)).slice(0, REWRITE_COUNT);
    const queries = [trimmed, ...deduped];
    logPhase(videoId, 'query rewritten', {
      original: trimmed,
      rewrites: deduped,
      took: ms(started),
    });
    return queries;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'rewrite failed';
    logPhase(videoId, 'query rewrite failed (falling back)', {
      error: message,
      took: ms(started),
    });
    return [trimmed];
  }
}

// Deep primitive: BM25 index in, ranked chunks out. Owns the rewrite-then-
// fuse policy and the silent-fallback contract. `videoId` is optional and
// only used for log telemetry — the Module is otherwise pure with respect
// to the index.
export async function getChatEvidence(
  index: BM25Index,
  query: string,
  opts?: { videoId?: string },
): Promise<TranscriptChunk[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const videoId = opts?.videoId ?? 'anon';
  const queries = await rewriteQuery(videoId, trimmed);
  if (queries.length <= 1) {
    return searchBM25(index, queries[0] ?? trimmed, CHAT_TOP_K);
  }
  return searchBM25MultiQuery(index, queries, CHAT_TOP_K);
}

// Strapi-coupled adapter: takes a Video row, narrows transcriptSegments
// to a usable BM25 index, forwards the youtubeVideoId for telemetry, and
// delegates to `getChatEvidence`. This is the convenience entry point for
// the existing chat callers in learning.ts.
export async function getChatEvidenceForVideo(
  video: StrapiVideo,
  query: string,
): Promise<TranscriptChunk[]> {
  const stored = loadStoredIndex(video.transcriptSegments);
  if (!stored) return [];
  return getChatEvidence(stored.bm25, query, {
    videoId: video.youtubeVideoId,
  });
}
