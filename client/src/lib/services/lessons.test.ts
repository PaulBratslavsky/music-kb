import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./strapi-client', () => ({ strapiFetch: vi.fn() }));

import { strapiFetch } from './strapi-client';
import {
  computeLessonDuration,
  findLessonForVideoService,
  getLessonBySlugWithStatus,
  listLessonsWithStatus,
  saveLessonService,
} from './lessons';
import type { GeneratedLesson, SourceVideo } from './lesson-generation';
import type { LessonBlock } from './lessons';

const mocked = vi.mocked(strapiFetch);

beforeEach(() => mocked.mockReset());

function makeLesson(overrides: Partial<GeneratedLesson> = {}): GeneratedLesson {
  return {
    title: 'Drop D Basics',
    slug: 'drop-d-basics',
    summary: 'A short intro to drop D tuning.',
    level: 'beginner',
    instrument: 'guitar',
    duration: null,
    status: 'ai-generated',
    parameter: null,
    body: [],
    ...overrides,
  };
}

describe('listLessonsWithStatus', () => {
  it('returns the rows Strapi gave, with their fields intact', async () => {
    mocked.mockResolvedValue({
      ok: true,
      data: [
        { documentId: 'b', title: 'B', slug: 'b', order: 2 },
        { documentId: 'a', title: 'A', slug: 'a', order: 1 },
      ],
    } as never);
    const out = await listLessonsWithStatus();
    expect(out).toEqual({
      ok: true,
      lessons: [
        { documentId: 'b', title: 'B', slug: 'b', order: 2 },
        { documentId: 'a', title: 'A', slug: 'a', order: 1 },
      ],
    });
  });

  it('returns an empty list distinctly from a dead backend', async () => {
    mocked.mockResolvedValue({ ok: true, data: [] } as never);
    expect(await listLessonsWithStatus()).toEqual({ ok: true, lessons: [] });
  });

  it('distinguishes a dead backend from an empty collection', async () => {
    mocked.mockResolvedValue({ ok: false, status: 0, error: 'down' } as never);
    expect(await listLessonsWithStatus()).toEqual({
      ok: false,
      status: 0,
      error: 'down',
    });
  });
});

describe('getLessonBySlugWithStatus', () => {
  it('distinguishes a missing lesson from a dead backend', async () => {
    mocked.mockResolvedValue({ ok: true, data: [] } as never);
    const missing = await getLessonBySlugWithStatus('nope');
    expect(missing).toMatchObject({ ok: false, status: 404 });

    mocked.mockResolvedValue({ ok: false, status: 0, error: 'down' } as never);
    const down = await getLessonBySlugWithStatus('nope');
    expect(down).toMatchObject({ ok: false, status: 0 });
  });

  it('returns the lesson when found', async () => {
    mocked.mockResolvedValue({
      ok: true,
      data: [{ documentId: 'x', title: 'T', slug: 't', body: [] }],
    } as never);
    const found = await getLessonBySlugWithStatus('t');
    expect(found).toMatchObject({
      ok: true,
      lesson: { documentId: 'x', slug: 't' },
    });
  });

  it('uses the populated videos relation when present', async () => {
    mocked.mockResolvedValue({
      ok: true,
      data: [
        {
          documentId: 'x',
          title: 'T',
          slug: 't',
          body: [],
          videos: [
            {
              documentId: 'doc-1',
              youtubeVideoId: 'vid1',
              videoTitle: 'Video One',
              videoThumbnailUrl: null,
            },
          ],
        },
      ],
    } as never);
    const found = await getLessonBySlugWithStatus('t');
    expect(found).toMatchObject({
      ok: true,
      lesson: {
        videos: [{ documentId: 'doc-1', youtubeVideoId: 'vid1' }],
      },
    });
    // Relation was already populated — no fallback /api/videos lookup.
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('derives sources from blocks when an older lesson has an empty videos relation', async () => {
    const body = [
      {
        __component: 'lesson.prose',
        id: 1,
        body: 'a claim',
        source: { videoId: 'vid1', timeSec: 12 },
      },
      {
        __component: 'lesson.callout',
        id: 2,
        tone: 'note',
        body: 'another claim',
        source: { videoId: 'vid2' },
      },
      // Same video cited twice — should still appear once in the result.
      {
        __component: 'lesson.step',
        id: 3,
        number: 1,
        title: 'Step',
        body: 'step body',
        source: { videoId: 'vid1', timeSec: 30 },
      },
    ];
    mocked.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/api/lessons') {
        return {
          ok: true,
          data: [{ documentId: 'x', title: 'T', slug: 't', body, videos: [] }],
        } as never;
      }
      if (method === 'GET' && path === '/api/videos') {
        return {
          ok: true,
          data: [
            {
              documentId: 'doc-1',
              youtubeVideoId: 'vid1',
              videoTitle: 'Video One',
              videoThumbnailUrl: null,
            },
            {
              documentId: 'doc-2',
              youtubeVideoId: 'vid2',
              videoTitle: 'Video Two',
              videoThumbnailUrl: null,
            },
          ],
        } as never;
      }
      // Benign fallback for a teardown-time phantom call — see the note
      // above in the saveLessonService tests, same tinyspy artifact.
      return { ok: true, data: [] } as never;
    });

    const found = await getLessonBySlugWithStatus('t');
    expect(found).toMatchObject({
      ok: true,
      lesson: {
        videos: [
          { documentId: 'doc-1', youtubeVideoId: 'vid1' },
          { documentId: 'doc-2', youtubeVideoId: 'vid2' },
        ],
      },
    });
  });

  it('renders no source videos for a hand-written lesson with no relation and no block sources', async () => {
    mocked.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/api/lessons') {
        return {
          ok: true,
          data: [
            {
              documentId: 'x',
              title: 'T',
              slug: 't',
              body: [{ __component: 'lesson.heading', id: 1, text: 'Intro' }],
              videos: [],
            },
          ],
        } as never;
      }
      // Benign fallback for a teardown-time phantom call — see the note
      // above in the saveLessonService tests, same tinyspy artifact.
      return { ok: true, data: [] } as never;
    });

    const found = await getLessonBySlugWithStatus('t');
    expect(found).toMatchObject({ ok: true, lesson: { videos: [] } });
  });
});

describe('saveLessonService', () => {
  it('creates the lesson at the requested slug when it is free', async () => {
    mocked.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/api/lessons') {
        return { ok: true, data: [] } as never; // slug free
      }
      if (method === 'POST' && path === '/api/lessons') {
        return {
          ok: true,
          data: { documentId: 'doc-1', slug: 'drop-d-basics' },
        } as never;
      }
      // Benign fallback rather than throwing: this vitest/tinyspy setup
      // invokes the mock once more, with no arguments, during test
      // teardown (after the assertions below already ran) — an
      // environment artifact, not a call this service ever makes.
      // Throwing here would surface as an unrelated unhandled rejection.
      return { ok: true, data: [] } as never;
    });

    const result = await saveLessonService(makeLesson());
    expect(result).toEqual({ ok: true, slug: 'drop-d-basics', documentId: 'doc-1' });

    // Sanity: the create call carries the CMS-shaped payload, not the
    // GeneratedLesson type verbatim (no `sources` field, for instance).
    const createCall = mocked.mock.calls.find(([m]) => m === 'POST');
    expect(createCall?.[2]).toMatchObject({
      body: { data: { slug: 'drop-d-basics', status: 'ai-generated' } },
    });
  });

  it('appends a numeric suffix when the derived slug collides, and never overwrites', async () => {
    const existingSlugs = new Set(['drop-d-basics', 'drop-d-basics-2']);
    mocked.mockImplementation(async (method, path, opts) => {
      if (method === 'GET' && path === '/api/lessons') {
        const candidate = (
          opts?.query?.filters as { slug?: { $eq?: string } } | undefined
        )?.slug?.$eq;
        const exists = !!candidate && existingSlugs.has(candidate);
        return { ok: true, data: exists ? [{ slug: candidate }] : [] } as never;
      }
      if (method === 'POST' && path === '/api/lessons') {
        const body = (opts?.body as { data: { slug: string } }).data;
        return { ok: true, data: { documentId: 'doc-3', slug: body.slug } } as never;
      }
      // See the note in the previous test — benign fallback for a
      // teardown-time phantom call, not a real code path.
      return { ok: true, data: [] } as never;
    });

    const result = await saveLessonService(makeLesson());
    expect(result).toEqual({ ok: true, slug: 'drop-d-basics-3', documentId: 'doc-3' });

    // Never a PUT/overwrite of the colliding rows — only GET (probes) and
    // one POST (create at the free slug).
    expect(mocked.mock.calls.every(([m]) => m === 'GET' || m === 'POST')).toBe(true);
    expect(mocked.mock.calls.filter(([m]) => m === 'POST')).toHaveLength(1);
  });

  it('surfaces a Strapi failure on the slug probe rather than throwing', async () => {
    mocked.mockResolvedValue({ ok: false, status: 0, error: 'down' } as never);
    const result = await saveLessonService(makeLesson());
    expect(result).toEqual({ ok: false, error: 'down' });
  });

  it('surfaces a Strapi failure on create rather than throwing', async () => {
    mocked.mockImplementation(async (method) => {
      if (method === 'GET') return { ok: true, data: [] } as never;
      return { ok: false, status: 500, error: 'create failed' } as never;
    });
    const result = await saveLessonService(makeLesson());
    expect(result).toEqual({ ok: false, error: 'create failed' });
  });

  it('fails loudly instead of silently succeeding when Strapi omits a documentId', async () => {
    mocked.mockImplementation(async (method) => {
      if (method === 'GET') return { ok: true, data: [] } as never;
      return { ok: true, data: {} } as never;
    });
    const result = await saveLessonService(makeLesson());
    expect(result).toMatchObject({ ok: false });
  });

  it('connects the videos relation from the generator sources by documentId', async () => {
    mocked.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/api/lessons') {
        return { ok: true, data: [] } as never; // slug free
      }
      if (method === 'POST' && path === '/api/lessons') {
        return {
          ok: true,
          data: { documentId: 'doc-1', slug: 'drop-d-basics' },
        } as never;
      }
      return { ok: true, data: [] } as never;
    });

    const sources: SourceVideo[] = [
      { documentId: 'video-doc-1', youtubeVideoId: 'vid1', title: 'Video One', score: 0.9 },
      { documentId: 'video-doc-2', youtubeVideoId: 'vid2', title: 'Video Two', score: 0.8 },
    ];
    const result = await saveLessonService(makeLesson(), sources);
    expect(result).toEqual({ ok: true, slug: 'drop-d-basics', documentId: 'doc-1' });

    const createCall = mocked.mock.calls.find(([m]) => m === 'POST');
    expect(createCall?.[2]).toMatchObject({
      body: { data: { videos: ['video-doc-1', 'video-doc-2'] } },
    });
  });

  it('connects no videos when saved without generator sources', async () => {
    mocked.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/api/lessons') {
        return { ok: true, data: [] } as never;
      }
      if (method === 'POST' && path === '/api/lessons') {
        return {
          ok: true,
          data: { documentId: 'doc-1', slug: 'drop-d-basics' },
        } as never;
      }
      return { ok: true, data: [] } as never;
    });

    await saveLessonService(makeLesson());
    const createCall = mocked.mock.calls.find(([m]) => m === 'POST');
    expect(createCall?.[2]).toMatchObject({ body: { data: { videos: [] } } });
  });

  it('overwrites the model-provided duration with a computed one (brief #4)', async () => {
    mocked.mockImplementation(async (method, path) => {
      if (method === 'GET' && path === '/api/lessons') return { ok: true, data: [] } as never;
      if (method === 'POST' && path === '/api/lessons') {
        return { ok: true, data: { documentId: 'doc-1', slug: 'drop-d-basics' } } as never;
      }
      return { ok: true, data: [] } as never;
    });

    // 400 words at 200 wpm = 2 minutes exactly — nothing like the model's
    // guess, which the save path must never let through unchanged.
    const body: LessonBlock[] = [
      {
        __component: 'lesson.prose',
        id: 1,
        body: Array.from({ length: 400 }, () => 'word').join(' '),
      } as unknown as LessonBlock,
    ];
    await saveLessonService(makeLesson({ duration: '30 min', body }));

    const createCall = mocked.mock.calls.find(([m]) => m === 'POST');
    expect(createCall?.[2]).toMatchObject({ body: { data: { duration: '2 min' } } });
  });
});

describe('computeLessonDuration', () => {
  const proseBlock = (words: number, id: number): LessonBlock =>
    ({
      __component: 'lesson.prose',
      id,
      body: Array.from({ length: words }, () => 'word').join(' '),
    }) as unknown as LessonBlock;

  it('returns null for an empty body — nothing to estimate', () => {
    expect(computeLessonDuration([])).toBeNull();
  });

  it('computes minutes from word count at 200 words/minute', () => {
    expect(computeLessonDuration([proseBlock(400, 1)])).toBe('2 min');
  });

  it('floors at 1 minute rather than reporting 0', () => {
    expect(computeLessonDuration([proseBlock(10, 1)])).toBe('1 min');
  });

  it('keeps similarly-sized lessons close, unlike the model guess it replaces', () => {
    // Real numbers from the brief: 1,769 and 1,682 words came back "7 min"
    // and "20 min" from the model despite being close in length. A
    // computed duration for word counts this close must itself be close.
    const minutesOf = (s: string | null) => Number(s?.match(/\d+/)?.[0]);
    const a = minutesOf(computeLessonDuration([proseBlock(1769, 1)]));
    const b = minutesOf(computeLessonDuration([proseBlock(1682, 1)]));
    expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  });

  it('adds a fixed allowance per diagram/table block on top of the word count', () => {
    const minutesOf = (s: string | null) => Number(s?.match(/\d+/)?.[0]);
    const withoutVisual = computeLessonDuration([proseBlock(600, 1)]);
    const withVisual = computeLessonDuration([
      proseBlock(600, 1),
      { __component: 'lesson.table', id: 2, headers: [], rows: [] } as unknown as LessonBlock,
    ]);
    expect(minutesOf(withVisual)).toBeGreaterThanOrEqual(minutesOf(withoutVisual));
  });

  it('ignores non-textual blocks for word count (a param-picker has no prose)', () => {
    expect(
      computeLessonDuration([
        { __component: 'lesson.param-picker', id: 1, label: 'Key' } as unknown as LessonBlock,
      ]),
    ).toBe('1 min');
  });
});

// Backs the learn page's Lesson tab: "if a lesson already exists for this
// video, show it instead of the generate form." Two lookups, same fallback
// order getLessonBySlugWithStatus already uses for a lesson's own `videos`
// list — the populated relation first, then a scan of `body` blocks'
// `source.videoId` for lessons saved before that relation existed. Either
// way, only a lesson whose ENTIRE resolved source set is this one video
// counts as "a lesson for this video" — a library lesson that merely cites
// it among several sources must not hide the generate form.
describe('findLessonForVideoService', () => {
  it('matches via the populated videos relation when the lesson has exactly this one source', async () => {
    mocked.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          documentId: 'lesson-1',
          title: 'Drop D Basics',
          slug: 'drop-d-basics',
          summary: 'A short intro.',
          videos: [{ documentId: 'video-doc-1' }],
        },
      ],
    } as never);

    const result = await findLessonForVideoService('video-doc-1', 'vid1');
    expect(result).toEqual({
      documentId: 'lesson-1',
      title: 'Drop D Basics',
      slug: 'drop-d-basics',
      summary: 'A short intro.',
    });
    // Only the relation query ran — no need for the fallback scan.
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('does NOT match a lesson that cites this video among several sources', async () => {
    mocked.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          documentId: 'lesson-multi',
          title: 'Barre Chords Across the Library',
          slug: 'barre-chords',
          summary: null,
          videos: [{ documentId: 'video-doc-1' }, { documentId: 'video-doc-2' }],
        },
      ],
    } as never);
    // Fallback scan also finds nothing single-video for this id.
    mocked.mockResolvedValueOnce({ ok: true, data: [] } as never);

    const result = await findLessonForVideoService('video-doc-1', 'vid1');
    expect(result).toBeNull();
  });

  it('falls back to scanning body source.videoId for a pre-relation lesson', async () => {
    mocked.mockResolvedValueOnce({ ok: true, data: [] } as never); // relation: no match
    mocked.mockResolvedValueOnce({
      ok: true,
      data: [
        {
          documentId: 'lesson-old',
          title: 'Legacy Lesson',
          slug: 'legacy-lesson',
          summary: 'Predates the videos relation.',
          body: [
            { __component: 'lesson.prose', id: 1, body: 'text', source: { videoId: 'vid1' } },
          ],
        },
      ],
    } as never);

    const result = await findLessonForVideoService('video-doc-1', 'vid1');
    expect(result).toEqual({
      documentId: 'lesson-old',
      title: 'Legacy Lesson',
      slug: 'legacy-lesson',
      summary: 'Predates the videos relation.',
    });
  });

  it('returns null when nothing matches either lookup', async () => {
    mocked.mockResolvedValueOnce({ ok: true, data: [] } as never);
    mocked.mockResolvedValueOnce({ ok: true, data: [] } as never);
    expect(await findLessonForVideoService('video-doc-1', 'vid1')).toBeNull();
  });

  it('treats a dead backend on the relation query as "no match" rather than throwing', async () => {
    mocked.mockResolvedValueOnce({ ok: false, status: 0, error: 'down' } as never);
    mocked.mockResolvedValueOnce({ ok: false, status: 0, error: 'down' } as never);
    expect(await findLessonForVideoService('video-doc-1', 'vid1')).toBeNull();
  });
});

// The single-video path (lesson-generation.ts's planSingleVideoLesson +
// the existing writeLesson) saves through this exact same saveLessonService
// — no parallel save path exists for it. This is the single-video-shaped
// case of the collision test above: one source, generating "again" for the
// same video must never overwrite the first lesson, only add a `-2`.
describe('saveLessonService — single-video-shaped input', () => {
  it('appends -2 rather than overwriting when a second single-video lesson collides', async () => {
    mocked.mockImplementation(async (method, path, opts) => {
      if (method === 'GET' && path === '/api/lessons') {
        const candidate = (
          opts?.query?.filters as { slug?: { $eq?: string } } | undefined
        )?.slug?.$eq;
        return { ok: true, data: candidate === 'one-video-lesson' ? [{ slug: candidate }] : [] } as never;
      }
      if (method === 'POST' && path === '/api/lessons') {
        const body = (opts?.body as { data: { slug: string } }).data;
        return { ok: true, data: { documentId: 'doc-2nd', slug: body.slug } } as never;
      }
      return { ok: true, data: [] } as never;
    });

    const sources: SourceVideo[] = [
      { documentId: 'video-doc-1', youtubeVideoId: 'vid1', title: 'The Only Source', score: 1 },
    ];
    const result = await saveLessonService(
      makeLesson({ title: 'One Video Lesson', slug: 'one-video-lesson' }),
      sources,
    );

    expect(result).toEqual({ ok: true, slug: 'one-video-lesson-2', documentId: 'doc-2nd' });
    expect(mocked.mock.calls.filter(([m]) => m === 'POST')).toHaveLength(1);
  });
});
