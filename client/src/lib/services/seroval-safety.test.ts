import { describe, it, expect } from 'vitest';
import { serialize } from 'seroval';
import { buildBM25Index } from './transcript';
import { stripVideoForClient, type StrapiVideo } from './videos';

// ---------------------------------------------------------------------------
// Seroval boundary contract
//
// TanStack Start serializes every loader / server-fn return value with
// seroval before streaming it to the browser.
//
// Historically seroval REJECTED any object carrying `constructor` (or
// another Object.prototype name) as an own property, and a BM25 token
// table naturally grows a `constructor` key whenever a transcript says
// the word "constructor" (common in programming videos). That crash was
// the original reason no video crossing the server→client boundary may
// carry `transcriptSegments`.
//
// **seroval 1.6 fixed it** — reserved-name own properties now serialize
// as computed keys (`{["constructor"]: 3}`). The first two tests below
// pin that new behaviour so a regression upstream is caught here.
//
// The strip contract itself is unchanged and still enforced by the rest
// of this file, but it now rests on payload size rather than a crash: a
// full BM25 index is large, and the browser never needs it. Dropping the
// strip would bloat every feed response, so `stripVideoForClient`
// remains mandatory.
// ---------------------------------------------------------------------------

function expectSerovalSafe(value: unknown, label: string): void {
  expect(() => serialize(value), `${label} must be seroval-serializable`).not.toThrow();
}

// Minimal-but-faithful StrapiVideo. Only the fields that matter for the
// boundary contract are realistic; the rest are nulled.
function makeVideo(overrides: Partial<StrapiVideo> = {}): StrapiVideo {
  return {
    id: 1,
    documentId: 'abc123',
    youtubeVideoId: '4HaFaYMbal0',
    url: 'https://youtu.be/4HaFaYMbal0',
    videoTitle: 'Building a constructor pattern in TypeScript',
    videoAuthor: 'Some Channel',
    videoThumbnailUrl: 'https://i.ytimg.com/vi/4HaFaYMbal0/hqdefault.jpg',
    caption: null,
    createdAt: '2026-05-15T00:00:00.000Z',
    tags: null,
    summaryStatus: 'generated',
    summaryTitle: null,
    summaryDescription: null,
    summaryOverview: null,
    watchVerdict: null,
    verdictSummary: null,
    verdictReason: null,
    valueScore: null,
    valueScoreSource: null,
    signalScores: null,
    signalScore: null,
    finalScore: null,
    readableArticle: null,
    readableArticleGeneratedAt: null,
    readableArticleModel: null,
    summaryGeneratedAt: null,
    aiModel: null,
    transcriptSegments: null,
    summaryEmbedding: null,
    embeddingModel: null,
    embeddingVersion: null,
    embeddingGeneratedAt: null,
    passageEmbeddings: null,
    keyTakeaways: null,
    sections: null,
    actionSteps: null,
    transcript: null,
    ...overrides,
  } as StrapiVideo;
}

// A BM25 index built from text that contains the token "constructor".
// This is the exact shape that crashes the loader stream — built clean
// by the current code, it STILL has `constructor` as an own key.
function makeReservedTokenIndex() {
  const chunks = [
    { id: 0, text: 'first the constructor pattern and the toString method', startWord: 0, timeSec: 0 },
    { id: 1, text: 'then we call super and check hasOwnProperty on the value', startWord: 10, timeSec: 30 },
    { id: 2, text: 'finally valueOf returns the wrapped primitive', startWord: 20, timeSec: 60 },
  ];
  return {
    version: 1 as const,
    bm25: buildBM25Index(chunks),
    durationSec: 90,
  };
}

describe('seroval boundary contract', () => {
  it('a BM25 index containing reserved-name tokens is seroval-safe (since seroval 1.6)', () => {
    // Pre-1.6 this threw. Reserved-name own properties are now emitted as
    // computed keys, so an index built from a transcript containing
    // "constructor" survives the boundary. If this starts throwing again,
    // seroval regressed and the strip contract is load-bearing for
    // correctness once more, not just for payload size.
    const index = makeReservedTokenIndex();
    expectSerovalSafe(index, 'BM25 index with reserved-name tokens');
    expect(serialize(index)).toContain('["constructor"]');
  });

  it('a video carrying transcriptSegments survives the boundary', () => {
    const video = makeVideo({ transcriptSegments: makeReservedTokenIndex() });
    expectSerovalSafe(video, 'video carrying transcriptSegments');
  });

  it('stripVideoForClient makes the video seroval-safe', () => {
    const video = makeVideo({ transcriptSegments: makeReservedTokenIndex() });
    const stripped = stripVideoForClient(video);
    expect(stripped!.transcriptSegments).toBeNull();
    expectSerovalSafe(stripped, 'stripped video');
  });

  it('stripped video survives a list/array boundary (feed, digest, search hits)', () => {
    const videos = [
      makeVideo({ transcriptSegments: makeReservedTokenIndex() }),
      makeVideo({ documentId: 'def456', transcriptSegments: makeReservedTokenIndex() }),
    ].map((v) => stripVideoForClient(v));
    expectSerovalSafe(videos, 'feed-style video array');
    expectSerovalSafe(
      { status: 'ok', hits: videos.map((video) => ({ video, score: 0.9 })) },
      'semantic-search-style result',
    );
  });

  it('stripVideoForClient is null-safe', () => {
    expect(stripVideoForClient(null)).toBeNull();
  });
});
