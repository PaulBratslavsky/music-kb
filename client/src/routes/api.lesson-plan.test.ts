// Contract tests for POST /api/lesson-plan — the phase-1 SSE route.
// planLesson() itself is mocked (it's exhaustively tested in
// lesson-generation.test.ts); this suite only checks that the route wires
// planLesson's onProgress callback and result into well-formed SSE frames,
// and that the stream always terminates.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const planLessonMock = vi.fn();
vi.mock('#/lib/services/lesson-generation', () => ({
  planLesson: (...args: unknown[]) => planLessonMock(...args),
}));

import { lessonPlanHandler } from './api.lesson-plan';
import { streamLessonPlanSSE } from '#/lib/services/lesson-stream';

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/lesson-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function collectFrames(response: Response) {
  const frames = [];
  for await (const frame of streamLessonPlanSSE(response)) frames.push(frame);
  return frames;
}

describe('POST /api/lesson-plan', () => {
  beforeEach(() => {
    planLessonMock.mockReset();
  });

  it('rejects an empty topic without calling planLesson', async () => {
    const res = await lessonPlanHandler(postRequest({ topic: '' }));
    expect(res.status).toBe(400);
    expect(planLessonMock).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON', async () => {
    const req = new Request('http://localhost/api/lesson-plan', {
      method: 'POST',
      body: 'not json',
    });
    const res = await lessonPlanHandler(req);
    expect(res.status).toBe(400);
  });

  it('streams every onProgress event, then the terminal `plan` frame, and terminates', async () => {
    planLessonMock.mockImplementation(async (_input: unknown, onProgress: (e: unknown) => void) => {
      onProgress({ type: 'tier', tier: 'local', model: 'gemma4-kb:latest' });
      onProgress({ type: 'outline', title: 'Blues turnarounds', level: 'beginner', sections: ['A', 'B'] });
      return {
        ok: true,
        topic: 'blues turnarounds',
        outline: { title: 'Blues turnarounds', summary: 's', level: 'beginner', instrument: 'guitar', duration: null, sections: [] },
        sources: [],
        digest: { title: 't', description: 'd', overallTheme: 'o', sharedThemes: [], uniqueInsights: [], contradictions: [], viewingOrder: [], bottomLine: 'b' },
        tier: 'local',
        model: 'gemma4-kb:latest',
      };
    });

    const res = await lessonPlanHandler(postRequest({ topic: 'blues turnarounds' }));
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const frames = await collectFrames(res);
    expect(frames.map((f) => (f as { type: string }).type)).toEqual(['tier', 'outline', 'plan']);
    const planFrame = frames[2] as { type: 'plan'; outline: { title: string } };
    expect(planFrame.outline.title).toBe('Blues turnarounds');
  });

  it('does NOT send a `plan` frame when planLesson returns ok: false — the progress stream already carries the terminal event', async () => {
    planLessonMock.mockImplementation(async (_input: unknown, onProgress: (e: unknown) => void) => {
      onProgress({ type: 'tier', tier: 'local', model: 'gemma4-kb:latest' });
      onProgress({ type: 'error', step: 'outline', message: 'The model returned an unusable lesson outline.' });
      return { ok: false, error: 'The model returned an unusable lesson outline.' };
    });

    const res = await lessonPlanHandler(postRequest({ topic: 'blues turnarounds' }));
    const frames = await collectFrames(res);

    expect(frames.map((f) => (f as { type: string }).type)).toEqual(['tier', 'error']);
  });

  it('surfaces an unexpected throw from planLesson as a visible error frame rather than a silently truncated stream', async () => {
    planLessonMock.mockRejectedValue(new Error('boom'));

    const res = await lessonPlanHandler(postRequest({ topic: 'blues turnarounds' }));
    const frames = await collectFrames(res);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'error', message: 'boom' });
  });
});
