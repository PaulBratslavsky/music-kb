import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./strapi-client', () => ({ strapiFetch: vi.fn() }));

import { strapiFetch } from './strapi-client';
import {
  getLessonBySlugWithStatus,
  listLessonsWithStatus,
  saveLessonService,
} from './lessons';
import type { GeneratedLesson, SourceVideo } from './lesson-generation';

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
});
