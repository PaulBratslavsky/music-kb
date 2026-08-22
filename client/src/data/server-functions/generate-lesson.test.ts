// generateAndSaveLesson is a createServerFn wrapper; calling it directly
// requires a live Start request context (AsyncLocalStorage) this suite
// doesn't have. The business logic lives in the exported, plain
// `generateAndSaveLessonLogic` instead (see generate-lesson.ts) — that's
// what's exercised here, along with the zod schema the `.validator()`
// step uses, which is a pure function and needs no server context at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateLessonMock = vi.fn();
vi.mock('#/lib/services/lesson-generation', () => ({
  generateLesson: (...args: unknown[]) => generateLessonMock(...args),
}));

const saveLessonServiceMock = vi.fn();
vi.mock('#/lib/services/lessons', () => ({
  saveLessonService: (...args: unknown[]) => saveLessonServiceMock(...args),
}));

import {
  GenerateLessonSchema,
  generateAndSaveLessonLogic,
} from './generate-lesson';
import type { GeneratedLesson } from '#/lib/services/lesson-generation';

beforeEach(() => {
  generateLessonMock.mockReset();
  saveLessonServiceMock.mockReset();
});

const FAKE_ANTHROPIC_KEY = 'sk-ant-api03-fake-secret-do-not-leak';

const generatedLesson: GeneratedLesson = {
  title: 'Drop D Basics',
  slug: 'drop-d-basics',
  summary: 'A short intro to drop D tuning.',
  level: 'beginner',
  instrument: 'guitar',
  duration: null,
  status: 'ai-generated',
  body: [
    { __component: 'lesson.heading', id: 1, text: 'Intro', level: 'h2' },
    { __component: 'lesson.prose', id: 2, body: 'Detune the low E to D.' },
  ],
};

describe('GenerateLessonSchema', () => {
  it('rejects an empty topic', () => {
    expect(GenerateLessonSchema.safeParse({ topic: '' }).success).toBe(false);
  });

  it('rejects a whitespace-only topic (trimmed to empty)', () => {
    expect(GenerateLessonSchema.safeParse({ topic: '   ' }).success).toBe(false);
  });

  it('accepts a reasonable topic', () => {
    const result = GenerateLessonSchema.safeParse({ topic: 'drop D tuning' });
    expect(result.success).toBe(true);
  });

  it('rejects an unreasonably long topic', () => {
    const result = GenerateLessonSchema.safeParse({ topic: 'x'.repeat(500) });
    expect(result.success).toBe(false);
  });
});

describe('generateAndSaveLessonLogic', () => {
  it('generates then saves, returning slug/title/tier/model/blockCount/sources', async () => {
    generateLessonMock.mockResolvedValue({
      ok: true,
      lesson: generatedLesson,
      sources: [
        { documentId: 'd1', youtubeVideoId: 'yt1', title: 'Video 1', score: 0.6 },
      ],
      tier: 'local',
      model: 'gemma4-kb:latest',
    });
    saveLessonServiceMock.mockResolvedValue({
      ok: true,
      slug: 'drop-d-basics',
      documentId: 'doc-1',
    });

    const result = await generateAndSaveLessonLogic('drop D basics');

    expect(result).toEqual({
      ok: true,
      slug: 'drop-d-basics',
      title: 'Drop D Basics',
      tier: 'local',
      model: 'gemma4-kb:latest',
      blockCount: 2,
      sources: [
        { documentId: 'd1', youtubeVideoId: 'yt1', title: 'Video 1', score: 0.6 },
      ],
    });
    expect(saveLessonServiceMock).toHaveBeenCalledWith(generatedLesson);
  });

  it('surfaces a generation failure (e.g. below the relevance floor) without calling save', async () => {
    generateLessonMock.mockResolvedValue({
      ok: false,
      error: "The library doesn't have enough videos closely related to this topic.",
    });

    const result = await generateAndSaveLessonLogic('extremely obscure topic');

    expect(result).toEqual({
      ok: false,
      error: "The library doesn't have enough videos closely related to this topic.",
    });
    expect(saveLessonServiceMock).not.toHaveBeenCalled();
  });

  it('surfaces a save failure rather than reporting success for an unsaved lesson', async () => {
    generateLessonMock.mockResolvedValue({
      ok: true,
      lesson: generatedLesson,
      sources: [],
      tier: 'frontier',
      model: 'claude-sonnet-5',
    });
    saveLessonServiceMock.mockResolvedValue({
      ok: false,
      error: 'Strapi error 500',
    });

    const result = await generateAndSaveLessonLogic('drop D basics');

    expect(result).toEqual({ ok: false, error: 'Strapi error 500' });
  });

  it('never includes key material in the success payload, even if a stray field carried it upstream', async () => {
    // Simulates a defensive scenario: some future change to generateLesson()
    // or saveLessonService() accidentally attaches an extra property (here,
    // something key-shaped) to the object it resolves with. This function
    // builds its return value field-by-field rather than spreading either
    // service's result, so that property should never reach the payload
    // regardless of what upstream does.
    generateLessonMock.mockResolvedValue({
      ok: true,
      lesson: generatedLesson,
      sources: [],
      tier: 'frontier',
      model: 'claude-sonnet-5',
      leakedApiKey: FAKE_ANTHROPIC_KEY,
    });
    saveLessonServiceMock.mockResolvedValue({
      ok: true,
      slug: 'drop-d-basics',
      documentId: 'doc-1',
      leakedApiKey: FAKE_ANTHROPIC_KEY,
    });

    const result = await generateAndSaveLessonLogic('drop D basics');

    expect(JSON.stringify(result)).not.toContain(FAKE_ANTHROPIC_KEY);
    // Belt-and-suspenders: the success payload only ever carries these six
    // fields — nothing spread in from `generated`/`saved` that could smuggle
    // an unexpected property (like a key) through.
    expect(result.ok && Object.keys(result).sort()).toEqual(
      ['blockCount', 'model', 'ok', 'slug', 'sources', 'title', 'tier'].sort(),
    );
  });
});
