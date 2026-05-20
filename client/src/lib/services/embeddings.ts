// Topical embeddings for semantic neighbor search over the video library.
//
// Scale assumption: personal KB, <1000 videos. We keep this simple:
//   - One vector per video, from the summary layer (not transcript chunks).
//   - Stored as JSON on the Video row (same pattern as transcriptSegments).
//   - Cosine similarity computed in-memory at query time — fast enough at this
//     scale (1000 × 768-dim dot product ≈ 1–2 ms).
//
// Upgradability:
//   (embeddingModel, embeddingVersion) form a compound invalidation key.
//   Changing either — swap the Ollama model, or change what text the builder
//   concatenates — marks every stored vector stale; the regenerate flow picks
//   them up. Graduating to pgvector or a separate vector DB later is a
//   storage-layer swap; all consumers go through this service boundary.
//
// Same service is intended to power a future Tier-2 passage-level embedding
// (chunked transcript segments inside StoredTranscriptIndex). Only the
// write target and read path differ; `embedText` + `cosineSimilarity` are
// reused verbatim.

import {
  OLLAMA_HOST,
  OLLAMA_EMBEDDING_MODEL,
  EMBEDDING_VERSION,
  PASSAGE_EMBEDDING_VERSION,
} from '#/lib/env';
import type { StrapiVideo } from './videos';
import { chunkForPassages, type TimedTextSegment } from './transcript';

export const CURRENT_EMBEDDING_MODEL = OLLAMA_EMBEDDING_MODEL;
export const CURRENT_EMBEDDING_VERSION = EMBEDDING_VERSION;
export const CURRENT_PASSAGE_VERSION = PASSAGE_EMBEDDING_VERSION;

// Defensive cap. `nomic-embed-text` handles 2048-token inputs (~8000 chars
// for English); we truncate a hair under that so no silent drops.
const MAX_EMBED_CHARS = 8000;

// =============================================================================
// Ollama native embeddings endpoint.
//
// Task-specific prefixes matter for nomic-embed-text (and other Matryoshka
// / instruction-tuned embedders). Without the prefix, the model defaults
// to a generic representation and cosine scores lose their semantic zero
// point — every English-text pair hovers around 0.5 regardless of topic.
// See https://ollama.com/library/nomic-embed-text.
//
//   - 'query'    — user-typed query or probe text
//   - 'document' — stored text (summary, passage) that queries will match
//
// Bumping CURRENT_EMBEDDING_MODEL or changing the prefix scheme needs a
// version bump so existing stored vectors flag stale.
// =============================================================================

export type EmbedTask = 'query' | 'document';

function applyPrefix(text: string, task: EmbedTask): string {
  const prefix = task === 'query' ? 'search_query: ' : 'search_document: ';
  return `${prefix}${text}`;
}

export async function embedText(
  text: string,
  task: EmbedTask = 'document',
): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('embedText: empty input');
  // Reserve some headroom for the prefix within the overall char cap.
  const body = applyPrefix(trimmed.slice(0, MAX_EMBED_CHARS - 32), task);

  const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CURRENT_EMBEDDING_MODEL,
      prompt: body,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Ollama embeddings error ${res.status}: ${errText.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
    throw new Error('Ollama returned no embedding');
  }
  return json.embedding;
}

// =============================================================================
// Cosine similarity — hot loop, inlined for speed at >500 videos.
// =============================================================================

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// =============================================================================
// Text builder — what we actually embed.
//
// Summary-layer only. Transcripts are noisy and too long; the summary already
// encodes "what this video is about" densely. We include tags as user-
// authored topic signal — they bias similarity toward the library's own
// semantic clusters.
//
// If you change what goes in here, bump EMBEDDING_VERSION in env.ts so
// existing stored vectors are flagged stale.
// =============================================================================

export function buildEmbeddingText(video: StrapiVideo): string {
  const parts: string[] = [];
  if (video.videoTitle) parts.push(video.videoTitle);
  if (
    video.summaryTitle &&
    video.summaryTitle !== video.videoTitle
  ) {
    parts.push(video.summaryTitle);
  }
  if (video.summaryDescription) parts.push(video.summaryDescription);
  if (video.summaryOverview) parts.push(video.summaryOverview);
  if (video.keyTakeaways && video.keyTakeaways.length > 0) {
    parts.push(video.keyTakeaways.map((t) => `- ${t.text}`).join('\n'));
  }
  if (video.sections && video.sections.length > 0) {
    parts.push(video.sections.map((s) => s.heading).join('\n'));
  }
  if (video.tags && video.tags.length > 0) {
    parts.push(`Tags: ${video.tags.map((t) => t.name).join(', ')}`);
  }
  return parts.join('\n\n');
}

// =============================================================================
// Staleness check — is the embedding on this row usable with the current
// model + version, or does it need regeneration?
// =============================================================================

export function isEmbeddingCurrent(video: StrapiVideo): boolean {
  if (!video.summaryEmbedding || video.summaryEmbedding.length === 0) {
    return false;
  }
  if (video.embeddingModel !== CURRENT_EMBEDDING_MODEL) return false;
  if (video.embeddingVersion !== CURRENT_EMBEDDING_VERSION) return false;
  return true;
}

export type VideoEmbeddingStatus =
  | 'missing'      // no vector stored
  | 'stale'        // stored but model/version mismatch
  | 'current';     // stored and matches current env

export function embeddingStatus(video: StrapiVideo): VideoEmbeddingStatus {
  if (!video.summaryEmbedding || video.summaryEmbedding.length === 0) {
    return 'missing';
  }
  if (
    video.embeddingModel !== CURRENT_EMBEDDING_MODEL ||
    video.embeddingVersion !== CURRENT_EMBEDDING_VERSION
  ) {
    return 'stale';
  }
  return 'current';
}

// =============================================================================
// Orchestrator — build text, call Ollama, return the row payload.
// Callers pass the result to `updateVideoEmbeddingService` (videos.ts).
// =============================================================================

export type ComputedEmbedding = {
  embedding: number[];
  model: string;
  version: number;
  generatedAt: string;
};

export async function computeVideoEmbedding(
  video: StrapiVideo,
): Promise<ComputedEmbedding> {
  const text = buildEmbeddingText(video);
  if (!text.trim()) {
    throw new Error(
      'No summary content to embed — generate the summary first.',
    );
  }
  // Stored vector is a document in the retrieval sense — queries will
  // match against it later with a `search_query:` prefix.
  const embedding = await embedText(text, 'document');
  return {
    embedding,
    model: CURRENT_EMBEDDING_MODEL,
    version: CURRENT_EMBEDDING_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Tag aggregation — given a ranked list of neighbor videos + their cosine
// scores, return the tags most characteristic of the neighborhood, weighted
// by similarity. Pure function, easy to test.
//
// Score model: each tag's score = sum of the cosine scores of neighbors that
// carry it. So a tag appearing on 3 moderately-similar videos outranks a
// tag appearing on 1 slightly-more-similar one. Normalized at the end so
// scores sit on [0, 1] for display.
// =============================================================================

export type SuggestedTag = {
  name: string;
  slug: string;
  score: number;
};

export type NeighborWithTags = {
  score: number;
  tags: Array<{ name: string; slug: string }> | null;
};

// =============================================================================
// Match-tier labels for retrieval results. Raw cosine with nomic-embed-text
// saturates around 0.65–0.72 for correct topical matches, so a "54% match"
// chip reads as "not confident" even when the result is genuinely #1. The
// research on RAG UIs (and our own ranking tests) is consistent: drop the
// percentages, show rank-tier labels derived from position + threshold.
//
// Tiers are position-sensitive — "top match" only applies to the result
// the system ranked first, even if multiple results clear the same score
// threshold. That matches how a user reads a ranked list.
// =============================================================================

export type MatchTier = 'top' | 'strong' | 'good' | 'related';

// Rank-only tier. After hybrid retrieval, the ranking order IS the signal —
// raw cosine score is not a good proxy for confidence because it's
// compressed (0.45–0.72 for good matches in nomic-embed-text) and hybrid
// ranks often differ from cosine ranks. A doc the system ranked #1 after
// BM25 + dense merge is the top match, even if its raw cosine was 0.47.
export function getMatchTier(rank: number, _score: number): MatchTier {
  if (rank === 0) return 'top';
  if (rank < 3) return 'strong';
  if (rank < 8) return 'good';
  return 'related';
}

export const MATCH_TIER_LABEL: Record<MatchTier, string> = {
  top: 'Top match',
  strong: 'Strong match',
  good: 'Good match',
  related: 'Related',
};

// =============================================================================
// Tier 2 — passage-level embeddings for moment search.
//
// Stored as `Video.passageEmbeddings: json`, self-contained so a single read
// gets everything search needs (text + time range + vector) without extra
// joins or populate gymnastics. Independent invalidation key
// (PASSAGE_EMBEDDING_VERSION) so tweaking the chunker doesn't invalidate
// summary-level vectors.
// =============================================================================

export type StoredPassage = {
  text: string;
  startSec: number;
  endSec: number;
  embedding: number[];
};

export type PassageIndex = {
  model: string;
  version: number;
  generatedAt: string;
  chunks: StoredPassage[];
};

export type PassageStatus = 'missing' | 'stale' | 'current';

export function passageStatus(
  index: PassageIndex | null | undefined,
): PassageStatus {
  if (!index || !Array.isArray(index.chunks) || index.chunks.length === 0) {
    return 'missing';
  }
  if (index.model !== CURRENT_EMBEDDING_MODEL) return 'stale';
  if (index.version !== CURRENT_PASSAGE_VERSION) return 'stale';
  return 'current';
}

// Concurrency-bounded batch embedder. Ollama serializes anyway, but capping
// at 2 prevents flooding the client with in-flight fetches on long videos.
async function embedBatch(
  texts: string[],
  concurrency = 2,
): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= texts.length) return;
      // Passages are documents — queries will search against them.
      out[i] = await embedText(texts[i], 'document');
    }
  });
  await Promise.all(workers);
  return out;
}

// Build the per-video context anchor that prepends every chunk's embed
// text. Contextual Retrieval (Anthropic, 2024) — giving each chunk a
// short situating header dramatically improves dense recall for queries
// that reference the video's topic or proper nouns, because every chunk
// carries the video's identity into its vector.
//
// Static version: title + channel + tags. Cheap (no LLM), works well
// enough to unblock the "what is Qwen" / "what is Gemma" failures where
// the speaker uses pronouns or abbreviations inside a chunk.
type VideoContext = {
  videoTitle?: string | null;
  videoAuthor?: string | null;
  tags?: Array<{ name: string }> | null;
};

function buildPassageContext(v: VideoContext): string {
  const parts: string[] = [];
  if (v.videoTitle) parts.push(`Video: ${v.videoTitle}`);
  if (v.videoAuthor) parts.push(`Channel: ${v.videoAuthor}`);
  if (v.tags && v.tags.length > 0) {
    parts.push(`Tags: ${v.tags.map((t) => t.name).join(', ')}`);
  }
  return parts.join('\n');
}

export async function computePassageIndex(input: {
  video: VideoContext;
  segments: TimedTextSegment[];
}): Promise<PassageIndex> {
  const chunks = chunkForPassages(input.segments);
  if (chunks.length === 0) {
    return {
      model: CURRENT_EMBEDDING_MODEL,
      version: CURRENT_PASSAGE_VERSION,
      generatedAt: new Date().toISOString(),
      chunks: [],
    };
  }
  const context = buildPassageContext(input.video);
  const vectors = await embedBatch(
    chunks.map((c) => (context ? `${context}\n\n${c.text}` : c.text)),
    2,
  );
  return {
    model: CURRENT_EMBEDDING_MODEL,
    version: CURRENT_PASSAGE_VERSION,
    generatedAt: new Date().toISOString(),
    // Stored chunk `text` remains the raw transcript — the context only
    // exists in the embedding vector. This keeps the UI's displayed
    // passage text clean (no "Video:" header in search results) while
    // the vector still carries the contextual signal.
    chunks: chunks.map((c, i) => ({
      text: c.text,
      startSec: c.startSec,
      endSec: c.endSec,
      embedding: vectors[i],
    })),
  };
}

// =============================================================================

export function aggregateTagsFromNeighbors(
  neighbors: NeighborWithTags[],
  limit = 5,
): SuggestedTag[] {
  const byName = new Map<string, SuggestedTag>();
  for (const n of neighbors) {
    if (!n.tags) continue;
    for (const t of n.tags) {
      const key = t.name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        existing.score += n.score;
      } else {
        byName.set(key, { name: t.name, slug: t.slug, score: n.score });
      }
    }
  }
  if (byName.size === 0) return [];
  const sorted = Array.from(byName.values()).sort((a, b) => b.score - a.score);
  const top = sorted[0].score || 1;
  return sorted.slice(0, limit).map((t) => ({ ...t, score: t.score / top }));
}
