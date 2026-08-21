// Contract tests for the lesson-generation pipeline. `chat()` is fully
// mocked — this suite never talks to Ollama. It exercises:
//   - the happy path assembling outline + per-section blocks into a body
//   - block-level validation (malformed blocks dropped, captions truncated)
//   - model-failure handling (single section drop vs whole-run failure)
//   - the zero-videos-with-embeddings guard, which must short-circuit
//     BEFORE any chat() call is made (no wasted inference on empty context)

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/ai', () => ({
  chat: vi.fn(),
}));
vi.mock('@tanstack/ai-ollama', () => ({
  createOllamaChat: vi.fn(() => ({})),
}));

const embedTextMock = vi.fn();
vi.mock('./embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./embeddings')>();
  return {
    ...actual,
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

import { chat } from '@tanstack/ai';
import type { StrapiVideo } from './videos';
import { generateLesson } from './lesson-generation';

const mockedChat = vi.mocked(chat);

// Unit vector whose cosine against QUERY_VEC=[1,0] is exactly `c` — same
// trick as ask-library.test.ts, keeps ranking assertions unambiguous.
const QUERY_VEC = [1, 0];
function vec(c: number): number[] {
  return [c, Math.sqrt(1 - c * c)];
}

function makeVideo(documentId: string, score: number, overrides: Partial<StrapiVideo> = {}): StrapiVideo {
  const base: Partial<StrapiVideo> = {
    documentId,
    youtubeVideoId: `yt-${documentId}`,
    videoTitle: `Title ${documentId}`,
    summaryTitle: `Summary title ${documentId}`,
    summaryDescription: `Summary description for ${documentId}`,
    summaryOverview: null,
    musicExtraction: null,
    summaryEmbedding: vec(score),
  };
  return { ...base, ...overrides } as StrapiVideo;
}

const OUTLINE = {
  title: 'Blues turnarounds for guitar',
  summary: 'Learn the essential blues turnaround shapes and when to use them.',
  level: 'beginner',
  instrument: 'guitar',
  duration: '15 min',
  sections: [
    { heading: 'What a turnaround does', goal: 'Explain the function of a turnaround in a 12-bar blues.' },
    { heading: 'The classic V-IV-I shape', goal: 'Walk through the classic descending turnaround shape.' },
  ],
};

beforeEach(() => {
  mockedChat.mockReset();
  embedTextMock.mockReset();
  embedTextMock.mockResolvedValue(QUERY_VEC);
  listAllVideosMock.mockReset();
  listAllVideosMock.mockResolvedValue([makeVideo('A', 0.9), makeVideo('B', 0.7)]);
});

describe('generateLesson — happy path', () => {
  it('assembles blocks from the outline + per-section calls, and returns ranked sources', async () => {
    mockedChat
      .mockResolvedValueOnce(OUTLINE)
      .mockResolvedValueOnce({
        blocks: [
          { type: 'heading', text: 'What a turnaround does', level: 'h2' },
          { type: 'prose', body: 'A turnaround signals the loop back to the top of the form.' },
        ],
      })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'heading', text: 'The classic V-IV-I shape', level: 'h2' },
          { type: 'step', number: 1, title: 'Play the V chord', lede: null, body: 'Start on the V.' },
          { type: 'degree-chips', degrees: ['V', 'IV', 'I'], size: 'md' },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.lesson.title).toBe(OUTLINE.title);
    expect(result.lesson.slug).toBe('blues-turnarounds-for-guitar');
    expect(result.lesson.status).toBe('ai-generated');
    expect(result.lesson.level).toBe('beginner');
    expect(result.lesson.instrument).toBe('guitar');
    expect(result.lesson.duration).toBe('15 min');

    // 2 blocks from section 1 + 3 from section 2, in order, sequential ids.
    expect(result.lesson.body).toHaveLength(5);
    expect(result.lesson.body.map((b) => b.__component)).toEqual([
      'lesson.heading',
      'lesson.prose',
      'lesson.heading',
      'lesson.step',
      'lesson.degree-chips',
    ]);
    expect(result.lesson.body.map((b) => b.id)).toEqual([1, 2, 3, 4, 5]);

    // Sources ranked by cosine score, highest first.
    expect(result.sources.map((s) => s.documentId)).toEqual(['A', 'B']);
    expect(result.sources[0].score).toBeGreaterThan(result.sources[1].score);
  });
});

describe('generateLesson — block validation', () => {
  it('drops a malformed block but keeps the rest of the section', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'heading', text: 'What a turnaround does', level: 'h2' },
          { type: 'prose' }, // missing required `body` — invalid
          { type: 'callout', tone: 'tip', body: 'Turnarounds often use a chromatic walk-down.' },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body).toHaveLength(2);
    expect(result.lesson.body.map((b) => b.__component)).toEqual([
      'lesson.heading',
      'lesson.callout',
    ]);
  });

  it('drops a block of a disallowed type (e.g. diagram)', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'heading', text: 'What a turnaround does', level: 'h2' },
          { type: 'diagram', instrument: 'guitar', root: 'E', quality: 'maj' },
          { type: 'prose', body: 'Turnarounds reset the harmonic loop.' },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual([
      'lesson.heading',
      'lesson.prose',
    ]);
  });

  it('truncates an over-long table caption to 255 chars instead of failing', async () => {
    const longCaption = 'x'.repeat(300);
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'heading', text: 'What a turnaround does', level: 'h2' },
          {
            type: 'table',
            headers: ['Bar', 'Chord'],
            rows: [['11', 'V7']],
            caption: longCaption,
          },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = result.lesson.body.find((b) => b.__component === 'lesson.table');
    expect(table).toBeDefined();
    expect(typeof table!.caption).toBe('string');
    expect((table!.caption as string).length).toBe(255);
  });

  it('coerces non-string headers/rows/degrees with String()', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'heading', text: 'What a turnaround does', level: 'h2' },
          {
            type: 'table',
            headers: ['Bar', 1 as unknown as string],
            rows: [[11 as unknown as string, 'V7']],
            caption: null,
          },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = result.lesson.body.find((b) => b.__component === 'lesson.table');
    expect(table!.headers).toEqual(['Bar', '1']);
    expect(table!.rows).toEqual([['11', 'V7']]);
  });
});

describe('generateLesson — model failure handling', () => {
  it('skips a section whose chat() call fails and still returns a lesson from the rest', async () => {
    mockedChat
      .mockResolvedValueOnce(OUTLINE)
      .mockRejectedValueOnce(new Error('model returned invalid json'))
      .mockResolvedValueOnce({
        blocks: [
          { type: 'heading', text: 'The classic V-IV-I shape', level: 'h2' },
          { type: 'prose', body: 'Descend from V to IV to I.' },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual([
      'lesson.heading',
      'lesson.prose',
    ]);
  });

  it('returns { ok: false } with a friendly message when the outline call fails', async () => {
    mockedChat.mockRejectedValueOnce(new Error("model 'gemma4-kb:latest' not found"));

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Ollama');
    expect(result.error).toContain('pull');
  });

  it('returns { ok: false } when every section fails', async () => {
    mockedChat
      .mockResolvedValueOnce(OUTLINE)
      .mockRejectedValueOnce(new Error('bad json'))
      .mockRejectedValueOnce(new Error('bad json'));

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
  });
});

describe('generateLesson — retrieval guard', () => {
  it('returns { ok: false } when no videos have stored embeddings, without calling chat()', async () => {
    listAllVideosMock.mockResolvedValue([
      makeVideo('A', 0.9, { summaryEmbedding: null }),
    ]);

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('returns { ok: false } when the video library is empty, without calling chat()', async () => {
    listAllVideosMock.mockResolvedValue([]);

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });
});
