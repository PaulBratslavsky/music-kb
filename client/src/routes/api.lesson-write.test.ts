// Contract tests for POST /api/lesson-write — the phase-2 SSE route.
// writeLesson() and saveLessonService() are mocked (writeLesson is
// exhaustively tested in lesson-generation.test.ts); this suite only
// checks that the route wires writeLesson's onProgress callback + save
// result into well-formed SSE frames, and that the stream always
// terminates.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const writeLessonMock = vi.fn();
vi.mock('#/lib/services/lesson-generation', () => ({
  writeLesson: (...args: unknown[]) => writeLessonMock(...args),
}));

const saveLessonServiceMock = vi.fn();
vi.mock('#/lib/services/lessons', () => ({
  saveLessonService: (...args: unknown[]) => saveLessonServiceMock(...args),
}));

import { lessonWriteHandler } from './api.lesson-write';
import { streamLessonWriteSSE } from '#/lib/services/lesson-stream';

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/lesson-write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function collectFrames(response: Response) {
  const frames = [];
  for await (const frame of streamLessonWriteSSE(response)) frames.push(frame);
  return frames;
}

const GENERATED_LESSON = {
  title: 'Blues turnarounds',
  slug: 'blues-turnarounds',
  summary: 's',
  level: 'beginner' as const,
  instrument: 'guitar' as const,
  duration: null,
  status: 'ai-generated' as const,
  body: [{ __component: 'lesson.heading', id: 1, text: 'x', level: 'h2' }],
};

describe('POST /api/lesson-write', () => {
  beforeEach(() => {
    writeLessonMock.mockReset();
    saveLessonServiceMock.mockReset();
  });

  it('rejects invalid JSON', async () => {
    const req = new Request('http://localhost/api/lesson-write', { method: 'POST', body: 'not json' });
    const res = await lessonWriteHandler(req);
    expect(res.status).toBe(400);
  });

  it('rejects a non-object body', async () => {
    const req = new Request('http://localhost/api/lesson-write', {
      method: 'POST',
      body: JSON.stringify('a string'),
    });
    const res = await lessonWriteHandler(req);
    expect(res.status).toBe(400);
  });

  it('streams every onProgress event, then persists and emits the terminal `saved` frame', async () => {
    writeLessonMock.mockImplementation(async (_input: unknown, onProgress: (e: unknown) => void) => {
      onProgress({ type: 'tier', tier: 'local', model: 'gemma4-kb:latest' });
      onProgress({ type: 'section', index: 0, total: 1, heading: 'A', blocks: 2 });
      onProgress({ type: 'grounding', grounded: 1, total: 2 });
      return { ok: true, lesson: GENERATED_LESSON, sources: [], tier: 'local', model: 'gemma4-kb:latest' };
    });
    saveLessonServiceMock.mockResolvedValue({ ok: true, slug: 'blues-turnarounds', documentId: 'doc-1' });

    const res = await lessonWriteHandler(postRequest({ topic: 't', outline: {}, sources: [], digest: {} }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const frames = await collectFrames(res);
    expect(frames.map((f) => f.type)).toEqual(['tier', 'section', 'grounding', 'saved']);
    const saved = frames[3] as Extract<(typeof frames)[number], { type: 'saved' }>;
    expect(saved.slug).toBe('blues-turnarounds');
    expect(saved.blockCount).toBe(GENERATED_LESSON.body.length);
    // Threads writeLesson's `sources` through to saveLessonService so it
    // can connect the `videos` relation — see lessons.ts.
    expect(saveLessonServiceMock).toHaveBeenCalledWith(GENERATED_LESSON, []);
  });

  it('does NOT call saveLessonService when writeLesson returns ok: false — its progress stream already carries the terminal error', async () => {
    writeLessonMock.mockImplementation(async (_input: unknown, onProgress: (e: unknown) => void) => {
      onProgress({ type: 'error', step: 'validate', message: 'malformed outline' });
      return { ok: false, error: 'malformed outline' };
    });

    const res = await lessonWriteHandler(postRequest({ topic: 't', outline: {}, sources: [], digest: {} }));
    const frames = await collectFrames(res);

    expect(frames.map((f) => f.type)).toEqual(['error']);
    expect(saveLessonServiceMock).not.toHaveBeenCalled();
  });

  it('emits an `error` frame when persistence fails after a successful generation', async () => {
    writeLessonMock.mockResolvedValue({
      ok: true,
      lesson: GENERATED_LESSON,
      sources: [],
      tier: 'local',
      model: 'gemma4-kb:latest',
    });
    saveLessonServiceMock.mockResolvedValue({ ok: false, error: 'Strapi rejected the write' });

    const res = await lessonWriteHandler(postRequest({ topic: 't', outline: {}, sources: [], digest: {} }));
    const frames = await collectFrames(res);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'error', step: 'saved', message: 'Strapi rejected the write' });
  });

  it('surfaces an unexpected throw as a visible error frame rather than a silently truncated stream', async () => {
    writeLessonMock.mockRejectedValue(new Error('boom'));

    const res = await lessonWriteHandler(postRequest({ topic: 't', outline: {}, sources: [], digest: {} }));
    const frames = await collectFrames(res);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'error', message: 'boom' });
  });
});

describe('POST /api/lesson-write — a failed save keeps the lesson (issue #12)', () => {
  beforeEach(() => {
    writeLessonMock.mockReset();
    saveLessonServiceMock.mockReset();
  });

  const SOURCES = [{ documentId: 'v1', youtubeVideoId: 'dQw4w9WgXcQ', title: 'Triads 101' }];

  it('carries the generated lesson and its sources in the error frame', async () => {
    // Every model call has already finished by the time the save runs, so a
    // failed save used to throw away minutes of generation. The frame is the
    // only thing that still reaches the reader.
    writeLessonMock.mockResolvedValue({
      ok: true,
      lesson: GENERATED_LESSON,
      sources: SOURCES,
      tier: 'local',
      model: 'gemma4-kb:latest',
    });
    saveLessonServiceMock.mockResolvedValue({ ok: false, error: 'Strapi rejected the write' });

    const res = await lessonWriteHandler(postRequest({ topic: 't', outline: {}, sources: [], digest: {} }));
    const [frame] = await collectFrames(res);

    expect(frame).toMatchObject({
      type: 'error',
      step: 'saved',
      message: 'Strapi rejected the write',
      unsaved: { lesson: GENERATED_LESSON, sources: SOURCES },
    });
  });

  it('logs the unsaved lesson server-side, so it is recoverable even if the tab closes', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeLessonMock.mockResolvedValue({
      ok: true,
      lesson: GENERATED_LESSON,
      sources: SOURCES,
      tier: 'local',
      model: 'gemma4-kb:latest',
    });
    saveLessonServiceMock.mockResolvedValue({ ok: false, error: 'Strapi rejected the write' });

    await collectFrames(
      await lessonWriteHandler(postRequest({ topic: 't', outline: {}, sources: [], digest: {} })),
    );

    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('Blues turnarounds');
    expect(logged).toContain('"__component":"lesson.heading"'); // the body itself, not just a summary
    errorSpy.mockRestore();
  });

  it('a successful save carries no unsaved payload', async () => {
    writeLessonMock.mockResolvedValue({
      ok: true,
      lesson: GENERATED_LESSON,
      sources: SOURCES,
      tier: 'local',
      model: 'gemma4-kb:latest',
    });
    saveLessonServiceMock.mockResolvedValue({ ok: true, slug: 'blues-turnarounds', documentId: 'doc-1' });

    const frames = await collectFrames(
      await lessonWriteHandler(postRequest({ topic: 't', outline: {}, sources: [], digest: {} })),
    );

    expect(frames.some((f) => 'unsaved' in (f as object))).toBe(false);
  });
});
