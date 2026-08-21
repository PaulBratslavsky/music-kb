// Contract tests for the lesson-generation pipeline. `chat()` and every
// network-touching service (embeddings, digest lookup/synthesis, video
// fetch) are mocked — this suite never talks to Ollama, Anthropic, or
// Strapi (resolveLessonModel() itself is mocked too — see "model tier"
// below). BM25 grounding is exercised for real (pure JS, no network)
// against synthetic `transcriptSegments` on the mocked videos.
//
// Covers:
//   - the happy path assembling outline + per-section blocks into a body,
//     with a deterministically-injected heading per section
//   - model tier: a successful result is stamped with whichever
//     tier/model resolveLessonModel() returned; the assembled body is
//     byte-identical across tiers given identical mocked model output,
//     proving one staged pipeline serves both, not two divergent ones; a
//     frontier auth failure maps to a friendly message that never
//     contains the key (see also lesson-model.test.ts /
//     anthropic-errors.test.ts for the unit-level guarantees)
//   - the relevance floor: below it, generation refuses rather than
//     grounding a lesson in unrelated videos
//   - digest reuse: a cached digest short-circuits synthesis
//   - contradictions becoming deterministic callouts
//   - citation grounding: sourceVideoId validated against the source set,
//     timeSec always BM25-derived, never trusted from the model
//   - assembly fixes: sequential step renumbering, trailing-colon
//     stripping, model-emitted headings dropped in favor of the injected one
//   - block-level validation carried over from Task 1
//   - model-failure handling (single section drop vs whole-run failure)
//   - the zero-videos-with-embeddings guard

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/ai', () => ({
  chat: vi.fn(),
}));

// lesson-generation.ts no longer picks an adapter itself — it asks
// lesson-model.ts once via resolveLessonModel(). Mocking that call directly
// (rather than the two underlying adapter packages) matches the "ONLY
// place the choice is made" contract and lets tests flip tier without
// touching @tanstack/ai-ollama / @tanstack/ai-anthropic at all.
const resolveLessonModelMock = vi.fn();
vi.mock('./lesson-model', () => ({
  resolveLessonModel: () => resolveLessonModelMock(),
  // Pass-through here — redaction itself is unit-tested for real against
  // the actual module in lesson-model.test.ts. These tests only care that
  // friendlyAnthropicError's canned messages never echo input at all.
  redactAnthropicKey: (text: string) => text,
}));

const LOCAL_MODEL = { adapter: {}, tier: 'local' as const, model: 'gemma4-kb:latest' };
const FRONTIER_MODEL = { adapter: {}, tier: 'frontier' as const, model: 'claude-sonnet-5' };

const embedTextMock = vi.fn();
vi.mock('./embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./embeddings')>();
  return {
    ...actual,
    embedText: (...args: unknown[]) => embedTextMock(...args),
  };
});

const listAllVideosMock = vi.fn();
const fetchVideoByVideoIdMock = vi.fn();
const fetchVideoByDocumentIdMock = vi.fn();
vi.mock('./videos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./videos')>();
  return {
    ...actual,
    listAllVideosForEmbeddingService: () => listAllVideosMock(),
    fetchVideoByVideoIdService: (id: string) => fetchVideoByVideoIdMock(id),
    fetchVideoByDocumentIdService: (id: string) => fetchVideoByDocumentIdMock(id),
  };
});

const findDigestByVideoSetKeyMock = vi.fn();
vi.mock('./digests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./digests')>();
  return {
    ...actual,
    findDigestByVideoSetKeyService: (key: string) => findDigestByVideoSetKeyMock(key),
  };
});

const synthesizeDigestMock = vi.fn();
vi.mock('./digest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./digest')>();
  return {
    ...actual,
    synthesizeDigest: (videos: unknown) => synthesizeDigestMock(videos),
  };
});

import { chat } from '@tanstack/ai';
import { buildBM25Index, type TranscriptChunk } from './transcript';
import type { StrapiVideo } from './videos';
import type { Digest } from './digest';
import { generateLesson } from './lesson-generation';

const mockedChat = vi.mocked(chat);

// Unit vector whose cosine against QUERY_VEC=[1,0] is exactly `c` — same
// trick as ask-library.test.ts, keeps ranking assertions unambiguous.
const QUERY_VEC = [1, 0];
function vec(c: number): number[] {
  return [c, Math.sqrt(1 - c * c)];
}

function bm25For(text: string): ReturnType<typeof buildBM25Index> {
  const chunk: TranscriptChunk = { id: 0, text, startWord: 0, timeSec: 42 };
  return buildBM25Index([chunk]);
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
    transcriptSegments: {
      version: 1,
      bm25: bm25For(`Turnaround content for video ${documentId} about blues turnarounds and shapes`),
    },
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

const EMPTY_DIGEST: Digest = {
  title: 'Blues turnarounds across sources',
  description: 'What the sources say about turnarounds.',
  overallTheme: 'Both videos cover blues turnaround shapes.',
  sharedThemes: [],
  uniqueInsights: [],
  contradictions: [],
  viewingOrder: [],
  bottomLine: 'Turnarounds signal the loop back to the top of the form.',
};

function makeFullVideo(documentId: string): StrapiVideo {
  return makeVideo(documentId, 0.9);
}

beforeEach(() => {
  mockedChat.mockReset();
  resolveLessonModelMock.mockReset();
  resolveLessonModelMock.mockReturnValue(LOCAL_MODEL);
  embedTextMock.mockReset();
  embedTextMock.mockResolvedValue(QUERY_VEC);
  listAllVideosMock.mockReset();
  listAllVideosMock.mockResolvedValue([makeVideo('A', 0.9), makeVideo('B', 0.7)]);

  fetchVideoByVideoIdMock.mockReset();
  fetchVideoByDocumentIdMock.mockReset();
  fetchVideoByVideoIdMock.mockImplementation((id: string) => {
    const documentId = id.replace(/^yt-/, '');
    return Promise.resolve(makeFullVideo(documentId));
  });
  fetchVideoByDocumentIdMock.mockResolvedValue(null);

  findDigestByVideoSetKeyMock.mockReset();
  findDigestByVideoSetKeyMock.mockResolvedValue({ success: true, data: null });

  synthesizeDigestMock.mockReset();
  synthesizeDigestMock.mockResolvedValue({ success: true, data: EMPTY_DIGEST });
});

describe('generateLesson — happy path', () => {
  it('assembles blocks from the outline + per-section calls, injecting headings deterministically, and returns ranked sources', async () => {
    mockedChat
      .mockResolvedValueOnce(OUTLINE)
      .mockResolvedValueOnce({
        blocks: [
          {
            type: 'prose',
            body: 'A turnaround signals the loop back to the top of the form.',
            sourceVideoId: 'yt-A',
          },
        ],
      })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'step', number: 1, title: 'Play the V chord', lede: null, body: 'Start on the V.', sourceVideoId: null },
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

    // Heading injected deterministically per section (from the outline, not
    // the model) + 1 content block for section 1, heading + 2 for section 2.
    expect(result.lesson.body).toHaveLength(5);
    expect(result.lesson.body.map((b) => b.__component)).toEqual([
      'lesson.heading',
      'lesson.prose',
      'lesson.heading',
      'lesson.step',
      'lesson.degree-chips',
    ]);
    expect(result.lesson.body.map((b) => b.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.lesson.body[0].text).toBe('What a turnaround does');
    expect(result.lesson.body[2].text).toBe('The classic V-IV-I shape');

    // Sources ranked by cosine score, highest first.
    expect(result.sources.map((s) => s.documentId)).toEqual(['A', 'B']);
    expect(result.sources[0].score).toBeGreaterThan(result.sources[1].score);
  });
});

describe('generateLesson — model tier', () => {
  function outlineAndOneSectionMocks() {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          {
            type: 'prose',
            body: 'blues turnarounds and shapes content for video A',
            sourceVideoId: 'yt-A',
          },
        ],
      });
  }

  it('stamps a successful result with the local tier when no frontier key is configured', async () => {
    resolveLessonModelMock.mockReturnValue(LOCAL_MODEL);
    outlineAndOneSectionMocks();

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toBe('local');
    expect(result.model).toBe('gemma4-kb:latest');
  });

  it('stamps a successful result with the frontier tier and model when resolveLessonModel picks frontier', async () => {
    resolveLessonModelMock.mockReturnValue(FRONTIER_MODEL);
    outlineAndOneSectionMocks();

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toBe('frontier');
    expect(result.model).toBe('claude-sonnet-5');
    // Every chat() call used the adapter resolveLessonModel() handed back —
    // proves the pipeline doesn't construct its own adapter anywhere.
    for (const call of mockedChat.mock.calls) {
      expect(call[0].adapter).toBe(FRONTIER_MODEL.adapter);
    }
  });

  it('produces byte-identical blocks on both tiers given the same mocked model output — proves one code path, not two', async () => {
    resolveLessonModelMock.mockReturnValue(LOCAL_MODEL);
    outlineAndOneSectionMocks();
    const localResult = await generateLesson({ topic: 'blues turnarounds' });

    resolveLessonModelMock.mockReturnValue(FRONTIER_MODEL);
    outlineAndOneSectionMocks();
    const frontierResult = await generateLesson({ topic: 'blues turnarounds' });

    expect(localResult.ok).toBe(true);
    expect(frontierResult.ok).toBe(true);
    if (!localResult.ok || !frontierResult.ok) return;
    expect(frontierResult.lesson.body).toEqual(localResult.lesson.body);
    expect(frontierResult.lesson.title).toBe(localResult.lesson.title);
    expect(frontierResult.sources).toEqual(localResult.sources);
    // The only difference between the two runs is the tier/model stamp.
    expect(localResult.tier).toBe('local');
    expect(frontierResult.tier).toBe('frontier');
  });
});

describe('generateLesson — relevance floor', () => {
  it('returns { ok: false } naming the topic when everything scores below the floor', async () => {
    listAllVideosMock.mockResolvedValue([makeVideo('A', 0.1), makeVideo('B', 0.05)]);

    const result = await generateLesson({ topic: 'obscure topic' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('obscure topic');
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('returns { ok: false } when only one video clears the floor (digest needs at least 2)', async () => {
    listAllVideosMock.mockResolvedValue([makeVideo('A', 0.9), makeVideo('B', 0.1)]);

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });
});

describe('generateLesson — digest reuse', () => {
  it('reuses a cached digest instead of re-synthesizing', async () => {
    findDigestByVideoSetKeyMock.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        documentId: 'digest-1',
        title: EMPTY_DIGEST.title,
        description: EMPTY_DIGEST.description,
        overallTheme: EMPTY_DIGEST.overallTheme,
        bottomLine: EMPTY_DIGEST.bottomLine,
        sharedThemes: [],
        uniqueInsights: [],
        contradictions: [],
        viewingOrder: [],
        articleMarkdown: null,
        model: null,
        videoSetKey: 'yt-A,yt-B',
        videos: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [{ type: 'prose', body: 'Content grounded in the cached digest.', sourceVideoId: null }],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    expect(synthesizeDigestMock).not.toHaveBeenCalled();
    expect(findDigestByVideoSetKeyMock).toHaveBeenCalledWith('yt-A,yt-B');
  });

  it('synthesizes via the digest service on a cache miss', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [{ type: 'prose', body: 'Freshly synthesized content.', sourceVideoId: null }],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    expect(synthesizeDigestMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateLesson — contradictions', () => {
  it('turns digest contradictions into deterministic note callouts', async () => {
    synthesizeDigestMock.mockResolvedValue({
      success: true,
      data: {
        ...EMPTY_DIGEST,
        contradictions: [
          {
            topic: 'Whether to use a V7 or a diminished passing chord',
            positions: [
              { videoTitle: 'Title A', stance: 'Prefers a straight V7.' },
              { videoTitle: 'Title B', stance: 'Prefers a diminished passing chord.' },
            ],
          },
        ],
      },
    });
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [{ type: 'prose', body: 'Baseline content.', sourceVideoId: null }],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const callouts = result.lesson.body.filter((b) => b.__component === 'lesson.callout');
    expect(callouts).toHaveLength(1);
    expect(callouts[0].tone).toBe('note');
    expect(callouts[0].body as string).toContain('V7 or a diminished passing chord');
    expect(callouts[0].body as string).toContain('Title A');
    expect(callouts[0].body as string).toContain('Title B');

    // A heading precedes the contradiction callouts.
    const headings = result.lesson.body.filter((b) => b.__component === 'lesson.heading');
    expect(headings.some((h) => h.text === 'Where the sources disagree')).toBe(true);
  });

  it('adds no contradiction blocks when the digest has none', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [{ type: 'prose', body: 'Baseline content.', sourceVideoId: null }],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.some((b) => b.__component === 'lesson.callout')).toBe(false);
  });
});

describe('generateLesson — citation grounding', () => {
  it('grounds a valid sourceVideoId to a real BM25 timecode from that video only', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          {
            type: 'prose',
            body: 'blues turnarounds and shapes content for video A',
            sourceVideoId: 'yt-A',
          },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    const source = prose.source as { videoId: string; timeSec?: number };
    expect(source.videoId).toBe('yt-A');
    expect(source.timeSec).toBe(42);
  });

  it('drops a citation naming a video outside the source set', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          {
            type: 'prose',
            body: 'Content citing an unrelated video.',
            sourceVideoId: 'yt-not-in-the-set',
          },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    expect(prose.source).toBeUndefined();
  });

  it('never trusts a model-supplied timeSec — grounding decides it', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          {
            type: 'prose',
            body: 'blues turnarounds and shapes content for video A',
            sourceVideoId: 'yt-A',
            // Not part of the schema — simulates a local model tacking on
            // an extra, unrequested field. Must be ignored regardless.
            timeSec: 999999,
          },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    const source = prose.source as { videoId: string; timeSec?: number };
    expect(source.timeSec).not.toBe(999999);
    expect(source.timeSec).toBe(42);
  });

  it('yields videoId only, no timeSec, when grounding is weak', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          {
            type: 'prose',
            body: 'completely unrelated words xylophone quokka zeppelin',
            sourceVideoId: 'yt-A',
          },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    const source = prose.source as { videoId: string; timeSec?: number };
    expect(source.videoId).toBe('yt-A');
    expect(source.timeSec).toBeUndefined();
  });
});

describe('generateLesson — assembly fixes', () => {
  it('renumbers steps sequentially across sections instead of restarting per section', async () => {
    mockedChat
      .mockResolvedValueOnce(OUTLINE)
      .mockResolvedValueOnce({
        blocks: [
          { type: 'step', number: 1, title: 'First step', lede: null, body: null, sourceVideoId: null },
          { type: 'step', number: 2, title: 'Second step', lede: null, body: null, sourceVideoId: null },
        ],
      })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'step', number: 1, title: 'Third step', lede: null, body: null, sourceVideoId: null },
          { type: 'step', number: 2, title: 'Fourth step', lede: null, body: null, sourceVideoId: null },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const steps = result.lesson.body.filter((b) => b.__component === 'lesson.step');
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4]);
  });

  it('strips a trailing colon and whitespace from step titles', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          {
            type: 'step',
            number: 1,
            title: 'Identify the Root:  ',
            lede: null,
            body: null,
            sourceVideoId: null,
          },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const step = result.lesson.body.find((b) => b.__component === 'lesson.step')!;
    expect(step.title).toBe('Identify the Root');
  });

  it('drops a model-emitted heading inside a section, keeping only the injected one', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'heading', text: 'A DIFFERENT drifted heading', level: 'h2' },
          { type: 'prose', body: 'Section content.', sourceVideoId: null },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headings = result.lesson.body.filter((b) => b.__component === 'lesson.heading');
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe(OUTLINE.sections[0].heading);
    expect(result.lesson.body.some((b) => b.text === 'A DIFFERENT drifted heading')).toBe(false);
  });
});

describe('generateLesson — block validation', () => {
  it('drops a malformed block but keeps the rest of the section', async () => {
    mockedChat
      .mockResolvedValueOnce({ ...OUTLINE, sections: [OUTLINE.sections[0]] })
      .mockResolvedValueOnce({
        blocks: [
          { type: 'prose' }, // missing required `body` — invalid
          { type: 'callout', tone: 'tip', body: 'Turnarounds often use a chromatic walk-down.', sourceVideoId: null },
        ],
      });

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Injected heading + the one valid callout.
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
          { type: 'diagram', instrument: 'guitar', root: 'E', quality: 'maj' },
          { type: 'prose', body: 'Turnarounds reset the harmonic loop.', sourceVideoId: null },
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
        blocks: [{ type: 'prose', body: 'Descend from V to IV to I.', sourceVideoId: null }],
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

  it('maps a frontier auth failure to a friendly message that never contains the key', async () => {
    resolveLessonModelMock.mockReturnValue(FRONTIER_MODEL);
    const FAKE_KEY = 'sk-ant-api03-totally-real-secret-value-should-never-leak';
    // Worst-case shape: even if a raw provider error message somehow
    // embedded the key (it doesn't, in practice — see anthropic-errors.ts
    // for why — but never trust that), the mapped message must not.
    mockedChat.mockRejectedValueOnce(
      new Error(
        `Structured output generation failed: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key ${FAKE_KEY}"}}`,
      ),
    );

    const result = await generateLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain(FAKE_KEY);
    expect(result.error).toContain('Anthropic');
    expect(result.error).toContain('ANTHROPIC_API_KEY');
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
