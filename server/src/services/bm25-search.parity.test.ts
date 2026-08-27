// Behavioural parity guard for the BM25 retrieval core that
// `server/src/services/bm25-search.ts` duplicates from
// `client/src/lib/services/transcript.ts`.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A SHARED MODULE
// --------------------------------------------------
// The obvious fix — extract one retrieval module both packages import — does
// not work here, and ADR 0010 records the four tsconfig configurations that
// were measured before concluding that. Short version: `packages/music` is
// ESM-only with an `exports` map pointing at raw `.ts`, and Strapi compiles
// with `tsc` → CommonJS Node with no bundler anywhere in the pipeline. So the
// duplication is deliberate and permanent, and this file is what keeps it
// honest.
//
// WHY IT LIVES IN THE SERVER SUITE, NOT THE CLIENT ONE
// ----------------------------------------------------
// The seven existing cross-boundary guards all live in `client/` and read the
// server's source as TEXT (see `client/src/lib/services/embeddings.parity.test.ts`).
// That is right for a guard that compares two *files*. This one compares two
// *behaviours*: it EXECUTES both implementations against the same fixture. Per
// docs/ai-architecture.md ("What crosses the boundary"), executing guards
// belong in the server suite, and the direction is fixed — `client/tsconfig.json`
// includes `**/*.ts`, so a client-side test importing server source would drag
// server files into the client's `tsc --noEmit` gate.
//
// Importing `../../../client/src/lib/services/transcript` from here is safe for
// one specific reason, asserted below in group F: that module has ZERO imports,
// so nothing resolves through `client/node_modules` and no second copy of any
// dependency is created. `server/src/services/bm25-search.ts` likewise has zero
// imports. Do not import any other client module here.
//
// WHAT THE TWO SIDES ACTUALLY SHARE
// ---------------------------------
// The client BUILDS the index (`buildBM25Index`) and persists it as JSON on
// `Video.transcriptSegments`. The server only ever READS one. `buildBM25Index`
// appears nowhere in `server/src` — verified. That single fact is what caps the
// blast radius of any drift at "queries rank differently" instead of "the
// stored artifact is corrupt", and it is the fact that reverses ADR 0010 the
// day it stops being true.
//
// WHAT THIS CANNOT CATCH — read before trusting a green run:
//   1. ONE WORKING TREE. Both files are read from this checkout. A deployed
//      Strapi running an older commit than the client diverges with this test
//      green in both trees. Same blind spot embeddings.parity.test.ts names.
//   2. It does NOT cover `server/src/mcp/tools/query-helpers.ts`. That is a
//      THIRD tokenizer — 25 stopwords (a strict subset of the 69 here), a
//      `length >= 2` bound instead of `length > 1`, no timecode stripping, no
//      alpha-prefix expansion — feeding a Strapi `$containsi` AND-filter for
//      `searchVideos` / `findTranscripts`. It is not BM25 and was never meant
//      to match. Do not "unify" it on the strength of a green run here.
//   3. It does NOT cover `relatedVideos`. The client's is RRF fusion plus tag
//      and title boosts; the MCP tool's is raw cosine over one page of rows.
//      Identical defaults, different answers, by construction — two algorithms
//      behind one name, not drift. See ADR 0010 §"Recorded separately".
//   4. This file is TYPECHECKED BY NOTHING. `server/tsconfig.json` excludes
//      `**/*.test.*` (which is what keeps tests out of the Strapi build) and
//      `client/tsconfig.json` cannot see it. That is tolerable ONLY because
//      this guard executes both sides: a signature drift surfaces as a red
//      test at runtime, which is not true of the text-comparison guards.
//   5. It pins the READ path only. Neither `chunkForRetrieval`'s chunk sizing
//      nor `cleanTranscript`'s filler stripping has a server counterpart to
//      compare against, so a change to either changes what both sides see
//      without this file noticing.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  findEvidenceForQuote as serverEvidence,
  formatTimecode as serverFormatTimecode,
  isStoredIndex as serverIsStoredIndex,
  searchBM25 as serverSearch,
  verifyTimecodesInText as serverVerify,
  type BM25Index as ServerBM25Index,
} from './bm25-search';
import {
  annotateWithTimecodes,
  buildBM25Index,
  chunkForRetrieval,
  findEvidenceForQuote as clientEvidence,
  isStoredIndex as clientIsStoredIndex,
  loadStoredIndex,
  prepareSegmentedTranscript,
  searchBM25 as clientSearch,
  STOPWORDS,
  tokenize,
  verifyTimecodesInText as clientVerify,
  type BM25Index,
  type TranscriptChunk,
} from '../../../client/src/lib/services/transcript';

// -----------------------------------------------------------------------------
// Fixture
// -----------------------------------------------------------------------------
//
// 60 chunks, with term document-frequencies chosen so the client's
// BM25_MIN_QUERY_IDF = 1.5 floor lands BETWEEN two of them. idf under
// buildBM25Index's smoothing is ln(1 + (N - df + 0.5) / (df + 0.5)), so at
// N = 60:
//
//   term         df    idf       vs the 1.5 floor
//   ---------------------------------------------
//   vibrato       1    3.70551   far above
//   arpeggio      2    3.19458   far above
//   metronome    13    1.50818   JUST above  <- kept by the client
//   posture      14    1.43671   JUST below  <- dropped by the client
//   guitar       30    0.69315   far below
//   lesson       60    0.00823   floor-adjacent noise
//
// `metronome` and `posture` are the load-bearing pair: they bracket 1.5 by
// ±0.04. Move BM25_MIN_QUERY_IDF to 1.4 or 1.6 and one of them flips, which
// turns group B red. That is deliberate — the constant is the whole subject of
// this file's group B and it should not be quietly adjustable.

const N = 60;

/** The idf `buildBM25Index` assigns a term appearing in `df` of `n` chunks. */
function idfFor(df: number, n = N): number {
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

function mainChunks(): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  for (let i = 0; i < N; i++) {
    const w: string[] = [`filler${i}`, 'lesson'];
    if (i % 2 === 0) w.push('guitar'); //            df 30
    if (i < 14) w.push('posture'); //                df 14
    if (i >= 20 && i < 33) w.push('metronome'); //   df 13
    if (i === 7 || i === 23) w.push('arpeggio'); //  df  2
    if (i === 41) w.push('vibrato'); //              df  1
    // Pad chunk 7 so it is LONGER than chunk 23. Length normalisation then
    // ranks 23 above 7 for "arpeggio", making the expected order [23, 7] —
    // the reverse of chunk-index order, so an ordering assertion actually
    // tests ordering rather than accidentally matching the stable-sort
    // fallback.
    if (i === 7) w.push('pad', 'pad2', 'pad3', 'pad4', 'pad5', 'pad6');
    chunks.push({ id: i, text: w.join(' '), startWord: i * 40, timeSec: i * 20 });
  }
  return chunks;
}

const INDEX: BM25Index = buildBM25Index(mainChunks());

const serverIds = (index: BM25Index, q: string, k = 10): number[] =>
  serverSearch(index as unknown as ServerBM25Index, q, k).map((r) => r.chunk.id);

const clientIds = (index: BM25Index, q: string, k = 10): number[] =>
  clientSearch(index, q, k).map((c) => c.id);

/**
 * A hand-written index, bypassing `buildBM25Index` entirely. One chunk per
 * term, every idf identical and comfortably above the client's floor. Used to
 * probe the two TOKENIZERS in isolation: whether a term is searchable at all
 * is then purely a tokenize decision, with no scoring or floor confounds.
 */
function handIndex(terms: readonly string[]): BM25Index {
  return {
    tf: terms.map((t) => ({ [t]: 1 })),
    idf: Object.fromEntries(terms.map((t) => [t, 3])),
    lengths: terms.map(() => 1),
    avgLength: 1,
    chunks: terms.map((t, i) => ({ id: i, text: t, startWord: i, timeSec: i * 10 })),
  };
}

// -----------------------------------------------------------------------------
// A. Equivalence — where the two are supposed to agree, they agree exactly
// -----------------------------------------------------------------------------

describe('A. searchBM25 — identical results on discriminative queries', () => {
  it('the fixture brackets the 1.5 floor as documented', () => {
    // If this drifts, every threshold assertion below is testing something
    // other than what its name says.
    expect(INDEX.idf.vibrato).toBeCloseTo(idfFor(1), 10);
    expect(INDEX.idf.arpeggio).toBeCloseTo(idfFor(2), 10);
    expect(INDEX.idf.metronome).toBeCloseTo(idfFor(13), 10);
    expect(INDEX.idf.posture).toBeCloseTo(idfFor(14), 10);
    expect(INDEX.idf.guitar).toBeCloseTo(idfFor(30), 10);

    // The bracket itself, stated as the inequality the floor cares about.
    expect(INDEX.idf.metronome).toBeGreaterThan(1.5);
    expect(INDEX.idf.posture).toBeLessThan(1.5);
    // ...and tight, so a floor moved to 1.4 or 1.6 cannot slip through.
    expect(INDEX.idf.metronome).toBeLessThan(1.6);
    expect(INDEX.idf.posture).toBeGreaterThan(1.4);
  });

  const AGREEING_QUERIES = [
    'vibrato',
    'arpeggio',
    'metronome',
    'arpeggio metronome',
    'vibrato arpeggio metronome',
    'where does the arpeggio start',
  ] as const;

  it.each(AGREEING_QUERIES)('"%s" — identical ids in identical order', (q) => {
    const c = clientIds(INDEX, q);
    const s = serverIds(INDEX, q);
    // Guard against a vacuous pass: two empty arrays are equal too, and the
    // client's floor makes empty a very reachable answer.
    expect(c.length, `client returned nothing for "${q}" — fixture no longer exercises this`).toBeGreaterThan(0);
    expect(s).toEqual(c);
  });

  it('ORDER, not just membership — "arpeggio" ranks 23 above 7', () => {
    // Chunk 7 is padded longer than chunk 23, so length normalisation puts 23
    // first. Both sides must agree on that, and on it being the reverse of
    // chunk-index order.
    expect(clientIds(INDEX, 'arpeggio')).toEqual([23, 7]);
    expect(serverIds(INDEX, 'arpeggio')).toEqual([23, 7]);
  });

  it('topK truncates identically', () => {
    for (const k of [1, 3, 7]) {
      expect(serverIds(INDEX, 'metronome', k)).toEqual(clientIds(INDEX, 'metronome', k));
      expect(clientIds(INDEX, 'metronome', k).length).toBe(k);
    }
  });

  it('an unknown term yields nothing on either side', () => {
    expect(clientIds(INDEX, 'harpsichord')).toEqual([]);
    expect(serverIds(INDEX, 'harpsichord')).toEqual([]);
  });
});

describe('A2. tokenize — the two stopword lists and length bound agree', () => {
  // The client EXPORTS `STOPWORDS` and `tokenize`; the server keeps both
  // private. So they cannot be compared by import. They CAN be compared
  // behaviourally: a term the tokenizer drops is a term `searchBM25` can never
  // score, even when the index contains it.
  //
  // `findEvidenceForQuote` is the client probe rather than `searchBM25`
  // because it goes through `searchBM25Top1WithScore`, which applies NO idf
  // floor — so a miss here means "the tokenizer dropped it", never "the floor
  // dropped it".
  const CLIENT_STOPWORDS = [...STOPWORDS] as string[];

  it('the client list has not silently shrunk', () => {
    // 69 today. A blunt floor: it should not fight additions, only notice a
    // collapse that would make the loop below vacuous.
    expect(CLIENT_STOPWORDS.length).toBeGreaterThanOrEqual(69);
  });

  it('every client stopword is also unsearchable server-side', () => {
    // `constructor` is deliberately excluded — `handIndex` builds plain object
    // literals, and that name collides with Object.prototype. It gets its own
    // treatment in group E, where the collision is the point.
    const probes = CLIENT_STOPWORDS.filter((t) => t !== 'constructor');
    const index = handIndex(probes);
    const clientFinds = probes.filter((t) => clientEvidence(t, index, 0) !== null);
    const serverFinds = probes.filter((t) => serverEvidence(t, index as unknown as ServerBM25Index, 0) !== null);
    expect(clientFinds, 'client tokenize stopped dropping these').toEqual([]);
    expect(serverFinds, 'server tokenize stopped dropping these — stopword lists have drifted').toEqual([]);
  });

  it('non-stopwords are searchable on BOTH sides', () => {
    // The other direction: catches a stopword ADDED to one list only.
    const probes = [
      'guitar', 'metronome', 'arpeggio', 'vibrato', 'fret', 'scale', 'minor',
      'chord', 'inversion', 'tempo', 'pentatonic', 'strum', 'capo', 'triad',
      'why', 'what', 'how', 'when', 'because', 'should', 'could', 'will',
    ];
    const index = handIndex(probes);
    for (const t of probes) {
      expect(clientEvidence(t, index, 0), `client dropped "${t}"`).not.toBeNull();
      expect(serverEvidence(t, index as unknown as ServerBM25Index, 0), `server dropped "${t}"`).not.toBeNull();
    }
  });

  it('the single-character bound is the same on both sides', () => {
    const index = handIndex(['ab', 'x9', 'q']);
    // length > 1 keeps "ab" and "x9"; "q" is dropped by both.
    for (const t of ['ab', 'x9']) {
      expect(clientEvidence(t, index, 0), `client dropped "${t}"`).not.toBeNull();
      expect(serverEvidence(t, index as unknown as ServerBM25Index, 0), `server dropped "${t}"`).not.toBeNull();
    }
    expect(clientEvidence('q', index, 0)).toBeNull();
    expect(serverEvidence('q', index as unknown as ServerBM25Index, 0)).toBeNull();
  });

  it('inline [mm:ss] markers are stripped from the query by both', () => {
    // The index deliberately CONTAINS "12" and "34" as terms. Without that,
    // a side that stopped stripping would emit them as tokens, match nothing,
    // and look identical to a side that did strip.
    const index = handIndex(['arpeggio', 'metronome', '12', '34']);
    expect(clientIds(index, 'arpeggio')).toEqual([0]);
    expect(clientIds(index, '[12:34] arpeggio')).toEqual([0]);
    expect(serverIds(index, '[12:34] arpeggio')).toEqual([0]);
    // ...and both DO tokenize bare digit pairs when they are not inside a
    // marker, so the assertion above is about the stripping, not about digits.
    expect(clientIds(index, '12 34').sort((a, b) => a - b)).toEqual([2, 3]);
    expect(serverIds(index, '12 34').sort((a, b) => a - b)).toEqual([2, 3]);
  });
});

// -----------------------------------------------------------------------------
// B. The divergences — intentional, and pinned so nobody "fixes" them quietly
// -----------------------------------------------------------------------------
//
// The server is a plain-BM25 READER. It deliberately omits four query-side
// behaviours the client applies. Each one is pinned below. If you re-converge
// either side, these tests go RED — that is the point. Read ADR 0010 before
// deciding the convergence is the fix.

describe('B1. INTENDED: the server has no BM25_MIN_QUERY_IDF floor', () => {
  it('a below-floor term returns nothing in-app and returns hits over MCP', () => {
    // idf("guitar") = 0.693. The client refuses; the server answers.
    // This is NOT drift. MCP serves external clients with no query-rewrite
    // stage, so the floor's premise — a rewritten, well-formed query — does
    // not hold there. See ADR 0010.
    expect(clientIds(INDEX, 'guitar')).toEqual([]);
    expect(serverIds(INDEX, 'guitar').length).toBeGreaterThan(0);
  });

  it('the floor sits between idf 1.437 and idf 1.508', () => {
    // Just BELOW: client refuses, server answers.
    expect(clientIds(INDEX, 'posture')).toEqual([]);
    expect(serverIds(INDEX, 'posture').length).toBeGreaterThan(0);

    // Just ABOVE: both answer, and identically.
    const c = clientIds(INDEX, 'metronome');
    expect(c.length).toBeGreaterThan(0);
    expect(serverIds(INDEX, 'metronome')).toEqual(c);
  });

  it('a mixed query keeps only the above-floor term client-side', () => {
    // "posture arpeggio": the client scores arpeggio alone, the server scores
    // both — so the server's result set is a strict SUPERSET here.
    const c = clientIds(INDEX, 'posture arpeggio');
    const s = serverIds(INDEX, 'posture arpeggio');
    expect(c).toEqual([23, 7]);
    expect(s.length).toBeGreaterThan(c.length);
    for (const id of c) expect(s).toContain(id);
  });
});

describe('B2. INTENDED and UNREACHABLE: the server has no query-side TF weighting', () => {
  // The client multiplies each term by log(1 + qtf) where qtf is its query-side
  // frequency; the server weights every distinct term equally. The header calls
  // that an omission, and it is — but it is an omission that CANNOT change an
  // answer, because `tokenize` deduplicates. Every qtf is therefore exactly 1,
  // the factor collapses to a uniform log 2 = 0.6931, and a uniform factor
  // cannot reorder a ranking.
  //
  // The same dedup makes the DOCUMENT side degenerate too: `buildBM25Index`
  // counts over `tokenize(text)`, so every stored term frequency is 1 and the
  // tf table is a pure membership set. Measured on real data during the ADR
  // 0010 spike: 136,152 tf entries across 40 stored indexes, max value 1.
  //
  // Pinned because it is the reason the divergence is harmless. If tokenize
  // ever stops deduplicating, these go red and the server's omission becomes
  // load-bearing.

  it('tokenize deduplicates, so query-side TF is always 1', () => {
    expect(tokenize('arpeggio arpeggio metronome arpeggio')).toEqual(['arpeggio', 'metronome']);
  });

  it('every stored term frequency in a built index is exactly 1', () => {
    const values = INDEX.tf.flatMap((row) => Object.values(row));
    expect(values.length).toBeGreaterThan(100);
    expect([...new Set(values)]).toEqual([1]);
  });

  it('repeating a query term changes nothing, on either side', () => {
    const index: BM25Index = {
      tf: [{ arpeggio: 1 }, { metronome: 1 }],
      idf: { arpeggio: 2.0, metronome: 2.6 },
      lengths: [10, 10],
      avgLength: 10,
      chunks: [
        { id: 0, text: 'arpeggio', startWord: 0, timeSec: 0 },
        { id: 1, text: 'metronome', startWord: 10, timeSec: 60 },
      ],
    };
    // Both idfs clear the floor, so the floor plays no part in this one.
    expect(index.idf.arpeggio).toBeGreaterThan(1.5);
    expect(index.idf.metronome).toBeGreaterThan(1.5);

    const once = clientIds(index, 'arpeggio metronome');
    expect(once).toEqual([1, 0]);
    expect(serverIds(index, 'arpeggio metronome')).toEqual(once);

    for (const q of [
      'arpeggio arpeggio metronome',
      'arpeggio arpeggio arpeggio arpeggio metronome',
      'metronome arpeggio metronome arpeggio',
    ]) {
      expect(clientIds(index, q), q).toEqual(once);
      expect(serverIds(index, q), q).toEqual(once);
    }
  });
});

describe('B3. INTENDED: the server tokenizer has no alpha-prefix expansion', () => {
  // The client expands "qwen3" -> ["qwen3", "qwen"] so a query for a
  // versioned product name finds documents that spell it without the digits.
  // The server does not. Consequence: on any query containing a mixed
  // alpha-digit token, MCP recall is narrower AND the citation-grounding
  // scores differ.
  const versioned = (): BM25Index => {
    const chunks: TranscriptChunk[] = [];
    for (let i = 0; i < 30; i++) {
      let w: string[];
      if (i === 5) w = ['qwen3', ...Array.from({ length: 80 }, (_, k) => `pad${k}`)];
      else if (i === 9) w = ['qwen', 'tuning'];
      else w = [`filler${i}`, 'lesson'];
      chunks.push({ id: i, text: w.join(' '), startWord: i * 5, timeSec: i * 30 });
    }
    return buildBM25Index(chunks);
  };

  it('recall differs: the client also matches the alpha-only spelling', () => {
    const index = versioned();
    expect(clientIds(index, 'qwen3').sort((a, b) => a - b)).toEqual([5, 9]);
    expect(serverIds(index, 'qwen3')).toEqual([5]);
  });

  it('the expansion respects the same >1-char bound as the base filter', () => {
    // "z1" expands to "z", which the length bound then drops — so the
    // divergence is bounded to prefixes of two characters or more. (Probing
    // with "a1" proves nothing: "a" is a stopword and would be dropped by the
    // stopword check whatever the length bound said.)
    const index = handIndex(['z1', 'z']);
    expect(clientIds(index, 'z1')).toEqual([0]);
    expect(serverIds(index, 'z1')).toEqual([0]);
  });

  it('ADR 0004 exposure: the two ground the SAME quote at DIFFERENT timecodes', () => {
    // Chunk 5 carries the exact token but is long; chunk 9 carries only the
    // alpha prefix but is short. Length normalisation then puts them on
    // opposite sides of the client/server tokenizer split.
    //
    // This is the sharpest known consequence of the duplication: the MCP
    // `verifyCitations` tool grounds through the server copy, so it can
    // return a different timecode than the in-app path for the same text.
    // The prior survey measured 0/240 disagreements on real quotes — real
    // quotes are long and rarely contain versioned product names. This is
    // the case that sampling misses.
    const index = versioned();
    const c = clientEvidence('qwen3', index, 0);
    const s = serverEvidence('qwen3', index as unknown as ServerBM25Index, 0);
    expect(c?.timeSec).toBe(270); // chunk 9
    expect(s?.timeSec).toBe(150); // chunk 5
    expect(c?.timeSec).not.toBe(s?.timeSec);
  });
});

describe('B4. INTENDED: maxQueryTerms is client-only', () => {
  it('the client can cap query terms; the server has no such parameter', () => {
    // The cap exists for doc-as-query paths (relatedVideos), where an
    // un-capped target expands to hundreds of terms. The server never runs a
    // doc-as-query, so it has no counterpart. Pinned here so the header's
    // list of omissions cannot go stale: drop the cap and this goes red.
    //
    // Unlike the qtf weighting in B2 this one IS reachable — it ranks the
    // deduplicated terms, so tokenize's dedup does not neutralise it. With
    // every qtf pinned at 1 by that dedup, the TF x IDF weight is just IDF.
    const uncapped = clientIds(INDEX, 'vibrato arpeggio metronome');
    const capped = clientIds(INDEX, 'vibrato arpeggio metronome', 10);
    expect(capped).toEqual(uncapped);

    const oneTerm = clientSearch(INDEX, 'vibrato arpeggio metronome', 10, {
      maxQueryTerms: 1,
    }).map((c) => c.id);
    // Highest IDF wins: vibrato (3.706) beats arpeggio (3.195).
    expect(oneTerm).toEqual([41]);
    expect(oneTerm).not.toEqual(uncapped);
  });
});

// -----------------------------------------------------------------------------
// C. Citation grounding
// -----------------------------------------------------------------------------

describe('C. findEvidenceForQuote — the grounding both ADR 0004 paths rely on', () => {
  // NOTE the asymmetry that makes this group agree far more often than group A
  // does: the client's `findEvidenceForQuote` goes through the PRIVATE
  // `searchBM25Top1WithScore`, which applies neither the idf floor nor the qtf
  // weighting. So on this path the only remaining divergence is the tokenizer
  // (group B3).
  const QUOTES = [
    'the arpeggio shape starts here',
    'set the metronome before you begin',
    'vibrato',
    'guitar', //                          short + generic: the case real data under-samples
    'lesson', //                          floor-adjacent noise
    'posture', //                         below the floor for searchBM25, but not on this path
    'practise the arpeggio slowly with the metronome running',
  ] as const;

  it.each(QUOTES)('"%s" — same chunk, same snippet, same score', (q) => {
    const c = clientEvidence(q, INDEX, 0);
    const s = serverEvidence(q, INDEX as unknown as ServerBM25Index, 0);
    expect(!!c, `client found nothing for "${q}"`).toBe(true);
    expect(s).not.toBeNull();
    expect(s!.timeSec).toBe(c!.timeSec);
    expect(s!.snippet).toBe(c!.snippet);
    expect(s!.score).toBeCloseTo(c!.score, 10);
  });

  it('the below-floor term grounds identically here, unlike searchBM25', () => {
    // Same input, two different verdicts on the two paths — worth stating
    // explicitly, because it is the reason group B1 and group C disagree
    // about "posture" without either being wrong.
    expect(clientIds(INDEX, 'posture')).toEqual([]);
    expect(clientEvidence('posture', INDEX, 0)).not.toBeNull();
  });

  it('the minScore gate opens and closes at the same point', () => {
    const c = clientEvidence('arpeggio', INDEX, 0)!;
    const justUnder = c.score - 1e-6;
    const justOver = c.score + 1e-6;
    expect(clientEvidence('arpeggio', INDEX, justUnder)).not.toBeNull();
    expect(serverEvidence('arpeggio', INDEX as unknown as ServerBM25Index, justUnder)).not.toBeNull();
    expect(clientEvidence('arpeggio', INDEX, justOver)).toBeNull();
    expect(serverEvidence('arpeggio', INDEX as unknown as ServerBM25Index, justOver)).toBeNull();
    // Exactly ON the threshold: both spell the comparison `score < minScore`,
    // so equality PASSES. A `<=` on either side flips this one alone.
    expect(clientEvidence('arpeggio', INDEX, c.score)).not.toBeNull();
    expect(serverEvidence('arpeggio', INDEX as unknown as ServerBM25Index, c.score)).not.toBeNull();
  });

  it('both return null when the quote shares nothing with the transcript', () => {
    expect(clientEvidence('harpsichord clavichord', INDEX, 0)).toBeNull();
    expect(serverEvidence('harpsichord clavichord', INDEX as unknown as ServerBM25Index, 0)).toBeNull();
  });

  it('the default minScore is 1.0 on both sides, bracketed', () => {
    // Two probes that straddle the default, so ANY other default is red:
    //   "guitar"  scores 0.7001  -> must be refused
    //   "posture" scores 1.4512  -> must be accepted
    // A default anywhere outside (0.7001, 1.4512] flips one of them.
    const weak = clientEvidence('guitar', INDEX, 0)!;
    const strong = clientEvidence('posture', INDEX, 0)!;
    expect(weak.score).toBeGreaterThan(0.5);
    expect(weak.score).toBeLessThan(1);
    expect(strong.score).toBeGreaterThan(1);
    expect(strong.score).toBeLessThan(2);

    expect(clientEvidence('guitar', INDEX)).toBeNull();
    expect(serverEvidence('guitar', INDEX as unknown as ServerBM25Index)).toBeNull();
    expect(clientEvidence('posture', INDEX)).not.toBeNull();
    expect(serverEvidence('posture', INDEX as unknown as ServerBM25Index)).not.toBeNull();
  });
});

// -----------------------------------------------------------------------------
// D. Timecode rewriting
// -----------------------------------------------------------------------------

describe('D. verifyTimecodesInText — identical rewrites', () => {
  // This transitively pins THREE private functions that cannot be compared by
  // import: the client's `formatMmss` against the server's `formatTimecode`,
  // and both copies of `parseTcStringToSeconds`. A rewrite exercises parse on
  // the way in and format on the way out.
  const padding = 'padding word '.repeat(20);
  const CASES = [
    `The arpeggio shape starts here [00:10] and we cover it in depth. ${padding} Later the metronome section at [05:00] discusses tempo and counting at length so there is real context to score.`,
    `See (00:30) for the vibrato demonstration and how the hand moves, then keep going for a while so the context window has something in it at all.`,
    `Bare style: at 09:12 the arpeggio comes back, and the surrounding sentence is long enough to give the scorer something to work with here.`,
    `Hour form [1:02:03] appears mid-sentence about the metronome and counting, with enough words around it to clear the twenty-character context bar.`,
    `Too short [00:05].`,
    `No citations here at all, just prose about arpeggios and metronomes.`,
  ] as const;

  it.each(CASES.map((t, i) => [i, t] as const))('case %i — identical text and overrides', (_i, text) => {
    const c = clientVerify(text, INDEX);
    const s = serverVerify(text, INDEX as unknown as ServerBM25Index);
    expect(s.text).toBe(c.text);
    // The server returns an extra `ungrounded[]`; `overrides` is the shared shape.
    expect(s.overrides).toEqual(c.overrides);
  });

  it('at least one case actually rewrites something', () => {
    // Otherwise every assertion above is "both did nothing".
    const total = CASES.reduce((n, t) => n + clientVerify(t, INDEX).overrides.length, 0);
    expect(total).toBeGreaterThan(0);
  });

  // The two defaults, bracketed. `verifyTimecodesInText` reads
  // `toleranceSec ?? 30` and `minScore ?? 1.5` on both sides; a case list
  // alone does not pin either number, because every case sits far from the
  // boundary. These two do the pinning.
  //
  // Both texts are written so that only INDEXED fixture terms carry score:
  // "posture"/"lesson" (context score 1.4595, just under 1.5) and
  // "metronome"/"lesson" (1.5317, just over). Do not add the words guitar,
  // arpeggio, vibrato or pad to them.
  const UNDER_THRESHOLD =
    'We talk at length about posture in this lesson and how it matters [09:00] and then keep going with more general commentary that has no indexed words in it whatsoever.';
  const OVER_THRESHOLD =
    'We talk at length about the metronome in this lesson and how it matters [09:00] and then keep going with more general commentary that has no indexed words in it whatsoever.';

  it('the default minScore is 1.5 on both sides, bracketed', () => {
    const under = clientEvidence('posture lesson', INDEX, 0)!;
    const over = clientEvidence('metronome lesson', INDEX, 0)!;
    expect(under.score).toBeLessThan(1.5);
    expect(under.score).toBeGreaterThan(1.4);
    expect(over.score).toBeGreaterThan(1.5);
    expect(over.score).toBeLessThan(1.6);

    // Under the bar: no anchor confident enough, so the citation stands.
    for (const v of [clientVerify(UNDER_THRESHOLD, INDEX), serverVerify(UNDER_THRESHOLD, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toEqual([]);
      expect(v.text).toBe(UNDER_THRESHOLD);
    }
    // Over the bar: grounded at 07:00 and rewritten away from 09:00.
    for (const v of [clientVerify(OVER_THRESHOLD, INDEX), serverVerify(OVER_THRESHOLD, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toHaveLength(1);
      expect(v.overrides[0]).toMatchObject({ from: '09:00', to: '07:00' });
    }
  });

  it('the default toleranceSec is 30 on both sides, bracketed', () => {
    // OVER_THRESHOLD grounds at 420s. Cite 30s away -> inside tolerance, no
    // rewrite. Cite 31s away -> outside, rewrite. Same string length either
    // way, so the context window is byte-identical between the two runs.
    const at30 = OVER_THRESHOLD.replace('[09:00]', '[07:30]'); // |450 - 420| = 30
    const at31 = OVER_THRESHOLD.replace('[09:00]', '[07:31]'); // |451 - 420| = 31

    for (const v of [clientVerify(at30, INDEX), serverVerify(at30, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toEqual([]);
    }
    for (const v of [clientVerify(at31, INDEX), serverVerify(at31, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toHaveLength(1);
      expect(v.overrides[0]).toMatchObject({ from: '07:31', to: '07:00' });
    }
  });

  it('h:mm:ss parses as HOURS on both sides', () => {
    // Both copies of the private `parseTcStringToSeconds` special-case a
    // three-part timecode. Pinning it needs a value where the hours field
    // decides the outcome: `[1:07:00]` is 4020s (3600s of drift -> rewrite),
    // but 420s if the hour is dropped (0s of drift -> no rewrite). Any case
    // with a further-away timecode rewrites under both readings and proves
    // nothing.
    const hourForm =
      'We talk at length about the metronome in this lesson and how it matters [1:07:00] and then keep going with more general commentary that has no indexed words in it.';
    for (const v of [clientVerify(hourForm, INDEX), serverVerify(hourForm, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toHaveLength(1);
      expect(v.overrides[0]).toMatchObject({ from: '1:07:00', to: '07:00' });
    }
  });

  it('the context window is +/-200 chars on both sides', () => {
    // The window size decides WHICH text gets scored, so drift there changes
    // grounding without touching any BM25 constant. Pinned by putting the
    // only indexed terms just BEYOND 200 chars after the citation: at 200 the
    // citation is ungrounded and survives; at 250 it would be rewritten.
    const leadIn = 'Talk about nothing in particular here. ';
    const beyond = `${leadIn}[09:00] ${'x'.repeat(203)} metronome lesson.`;
    for (const v of [clientVerify(beyond, INDEX), serverVerify(beyond, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toEqual([]);
      expect(v.text).toBe(beyond);
    }
    // Move the same terms inside the window and it rewrites — proving the
    // assertion above is about the window, not about the terms being unfindable.
    const within = `${leadIn}[09:00] ${'x'.repeat(150)} metronome lesson.`;
    for (const v of [clientVerify(within, INDEX), serverVerify(within, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toHaveLength(1);
      expect(v.overrides[0]).toMatchObject({ from: '09:00', to: '07:00' });
    }
  });

  it('the minimum-context bar is 20 chars on both sides', () => {
    // "Hm metronome." collapses to a 13-char context: under the bar, so the
    // citation is left alone even though `metronome` would ground it firmly.
    const tooShort = 'Hm [00:05] metronome.';
    for (const v of [clientVerify(tooShort, INDEX), serverVerify(tooShort, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toEqual([]);
      expect(v.text).toBe(tooShort);
    }
    // Pad the same sentence past 20 chars of context and it rewrites.
    const longEnough = 'Here we are now [00:05] metronome.';
    for (const v of [clientVerify(longEnough, INDEX), serverVerify(longEnough, INDEX as unknown as ServerBM25Index)]) {
      expect(v.overrides).toHaveLength(1);
      expect(v.overrides[0]).toMatchObject({ from: '00:05', to: '07:00' });
    }
  });

  it('custom tolerance and minScore behave identically', () => {
    const text = CASES[0];
    for (const opts of [
      { toleranceSec: 0 },
      { toleranceSec: 100000 },
      { minScore: 0 },
      { minScore: 1000 },
      { toleranceSec: 5, minScore: 0.5 },
    ]) {
      const c = clientVerify(text, INDEX, opts);
      const s = serverVerify(text, INDEX as unknown as ServerBM25Index, opts);
      expect(s.text, JSON.stringify(opts)).toBe(c.text);
      expect(s.overrides, JSON.stringify(opts)).toEqual(c.overrides);
    }
  });

  it('KNOWN, UNREACHABLE: the server formatter drops the client Math.max(0) clamp', () => {
    // The client's `formatMmss` starts `Math.max(0, Math.floor(sec))`; the
    // server's `formatTimecode` does not. The two therefore DISAGREE on a
    // negative input, and asserting they agree there would be false.
    //
    // Instead assert what makes it not matter: a chunk's timeSec is derived
    // from a word offset or a caption start, and is non-negative by
    // construction. So `formatTimecode` is never handed a negative value from
    // an index this codebase built.
    expect(serverFormatTimecode(-5)).not.toBe('00:00'); // the clamp is genuinely absent
    expect(serverFormatTimecode(0)).toBe('00:00');
    expect(serverFormatTimecode(65)).toBe('01:05');
    expect(serverFormatTimecode(3725)).toBe('1:02:05');

    // The client's clamp, reached through the only exported caller of its
    // private `formatMmss`. Asserted so the sentence above stays true in both
    // directions: if the client ever drops the clamp the two agree, and this
    // test's premise is gone.
    const negative = prepareSegmentedTranscript([{ text: 'early words here', startMs: -5_000 }]);
    expect(annotateWithTimecodes(negative, 30)).toContain('[00:00]');

    const prepared = prepareSegmentedTranscript([
      { text: 'first segment about arpeggios', startMs: 0 },
      { text: 'second segment about the metronome', startMs: 12_000 },
      { text: 'third segment about vibrato and tone', startMs: 40_500 },
    ]);
    for (const chunk of chunkForRetrieval(prepared, 120)) {
      expect(chunk.timeSec).toBeGreaterThanOrEqual(0);
    }
    for (const chunk of chunkForRetrieval('a plain cleaned string with no timings at all', 60)) {
      expect(chunk.timeSec).toBeGreaterThanOrEqual(0);
    }
    for (const chunk of INDEX.chunks) {
      expect(chunk.timeSec).toBeGreaterThanOrEqual(0);
    }
  });
});

// -----------------------------------------------------------------------------
// E. The wire format
// -----------------------------------------------------------------------------
//
// The highest-value group in this file. `Video.transcriptSegments` is a
// persisted JSON blob whose type is declared in BOTH packages, and unlike the
// embedding columns it carries NO model/version staleness field — `version` is
// the hardcoded literal 1 and has never been bumped. Nothing else in the repo
// asserts that the writer's output is readable by the reader.

describe('E. stored-index wire format — client writes, server reads', () => {
  const wire = () =>
    JSON.parse(
      JSON.stringify({
        version: 1,
        bm25: INDEX,
        rawSegments: [{ text: 'first', startMs: 0 }],
        durationSec: 1200,
      }),
    );

  it('both validators accept a freshly serialised index', () => {
    const w = wire();
    expect(clientIsStoredIndex(w)).toBe(true);
    expect(serverIsStoredIndex(w)).toBe(true);
  });

  it('the server searches the round-tripped blob to the same answer', () => {
    const w = wire();
    // Server: raw `.bm25`, exactly as search-transcript.ts uses it.
    expect(serverIds(w.bm25, 'arpeggio')).toEqual([23, 7]);
    expect(serverIds(w.bm25, 'metronome')).toEqual(serverIds(INDEX, 'metronome'));
    // Client: through `loadStoredIndex`, exactly as chat-retrieval.ts uses it.
    const loaded = loadStoredIndex(w)!;
    expect(clientIds(loaded.bm25, 'arpeggio')).toEqual([23, 7]);
    expect(serverIds(w.bm25, 'arpeggio')).toEqual(clientIds(loaded.bm25, 'arpeggio'));
  });

  it('sidecar fields survive and stay optional', () => {
    const w = wire();
    expect(w.rawSegments).toHaveLength(1);
    expect(w.durationSec).toBe(1200);
    // Both are optional on the way in — absent is legal.
    const bare = { version: 1, bm25: JSON.parse(JSON.stringify(INDEX)) };
    expect(clientIsStoredIndex(bare)).toBe(true);
    expect(serverIsStoredIndex(bare)).toBe(true);
  });

  it('both validators reject the same malformed shapes', () => {
    const bad: unknown[] = [
      null,
      undefined,
      {},
      'string',
      42,
      { version: 2, bm25: { chunks: [] } },
      { version: '1', bm25: { chunks: [] } },
      { version: 1, bm25: null },
      { version: 1 },
      { version: 1, bm25: {} },
      { version: 1, bm25: { chunks: null } },
      { version: 1, bm25: { chunks: 'nope' } },
    ];
    for (const v of bad) {
      expect(clientIsStoredIndex(v), `client accepted ${JSON.stringify(v)}`).toBe(false);
      expect(serverIsStoredIndex(v), `server accepted ${JSON.stringify(v)}`).toBe(false);
    }
  });

  it('FIXED: a prototype-named query term no longer blanks the server', () => {
    // ---------------------------------------------------------------------
    // This replaces a test that PINNED the bug. Worth keeping the mechanism
    // written down, because the shape of it is the whole argument of ADR 0010.
    //
    // `buildBM25Index` builds tf/idf as `Object.create(null)` maps precisely so
    // a term named `constructor` cannot collide with Object.prototype.
    // JSON.stringify/parse — exactly how Strapi stores and returns the column —
    // DISCARDS the null prototype. The client repairs it at its load boundary:
    // `loadStoredIndex` -> `sanitizeNumberMap` rebuilds on Object.create(null).
    // The server had no such step, so `index.idf['constructor']` handed back the
    // native Object function: truthy, survives `if (!idf)`, and makes every
    // score NaN, which `score > 0` then drops. Adding one word to a query made
    // searchTranscript, crossSearchTranscripts and verifyCitations return
    // NOTHING, silently.
    //
    // That is the duplication tax this ADR is about, and note WHERE it was paid:
    // whoever wrote the server copy mirrored the scoring loop faithfully and
    // missed the sanitizer, because the sanitizer lives in a different function
    // in a different file. Reading the code you are copying is not enough.
    //
    // The fix guards at the LOOKUP (typeof === 'number') rather than adding a
    // load step, so no caller can bypass it — all three hand searchBM25 the raw
    // parsed column.
    // ---------------------------------------------------------------------
    const w = wire();
    const loaded = loadStoredIndex(w)!;

    // Baseline: the query works without the poison term.
    expect(serverIds(w.bm25, 'arpeggio')).toEqual([23, 7]);

    // In-memory (null-prototype) maps were never affected.
    expect(serverIds(INDEX, 'arpeggio constructor')).toEqual([23, 7]);

    // The round trip no longer breaks it — this is the assertion that flipped.
    expect(serverIds(w.bm25, 'arpeggio constructor')).toEqual([23, 7]);
    expect(serverEvidence('arpeggio constructor', w.bm25, 0)).not.toBeNull();

    // And the two sides now agree, which is the point.
    expect(serverIds(w.bm25, 'arpeggio constructor')).toEqual(
      clientIds(loaded.bm25, 'arpeggio constructor'),
    );

    // The bare poison term alone must be inert, not catastrophic: it is simply
    // a term the index does not contain.
    expect(serverIds(w.bm25, 'constructor')).toEqual(clientIds(loaded.bm25, 'constructor'));

    // Every other Object.prototype member, in case tokenize ever stops
    // lowercasing or the pattern widens. These are unreachable today; the guard
    // is typeof-based so they cost nothing to cover.
    for (const poison of ['tostring', 'valueof', 'hasownproperty', 'isprototypeof']) {
      expect(serverIds(w.bm25, `arpeggio ${poison}`)).toEqual([23, 7]);
    }
  });
});

// -----------------------------------------------------------------------------
// F. Guard the guard
// -----------------------------------------------------------------------------

describe('F. the two modules stay import-free', () => {
  // Dependency-freedom is the ONLY reason this cross-package import is legal.
  // Add one import to either file and this test file starts resolving through
  // a foreign node_modules — the exact failure mode CLAUDE.md's separate-installs
  // rule exists to prevent. Nothing else in the repo checks this.
  const FILES = [
    ['server/src/services/bm25-search.ts', join(__dirname, 'bm25-search.ts')],
    [
      'client/src/lib/services/transcript.ts',
      join(__dirname, '..', '..', '..', 'client', 'src', 'lib', 'services', 'transcript.ts'),
    ],
  ] as const;

  it.each(FILES)('%s has no import or require', (label, path) => {
    const src = readFileSync(path, 'utf8');
    const withoutComments = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const offenders = [
      ...withoutComments.matchAll(/^\s*import\s/gm),
      ...withoutComments.matchAll(/\brequire\s*\(/g),
      ...withoutComments.matchAll(/^\s*export\s+.*\bfrom\s/gm),
    ].map((m) => m[0].trim());
    expect(offenders, `${label} gained a dependency — this parity test can no longer import it safely`).toEqual([]);
  });

  it('server/src contains no BM25 INDEXER — the server is read-only here', () => {
    // The single fact that caps the blast radius of every divergence above,
    // and the stated reversal condition for ADR 0010: the day `server/` gains
    // a write path over `Video.transcriptSegments`, the wire format has two
    // producers labelled `version: 1` with no staleness field to tell them
    // apart, and a parity test stops being adequate protection.
    //
    // Scans ALL server source, not just this file. Test files are excluded —
    // this suite legitimately imports the client's indexer to build fixtures.
    const SRC_ROOT = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;
        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^[ \t]*\/\/.*$/gm, '');
        if (/\bbuildBM25Index\b/.test(code)) offenders.push(full.slice(SRC_ROOT.length + 1));
      }
    };
    walk(SRC_ROOT);
    expect(
      offenders,
      'server source now builds a BM25 index — re-read ADR 0010, the verdict reverses here',
    ).toEqual([]);
  });
});
