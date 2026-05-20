// Diagnostic ranking tests for semantic + hybrid retrieval.
//
// These are INTEGRATION tests — they hit a real local Ollama at the
// configured host and embed live text. Auto-skip if Ollama is unreachable
// so CI/unattended runs don't fail on environment.
//
// Run with:
//   (cd client && ollama pull nomic-embed-text && yarn test)
//
// What they validate:
//  1. Proper-noun queries ("Kimi", "Qwen") should surface documents that
//     mention those exact terms above documents that don't. This is the
//     canonical failure mode for dense-only retrieval — rare proper nouns
//     embed weakly and generic semantics dominate.
//  2. Semantic queries should rank topically-similar documents highest
//     without overfitting to literal word overlap.
//  3. Hybrid (BM25 + dense) should strictly dominate dense-only on the
//     proper-noun tests while remaining competitive on the semantic ones.
//
// If these tests fail, it's almost certainly one of:
//  - Embedding model not pulled (check `ollama pull nomic-embed-text`)
//  - EMBEDDING_VERSION mismatch between stored and code (see /settings)
//  - Task prefix dropped from `embedText` (regression)

import { describe, it, expect, beforeAll } from 'vitest';
import { OLLAMA_HOST } from '#/lib/env';
import { embedText, cosineSimilarity } from './embeddings';
import { buildBM25Index, searchBM25, type TranscriptChunk } from './transcript';

async function isOllamaUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

// Reciprocal Rank Fusion — same constant (60) used in transcript.ts.
function rrfMerge(
  rankings: Array<string[]>,
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => {
      const delta = 1 / (rank + 1 + k);
      scores.set(id, (scores.get(id) ?? 0) + delta);
    });
  }
  return scores;
}

// Helper: rank docs by cosine against a query.
async function rankByCosine(
  queryText: string,
  docs: Array<{ id: string; text: string }>,
): Promise<Array<{ id: string; score: number }>> {
  const q = await embedText(queryText, 'query');
  const scored: Array<{ id: string; score: number }> = [];
  for (const d of docs) {
    const v = await embedText(d.text, 'document');
    scored.push({ id: d.id, score: cosineSimilarity(q, v) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function rankByBM25(
  queryText: string,
  docs: Array<{ id: string; text: string }>,
): Array<{ id: string; score: number }> {
  const chunks: TranscriptChunk[] = docs.map((d, i) => ({
    id: i,
    text: d.text,
    startWord: 0,
    timeSec: 0,
  }));
  const idx = buildBM25Index(chunks);
  const hits = searchBM25(idx, queryText, docs.length);
  // BM25 returns only matching chunks. Map back to doc ids, preserving rank.
  return hits.map((c) => ({ id: docs[c.id].id, score: 1 }));
}

function rankHybrid(
  cosine: Array<{ id: string; score: number }>,
  bm25: Array<{ id: string; score: number }>,
): Array<{ id: string; score: number }> {
  const merged = rrfMerge([
    cosine.map((c) => c.id),
    bm25.map((b) => b.id),
  ]);
  return Array.from(merged.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// =============================================================================
// Test corpora — synthetic passages mirroring the kinds of videos a user
// would have in a library. Kept small + deterministic.
// =============================================================================

// Corpus sized to mirror realistic IDF distributions — at 5 docs, every
// 1-of-5 term has IDF ~1.39 (under our 1.5 filter threshold), so BM25
// rescue would fail even for correct proper-noun matches. Padding with
// neutral filler docs pushes unique-term IDF above 1.5, which matches
// what happens on the user's real ~45-video library.
const MODEL_CORPUS = [
  {
    id: 'qwen',
    text: 'Qwen is an open-source large language model from Alibaba. The Qwen 2.5 series includes 7B and 72B variants. Qwen-specific fine-tunes perform well on Chinese and English benchmarks.',
  },
  {
    id: 'kimi',
    text: 'First look at Kimi K2.6, an open-source state-of-the-art model that really beat Opus. Kimi from Moonshot AI shows competitive performance on reasoning tasks. We compare Kimi against closed-source alternatives.',
  },
  {
    id: 'gemma',
    text: 'Gemma is a family of lightweight models from Google. Gemma 3 runs efficiently on consumer hardware. Local inference with Gemma in Ollama works for most chat workloads.',
  },
  {
    id: 'rust',
    text: 'Building AI agents in Rust. Async runtimes compared: Tokio vs async-std. Rust memory safety matters when running long-lived agent processes.',
  },
  {
    id: 'content-strategy',
    text: 'Content strategy nobody is talking about. Why fitness creators fail on YouTube. Build a real audience by focusing on what matters, not vanity metrics.',
  },
  // Filler docs — neutral topical coverage, pushes corpus size large
  // enough that proper nouns in 1 doc score IDF > 1.5.
  { id: 'filler-1', text: 'A deep dive into React rendering, hooks, and reconciliation patterns.' },
  { id: 'filler-2', text: 'Building resilient distributed systems with backpressure and graceful degradation.' },
  { id: 'filler-3', text: 'SQL optimization: indexes, query plans, and common pitfalls.' },
  { id: 'filler-4', text: 'Cryptography fundamentals and how to avoid common implementation mistakes.' },
  { id: 'filler-5', text: 'A brief history of UNIX and the design choices that shaped Linux.' },
  { id: 'filler-6', text: 'CSS layout patterns: flexbox, grid, and when each one is the right tool.' },
  { id: 'filler-7', text: 'Type theory for working programmers: variance, higher kinds, and the practical limits.' },
  { id: 'filler-8', text: 'Observability primer: metrics, logs, traces, and how they fit together.' },
  { id: 'filler-9', text: 'The history of compiler optimization and modern SSA-based IR designs.' },
  { id: 'filler-10', text: 'Networking basics: TCP congestion control, TLS handshake, HTTP/2 vs HTTP/3.' },
];

// =============================================================================

describe('embeddings — retrieval quality', () => {
  let ollamaUp = false;

  beforeAll(async () => {
    ollamaUp = await isOllamaUp();
    if (!ollamaUp) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ranking tests] Ollama unreachable at ${OLLAMA_HOST} — skipping. Start Ollama + ensure nomic-embed-text is pulled to run these.`,
      );
    }
  }, 10_000);

  it('DIAGNOSTIC: "what is qwen" — shows actual ranking behavior', async () => {
    if (!ollamaUp) return;

    const query = 'what is qwen';

    const cosine = await rankByCosine(query, MODEL_CORPUS);
    const bm25 = rankByBM25(query, MODEL_CORPUS);
    const hybrid = rankHybrid(cosine, bm25);

    // eslint-disable-next-line no-console
    console.log('\n======= DIAGNOSTIC =======');
    // eslint-disable-next-line no-console
    console.log('Query:', query);
    // eslint-disable-next-line no-console
    console.log('\nCosine (dense-only) ranking:');
    cosine.forEach((c, i) =>
      // eslint-disable-next-line no-console
      console.log(`  #${i + 1}: ${c.id.padEnd(20)} score=${c.score.toFixed(3)}`),
    );
    // eslint-disable-next-line no-console
    console.log('\nBM25 (keyword) ranking:');
    if (bm25.length === 0) {
      // eslint-disable-next-line no-console
      console.log('  (no docs contain any query terms)');
    } else {
      bm25.forEach((b, i) =>
        // eslint-disable-next-line no-console
        console.log(`  #${i + 1}: ${b.id}`),
      );
    }
    // eslint-disable-next-line no-console
    console.log('\nHybrid (RRF merge) ranking:');
    hybrid.forEach((h, i) =>
      // eslint-disable-next-line no-console
      console.log(`  #${i + 1}: ${h.id.padEnd(20)} rrf=${h.score.toFixed(4)}`),
    );
    // eslint-disable-next-line no-console
    console.log('======================\n');

    // Qwen MUST be top-1 in hybrid. This is the failure the user sees.
    expect(hybrid[0].id).toBe('qwen');
  }, 60_000);

  it('proper-noun query "Kimi" — dense-only may fail, hybrid wins', async () => {
    if (!ollamaUp) return;

    const query = 'tell me about Kimi model';

    const cosine = await rankByCosine(query, MODEL_CORPUS);
    const bm25 = rankByBM25(query, MODEL_CORPUS);
    const hybrid = rankHybrid(cosine, bm25);

    // eslint-disable-next-line no-console
    console.log('\n--- Query:', query);
    // eslint-disable-next-line no-console
    console.log('Cosine ranking:', cosine);
    // eslint-disable-next-line no-console
    console.log('BM25 ranking:  ', bm25);
    // eslint-disable-next-line no-console
    console.log('Hybrid ranking:', hybrid);

    // Hybrid MUST put Kimi first — keyword match dominates for exact
    // proper-noun queries.
    expect(hybrid[0].id).toBe('kimi');
  }, 60_000);

  it('proper-noun query "Qwen" — hybrid wins', async () => {
    if (!ollamaUp) return;

    const query = 'tell me about the Qwen model';

    const cosine = await rankByCosine(query, MODEL_CORPUS);
    const bm25 = rankByBM25(query, MODEL_CORPUS);
    const hybrid = rankHybrid(cosine, bm25);

    // eslint-disable-next-line no-console
    console.log('\n--- Query:', query);
    // eslint-disable-next-line no-console
    console.log('Cosine ranking:', cosine);
    // eslint-disable-next-line no-console
    console.log('BM25 ranking:  ', bm25);
    // eslint-disable-next-line no-console
    console.log('Hybrid ranking:', hybrid);

    expect(hybrid[0].id).toBe('qwen');
  }, 60_000);

  it('semantic query "running AI on laptop" — dense ranks correctly', async () => {
    if (!ollamaUp) return;

    const query = 'running AI models on my laptop locally';

    const cosine = await rankByCosine(query, MODEL_CORPUS);

    // eslint-disable-next-line no-console
    console.log('\n--- Query:', query);
    // eslint-disable-next-line no-console
    console.log('Cosine ranking:', cosine);

    // Dense should rank the Gemma passage (mentions "local inference",
    // "consumer hardware", "Ollama") at or near the top — the conceptual
    // bridge query BM25 can't make.
    const topTwoIds = cosine.slice(0, 2).map((c) => c.id);
    expect(topTwoIds).toContain('gemma');
  }, 60_000);

  it('unrelated query "fitness" doesn\'t cluster at 0.5 across tech content', async () => {
    if (!ollamaUp) return;

    const query = 'fitness workout routine';

    const cosine = await rankByCosine(query, MODEL_CORPUS);

    // eslint-disable-next-line no-console
    console.log('\n--- Query:', query);
    // eslint-disable-next-line no-console
    console.log('Cosine ranking:', cosine);

    // Primary contract: the doc that literally mentions "fitness" must
    // outrank every tech doc — that's the whole point of embeddings
    // producing meaningful relative scores (vs. the pre-prefix behavior
    // where tech docs hovered at 0.55 indistinguishable from relevance).
    expect(cosine[0].id).toBe('content-strategy');

    // Secondary: the top tech doc's score should be at least 0.1 below
    // the content-strategy doc's — a real separation, not a 0.01 nudge.
    // With the prefix in place, expect a gap of 0.1+. A shrinking gap
    // is the early warning that something's regressing.
    const topTechScore = cosine.find((c) =>
      ['qwen', 'kimi', 'gemma', 'rust'].includes(c.id),
    )!.score;
    expect(cosine[0].score - topTechScore).toBeGreaterThan(0.1);
  }, 60_000);
});
