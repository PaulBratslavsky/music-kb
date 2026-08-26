// Server-side embedding utilities for MCP tools.
//
// Duplicates a small surface of `client/src/lib/services/embeddings.ts` —
// deliberately, so MCP tools stay self-contained (no cross-process HTTP
// call back to the TanStack server functions). Both sides must agree on
// (model, version, text-builder fields) for stored vectors to be usable
// across them.
//
// Upgradability: bump `EMBEDDING_VERSION` HERE and in
// `client/src/lib/env.ts` in the same commit — both are source literals and
// neither is env-configurable, because the two halves are read by two
// different processes with two different .env files, so an override on one
// side alone can only ever produce divergence. Existing vectors then flag as
// stale and `reindexEmbeddings` sweeps them up.
//
// This file deliberately does NOT read `process.env.EMBEDDING_VERSION`. It
// used to, with a parseInt + silent clamp, and that was a hole rather than a
// feature: the key appears in no `.env` or `.env.example` in this repo, its
// client counterpart is a plain literal so an override could only diverge the
// two, and parseInt leniency meant `EMBEDDING_VERSION=1e3` silently pinned the
// server to v1 while `EMBEDDING_VERSION=` (empty) fell through to 3.
//
// `OLLAMA_EMBEDDING_MODEL` *is* env-readable on both sides — swapping embedding
// models is a real feature — but the two DEFAULTS below must match the
// client's. All of this is pinned by
// client/src/lib/services/embeddings.parity.test.ts, which fails the build if
// any of it drifts. (That guard strips comments before it looks for an env
// read, which is why the sentence above can name the variable it is banning.)

// NOTE: the client resolves its Ollama host from OLLAMA_BASE_URL
// (client/src/lib/env.ts), this side from OLLAMA_HOST, and neither key appears
// in server/.env.example. Point the client at a remote Ollama and this MCP
// reindex stays on localhost — same model NAME, possibly different weights,
// both vectors labelled current. Known, tracked separately; the parity guard
// names it in its "what this cannot catch" list.
const OLLAMA_HOST = (process.env.OLLAMA_HOST ?? 'http://localhost:11434').replace(
  /\/v1\/?$/,
  '',
);
// `?.trim() ||`, not `??` — matches readEnv() in client/src/lib/env.ts.
// `OLLAMA_EMBEDDING_MODEL=` (empty) must fall back, not resolve to ''; an empty
// model name here would stamp every MCP-written row `embeddingModel: ''` and
// the client would read all of them as stale forever.
const OLLAMA_EMBEDDING_MODEL =
  process.env.OLLAMA_EMBEDDING_MODEL?.trim() || 'nomic-embed-text';
// v2 introduced task prefixes (`search_query: / search_document:`), v3 added
// the music-extraction block to the text-builder. Mirrors EMBEDDING_VERSION in
// client/src/lib/env.ts.
const EMBEDDING_VERSION = 3;

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
  musicExtraction?: {
    key?: { root: string; type: string } | null;
    chords?: Array<{ root: string; quality: string }>;
    techniques?: Array<{ name: string; description: string }>;
    songs?: Array<{ title: string; artist: string | null }>;
  } | null;
};

// Mirrors `buildMusicExtractionText` (full form) in the client's videos.ts.
function buildMusicText(blob: VideoForEmbed['musicExtraction']): string {
  if (!blob) return '';
  const parts: string[] = [];
  if (blob.key) parts.push(`Key: ${blob.key.root} ${blob.key.type}`);
  if (blob.chords && blob.chords.length > 0) {
    const chordNames = blob.chords.map((c) => `${c.root} ${c.quality}`);
    parts.push(`Chords: ${chordNames.join(', ')}`);
  }
  if (blob.techniques && blob.techniques.length > 0) {
    const names = blob.techniques.map((t) => `${t.name} — ${t.description}`);
    parts.push(`Techniques: ${names.join('; ')}`);
  }
  if (blob.songs && blob.songs.length > 0) {
    parts.push(
      `Songs: ${blob.songs
        .map((s) => (s.artist ? `${s.title} by ${s.artist}` : s.title))
        .join(', ')}`,
    );
  }
  return parts.join('\n');
}

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
  // (music-kb) v3: music-extraction block — keep aligned with the client
  // text-builder or vectors written by the two reindex paths diverge.
  const music = buildMusicText(video.musicExtraction);
  if (music) parts.push(music);
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
