// Hermetic tests for the hybrid fusion primitive — pure math, no Ollama.
// The live-model ranking behavior is covered separately by
// embeddings.ranking.test.ts (integration, auto-skips without Ollama).

import { describe, it, expect } from 'vitest';
import {
  BM25_WEIGHT,
  RRF_K,
  fuseHybridRankings,
  rankByFusedScore,
} from './retrieval-fusion';

// Corpus sized so a term unique to one doc clears searchBM25's IDF >= 1.5
// query filter: with N=8 docs, a 1-of-8 term has IDF ln(1 + 7.5/1.5) ≈ 1.79.
// Smaller corpora silently drop every query term and BM25 returns nothing.
const FILLER_TEXTS = [
  'paint brushes and canvas texture for oil painting',
  'sourdough starter hydration and proofing schedule',
  'marathon training plans and recovery windows',
  'tide patterns and coastal navigation basics',
  'orchid repotting and humidity management',
  'woodworking joinery without metal fasteners',
  'volcanic soil composition and vineyard drainage',
  'medieval manuscript binding and vellum repair',
];

function candidate(embedding: number[], text: string) {
  return { embedding, text };
}

// Query vector along the x-axis; candidate vectors at decreasing alignment.
const QUERY_VEC = [1, 0];

describe('fuseHybridRankings', () => {
  it('computes RRF contributions as 1/(rank+1+K) dense and BM25_WEIGHT/(rank+1+K) lexical', () => {
    // Candidate 0: best dense AND only BM25 match (text contains the
    // query term). Candidate 1: second dense, no BM25. Fillers trail.
    const candidates = [
      candidate([1, 0], 'zephyrite crystals explained in depth'),
      candidate([0.9, 0.1], FILLER_TEXTS[0]),
      candidate([0.1, 0.9], FILLER_TEXTS[1]),
      candidate([0, 1], FILLER_TEXTS[2]),
      ...FILLER_TEXTS.slice(3).map((t) => candidate([-1, 0], t)),
    ];

    const result = fuseHybridRankings(QUERY_VEC, 'zephyrite', candidates);

    // Dense leg: candidate 0 is rank 0, candidate 1 is rank 1.
    // BM25 leg: only candidate 0 matches "zephyrite" (rank 0).
    const expected0 = 1 / (0 + 1 + RRF_K) + BM25_WEIGHT / (0 + 1 + RRF_K);
    const expected1 = 1 / (1 + 1 + RRF_K);
    expect(result.rrfScores.get(0)).toBeCloseTo(expected0, 10);
    expect(result.rrfScores.get(1)).toBeCloseTo(expected1, 10);

    expect(result.ranked[0].i).toBe(0);
    expect(result.ranked[0].rrfScore).toBeCloseTo(expected0, 10);
    expect(result.ranked[0].cosineScore).toBeCloseTo(1, 10);
  });

  it('gives half-credit to candidates ranked by only one retriever', () => {
    // Candidate 0 matches BM25 only (orthogonal vector → worst dense, but
    // dense ranks ALL candidates, so "BM25-only" means weak dense rank).
    // It must still appear in the fused ranking with a positive score.
    const candidates = [
      candidate([0, 1], 'quixotron assembly walkthrough'),
      ...FILLER_TEXTS.slice(0, 7).map((t, k) =>
        candidate([1 - k * 0.01, 0], t),
      ),
    ];

    const result = fuseHybridRankings(QUERY_VEC, 'quixotron', candidates);

    const hit = result.ranked.find((r) => r.i === 0);
    expect(hit).toBeDefined();
    // Dense rank is last (7), BM25 rank is 0.
    const expected = 1 / (7 + 1 + RRF_K) + BM25_WEIGHT / (0 + 1 + RRF_K);
    expect(hit!.rrfScore).toBeCloseTo(expected, 10);
    // The BM25 boost lifts it above pure-dense mid-rankers: with
    // BM25_WEIGHT=2.5, 2.5/61 dwarfs any dense-only 1/(rank+61).
    expect(result.ranked[0].i).toBe(0);
  });

  it('falls back to pure dense ranking when no query term survives BM25', () => {
    // Query term appears in no document → searchBM25 returns [] and the
    // fused order must equal the dense order.
    const candidates = FILLER_TEXTS.slice(0, 6).map((t, k) =>
      candidate([1 - k * 0.1, k * 0.1], t),
    );

    const result = fuseHybridRankings(QUERY_VEC, 'nonexistentterm', candidates);

    expect(result.bm25Order).toEqual([]);
    expect(result.ranked.map((r) => r.i)).toEqual(result.denseOrder);
  });

  it('returns parallel cosineScores and exposes the BM25 index for boost layers', () => {
    const candidates = [
      candidate([1, 0], 'zephyrite crystals explained'),
      ...FILLER_TEXTS.slice(0, 7).map((t) => candidate([0, 1], t)),
    ];

    const result = fuseHybridRankings(QUERY_VEC, 'zephyrite', candidates);

    expect(result.cosineScores).toHaveLength(candidates.length);
    expect(result.cosineScores[0]).toBeCloseTo(1, 10);
    // The corpus-unique term must be in the exposed index with IDF >= 1.5
    // (this is what relatedVideos' title-token boost filters on).
    expect(result.bm25Index.idf.zephyrite).toBeGreaterThanOrEqual(1.5);
  });

  it('honors maxQueryTerms for doc-as-query callers', () => {
    // Doc-as-query: the query text carries two corpus-unique terms, but
    // the cap keeps only the highest TF×IDF one. The doc matching the
    // dropped term must then get no BM25 credit.
    const candidates = [
      candidate([0, 1], 'zephyrite zephyrite zephyrite mineral survey'),
      candidate([0, 1], 'quixotron field manual'),
      ...FILLER_TEXTS.slice(0, 6).map((t) => candidate([1, 0], t)),
    ];
    const query = 'zephyrite zephyrite zephyrite quixotron';

    const capped = fuseHybridRankings(QUERY_VEC, query, candidates, {
      maxQueryTerms: 1,
    });
    // Only "zephyrite" (higher query TF) survives the cap → doc 0 is the
    // sole BM25 hit.
    expect(capped.bm25Order).toEqual([0]);

    const uncapped = fuseHybridRankings(QUERY_VEC, query, candidates);
    expect(uncapped.bm25Order).toContain(1);
  });
});

describe('rankByFusedScore', () => {
  it('re-ranks after additive boosts, preserving cosine pairing', () => {
    const cosineScores = [0.9, 0.5, 0.2];
    const scores = new Map<number, number>([
      [0, 0.010],
      [1, 0.012],
      [2, 0.005],
    ]);

    expect(rankByFusedScore(scores, cosineScores).map((r) => r.i)).toEqual([
      1, 0, 2,
    ]);

    // Boost candidate 2 past both (this is the relatedVideos tag-boost
    // pattern: mutate the map, re-rank).
    scores.set(2, (scores.get(2) ?? 0) + 0.06);
    const reranked = rankByFusedScore(scores, cosineScores);
    expect(reranked.map((r) => r.i)).toEqual([2, 1, 0]);
    expect(reranked[0].cosineScore).toBeCloseTo(0.2, 10);
  });
});
