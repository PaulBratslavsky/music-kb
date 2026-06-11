// Hybrid dense+lexical retrieval fusion — the one place the RRF math lives.
//
// Four retrieval surfaces rank candidates by fused dense+BM25 similarity:
// relatedVideos (target video as the query), semanticSearchVideos (query
// string over videos), searchLibraryPassages (query string over flattened
// passages) and ask-library's retrievePassagesForQuery. Each used to carry
// its own inline copy of the same cosine → BM25 → RRF pipeline; this module
// is that pipeline with the caller-specific concerns (boosts, minScore
// filters, per-video caps, result shaping) left at the call sites.
//
// Dense catches synonyms and intent; BM25 catches exact rare tokens
// (proper nouns like "Qwen", "Kimi", "MCP") that dense vectors
// systematically under-weight. Either alone fails on real user queries —
// the combination is the standard retrieval pattern.

import {
  buildBM25Index,
  searchBM25,
  type BM25Index,
  type TranscriptChunk,
} from './transcript';
import { cosineSimilarity } from './embeddings';

// Reciprocal Rank Fusion constant (Cormack et al., 2009).
export const RRF_K = 60;

// BM25 weight in the merge. Standard RRF uses 1:1. We bump BM25 because
// exact-token matches for rare proper-noun queries are far more reliable
// than dense similarity — and without the bump, the "what is qwen" case
// still lets generic "what is X" cosine matches tie-break the Qwen-specific
// result. 2.5x is the lowest value that consistently surfaces the proper-
// noun video at rank 1 in our tests without over-boosting common terms.
export const BM25_WEIGHT = 2.5;

export type FusionCandidate = {
  // Dense vector for the cosine leg.
  embedding: number[];
  // Lexical surface for the BM25 leg.
  text: string;
};

export type FusedHit = {
  // Index into the input candidates array.
  i: number;
  // Fused RRF score — drives ORDER only; not meaningful as a "% match".
  rrfScore: number;
  // Raw cosine — the user-facing "% match" metric and minScore filter input.
  cosineScore: number;
};

export type FusionResult = {
  // Fused ranking, sorted by rrfScore descending, before any caller boosts.
  ranked: FusedHit[];
  // Raw cosine per candidate index.
  cosineScores: number[];
  // Candidate indices in dense / BM25 rank order — for diagnostics.
  denseOrder: number[];
  bm25Order: number[];
  // Exposed for boost layers that need corpus stats (e.g. IDF-filtered
  // title-token boosting in relatedVideos).
  bm25Index: BM25Index;
  // Base fused scores by candidate index. Callers that layer additive
  // boosts mutate this map, then re-rank via rankByFusedScore.
  rrfScores: Map<number, number>;
};

// Sort a (possibly boosted) score map into the canonical hit shape.
export function rankByFusedScore(
  rrfScores: Map<number, number>,
  cosineScores: number[],
): FusedHit[] {
  return Array.from(rrfScores.entries())
    .map(([i, rrfScore]) => ({ i, rrfScore, cosineScore: cosineScores[i] }))
    .sort((a, b) => b.rrfScore - a.rrfScore);
}

// Rank candidates by fused dense+lexical similarity against the query.
// A candidate ranked by only one retriever still scores (half-credit);
// one strong in both wins comfortably.
//
// `maxQueryTerms` caps BM25 query expansion — essential for doc-as-query
// callers (relatedVideos) where the query text is a whole video's topical
// surface; see searchBM25 for the TF×IDF capping rationale.
export function fuseHybridRankings(
  queryVec: number[],
  queryText: string,
  candidates: FusionCandidate[],
  opts?: { maxQueryTerms?: number },
): FusionResult {
  const cosineScores = candidates.map((c) =>
    cosineSimilarity(queryVec, c.embedding),
  );
  const denseOrder = cosineScores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);

  // Adapt candidates to the TranscriptChunk shape the BM25 infra expects.
  // `id` carries the candidate index so hits map straight back.
  const bm25Chunks: TranscriptChunk[] = candidates.map((c, i) => ({
    id: i,
    text: c.text,
    startWord: 0,
    timeSec: 0,
  }));
  const bm25Index = buildBM25Index(bm25Chunks);
  const bm25Hits = searchBM25(bm25Index, queryText, candidates.length, opts);
  const bm25Order = bm25Hits.map((c) => c.id);

  const rrfScores = new Map<number, number>();
  denseOrder.forEach((id, rank) => {
    rrfScores.set(id, (rrfScores.get(id) ?? 0) + 1 / (rank + 1 + RRF_K));
  });
  bm25Order.forEach((id, rank) => {
    rrfScores.set(id, (rrfScores.get(id) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
  });

  return {
    ranked: rankByFusedScore(rrfScores, cosineScores),
    cosineScores,
    denseOrder,
    bm25Order,
    bm25Index,
    rrfScores,
  };
}
