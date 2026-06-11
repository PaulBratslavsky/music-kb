// Contract tests for the retrieval core behind /api/ask — black-box through
// the public interface so internal refactors don't break them. Fixtures go
// in via mocked `listAllVideosForEmbeddingService` + `embedText`; assertions
// read only the returned shapes. The fusion math itself is pinned in
// retrieval-fusion.test.ts — these tests only rely on "higher cosine ⇒
// higher fused rank", which holds because the query token appears in no
// fixture text, so the BM25 leg returns nothing and the fused order equals
// the dense order (deterministic).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const embedTextMock = vi.fn();
vi.mock('./embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./embeddings')>();
  return {
    ...actual,
    // Only the Ollama call is faked — passageStatus stays real so the
    // stale-index test exercises the actual model/version gate.
    embedText: (...args: unknown[]) => embedTextMock(...args),
  };
});

const listAllVideosMock = vi.fn();
vi.mock('./videos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./videos')>();
  return {
    ...actual,
    listAllVideosForEmbeddingService: () => listAllVideosMock(),
  };
});

import {
  CURRENT_EMBEDDING_MODEL,
  CURRENT_PASSAGE_VERSION,
} from './embeddings';
import type { StrapiVideo } from './videos';
import {
  formatSeedForPrompt,
  groupPassagesByVideo,
  retrievePassagesForQuery,
  type RetrievedPassage,
} from './ask-library';

// Nonsense token absent from every fixture text → BM25 contributes nothing.
const QUERY = 'zzyzxquery';
const QUERY_VEC = [1, 0];

// Unit vector whose cosine against QUERY_VEC is exactly `c`, so fixture
// rankings (and minScore floors) are unambiguous.
function vec(c: number): number[] {
  return [c, Math.sqrt(1 - c * c)];
}

type PassageFixture = {
  text: string;
  cosine: number;
  startSec?: number;
  endSec?: number;
};

// Only the fields the retrieval path reads are populated.
function makeVideo(
  documentId: string,
  passages: PassageFixture[],
  overrides: Partial<StrapiVideo> = {},
): StrapiVideo {
  const base: Partial<StrapiVideo> = {
    documentId,
    youtubeVideoId: `yt-${documentId}`,
    videoTitle: `Title ${documentId}`,
    videoAuthor: `Author ${documentId}`,
    videoThumbnailUrl: null,
    summaryDescription: null,
    summaryOverview: null,
    keyTakeaways: [],
    tags: [],
    passageEmbeddings: {
      model: CURRENT_EMBEDDING_MODEL,
      version: CURRENT_PASSAGE_VERSION,
      generatedAt: '2026-01-01T00:00:00.000Z',
      chunks: passages.map((p) => ({
        text: p.text,
        startSec: p.startSec ?? 0,
        endSec: p.endSec ?? 30,
        embedding: vec(p.cosine),
      })),
    },
  };
  return { ...base, ...overrides } as StrapiVideo;
}

beforeEach(() => {
  embedTextMock.mockReset();
  embedTextMock.mockResolvedValue(QUERY_VEC);
  listAllVideosMock.mockReset();
});

describe('retrievePassagesForQuery', () => {
  it('returns [] for an empty corpus', async () => {
    listAllVideosMock.mockResolvedValue([]);
    expect(await retrievePassagesForQuery(QUERY)).toEqual([]);
  });

  it('caps distinct videos at maxVideos, ranked by best passage', async () => {
    // Corpus order C, A, B — the cap must keep the two best-RANKED
    // videos, not the first two stored.
    listAllVideosMock.mockResolvedValue([
      makeVideo('C', [{ text: 'c-passage', cosine: 0.7 }]),
      makeVideo('A', [{ text: 'a-passage', cosine: 0.9 }]),
      makeVideo('B', [{ text: 'b-passage', cosine: 0.8 }]),
    ]);

    const result = await retrievePassagesForQuery(QUERY, { maxVideos: 2 });

    expect(result.map((r) => r.video.documentId)).toEqual(['A', 'B']);
  });

  it('caps each video at passagesPerVideo, keeping its top-ranked passages', async () => {
    listAllVideosMock.mockResolvedValue([
      makeVideo('A', [
        { text: 'weak', cosine: 0.6 },
        { text: 'best', cosine: 0.9 },
        { text: 'mid', cosine: 0.7 },
        { text: 'second', cosine: 0.8 },
      ]),
    ]);

    const result = await retrievePassagesForQuery(QUERY, {
      passagesPerVideo: 2,
    });

    expect(result.map((r) => r.text)).toEqual(['best', 'second']);
  });

  it('excludes passages below the minScore cosine floor', async () => {
    listAllVideosMock.mockResolvedValue([
      makeVideo('A', [
        { text: 'above', cosine: 0.9 },
        { text: 'below', cosine: 0.2 },
      ]),
    ]);

    const some = await retrievePassagesForQuery(QUERY, { minScore: 0.5 });
    expect(some.map((r) => r.text)).toEqual(['above']);

    const none = await retrievePassagesForQuery(QUERY, { minScore: 0.95 });
    expect(none).toEqual([]);
  });

  it('contributes nothing from videos whose passage index is stale or missing', async () => {
    // Stale fixtures carry far better cosine than the current one — the
    // real passageStatus gate must drop them anyway.
    const staleModel = makeVideo('stale-model', [
      { text: 'stale-model-hit', cosine: 0.99 },
    ]);
    staleModel.passageEmbeddings!.model = 'some-retired-model';

    const staleVersion = makeVideo('stale-version', [
      { text: 'stale-version-hit', cosine: 0.98 },
    ]);
    staleVersion.passageEmbeddings!.version = CURRENT_PASSAGE_VERSION - 1;

    const noIndex = makeVideo('no-index', [], { passageEmbeddings: null });
    const emptyIndex = makeVideo('empty-index', []);
    const current = makeVideo('current', [
      { text: 'current-hit', cosine: 0.5 },
    ]);

    listAllVideosMock.mockResolvedValue([
      staleModel,
      staleVersion,
      noIndex,
      emptyIndex,
      current,
    ]);

    const result = await retrievePassagesForQuery(QUERY);

    expect(result.map((r) => r.text)).toEqual(['current-hit']);
  });

  it('clusters output by video in rank order with ids assigned in emission order', async () => {
    listAllVideosMock.mockResolvedValue([
      // B stored first but ranks second (best passage 0.8 < A's 0.9).
      makeVideo(
        'B',
        [{ text: 'b-only', cosine: 0.8, startSec: 120, endSec: 150 }],
        { keyTakeaways: null, tags: null },
      ),
      // A's stronger passage stored second — within-video order must
      // follow rank, not storage order.
      makeVideo(
        'A',
        [
          { text: 'a-lo', cosine: 0.7 },
          { text: 'a-hi', cosine: 0.9 },
        ],
        {
          keyTakeaways: [{ id: 1, text: 'takeaway one' }],
          tags: [{ id: 7, documentId: 'tag-doc', name: 'jazz', slug: 'jazz' }],
        },
      ),
    ]);

    const result = await retrievePassagesForQuery(QUERY);

    expect(result.map((r) => [r.id, r.video.documentId, r.text])).toEqual([
      [0, 'A', 'a-hi'],
      [1, 'A', 'a-lo'],
      [2, 'B', 'b-only'],
    ]);
    expect(result[0].rrfScore).toBeGreaterThan(result[1].rrfScore);
    expect(result[0].cosineScore).toBeCloseTo(0.9, 10);
    expect(result[2].startSec).toBe(120);
    expect(result[2].endSec).toBe(150);
    // Takeaways/tags map to lean shapes; null collapses to [].
    expect(result[0].video.keyTakeaways).toEqual([{ text: 'takeaway one' }]);
    expect(result[0].video.tags).toEqual([{ name: 'jazz' }]);
    expect(result[2].video.keyTakeaways).toEqual([]);
    expect(result[2].video.tags).toEqual([]);
  });
});

// =============================================================================
// groupPassagesByVideo / formatSeedForPrompt — pure shaping over the pool.
// =============================================================================

function retrieved(input: {
  documentId: string;
  text: string;
  startSec?: number;
}): RetrievedPassage {
  return {
    // Real pools carry positional ids, but the grouping contract is that
    // citation indices come from ARRAY POSITION, not this field.
    id: 999,
    video: {
      documentId: input.documentId,
      youtubeVideoId: `yt-${input.documentId}`,
      videoTitle: `Title ${input.documentId}`,
      videoAuthor: null,
      videoThumbnailUrl: null,
      summaryDescription: null,
      summaryOverview: null,
      keyTakeaways: [],
      tags: [],
    },
    text: input.text,
    startSec: input.startSec ?? 0,
    endSec: (input.startSec ?? 0) + 30,
    cosineScore: 0.8,
    rrfScore: 0.02,
  };
}

describe('groupPassagesByVideo', () => {
  it('groups by documentId in first-seen order with position-based citation indices', () => {
    const groups = groupPassagesByVideo([
      retrieved({ documentId: 'A', text: 'a1' }),
      retrieved({ documentId: 'B', text: 'b1' }),
      retrieved({ documentId: 'A', text: 'a2', startSec: 45 }),
    ]);

    expect(groups.map((g) => g.video.documentId)).toEqual(['A', 'B']);
    expect(groups.map((g) => g.rank)).toEqual([1, 2]);
    expect(groups[0].passages.map((p) => p.index)).toEqual([0, 2]);
    expect(groups[1].passages.map((p) => p.index)).toEqual([1]);
    expect(groups[0].passages[1]).toEqual({
      index: 2,
      text: 'a2',
      startSec: 45,
      endSec: 75,
    });
  });

  it('returns [] for an empty pool', () => {
    expect(groupPassagesByVideo([])).toEqual([]);
  });
});

describe('formatSeedForPrompt', () => {
  it('returns the empty string for an empty pool', () => {
    expect(formatSeedForPrompt([])).toBe('');
  });

  it('caps anchors at 3 per card and advertises the remainder via load_passages', () => {
    const seed = formatSeedForPrompt([
      retrieved({ documentId: 'A', text: 'anchor-0' }),
      retrieved({ documentId: 'A', text: 'anchor-1' }),
      retrieved({ documentId: 'A', text: 'anchor-2' }),
      retrieved({ documentId: 'A', text: 'hidden-3' }),
      retrieved({ documentId: 'A', text: 'hidden-4' }),
    ]);

    expect(seed).toContain('anchor-0');
    expect(seed).toContain('anchor-1');
    expect(seed).toContain('anchor-2');
    expect(seed).not.toContain('hidden-3');
    expect(seed).not.toContain('hidden-4');
    expect(seed).toContain('(2 more passages available via load_passages("yt-A"))');
  });

  it('uses the singular hint for exactly one extra passage', () => {
    const seed = formatSeedForPrompt([
      retrieved({ documentId: 'A', text: 'p0' }),
      retrieved({ documentId: 'A', text: 'p1' }),
      retrieved({ documentId: 'A', text: 'p2' }),
      retrieved({ documentId: 'A', text: 'p3' }),
    ]);

    expect(seed).toContain('(1 more passage available via load_passages("yt-A"))');
  });

  it('omits the load_passages hint when every passage fits in the anchors', () => {
    const seed = formatSeedForPrompt([
      retrieved({ documentId: 'A', text: 'p0' }),
      retrieved({ documentId: 'A', text: 'p1' }),
      retrieved({ documentId: 'A', text: 'p2' }),
    ]);

    // The seed preamble mentions load_passages generically; only the
    // per-card "(N more ...)" hint must be absent.
    expect(seed).not.toContain('more passage');
  });

  it('formats anchor timestamps as m:ss below an hour and h:mm:ss above', () => {
    const seed = formatSeedForPrompt([
      retrieved({ documentId: 'A', text: 'early', startSec: 65 }),
      retrieved({ documentId: 'A', text: 'late', startSec: 3661 }),
    ]);

    expect(seed).toContain('[0] @ 1:05: early');
    expect(seed).toContain('[1] @ 1:01:01: late');
  });
});
