// Contract tests for the two-phase lesson-generation pipeline. `chat()` and
// every network-touching service (embeddings, digest lookup/synthesis,
// video fetch) are mocked — this suite never talks to Ollama, Anthropic, or
// Strapi (resolveLessonModel() itself is mocked too — see "model tier"
// below). BM25 grounding is exercised for real (pure JS, no network)
// against synthetic `transcriptSegments` on the mocked videos.
//
// Split to match the pipeline split:
//   planLesson  — tier, retrieve, coverage, digest, outline (+ its retry)
//   writeLesson — input validation, sections (+ their retry), grounding,
//                 assembly, contradictions
//
// Covers:
//   - planLesson: retrieval + relevance floor, coverage check (refuse/
//     proceed, never retried), digest reuse vs synthesis, outline
//     generation, and the outline retry (thrown call / unusable shape /
//     thin result — retry once, then accept or surface the error)
//   - writeLesson: input validation of the round-tripped plan (malformed
//     outline rejected), the happy path assembling outline + per-section
//     blocks into a body, citation grounding (BM25-derived timecodes,
//     never model-supplied), assembly fixes (step renumbering, trailing-
//     colon stripping, model-emitted headings dropped), block-level
//     validation, contradictions becoming deterministic callouts, and the
//     section retry (thrown call / zero usable blocks retry once; a thin
//     — but non-empty — section is accepted without retry)
//   - progress events: every phase, retry, and terminal step of both
//     functions is emitted as a structured `LessonProgressEvent`, in order
//   - model tier: a successful result is stamped with whichever
//     tier/model resolveLessonModel() returned; the assembled body is
//     byte-identical across tiers given identical mocked model output; a
//     frontier auth failure maps to a friendly message that never contains
//     the key

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
    // The generator uses the status-aware sibling so it can tell a dead
    // backend apart from an empty library; keep the existing mock as the
    // source of truth and wrap it in the success shape.
    listAllVideosForEmbeddingWithStatusService: async () => ({
      ok: true as const,
      videos: await listAllVideosMock(),
    }),
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
import {
  planLesson,
  writeLesson,
  CoverageVerdictSchema,
  LessonOutlineSchema,
  SectionBlocksSchema,
  type LessonOutline,
  type LessonProgressEvent,
  type SourceVideo,
  type WriteLessonInput,
} from './lesson-generation';
import { z } from 'zod';

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

function makeFullVideo(documentId: string): StrapiVideo {
  return makeVideo(documentId, 0.9);
}

// Collects every progress event a call emits, in order — used both to
// assert ordering/payloads directly and as a `onProgress` stand-in.
function collector(): { events: LessonProgressEvent[]; onProgress: (e: LessonProgressEvent) => void } {
  const events: LessonProgressEvent[] = [];
  return { events, onProgress: (e) => events.push(e) };
}

// The coverage step runs its own chat() call before the outline call.
// Every planLesson scenario that reaches the outline call needs this
// queued first, or the coverage call would consume the outline's mocked
// response instead.
const COVERED = { covered: true, actualTopic: null, reason: null };

const OUTLINE: LessonOutline = {
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

// DigestSchema requires `sharedThemes.min(1)` (a real production
// constraint the model itself must satisfy — see digest.ts) — writeLesson
// validates a round-tripped digest against that exact schema, so this
// fixture needs at least one entry to pass, same as any real digest would.
const EMPTY_DIGEST: Digest = {
  title: 'Blues turnarounds across sources',
  description: 'What the sources say about turnarounds.',
  overallTheme: 'Both videos cover blues turnaround shapes.',
  sharedThemes: [{ title: 'Turnaround shapes', body: 'Both sources cover turnaround shapes.', videoTitles: ['Title A', 'Title B'] }],
  uniqueInsights: [],
  contradictions: [],
  viewingOrder: [],
  bottomLine: 'Turnarounds signal the loop back to the top of the form.',
};

const SOURCES: SourceVideo[] = [
  { documentId: 'A', youtubeVideoId: 'yt-A', title: 'Title A', score: 0.9 },
  { documentId: 'B', youtubeVideoId: 'yt-B', title: 'Title B', score: 0.7 },
];

function writeInput(overrides: Partial<WriteLessonInput> = {}): WriteLessonInput {
  return {
    topic: 'blues turnarounds',
    outline: OUTLINE,
    sources: SOURCES,
    digest: EMPTY_DIGEST,
    ...overrides,
  };
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

// =============================================================================
// planLesson
// =============================================================================

describe('planLesson — retrieve + relevance floor', () => {
  it('returns { ok: false } naming the topic when everything scores below the floor', async () => {
    listAllVideosMock.mockResolvedValue([makeVideo('A', 0.1), makeVideo('B', 0.05)]);

    const result = await planLesson({ topic: 'obscure topic' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('obscure topic');
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('returns { ok: false } when only one video clears the floor (digest needs at least 2)', async () => {
    listAllVideosMock.mockResolvedValue([makeVideo('A', 0.9), makeVideo('B', 0.1)]);

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('returns { ok: false } when no videos have stored embeddings, without calling chat()', async () => {
    listAllVideosMock.mockResolvedValue([makeVideo('A', 0.9, { summaryEmbedding: null })]);

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('returns { ok: false } when the video library is empty, without calling chat()', async () => {
    listAllVideosMock.mockResolvedValue([]);

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('emits a `retrieve` progress event naming the selected videos, considered count, and floor', async () => {
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(OUTLINE);
    const { events, onProgress } = collector();

    const result = await planLesson({ topic: 'blues turnarounds' }, onProgress);

    expect(result.ok).toBe(true);
    const retrieve = events.find((e) => e.type === 'retrieve');
    expect(retrieve).toBeDefined();
    if (retrieve?.type !== 'retrieve') return;
    expect(retrieve.considered).toBe(2);
    expect(retrieve.floor).toBe(0.5);
    expect(retrieve.videos.map((v) => v.documentId)).toEqual(['A', 'B']);
  });
});

describe('planLesson — coverage check', () => {
  it('refuses when covered: false, naming both the requested topic and what the sources actually cover, and never calls the digest', async () => {
    mockedChat.mockResolvedValueOnce({
      covered: false,
      actualTopic: 'triads and harmonic movement',
      reason: 'The sources never mention barre chords specifically.',
    });

    const result = await planLesson({ topic: 'barre chords' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('barre chords');
    expect(result.error).toContain('triads and harmonic movement');
    expect(findDigestByVideoSetKeyMock).not.toHaveBeenCalled();
    expect(synthesizeDigestMock).not.toHaveBeenCalled();
    // Only the coverage call ran — the pipeline never reached the outline.
    expect(mockedChat).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a coverage refusal — a refusal is a correct answer, not an error', async () => {
    mockedChat.mockResolvedValueOnce({
      covered: false,
      actualTopic: 'triads and harmonic movement',
      reason: null,
    });
    const { events, onProgress } = collector();

    await planLesson({ topic: 'barre chords' }, onProgress);

    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'retry')).toBe(false);
    const coverage = events.find((e) => e.type === 'coverage');
    expect(coverage).toEqual({
      type: 'coverage',
      covered: false,
      actualTopic: 'triads and harmonic movement',
      reason: null,
    });
  });

  it('refuses rather than proceeding when the coverage call itself throws, and never calls the digest', async () => {
    mockedChat.mockRejectedValueOnce(new Error('model returned invalid json'));

    const result = await planLesson({ topic: 'barre chords' });

    expect(result.ok).toBe(false);
    expect(findDigestByVideoSetKeyMock).not.toHaveBeenCalled();
    expect(synthesizeDigestMock).not.toHaveBeenCalled();
  });

  it('refuses rather than proceeding when the coverage call returns an unusable shape (missing `covered`)', async () => {
    mockedChat.mockResolvedValueOnce({ actualTopic: 'something' });

    const result = await planLesson({ topic: 'barre chords' });

    expect(result.ok).toBe(false);
    expect(findDigestByVideoSetKeyMock).not.toHaveBeenCalled();
    expect(synthesizeDigestMock).not.toHaveBeenCalled();
  });

  it('proceeds to the outline unchanged when covered: true', async () => {
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(OUTLINE);

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.title).toBe(OUTLINE.title);
  });
});

describe('planLesson — digest reuse', () => {
  it('reuses a cached digest instead of re-synthesizing, and reports cacheHit: true', async () => {
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
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(OUTLINE);
    const { events, onProgress } = collector();

    const result = await planLesson({ topic: 'blues turnarounds' }, onProgress);

    expect(result.ok).toBe(true);
    expect(synthesizeDigestMock).not.toHaveBeenCalled();
    expect(findDigestByVideoSetKeyMock).toHaveBeenCalledWith('yt-A,yt-B');
    const digestEvent = events.find((e) => e.type === 'digest');
    expect(digestEvent).toMatchObject({ type: 'digest', cacheHit: true });
  });

  it('synthesizes via the digest service on a cache miss, and reports cacheHit: false', async () => {
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(OUTLINE);
    const { events, onProgress } = collector();

    const result = await planLesson({ topic: 'blues turnarounds' }, onProgress);

    expect(result.ok).toBe(true);
    expect(synthesizeDigestMock).toHaveBeenCalledTimes(1);
    const digestEvent = events.find((e) => e.type === 'digest');
    expect(digestEvent).toMatchObject({ type: 'digest', cacheHit: false });
  });
});

describe('planLesson — outline', () => {
  it('returns the outline, sources, digest, tier, and model on success', async () => {
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(OUTLINE);

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline).toEqual(OUTLINE);
    expect(result.sources.map((s) => s.documentId)).toEqual(['A', 'B']);
    expect(result.digest).toEqual(EMPTY_DIGEST);
    expect(result.tier).toBe('local');
    expect(result.model).toBe('gemma4-kb:latest');
  });

  it('emits progress events in order: tier, retrieve, coverage, digest, outline', async () => {
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(OUTLINE);
    const { events, onProgress } = collector();

    await planLesson({ topic: 'blues turnarounds' }, onProgress);

    expect(events.map((e) => e.type)).toEqual(['tier', 'retrieve', 'coverage', 'digest', 'outline']);
  });
});

describe('planLesson — outline retry', () => {
  it('retries a failing outline call once, then surfaces a friendly error', async () => {
    mockedChat
      .mockResolvedValueOnce(COVERED)
      .mockRejectedValueOnce(new Error("model 'gemma4-kb:latest' not found"))
      .mockRejectedValueOnce(new Error("model 'gemma4-kb:latest' not found"));
    const { events, onProgress } = collector();

    const result = await planLesson({ topic: 'blues turnarounds' }, onProgress);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // coverage + 2 outline attempts.
    expect(mockedChat).toHaveBeenCalledTimes(3);
    expect(result.error).toContain('Ollama');
    const retry = events.find((e) => e.type === 'retry');
    expect(retry).toMatchObject({ type: 'retry', step: 'outline', attempt: 1 });
    const error = events.find((e) => e.type === 'error');
    expect(error).toMatchObject({ type: 'error', step: 'outline' });
  });

  it('maps a frontier auth failure (after exhausting the retry) to a friendly message that never contains the key', async () => {
    resolveLessonModelMock.mockReturnValue(FRONTIER_MODEL);
    const FAKE_KEY = 'sk-ant-api03-totally-real-secret-value-should-never-leak';
    const authError = () =>
      new Error(
        `Structured output generation failed: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key ${FAKE_KEY}"}}`,
      );
    mockedChat
      .mockResolvedValueOnce(COVERED)
      .mockRejectedValueOnce(authError())
      .mockRejectedValueOnce(authError());

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).not.toContain(FAKE_KEY);
    expect(result.error).toContain('Anthropic');
    expect(result.error).toContain('ANTHROPIC_API_KEY');
  });

  it('retries a thin outline (fewer than MIN_OUTLINE_SECTIONS) once, then accepts the retry result', async () => {
    const thin = { ...OUTLINE, sections: [OUTLINE.sections[0]] };
    mockedChat
      .mockResolvedValueOnce(COVERED)
      .mockResolvedValueOnce(thin)
      .mockResolvedValueOnce(OUTLINE); // the retry: a full, non-thin outline
    const { events, onProgress } = collector();

    const result = await planLesson({ topic: 'blues turnarounds' }, onProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mockedChat).toHaveBeenCalledTimes(3);
    expect(result.outline.sections).toHaveLength(2);
    const retry = events.find((e) => e.type === 'retry');
    expect(retry).toMatchObject({ type: 'retry', step: 'outline', attempt: 1, reason: 'thin outline' });
  });

  it('accepts a still-thin retry result rather than retrying a second time', async () => {
    const thin = { ...OUTLINE, sections: [OUTLINE.sections[0]] };
    mockedChat
      .mockResolvedValueOnce(COVERED)
      .mockResolvedValueOnce(thin)
      .mockResolvedValueOnce(thin); // retry is STILL thin — accepted anyway
    const { onProgress } = collector();

    const result = await planLesson({ topic: 'blues turnarounds' }, onProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mockedChat).toHaveBeenCalledTimes(3);
    expect(result.outline.sections).toHaveLength(1);
  });

  it('retries an unusable outline shape once, then surfaces an error', async () => {
    mockedChat
      .mockResolvedValueOnce(COVERED)
      .mockResolvedValueOnce({ title: '' }) // unusable — no title/summary/sections
      .mockResolvedValueOnce({ title: '' });

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(false);
    expect(mockedChat).toHaveBeenCalledTimes(3);
  });
});

describe('planLesson — model tier', () => {
  it('stamps a successful result with the local tier when no frontier key is configured', async () => {
    resolveLessonModelMock.mockReturnValue(LOCAL_MODEL);
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(OUTLINE);

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toBe('local');
    expect(result.model).toBe('gemma4-kb:latest');
  });

  it('stamps a successful result with the frontier tier and model when resolveLessonModel picks frontier', async () => {
    resolveLessonModelMock.mockReturnValue(FRONTIER_MODEL);
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(OUTLINE);

    const result = await planLesson({ topic: 'blues turnarounds' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toBe('frontier');
    expect(result.model).toBe('claude-sonnet-5');
    for (const call of mockedChat.mock.calls) {
      expect(call[0].adapter).toBe(FRONTIER_MODEL.adapter);
    }
  });
});

// =============================================================================
// writeLesson
// =============================================================================

describe('writeLesson — input validation', () => {
  it('rejects a malformed outline (missing sections) with a clear error, never calling chat()', async () => {
    const result = await writeLesson({
      topic: 'blues turnarounds',
      outline: { title: 'x', summary: '', level: 'beginner', instrument: 'guitar', duration: null },
      sources: SOURCES,
      digest: EMPTY_DIGEST,
    } as unknown as WriteLessonInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('outline');
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('rejects an outline with an empty title', async () => {
    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, title: '' } }));

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('rejects an empty sources array', async () => {
    const result = await writeLesson(writeInput({ sources: [] }));

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('rejects a malformed digest', async () => {
    const result = await writeLesson(
      writeInput({ digest: { title: 'x' } as unknown as Digest }),
    );

    expect(result.ok).toBe(false);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('emits an `error` progress event for a malformed outline', async () => {
    const { events, onProgress } = collector();

    await writeLesson(
      { topic: 'x', outline: { title: '' }, sources: SOURCES, digest: EMPTY_DIGEST } as unknown as WriteLessonInput,
      onProgress,
    );

    expect(events).toEqual([{ type: 'error', step: 'validate', message: expect.any(String) }]);
  });
});

describe('writeLesson — happy path', () => {
  it('assembles blocks from the per-section calls, injecting headings deterministically', async () => {
    mockedChat
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

    const result = await writeLesson(writeInput());

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
    expect(result.lesson.body.map((b: { __component: string }) => b.__component)).toEqual([
      'lesson.heading',
      'lesson.prose',
      'lesson.heading',
      'lesson.step',
      'lesson.degree-chips',
    ]);
    expect(result.lesson.body.map((b: { id: number }) => b.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.lesson.body[0].text).toBe('What a turnaround does');
    expect(result.lesson.body[2].text).toBe('The classic V-IV-I shape');

    expect(result.sources).toEqual(SOURCES);
  });

  it('emits `section` and `grounding` progress events, then no `saved` event (persistence is the route\'s job)', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [{ type: 'prose', body: 'Content grounded in video A.', sourceVideoId: 'yt-A' }],
    });
    const { events, onProgress } = collector();

    const result = await writeLesson(
      writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }),
      onProgress,
    );

    expect(result.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['tier', 'section', 'grounding']);
    expect(events.some((e) => e.type === 'saved')).toBe(false);
  });
});

describe('writeLesson — model tier', () => {
  function oneSectionMock() {
    mockedChat.mockResolvedValueOnce({
      blocks: [
        { type: 'prose', body: 'blues turnarounds and shapes content for video A', sourceVideoId: 'yt-A' },
      ],
    });
  }
  const oneSectionOutline = { ...OUTLINE, sections: [OUTLINE.sections[0]] };

  it('stamps a successful result with the local tier when no frontier key is configured', async () => {
    resolveLessonModelMock.mockReturnValue(LOCAL_MODEL);
    oneSectionMock();

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toBe('local');
    expect(result.model).toBe('gemma4-kb:latest');
  });

  it('stamps a successful result with the frontier tier and model when resolveLessonModel picks frontier', async () => {
    resolveLessonModelMock.mockReturnValue(FRONTIER_MODEL);
    oneSectionMock();

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tier).toBe('frontier');
    expect(result.model).toBe('claude-sonnet-5');
    for (const call of mockedChat.mock.calls) {
      expect(call[0].adapter).toBe(FRONTIER_MODEL.adapter);
    }
  });

  it('produces byte-identical blocks on both tiers given the same mocked model output — proves one code path, not two', async () => {
    resolveLessonModelMock.mockReturnValue(LOCAL_MODEL);
    oneSectionMock();
    const localResult = await writeLesson(writeInput({ outline: oneSectionOutline }));

    resolveLessonModelMock.mockReturnValue(FRONTIER_MODEL);
    oneSectionMock();
    const frontierResult = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(localResult.ok).toBe(true);
    expect(frontierResult.ok).toBe(true);
    if (!localResult.ok || !frontierResult.ok) return;
    expect(frontierResult.lesson.body).toEqual(localResult.lesson.body);
    expect(frontierResult.lesson.title).toBe(localResult.lesson.title);
    expect(localResult.tier).toBe('local');
    expect(frontierResult.tier).toBe('frontier');
  });

});

describe('writeLesson — citation grounding', () => {
  const oneSectionOutline = { ...OUTLINE, sections: [OUTLINE.sections[0]] };

  it('grounds a valid sourceVideoId to a real BM25 timecode from that video only', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [
        { type: 'prose', body: 'blues turnarounds and shapes content for video A', sourceVideoId: 'yt-A' },
      ],
    });

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    const source = prose.source as { videoId: string; timeSec?: number };
    expect(source.videoId).toBe('yt-A');
    expect(source.timeSec).toBe(42);
  });

  it('drops a citation naming a video outside the source set', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [{ type: 'prose', body: 'Content citing an unrelated video.', sourceVideoId: 'yt-not-in-the-set' }],
    });

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    expect(prose.source).toBeUndefined();
  });

  it('never trusts a model-supplied timeSec — grounding decides it', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [
        {
          type: 'prose',
          body: 'blues turnarounds and shapes content for video A',
          sourceVideoId: 'yt-A',
          timeSec: 999999,
        },
      ],
    });

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    const source = prose.source as { videoId: string; timeSec?: number };
    expect(source.timeSec).not.toBe(999999);
    expect(source.timeSec).toBe(42);
  });

  it('yields videoId only, no timeSec, when grounding is weak', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [{ type: 'prose', body: 'completely unrelated words xylophone quokka zeppelin', sourceVideoId: 'yt-A' }],
    });

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    const source = prose.source as { videoId: string; timeSec?: number };
    expect(source.videoId).toBe('yt-A');
    expect(source.timeSec).toBeUndefined();
  });

  it('reports grounding stats via the `grounding` progress event', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [
        { type: 'prose', body: 'blues turnarounds and shapes content for video A', sourceVideoId: 'yt-A' },
        { type: 'prose', body: 'completely unrelated words xylophone quokka zeppelin', sourceVideoId: 'yt-A' },
      ],
    });
    const { events, onProgress } = collector();

    await writeLesson(writeInput({ outline: oneSectionOutline }), onProgress);

    const grounding = events.find((e) => e.type === 'grounding');
    expect(grounding).toEqual({ type: 'grounding', grounded: 1, total: 2 });
  });
});

describe('writeLesson — assembly fixes', () => {
  it('renumbers steps sequentially across sections instead of restarting per section', async () => {
    mockedChat
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

    const result = await writeLesson(writeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const steps = result.lesson.body.filter((b) => b.__component === 'lesson.step');
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4]);
  });

  it('strips a trailing colon and whitespace from step titles', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [{ type: 'step', number: 1, title: 'Identify the Root:  ', lede: null, body: null, sourceVideoId: null }],
    });

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const step = result.lesson.body.find((b) => b.__component === 'lesson.step')!;
    expect(step.title).toBe('Identify the Root');
  });

  it('drops a model-emitted heading inside a section, keeping only the injected one', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [
        { type: 'heading', text: 'A DIFFERENT drifted heading', level: 'h2' },
        { type: 'prose', body: 'Section content.', sourceVideoId: null },
      ],
    });

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const headings = result.lesson.body.filter((b) => b.__component === 'lesson.heading');
    expect(headings).toHaveLength(1);
    expect(headings[0].text).toBe(OUTLINE.sections[0].heading);
    expect(result.lesson.body.some((b) => b.text === 'A DIFFERENT drifted heading')).toBe(false);
  });
});

describe('writeLesson — block validation', () => {
  it('drops a malformed block but keeps the rest of the section', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [
        { type: 'prose' }, // missing required `body` — invalid
        { type: 'callout', tone: 'tip', body: 'Turnarounds often use a chromatic walk-down.', sourceVideoId: null },
      ],
    });

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.callout']);
  });

  it('drops a block of a disallowed type (e.g. diagram)', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [
        { type: 'diagram', instrument: 'guitar', root: 'E', quality: 'maj' },
        { type: 'prose', body: 'Turnarounds reset the harmonic loop.', sourceVideoId: null },
      ],
    });

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.prose']);
  });

  it('truncates an over-long table caption to 255 chars instead of failing', async () => {
    const longCaption = 'x'.repeat(300);
    mockedChat.mockResolvedValueOnce({
      blocks: [{ type: 'table', headers: ['Bar', 'Chord'], rows: [['11', 'V7']], caption: longCaption }],
    });

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = result.lesson.body.find((b) => b.__component === 'lesson.table');
    expect(table).toBeDefined();
    expect(typeof table!.caption).toBe('string');
    expect((table!.caption as string).length).toBe(255);
  });

  it('coerces non-string headers/rows/degrees with String()', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [
        {
          type: 'table',
          headers: ['Bar', 1 as unknown as string],
          rows: [[11 as unknown as string, 'V7']],
          caption: null,
        },
      ],
    });

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = result.lesson.body.find((b) => b.__component === 'lesson.table');
    expect(table!.headers).toEqual(['Bar', '1']);
    expect(table!.rows).toEqual([['11', 'V7']]);
  });
});

describe('writeLesson — contradictions', () => {
  it('turns digest contradictions into deterministic note callouts', async () => {
    const digestWithContradiction: Digest = {
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
    };
    mockedChat.mockResolvedValueOnce({
      blocks: [{ type: 'prose', body: 'Baseline content.', sourceVideoId: null }],
    });

    const result = await writeLesson(
      writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] }, digest: digestWithContradiction }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const callouts = result.lesson.body.filter((b) => b.__component === 'lesson.callout');
    expect(callouts).toHaveLength(1);
    expect(callouts[0].tone).toBe('note');
    expect(callouts[0].body as string).toContain('V7 or a diminished passing chord');
    expect(callouts[0].body as string).toContain('Title A');
    expect(callouts[0].body as string).toContain('Title B');

    const headings = result.lesson.body.filter((b) => b.__component === 'lesson.heading');
    expect(headings.some((h) => h.text === 'Where the sources disagree')).toBe(true);
  });

  it('adds no contradiction blocks when the digest has none', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [{ type: 'prose', body: 'Baseline content.', sourceVideoId: null }],
    });

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.some((b) => b.__component === 'lesson.callout')).toBe(false);
  });
});

describe('writeLesson — section retry', () => {
  const oneSectionOutline = { ...OUTLINE, sections: [OUTLINE.sections[0]] };

  it('retries a failed section call once, then succeeds using the retry result', async () => {
    mockedChat
      .mockRejectedValueOnce(new Error('model returned invalid json'))
      .mockResolvedValueOnce({
        blocks: [{ type: 'prose', body: 'Descend from V to IV to I.', sourceVideoId: null }],
      });
    const { events, onProgress } = collector();

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }), onProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mockedChat).toHaveBeenCalledTimes(2);
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.prose']);
    const retry = events.find((e) => e.type === 'retry');
    expect(retry).toMatchObject({ type: 'retry', step: 'section', attempt: 1, label: oneSectionOutline.sections[0].heading });
  });

  it('retries a failed section call once, then drops the section if the retry also fails', async () => {
    mockedChat
      .mockRejectedValueOnce(new Error('bad json'))
      .mockRejectedValueOnce(new Error('bad json'));

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    // Only section in the outline, and it failed twice — no usable body.
    expect(result.ok).toBe(false);
    expect(mockedChat).toHaveBeenCalledTimes(2);
  });

  it('retries a section that returns zero usable blocks once, then succeeds', async () => {
    mockedChat
      .mockResolvedValueOnce({ blocks: [{ type: 'prose' }] }) // invalid — missing body
      .mockResolvedValueOnce({
        blocks: [{ type: 'prose', body: 'Now with a real block.', sourceVideoId: null }],
      });
    const { events, onProgress } = collector();

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }), onProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mockedChat).toHaveBeenCalledTimes(2);
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.prose']);
    const retry = events.find((e) => e.type === 'retry');
    expect(retry).toMatchObject({ type: 'retry', step: 'section', reason: 'zero usable blocks' });
  });

  it('does NOT retry a thin (but non-empty) section — a single block is accept-and-log', async () => {
    mockedChat.mockResolvedValueOnce({
      blocks: [{ type: 'prose', body: 'Just one block.', sourceVideoId: null }],
    });
    const { events, onProgress } = collector();

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }), onProgress);

    expect(result.ok).toBe(true);
    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === 'retry')).toBe(false);
  });

  it('returns { ok: false } when every section fails after its retry', async () => {
    mockedChat
      .mockRejectedValueOnce(new Error('bad json'))
      .mockRejectedValueOnce(new Error('bad json'))
      .mockRejectedValueOnce(new Error('bad json'))
      .mockRejectedValueOnce(new Error('bad json'));

    const result = await writeLesson(writeInput());

    expect(result.ok).toBe(false);
    // 2 sections × 2 attempts each.
    expect(mockedChat).toHaveBeenCalledTimes(4);
  });

  it('skips a section whose every attempt fails and still returns a lesson from the rest', async () => {
    mockedChat
      .mockRejectedValueOnce(new Error('model returned invalid json'))
      .mockRejectedValueOnce(new Error('model returned invalid json'))
      .mockResolvedValueOnce({
        blocks: [{ type: 'prose', body: 'Descend from V to IV to I.', sourceVideoId: null }],
      });

    const result = await writeLesson(writeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.prose']);
  });
});

// -----------------------------------------------------------------------------
// Regression guard: Anthropic's structured-output schema support rejects
// several JSON Schema shapes, ALL caught live (never by a mocked/local
// test — Ollama, the local tier, accepts every one of them fine) across two
// rounds of exercising this pipeline against the real frontier tier:
//   - `minItems` other than 0 or 1 (from a zod array `.min(n)`, n > 1):
//     "output_config.format.schema: For 'array' type, 'minItems' values
//      other than 0 or 1 are not supported (got: [2, 5])"
//   - `maxItems` AT ALL (from a zod array `.max(n)`):
//     "output_config.format.schema: For 'array' type, property 'maxItems'
//      is not supported"
//   - `oneOf` (from a zod `z.discriminatedUnion(...)` — LessonBlockOutputSchema
//     used to be one; every single section call 400'd on the live frontier
//     tier until it was flattened to one object with nullable fields):
//     "output_config.format.schema: Schema type 'oneOf' is not supported"
//   - `minimum`/`maximum` on an `integer` (from a zod `.int()` — it compiles
//     to `{"type":"integer","minimum":...,"maximum":...}` with implicit
//     safe-integer bounds even with no explicit `.min()/.max()` call):
//     "output_config.format.schema: For 'integer' type, properties maximum,
//      minimum are not supported"
// This walks the ACTUAL compiled JSON Schema — via zod v4's own
// `~standard.jsonSchema.input({ target: 'draft-07' })`, the exact call
// `@tanstack/ai`'s schema-converter makes before handing the result to the
// Anthropic adapter (see `convertSchemaToJsonSchema` /
// `node_modules/@tanstack/ai/dist/esm/activities/chat/tools/schema-converter.js`)
// — rather than reflecting on zod's internal `_zod.def` representation, so
// this guard tracks whatever zod actually emits, not what a hand-written
// walker assumes it emits. `anyOf` (how `.nullable()` compiles) is
// deliberately NOT flagged — nullable fields are load-bearing throughout
// this pipeline's flattened block schema and are proven to work live.
// -----------------------------------------------------------------------------
describe('outputSchema regression guard — Anthropic-incompatible JSON Schema shapes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toDraft07JsonSchema(schema: any): unknown {
    return schema['~standard'].jsonSchema.input({ target: 'draft-07' });
  }

  // Walks a plain JSON Schema object (not a zod schema) looking for the
  // four shapes above. `anyOf` is intentionally not checked — see the
  // header comment.
  function findAnthropicViolations(node: unknown, path: string): string[] {
    if (!node || typeof node !== 'object') return [];
    const violations: string[] = [];
    const obj = node as Record<string, unknown>;

    if ('oneOf' in obj) {
      violations.push(
        `${path}: schema has 'oneOf' — Anthropic rejects this JSON Schema type outright. A zod z.discriminatedUnion() compiles to this; flatten it into one object with nullable per-variant fields instead (see LessonBlockOutputSchema).`,
      );
    }
    if ('allOf' in obj) {
      violations.push(`${path}: schema has 'allOf' — not verified against Anthropic but not used anywhere in this pipeline; treat as suspect the same as 'oneOf'.`);
    }
    if (typeof obj.maxItems === 'number') {
      violations.push(
        `${path}: schema has maxItems (${obj.maxItems}) — Anthropic rejects array maxItems entirely (a zod array .max(n)). Drop it and enforce the real maximum in code after the call, the way sanitizeOutline/buildSectionBlocks/toLessonBlock's table+degree-chips cases do.`,
      );
    }
    if (typeof obj.minItems === 'number' && obj.minItems > 1) {
      violations.push(
        `${path}: schema has minItems (${obj.minItems}) — Anthropic rejects array minItems other than 0 or 1 (a zod array .min(n), n > 1). Use .min(0)/.min(1) (or drop it) and enforce the real minimum in code, the way sanitizeOutline/MIN_SECTION_BLOCKS do.`,
      );
    }
    const isIntegerNode =
      obj.type === 'integer' || (Array.isArray(obj.type) && obj.type.includes('integer'));
    if (isIntegerNode && (typeof obj.minimum === 'number' || typeof obj.maximum === 'number')) {
      violations.push(
        `${path}: integer schema has minimum/maximum — Anthropic rejects bounds on integer types (a zod .int(), even with no explicit .min()/.max(), compiles to implicit safe-integer bounds). Use plain z.number() and coerce/validate the integer-ness in code instead.`,
      );
    }

    for (const [key, value] of Object.entries(obj)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        value.forEach((item, i) => violations.push(...findAnthropicViolations(item, `${path}.${key}[${i}]`)));
      } else {
        violations.push(...findAnthropicViolations(value, `${path}.${key}`));
      }
    }
    return violations;
  }

  it.each([
    ['CoverageVerdictSchema', CoverageVerdictSchema],
    ['LessonOutlineSchema', LessonOutlineSchema],
    ['SectionBlocksSchema', SectionBlocksSchema],
  ])('%s compiles to a JSON Schema with none of the four Anthropic-incompatible shapes', (name, schema) => {
    const jsonSchema = toDraft07JsonSchema(schema);
    const violations = findAnthropicViolations(jsonSchema, name);
    expect(violations, violations.join('\n')).toEqual([]);
  });

  // Sanity checks on the guard itself — if these ever stop catching an
  // obviously-bad schema, the three assertions above are worthless.
  it('catches oneOf (a discriminated union)', () => {
    const bad = z.discriminatedUnion('type', [
      z.object({ type: z.literal('a'), x: z.string() }),
      z.object({ type: z.literal('b'), y: z.string() }),
    ]);
    const violations = findAnthropicViolations(toDraft07JsonSchema(bad), 'bad');
    expect(violations.some((v) => v.includes("has 'oneOf'"))).toBe(true);
  });

  it('catches maxItems', () => {
    const bad = z.object({ items: z.array(z.string()).max(4) });
    const violations = findAnthropicViolations(toDraft07JsonSchema(bad), 'bad');
    expect(violations.some((v) => v.includes('maxItems (4)'))).toBe(true);
  });

  it('catches minItems > 1', () => {
    const bad = z.object({ items: z.array(z.string()).min(2) });
    const violations = findAnthropicViolations(toDraft07JsonSchema(bad), 'bad');
    expect(violations.some((v) => v.includes('minItems (2)'))).toBe(true);
  });

  it('catches integer bounds from a bare .int()', () => {
    const bad = z.object({ n: z.number().int() });
    const violations = findAnthropicViolations(toDraft07JsonSchema(bad), 'bad');
    expect(violations.some((v) => v.includes('integer schema has minimum/maximum'))).toBe(true);
  });

  it('does not false-positive on nullable fields (anyOf), .min(1)/.min(0) arrays, or a plain z.number()', () => {
    const ok = z.object({
      nullable: z.string().nullable(),
      a: z.array(z.string()).min(1),
      b: z.array(z.string()).min(0),
      c: z.array(z.string()),
      n: z.number(),
    });
    expect(findAnthropicViolations(toDraft07JsonSchema(ok), 'ok')).toEqual([]);
  });
});
