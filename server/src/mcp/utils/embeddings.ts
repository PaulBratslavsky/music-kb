// Server-side embedding utilities for MCP tools.
//
// Duplicates a small surface of `client/src/lib/services/embeddings.ts` —
// deliberately, so MCP tools stay self-contained (no cross-process HTTP
// call back to the TanStack server functions). Both sides must agree on
// (model, version, text-builder fields) for stored vectors to be usable
// across them.
//
// Upgradability: change `OLLAMA_EMBEDDING_MODEL` or `EMBEDDING_VERSION`
// in the server env and the matching value in `client/src/lib/env.ts`;
// existing vectors flag as stale, `reindexEmbeddings` sweeps them up.

const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(
  /\/v1\/?$/,
  '',
);
const OLLAMA_EMBEDDING_MODEL =
  process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text';
// v2 default matches the client — v2 introduced task prefixes
// (`search_query: / search_document:`) which materially change the
// produced vectors. Keep server + client defaults aligned so MCP-driven
// reindex produces the same embeddings as the in-app reindex.
const EMBEDDING_VERSION = (() => {
  const parsed = parseInt(process.env.EMBEDDING_VERSION ?? '2', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
})();

export const CURRENT_EMBEDDING_MODEL = OLLAMA_EMBEDDING_MODEL;
export const CURRENT_EMBEDDING_VERSION = EMBEDDING_VERSION;

const MAX_EMBED_CHARS = 8000;

// Task prefixes for nomic-embed-text (see client embeddings.ts for the
// full note). MCP's reindex path only writes documents; queries would
// only matter if a future tool embeds ad-hoc query text server-side.
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

export type VideoForEmbed = {
  videoTitle?: string | null;
  videoAuthor?: string | null;
  summaryTitle?: string | null;
  summaryDescription?: string | null;
  summaryOverview?: string | null;
  keyTakeaways?: Array<{ text: string }> | null;
  sections?: Array<{ heading: string }> | null;
  tags?: Array<{ name: string }> | null;
};

export function buildEmbeddingText(video: VideoForEmbed): string {
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

// Per-passage context anchor — mirrors `buildPassageContext` in the
// client-side embeddings service. Prepended to each chunk's text before
// embedding so the chunk's vector carries the parent video's identity.
// See client-side note on Contextual Retrieval.
export function buildPassageContext(video: VideoForEmbed): string {
  const parts: string[] = [];
  if (video.videoTitle) parts.push(`Video: ${video.videoTitle}`);
  if (video.videoAuthor) parts.push(`Channel: ${video.videoAuthor}`);
  if (video.tags && video.tags.length > 0) {
    parts.push(`Tags: ${video.tags.map((t) => t.name).join(', ')}`);
  }
  return parts.join('\n');
}

export type EmbeddingStatus = 'missing' | 'stale' | 'current';

export type VideoWithEmbedding = {
  summaryEmbedding?: number[] | null;
  embeddingModel?: string | null;
  embeddingVersion?: number | null;
};

export function embeddingStatus(v: VideoWithEmbedding): EmbeddingStatus {
  if (!v.summaryEmbedding || v.summaryEmbedding.length === 0) return 'missing';
  if (v.embeddingModel !== CURRENT_EMBEDDING_MODEL) return 'stale';
  if (v.embeddingVersion !== CURRENT_EMBEDDING_VERSION) return 'stale';
  return 'current';
}
