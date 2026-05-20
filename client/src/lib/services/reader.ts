// Reading mode — turn a video's cleaned transcript into a long-form
// markdown article so you can read in ~5 min instead of watching 30.
//
// Unlike the summary (sections, takeaways, verdicts), this output is a
// single markdown blob stored in Video.readableArticle. It's generated
// on-demand (the user clicks "Read as article") and cached forever —
// the transcript is immutable, so there's no staleness to manage.
//
// Strips: filler ("um," "uh"), sponsor reads, tangents, duplicate
// phrasing, inline timecodes. Preserves: the speaker's arguments, their
// terminology, the narrative arc.

import { chat } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import {
  fetchTranscriptByVideoIdService,
  fetchVideoByVideoIdService,
  type StrapiTranscript,
} from '#/lib/services/videos';
import {
  chunkForSummary,
  cleanTranscript,
  estimateTokens,
  prepareSegmentedTranscript,
  type PreparedTranscript,
  type TimedTextSegment,
} from '#/lib/services/transcript';
import { withRetry } from '#/lib/retry';
import { MAP_CONCURRENCY, OLLAMA_HOST, OLLAMA_MODEL as MODEL } from '#/lib/env';

const adapter = createOllamaChat(MODEL, OLLAMA_HOST);

// Same cutover used for summary generation — above this, map-reduce kicks
// in to keep per-section attention coherent on long videos.
const SINGLE_PASS_TOKEN_BUDGET = 15_000;

type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

function logPhase(videoId: string, phase: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const body = extra ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [reader ${videoId}] ${phase}${body}`);
}

function ms(start: number): string {
  return `${Math.round(performance.now() - start)}ms`;
}

// =============================================================================
// Prompts
// =============================================================================

const ARTICLE_SYSTEM = [
  'You convert a YouTube video transcript into a clean, long-form markdown blog post that preserves the speaker\'s content while stripping the disfluencies of spoken delivery.',
  '',
  'REQUIRED STRUCTURE (follow exactly, in order):',
  '',
  '1. `#` H1 TITLE — one short, descriptive title. Not "Transcript" or the raw video title.',
  '',
  '2. TL;DR SECTION — bold label (NOT a heading), then a bulleted list of 3-5 key takeaways from the speaker\'s argument. Each bullet: one crisp sentence, max two sentences.',
  '   Example:',
  '   **TL;DR**',
  '',
  '   - First takeaway as a complete sentence.',
  '   - Second takeaway.',
  '',
  '3. MAIN CONTENT — `##` H2 sections for major parts of the speaker\'s argument, `###` H3 sparingly for sub-points. Write in proper paragraphs (not bullet soup). Follow the speaker\'s narrative arc — don\'t reorganize. Short lists only where the speaker enumerates things. Code in fenced code blocks when they discuss code. Block quotes for memorable direct quotes.',
  '',
  'KEEP:',
  ' • Every substantive point, argument, example, and specific detail (names, tools, numbers, references).',
  ' • The speaker\'s terminology and voice. Do NOT invent product or person names.',
  '',
  'STRIP:',
  ' • Filler: "um," "uh," "like," "you know," repeated "so"s at sentence starts.',
  ' • Sponsor reads, "smash that like button," "check out the link in the description," outros.',
  ' • Duplicated phrasing when the speaker re-starts a sentence.',
  ' • Tangents unrelated to the main content.',
  ' • Inline `[mm:ss]` / `(mm:ss)` timecodes — never emit these.',
  '',
  'No "thanks for reading" footer. No end summary section.',
  '',
  'Write as if it were an original essay by the speaker. A reader who has never seen the video should get the full content.',
].join('\n');

const MAP_SYSTEM = [
  'You are converting one window of a YouTube transcript into a cleaned-up narrative passage.',
  'Strip filler, stutters, sponsor reads, inline timecodes, and duplicate phrasing. Preserve every substantive point and the speaker\'s own terminology.',
  'Output plain markdown — paragraphs, occasional lists or code blocks where the speaker actually uses them. No headings at this stage; the final reduce pass will add them.',
  'Do not invent content. Do not summarize. Just clean up what was said in this window.',
].join('\n');

const REDUCE_SYSTEM = [
  'You compose a final long-form markdown blog post from cleaned passages of a YouTube video, each representing a consecutive window of the transcript.',
  '',
  'REQUIRED STRUCTURE (follow exactly, in order):',
  '',
  '1. `#` H1 TITLE — one short, descriptive title.',
  '',
  '2. TL;DR SECTION — bold label (NOT a heading), then a bulleted list of 3-5 key takeaways. Each bullet: one crisp sentence, max two sentences.',
  '   Example:',
  '   **TL;DR**',
  '',
  '   - First takeaway.',
  '   - Second takeaway.',
  '',
  '3. MAIN CONTENT — `##` H2 for major sections, `###` H3 sparingly for sub-points. Merge the windows into continuous prose with smooth transitions — NOT just concatenated. Keep every substantive point; do not summarize or compress. Use fenced code blocks and block quotes where they\'re present in the windows.',
  '',
  'No sponsor reads, no filler, no timecodes. No "thanks for reading" footer. No end summary.',
  '',
  'The output should read like one coherent essay by the speaker, not a transcript.',
].join('\n');

type TranscriptData = {
  videoId: string;
  text: string;
  prepared: PreparedTranscript | null;
  durationSec: number | null;
};

function loadFromStrapiRow(videoId: string, row: StrapiTranscript): TranscriptData {
  const segments: TimedTextSegment[] = (row.rawSegments ?? []).map((s) => ({
    text: s.text,
    startMs: s.startMs,
    endMs: s.endMs,
  }));
  let prepared: PreparedTranscript | null = null;
  let cleaned: string;
  if (segments.length > 0) {
    prepared = prepareSegmentedTranscript(segments);
    cleaned = prepared.cleanedText;
  } else {
    const raw = row.rawText ?? '';
    cleaned = cleanTranscript(raw);
  }
  return {
    videoId,
    text: cleaned,
    prepared,
    durationSec: row.durationSec ?? null,
  };
}

async function generateSinglePass(
  transcript: TranscriptData,
  displayTitle?: string | null,
): Promise<ServiceResult<string>> {
  const started = performance.now();
  logPhase(transcript.videoId, 'single-pass → generating', {
    model: MODEL,
    chars: transcript.text.length,
    tokens: estimateTokens(transcript.text),
  });
  try {
    const userPrompt = [
      displayTitle ? `Video title: ${displayTitle}` : null,
      '',
      'Transcript:',
      transcript.text,
    ]
      .filter(Boolean)
      .join('\n');

    const out = (await withRetry(
      () =>
        chat({
          adapter,
          messages: [
            { role: 'system', content: ARTICLE_SYSTEM },
            { role: 'user', content: userPrompt },
          ] as never,
          stream: false,
          temperature: 0.3,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(
            transcript.videoId,
            `↻ single-pass retry ${attempt}/1 in ${delayMs}ms`,
            { cause: err instanceof Error ? err.message : 'unknown' },
          );
        },
      },
    )) as string;
    logPhase(transcript.videoId, '✓ single-pass done', {
      took: ms(started),
      outChars: out.length,
    });
    return { success: true, data: out };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Article generation failed';
    logPhase(transcript.videoId, '✗ single-pass failed', {
      error: message,
      took: ms(started),
    });
    return { success: false, error: message };
  }
}

async function generateMapReduce(
  transcript: TranscriptData,
  displayTitle?: string | null,
): Promise<ServiceResult<string>> {
  const runStart = performance.now();
  const chunks = chunkForSummary(
    transcript.prepared ?? transcript.text,
    transcript.durationSec,
  );
  logPhase(transcript.videoId, 'map-reduce → generating', {
    model: MODEL,
    chunks: chunks.length,
    concurrency: MAP_CONCURRENCY,
  });

  const windowOutputs: string[] = new Array(chunks.length);

  const processChunk = async (i: number): Promise<void> => {
    const chunk = chunks[i];
    const start = performance.now();
    logPhase(transcript.videoId, `map chunk ${i + 1}/${chunks.length} → generating`);
    const cleanChunkText = chunk.text.replace(
      /\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/g,
      '',
    );
    const out = (await withRetry(
      () =>
        chat({
          adapter,
          messages: [
            { role: 'system', content: MAP_SYSTEM },
            { role: 'user', content: `Transcript window:\n${cleanChunkText}` },
          ] as never,
          stream: false,
          temperature: 0.3,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(
            transcript.videoId,
            `↻ map ${i + 1} retry ${attempt}/1 in ${delayMs}ms`,
            { cause: err instanceof Error ? err.message : 'unknown' },
          );
        },
      },
    )) as string;
    windowOutputs[i] = out;
    logPhase(transcript.videoId, `✓ map chunk ${i + 1}/${chunks.length}`, {
      took: ms(start),
    });
  };

  let cursor = 0;
  const workers = Array.from({ length: MAP_CONCURRENCY }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= chunks.length) return;
      await processChunk(i);
    }
  });
  try {
    await Promise.all(workers);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'map step failed';
    logPhase(transcript.videoId, '✗ map step failed', { error: message });
    return { success: false, error: `Map step failed: ${message}` };
  }

  const reduceStart = performance.now();
  try {
    const reduceUser = [
      displayTitle ? `Video title: ${displayTitle}` : null,
      '',
      `Cleaned windows (${windowOutputs.length}, in chronological order):`,
      '',
      windowOutputs.map((w, i) => `--- Window ${i + 1} ---\n${w}`).join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n');

    const out = (await withRetry(
      () =>
        chat({
          adapter,
          messages: [
            { role: 'system', content: REDUCE_SYSTEM },
            { role: 'user', content: reduceUser },
          ] as never,
          stream: false,
          temperature: 0.3,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(
            transcript.videoId,
            `↻ reduce retry ${attempt}/1 in ${delayMs}ms`,
            { cause: err instanceof Error ? err.message : 'unknown' },
          );
        },
      },
    )) as string;
    logPhase(transcript.videoId, '✓ map-reduce done', {
      took: ms(reduceStart),
      totalTook: ms(runStart),
      outChars: out.length,
    });
    return { success: true, data: out };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'reduce step failed';
    logPhase(transcript.videoId, '✗ reduce failed', {
      error: message,
      took: ms(reduceStart),
    });
    return { success: false, error: `Reduce step failed: ${message}` };
  }
}

// =============================================================================
// Orchestrator — load transcript, generate, persist
// =============================================================================

export type ReadableArticleResult = {
  article: string;
  generatedAt: string;
  model: string;
};

async function persistArticle(
  documentId: string,
  article: string,
): Promise<ServiceResult<ReadableArticleResult>> {
  const now = new Date().toISOString();
  const { STRAPI_URL, STRAPI_API_TOKEN } = await import('#/lib/env');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (STRAPI_API_TOKEN) headers.Authorization = `Bearer ${STRAPI_API_TOKEN}`;

  const res = await fetch(`${STRAPI_URL}/api/videos/${documentId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      data: {
        readableArticle: article,
        readableArticleGeneratedAt: now,
        readableArticleModel: MODEL,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // eslint-disable-next-line no-console
    console.error('[reader] save failed', { status: res.status, body: body.slice(0, 500) });
    return { success: false, error: `Strapi save failed (${res.status})` };
  }
  return {
    success: true,
    data: { article, generatedAt: now, model: MODEL },
  };
}

export async function generateReadableArticleForVideo(
  videoId: string,
  options: { forceRegenerate?: boolean } = {},
): Promise<ServiceResult<ReadableArticleResult>> {
  const runStart = performance.now();
  logPhase(videoId, '▶ generation started', {
    forceRegenerate: !!options.forceRegenerate,
  });

  const video = await fetchVideoByVideoIdService(videoId);
  if (!video) {
    logPhase(videoId, '✗ aborted — video row not found');
    return { success: false, error: 'Video row not found' };
  }

  // Cache hit — return what's already stored unless force is set.
  if (!options.forceRegenerate && video.readableArticle) {
    logPhase(videoId, '↳ cache hit, returning stored article');
    return {
      success: true,
      data: {
        article: video.readableArticle,
        generatedAt: video.readableArticleGeneratedAt ?? new Date().toISOString(),
        model: video.readableArticleModel ?? MODEL,
      },
    };
  }

  // Must have a cached transcript — reader mode is a read-only pass over
  // transcript data, we don't re-fetch from YouTube.
  const transcriptRow =
    video.transcript ?? (await fetchTranscriptByVideoIdService(videoId).catch(() => null));
  if (!transcriptRow) {
    return {
      success: false,
      error: 'No transcript available. Generate the summary first.',
    };
  }

  const transcript = loadFromStrapiRow(videoId, transcriptRow);
  const tokens = estimateTokens(transcript.text);

  const displayTitle = video.videoTitle ?? video.summaryTitle ?? null;
  const result =
    tokens <= SINGLE_PASS_TOKEN_BUDGET
      ? await generateSinglePass(transcript, displayTitle)
      : await generateMapReduce(transcript, displayTitle);

  if (!result.success) return result;

  const article = stripFencingAndFooter(result.data);
  const saved = await persistArticle(video.documentId, article);
  if (!saved.success) return saved;

  logPhase(videoId, '✓ generation complete', { totalTook: ms(runStart) });
  return saved;
}

// The model sometimes wraps the whole article in a ```markdown ... ```
// fence or appends a "Thanks for reading" style footer despite the prompt.
// Strip those before persisting so the stored article is clean.
function stripFencingAndFooter(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) text = fence[1].trim();
  // Drop trailing "Thanks for reading!" style goodbyes.
  text = text.replace(
    /\n{2,}(?:\*\*)?(?:Thanks for (?:reading|watching)|Hope this (?:helped|helps)|Until next time|Cheers).{0,120}$/i,
    '',
  );
  return text;
}
