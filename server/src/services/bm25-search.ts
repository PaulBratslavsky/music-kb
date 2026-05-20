// BM25 search against a persisted index — read-only complement to the
// client-side indexer at client/src/lib/services/transcript.ts. The MCP
// `searchTranscript` tool reuses the index already stored on
// `Video.transcriptSegments` (built during summary generation) rather than
// rebuilding one per query.
//
// Mirrors the scoring math of `searchBM25` in transcript.ts so results are
// identical to what the in-app chat sees. Kept small on purpose — the
// full module there also handles indexing, chunking, and cleaning, which
// the MCP surface doesn't need.

const BM25_K1 = 1.2;
const BM25_B = 0.75;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
  'by', 'as', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'we', 'they', 'them', 'his', 'her', 'their', 'our', 'my',
  'your', 'so', 'if', 'then', 'than', 'there', 'here', 'do', 'does', 'did',
  'have', 'has', 'had', 'not', 'no', 'yes', 'too', 'very', 'just', 'about',
  'from', 'up', 'down', 'out', 'off', 'over', 'again', 'further', 'once',
]);

function tokenize(input: string): string[] {
  return input
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]*/g)
    ?.filter((t) => t.length > 1 && !STOPWORDS.has(t)) ?? [];
}

export type TranscriptChunk = {
  id: number;
  text: string;
  startWord: number;
  timeSec: number;
};

export type BM25Index = {
  tf: Array<Record<string, number>>;
  idf: Record<string, number>;
  lengths: number[];
  avgLength: number;
  chunks: TranscriptChunk[];
};

export type StoredTranscriptIndex = {
  version: 1;
  bm25: BM25Index;
  rawSegments?: unknown[];
  durationSec?: number | null;
};

export function isStoredIndex(value: unknown): value is StoredTranscriptIndex {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredTranscriptIndex>;
  return v.version === 1 && !!v.bm25 && Array.isArray(v.bm25.chunks);
}

export type RankedChunk = {
  chunk: TranscriptChunk;
  score: number;
};

export function searchBM25(
  index: BM25Index,
  query: string,
  topK: number,
): RankedChunk[] {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0) return [];

  const scores: number[] = new Array(index.chunks.length).fill(0);
  for (const term of queryTerms) {
    const idf = index.idf[term];
    if (!idf) continue;
    for (let i = 0; i < index.chunks.length; i++) {
      const f = index.tf[i][term];
      if (!f) continue;
      const dl = index.lengths[i];
      const norm = 1 - BM25_B + (BM25_B * dl) / (index.avgLength || 1);
      scores[i] += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * norm));
    }
  }

  return scores
    .map((score, i) => ({ score, chunk: index.chunks[i] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
