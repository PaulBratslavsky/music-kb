import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./strapi-client', () => ({ strapiFetch: vi.fn() }));

import { strapiFetch } from './strapi-client';
import { getLessonBySlugWithStatus, listLessonsService } from './lessons';

const mocked = vi.mocked(strapiFetch);

beforeEach(() => mocked.mockReset());

describe('listLessonsService', () => {
  it('returns the rows Strapi gave, with their fields intact', async () => {
    mocked.mockResolvedValue({
      ok: true,
      data: [
        { documentId: 'b', title: 'B', slug: 'b', order: 2 },
        { documentId: 'a', title: 'A', slug: 'a', order: 1 },
      ],
    } as never);
    const out = await listLessonsService();
    expect(out).toEqual([
      { documentId: 'b', title: 'B', slug: 'b', order: 2 },
      { documentId: 'a', title: 'A', slug: 'a', order: 1 },
    ]);
  });

  it('returns [] when the backend is unreachable', async () => {
    mocked.mockResolvedValue({ ok: false, status: 0, error: 'down' } as never);
    expect(await listLessonsService()).toEqual([]);
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
});
