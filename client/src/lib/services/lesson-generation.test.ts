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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chat } from '@tanstack/ai';
import { buildBM25Index, type TranscriptChunk } from './transcript';
import type { StrapiVideo } from './videos';
import type { Digest } from './digest';
import {
  planLesson,
  writeLesson,
  CoverageVerdictSchema,
  LessonOutlineSchema,
  COVERAGE_SYSTEM,
  type LessonOutline,
  type LessonProgressEvent,
  type SourceVideo,
  findKeyPinnedNote,
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
  parameter: null,
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

  // Regression test for a real over-refusal: "what a beginner guitar
  // student needs to know" was refused even though retrieval found 5
  // sources scoring 0.70–0.77 (self-teaching guitar, first months of
  // practice, fretboard orientation, learning by ear) — the model demanded
  // EXHAUSTIVE coverage of every beginner sub-topic (posture, tuning,
  // equipment) instead of asking whether the sources had real, useful
  // beginner material. `covered` itself is model output this suite always
  // mocks (no live LLM call here), so this exercises the MECHANISM this
  // fix depends on: a `covered: true` verdict over a source set that is
  // deliberately only partially on-topic (see makeVideo's summaries below)
  // must proceed, never be second-guessed by planLesson itself.
  it('proceeds past coverage for a source set that is only partially, not exhaustively, on-topic (the real over-refusal case)', async () => {
    listAllVideosMock.mockResolvedValue([
      makeVideo('A', 0.77, {
        summaryTitle: 'How to Teach Yourself Guitar in 2026',
        summaryDescription: 'A self-directed practice plan for a new guitarist.',
      }),
      makeVideo('B', 0.72, {
        summaryTitle: 'How I Wish The Fretboard Was Explained To Me As A Beginner',
        summaryDescription: 'Orienting a beginner to the fretboard layout.',
      }),
    ]);
    mockedChat.mockResolvedValueOnce({
      covered: true,
      actualTopic: null,
      reason: 'The sources give a beginner real, substantive material even though neither covers posture, tuning, or equipment.',
    });
    mockedChat.mockResolvedValueOnce(OUTLINE);

    const result = await planLesson({ topic: 'what a beginner guitar student needs to know' });

    expect(result.ok).toBe(true);
    expect(findDigestByVideoSetKeyMock).toHaveBeenCalled();
  });
});

// The recalibration itself lives in the PROMPT (COVERAGE_SYSTEM) — the
// coverage verdict is always mocked above, so nothing there can catch a
// prompt that regresses back to demanding exhaustive coverage. This guards
// the prompt's own content instead: the old absolute framing must not come
// back, the "useful, not exhaustive" framing must be present, and the still-
// valid refusal example (barre chords) must not have been lost in the
// rewrite.
describe('COVERAGE_SYSTEM — recalibrated toward useful, not exhaustive, coverage', () => {
  it('does not contain the old absolute "partial coverage is NOT coverage" framing', () => {
    expect(COVERAGE_SYSTEM).not.toMatch(/partial.{0,20}coverage.{0,10}is not coverage/i);
  });

  it('frames the question as usefulness, not exhaustiveness', () => {
    expect(COVERAGE_SYSTEM.toLowerCase()).toContain('useful');
    expect(COVERAGE_SYSTEM).toMatch(/exhaustive/i);
  });

  it('still refuses the case this step was built for (barre chords vs. triads/harmonic movement)', () => {
    expect(COVERAGE_SYSTEM).toContain('barre chords');
    expect(COVERAGE_SYSTEM).toContain('triads and harmonic movement');
  });

  it('gives a worked example of a correct acceptance for partial-but-substantive coverage', () => {
    expect(COVERAGE_SYSTEM.toLowerCase()).toContain('beginner');
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
      .mockResolvedValueOnce(
        '::prose{src=yt-A}\nA turnaround signals the loop back to the top of the form.\n::',
      )
      .mockResolvedValueOnce(
        [
          '::step{title="Play the V chord"}',
          'Start on the V.',
          '::',
          '',
          '::degree-chips{}',
          'V IV I',
          '::',
        ].join('\n'),
      );

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
    mockedChat.mockResolvedValueOnce('::prose{src=yt-A}\nContent grounded in video A.\n::');
    const { events, onProgress } = collector();

    const result = await writeLesson(
      writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }),
      onProgress,
    );

    expect(result.ok).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['tier', 'section', 'illustrate', 'grounding']);
    expect(events.some((e) => e.type === 'saved')).toBe(false);
  });
});

describe('writeLesson — model tier', () => {
  function oneSectionMock() {
    mockedChat.mockResolvedValueOnce(
      '::prose{src=yt-A}\nblues turnarounds and shapes content for video A\n::',
    );
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

  it('grounds a valid src to a real BM25 timecode from that video only', async () => {
    mockedChat.mockResolvedValueOnce(
      '::prose{src=yt-A}\nblues turnarounds and shapes content for video A\n::',
    );

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    const source = prose.source as { videoId: string; timeSec?: number };
    expect(source.videoId).toBe('yt-A');
    expect(source.timeSec).toBe(42);
  });

  it('drops a citation naming a video outside the source set', async () => {
    mockedChat.mockResolvedValueOnce(
      '::prose{src=yt-not-in-the-set}\nContent citing an unrelated video.\n::',
    );

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    expect(prose.source).toBeUndefined();
  });

  // A timecode the model produced is not merely ignored — on a prose block
  // it is not a legal attribute at all, so the whole block is rejected by
  // name. Grounding decides `timeSec`, always.
  it('never trusts a model-authored timeSec — the attribute is rejected and grounding decides', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        '::prose{src=yt-A timeSec=999999}',
        'A block that tried to author its own timecode.',
        '::',
        '',
        '::prose{src=yt-A}',
        'blues turnarounds and shapes content for video A',
        '::',
      ].join('\n'),
    );

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.filter((b) => b.__component === 'lesson.prose');
    expect(prose).toHaveLength(1);
    expect(prose[0].body).toBe('blues turnarounds and shapes content for video A');
    const source = prose[0].source as { videoId: string; timeSec?: number };
    expect(source.timeSec).not.toBe(999999);
    expect(source.timeSec).toBe(42);
  });

  it('yields videoId only, no timeSec, when grounding is weak', async () => {
    mockedChat.mockResolvedValueOnce(
      '::prose{src=yt-A}\ncompletely unrelated words xylophone quokka zeppelin\n::',
    );

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const prose = result.lesson.body.find((b) => b.__component === 'lesson.prose')!;
    const source = prose.source as { videoId: string; timeSec?: number };
    expect(source.videoId).toBe('yt-A');
    expect(source.timeSec).toBeUndefined();
  });

  it('reports grounding stats via the `grounding` progress event', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        '::prose{src=yt-A}',
        'blues turnarounds and shapes content for video A',
        '::',
        '',
        '::prose{src=yt-A}',
        'completely unrelated words xylophone quokka zeppelin',
        '::',
      ].join('\n'),
    );
    const { events, onProgress } = collector();

    await writeLesson(writeInput({ outline: oneSectionOutline }), onProgress);

    const grounding = events.find((e) => e.type === 'grounding');
    expect(grounding).toEqual({ type: 'grounding', grounded: 1, total: 2 });
  });
});

describe('writeLesson — assembly fixes', () => {
  it('renumbers steps sequentially across sections instead of restarting per section', async () => {
    mockedChat
      .mockResolvedValueOnce(
        '::step{title="First step"}\n::\n\n::step{title="Second step"}\n::',
      )
      .mockResolvedValueOnce(
        '::step{title="Third step"}\n::\n\n::step{title="Fourth step"}\n::',
      );

    const result = await writeLesson(writeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const steps = result.lesson.body.filter((b) => b.__component === 'lesson.step');
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4]);
  });

  it('strips a trailing colon and whitespace from step titles', async () => {
    mockedChat.mockResolvedValueOnce('::step{title="Identify the Root:  "}\n::');

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const step = result.lesson.body.find((b) => b.__component === 'lesson.step')!;
    expect(step.title).toBe('Identify the Root');
  });

  // `::heading` is not in the write pass's directive set, so a model
  // heading is now REJECTED by name at the offending line rather than
  // dropped in silence the way buildSectionBlocks used to.
  it('rejects a model-emitted heading inside a section, keeping only the injected one', async () => {
    mockedChat.mockResolvedValueOnce(
      '::heading{level=h2}\nA DIFFERENT drifted heading\n::\n\nSection content.',
    );

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
    mockedChat.mockResolvedValueOnce(
      [
        '::prose{}', // empty body — a prose block that renders as nothing
        '::',
        '',
        '::callout{tone=tip}',
        'Turnarounds often use a chromatic walk-down.',
        '::',
      ].join('\n'),
    );

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.callout']);
  });

  it('drops a directive this pass may not emit (e.g. ::diagram)', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        '::diagram{root=E quality=major stringSet=e–B–G}',
        'A diagram the write pass may not draw.',
        '::',
        '',
        'Turnarounds reset the harmonic loop.',
      ].join('\n'),
    );

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.prose']);
  });

  it('truncates an over-long table caption to 255 chars instead of failing', async () => {
    const longCaption = 'x'.repeat(300);
    mockedChat.mockResolvedValueOnce(
      [`::table{caption="${longCaption}"}`, '| Bar | Chord |', '|---|---|', '| 11 | V7 |', '::'].join('\n'),
    );

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = result.lesson.body.find((b) => b.__component === 'lesson.table');
    expect(table).toBeDefined();
    expect(typeof table!.caption).toBe('string');
    expect((table!.caption as string).length).toBe(255);
  });

  it('stores every table cell as a string — a markdown table has no other type', async () => {
    mockedChat.mockResolvedValueOnce(
      ['::table{}', '| Bar | 1 |', '|---|---|', '| 11 | V7 |', '::'].join('\n'),
    );

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const table = result.lesson.body.find((b) => b.__component === 'lesson.table');
    expect(table!.headers).toEqual(['Bar', '1']);
    expect(table!.rows).toEqual([['11', 'V7']]);
  });

  // The markdown equivalent of the old schema's row/column mismatch check —
  // enforced at parse time now, with the row's own line number.
  it('drops a table whose row does not match the header count, keeping the rest', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        '::table{}',
        '| Bar | Chord |',
        '|---|---|',
        '| 11 |',
        '::',
        '',
        'The turnaround still gets explained.',
      ].join('\n'),
    );

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.prose']);
  });

  // The parse-rejection count reaches the progress stream, not only the log:
  // with the model authoring in markdown, a rejected block would otherwise
  // show up as nothing but a slightly shorter lesson.
  it('reports how many blocks the parser rejected, via the `section` progress event', async () => {
    mockedChat.mockResolvedValueOnce(
      ['::callout{tone=urgent}', 'Not a legal tone.', '::', '', 'But this paragraph is fine.'].join('\n'),
    );
    const { events, onProgress } = collector();

    await writeLesson(
      writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }),
      onProgress,
    );

    const section = events.find((e) => e.type === 'section');
    expect(section).toMatchObject({ type: 'section', blocks: 1, dropped: 1 });
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
    mockedChat.mockResolvedValueOnce('Baseline content.');

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
    mockedChat.mockResolvedValueOnce('Baseline content.');

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
      .mockRejectedValueOnce(new Error('model call failed'))
      .mockResolvedValueOnce('Descend from V to IV to I.');
    const { events, onProgress } = collector();

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }), onProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 write attempts (fail, then succeed) + 1 illustrate call for the
    // section that succeeded (unmocked here, so it resolves to `undefined`
    // — no illustrations, which is a valid outcome, not a failure).
    expect(mockedChat).toHaveBeenCalledTimes(3);
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
      .mockResolvedValueOnce('::prose{}\n::') // empty body — nothing usable
      .mockResolvedValueOnce('Now with a real block.');
    const { events, onProgress } = collector();

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }), onProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 write attempts + 1 illustrate call for the section that succeeded.
    expect(mockedChat).toHaveBeenCalledTimes(3);
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.prose']);
    const retry = events.find((e) => e.type === 'retry');
    expect(retry).toMatchObject({ type: 'retry', step: 'section', reason: 'zero usable blocks' });
  });

  it('does NOT retry a thin (but non-empty) section — a single block is accept-and-log', async () => {
    mockedChat.mockResolvedValueOnce('Just one block.');
    const { events, onProgress } = collector();

    const result = await writeLesson(writeInput({ outline: oneSectionOutline }), onProgress);

    expect(result.ok).toBe(true);
    // 1 write call + 1 illustrate call for the section that succeeded.
    expect(mockedChat).toHaveBeenCalledTimes(2);
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
      .mockRejectedValueOnce(new Error('model call failed'))
      .mockRejectedValueOnce(new Error('model call failed'))
      .mockResolvedValueOnce('Descend from V to IV to I.');

    const result = await writeLesson(writeInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual(['lesson.heading', 'lesson.prose']);
  });
});

// =============================================================================
// writeLesson — section source material (real transcript passages)
// =============================================================================
//
// The write pass used to see only the per-video CONTEXT CARDS (title +
// 400-char summary). It now retrieves real transcript passages per section
// from the same BM25 indexes citation grounding uses. These tests assert on
// the PROMPT, because that is the whole change — no mocked model response
// can tell you whether the material reaching the model got more specific.

/** The user-message content of the Nth chat() call this test made. */
function userPromptOf(callIndex: number): string {
  const args = mockedChat.mock.calls[callIndex]?.[0] as
    | { messages: Array<{ role: string; content: string }> }
    | undefined;
  return args?.messages.find((m) => m.role === 'user')?.content ?? '';
}

// A one-chunk BM25 index retrieves NOTHING: transcript.ts drops any query
// term whose IDF is under BM25_MIN_QUERY_IDF (1.5), and with N=1 every term
// sits at log(1 + 0.5/1.5) ≈ 0.29. A distinctive term needs a corpus to be
// distinctive against — at N=9 (one real chunk + eight filler), a term in
// exactly one chunk scores log(1 + 8.5/1.5) ≈ 1.86 and is retrievable.
// This is not a test artifact: a real transcript is hundreds of chunks.
const BM25_FILLER = [
  'microphone placement and gain staging for recording acoustic instruments at home',
  'cable management pedal order and power supply noise on a pedalboard',
  'humidity storage and seasonal neck relief adjustment for wooden instruments',
  'choosing an amplifier speaker size and cabinet material for a small room',
  'restringing winding technique and stretching new strings before a session',
  'metronome subdivisions and practising slowly with a click for timing',
  'ear training intervals sung against a drone for pitch accuracy',
  'setting action height and intonation at the bridge saddles',
];

function bm25ForPassages(passages: Array<{ text: string; timeSec: number }>) {
  const chunks: TranscriptChunk[] = [
    ...passages.map((p, i) => ({ id: i, text: p.text, startWord: i * 150, timeSec: p.timeSec })),
    ...BM25_FILLER.map((text, i) => ({
      id: passages.length + i,
      text,
      startWord: (passages.length + i) * 150,
      timeSec: 900 + i * 60,
    })),
  ];
  return buildBM25Index(chunks);
}

const PASSAGE_A =
  'A turnaround signals the loop back to the top of the twelve bar blues form.';
const PASSAGE_B =
  'The turnaround walks down from the five chord to the four chord and lands on fret eight.';

/** Video rows whose transcripts actually contain retrievable passages. */
function makePassageVideo(documentId: string, passageText: string, timeSec: number): StrapiVideo {
  return makeVideo(documentId, 0.9, {
    transcriptSegments: {
      version: 1,
      bm25: bm25ForPassages([{ text: passageText, timeSec }]),
    },
  } as Partial<StrapiVideo>);
}

function usePassageVideos() {
  fetchVideoByVideoIdMock.mockImplementation((id: string) =>
    Promise.resolve(
      id === 'yt-A' ? makePassageVideo('A', PASSAGE_A, 42) : makePassageVideo('B', PASSAGE_B, 77),
    ),
  );
}

describe('writeLesson — sections are written from transcript passages, not digest themes', () => {
  beforeEach(() => {
    usePassageVideos();
    mockedChat.mockResolvedValue('Passage-derived prose.');
  });

  const oneSection = () => writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } });

  it('puts the real transcript text into the section prompt, attributed to its video and timecode', async () => {
    await writeLesson(oneSection());

    const prompt = userPromptOf(0);
    expect(prompt).toContain(PASSAGE_A);
    expect(prompt).toContain(PASSAGE_B);
    expect(prompt).toContain('[yt-A @ 0:42]');
    expect(prompt).toContain('[yt-B @ 1:17]');
  });

  it('collapses a video that contributed a passage to id + title, dropping its summary card', async () => {
    await writeLesson(oneSection());

    const prompt = userPromptOf(0);
    expect(prompt).toContain('- [yt-A] "Summary title A"');
    // The compressed material the passages replace.
    expect(prompt).not.toContain('Summary description for A');
  });

  it('keeps the full context card for a source with no stored transcript index', async () => {
    fetchVideoByVideoIdMock.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'yt-A'
          ? makePassageVideo('A', PASSAGE_A, 42)
          : makeVideo('B', 0.9, { transcriptSegments: null } as Partial<StrapiVideo>),
      ),
    );

    await writeLesson(oneSection());

    const prompt = userPromptOf(0);
    // A source that can contribute no passage must not silently shrink to
    // a bare title — it keeps the summary it always had.
    expect(prompt).toContain('Summary description for B');
    expect(prompt).not.toContain('Summary description for A');
  });

  it('strips the inline [mm:ss] markers chunk text carries, so no timecode can be copied into prose', async () => {
    fetchVideoByVideoIdMock.mockImplementation(() =>
      Promise.resolve(
        makePassageVideo('A', `[0:42] ${PASSAGE_A} [0:58] and then it resolves.`, 42),
      ),
    );

    await writeLesson(oneSection());

    const prompt = userPromptOf(0);
    expect(prompt).toContain('and then it resolves.');
    expect(prompt).not.toContain('[0:42]');
    expect(prompt).not.toContain('[0:58]');
  });

  it('carries only the digest THROUGHLINE into the section prompt, not its compressed themes', async () => {
    await writeLesson(oneSection());

    const prompt = userPromptOf(0);
    expect(prompt).toContain(EMPTY_DIGEST.overallTheme);
    expect(prompt).toContain(EMPTY_DIGEST.bottomLine);
    // sharedThemes/uniqueInsights/viewingOrder are what the outline call
    // gets. Feeding them here is the thing this change removed.
    expect(prompt).not.toContain(EMPTY_DIGEST.sharedThemes[0].body);
  });

  it('reports how many passages each section was written from, via the `section` progress event', async () => {
    const { events, onProgress } = collector();
    await writeLesson(oneSection(), onProgress);

    const section = events.find((e) => e.type === 'section');
    expect(section).toBeDefined();
    if (section?.type !== 'section') return;
    expect(section.passages).toBe(2);
  });

  it('says so in the prompt — and reports passages: 0 — when nothing matched, rather than pretending', async () => {
    fetchVideoByVideoIdMock.mockImplementation((id: string) =>
      Promise.resolve(makeVideo(id.replace(/^yt-/, ''), 0.9, {
        transcriptSegments: { version: 1, bm25: bm25ForPassages([]) },
      } as Partial<StrapiVideo>)),
    );
    const { events, onProgress } = collector();

    await writeLesson(oneSection(), onProgress);

    const prompt = userPromptOf(0);
    expect(prompt).toContain('No transcript passages matched this section');
    const section = events.find((e) => e.type === 'section');
    if (section?.type !== 'section') return;
    expect(section.passages).toBe(0);
  });

  it('retrieves per section — a second section gets its own passages, not the first section\'s', async () => {
    fetchVideoByVideoIdMock.mockImplementation((id: string) =>
      Promise.resolve(
        id === 'yt-A'
          ? makePassageVideo('A', PASSAGE_A, 42)
          : makePassageVideo('B', 'Descending from the five chord to the four chord on the top strings.', 77),
      ),
    );

    await writeLesson(writeInput());

    // Section 2's goal ("the classic descending turnaround shape") should
    // pull the descending passage; the prompts must not be identical.
    expect(userPromptOf(0)).not.toBe(userPromptOf(1));
    expect(userPromptOf(1)).toContain('This section\'s goal: Walk through the classic descending turnaround shape.');
  });
});

// =============================================================================
// writeLesson — param-picker and video-ref (restored to the write schema)
// =============================================================================

const KEY_PARAMETER = { name: 'key' as const, label: 'Key', default: 'A' as const };

describe('writeLesson — param-picker', () => {
  beforeEach(usePassageVideos);

  const withParameter = (sections = [OUTLINE.sections[0]]) =>
    writeInput({ outline: { ...OUTLINE, parameter: KEY_PARAMETER, sections } });

  it('emits a param-picker and persists the lesson parameter that makes it render', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        '::param-picker{label="Try it in"}',
        '::',
        '',
        '::prose{src=yt-A}',
        'Move the shape to any root.',
        '::',
      ].join('\n'),
    );

    const result = await writeLesson(withParameter());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The pair, together: a picker with no lesson parameter renders as
    // nothing, and a parameter with no picker is unreachable.
    expect(result.lesson.parameter).toEqual(KEY_PARAMETER);
    const picker = result.lesson.body.find((b) => b.__component === 'lesson.param-picker');
    expect(picker).toBeDefined();
    expect(picker?.label).toBe('Try it in');
  });

  it('drops a param-picker on a lesson that declares no parameter — it would render as nothing', async () => {
    mockedChat.mockResolvedValueOnce(
      ['::param-picker{label="Key"}', '::', '', '::prose{src=yt-A}', 'Still real content.', '::'].join('\n'),
    );

    const result = await writeLesson(writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.parameter).toBeNull();
    expect(result.lesson.body.some((b) => b.__component === 'lesson.param-picker')).toBe(false);
    expect(result.lesson.body.some((b) => b.__component === 'lesson.prose')).toBe(true);
  });

  it('keeps only the FIRST param-picker when independently-generated sections each emit one', async () => {
    mockedChat
      .mockResolvedValueOnce('::param-picker{label="First"}\n::')
      .mockResolvedValueOnce('::param-picker{label="Second"}\n::');

    const result = await writeLesson(withParameter(OUTLINE.sections));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pickers = result.lesson.body.filter((b) => b.__component === 'lesson.param-picker');
    expect(pickers).toHaveLength(1);
    expect(pickers[0].label).toBe('First');
  });

  /** One theory-mode diagram, as the illustrate pass now answers: markdown. */
  const diagramMd = (attrs = 'root=A quality=major', caption = 'A movable major shape.') =>
    [`::diagram{mode=theory instrument=guitar stringSet=e–B–G useParam ${attrs}}`, caption, '::'].join('\n');

  it('honours a diagram\'s useParam only when the lesson has a parameter', async () => {
    const illustration = diagramMd();
    const section = '::prose{src=yt-A}\nThe shape moves.\n::';

    mockedChat.mockResolvedValueOnce(section).mockResolvedValueOnce(illustration);
    const withParam = await writeLesson(withParameter());

    mockedChat.mockReset();
    mockedChat.mockResolvedValueOnce(section).mockResolvedValueOnce(illustration);
    const withoutParam = await writeLesson(
      writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } }),
    );

    expect(withParam.ok && withoutParam.ok).toBe(true);
    if (!withParam.ok || !withoutParam.ok) return;
    expect(withParam.lesson.body.find((b) => b.__component === 'lesson.diagram')?.useParam).toBe(true);
    // Without a lesson parameter, useParam: true would make
    // resolveDiagramDots take LessonBody's fallback 'C' as the root and
    // silently redraw an A-major diagram in C.
    expect(
      withoutParam.lesson.body.find((b) => b.__component === 'lesson.diagram')?.useParam,
    ).toBe(false);
  });

  // Caught by a live frontier run, not by any of the above: the model set
  // useParam on a vii° diagram (root B) in a lesson keyed to C. The picker
  // replaces the ROOT, so at the default key that diagram would have drawn
  // C diminished under a caption calling it "the vii° chord" — a chord
  // that silently stops matching its own caption. See
  // `honoursLessonParameter`.
  it('ignores useParam on a diagram rooted somewhere other than the lesson key, keeping the fixed root', async () => {
    mockedChat
      .mockResolvedValueOnce('::prose{src=yt-A}\nThe seventh degree is diminished.\n::')
      .mockResolvedValueOnce(
        // Lesson key is A (KEY_PARAMETER.default); this is the vii°.
        diagramMd('root=G quality=diminished', 'The vii° chord.'),
      );

    const result = await writeLesson(withParameter());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const diagram = result.lesson.body.find((b) => b.__component === 'lesson.diagram');
    expect(diagram).toBeDefined();
    // Still drawn — just fixed on its own root, which is what the caption
    // describes. Dropping the diagram would lose real content.
    expect(diagram?.root).toBe('G');
    expect(diagram?.useParam).toBe(false);
  });
});

describe('writeLesson — video-ref', () => {
  beforeEach(usePassageVideos);

  const oneSection = () => writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } });

  it('emits a video-ref whose timeSec is BM25-grounded from the moment description, never taken from the model', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        // The `timeSec` attribute is refused with a warning, not honoured.
        '::video-ref{videoId=yt-A label="Watch the turnaround demonstrated" timeSec=999}',
        // Never rendered — the body is the grounding query.
        'A turnaround signals the loop back to the top of the twelve bar blues form.',
        '::',
      ].join('\n'),
    );

    const result = await writeLesson(oneSection());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ref = result.lesson.body.find((b) => b.__component === 'lesson.video-ref');
    expect(ref).toBeDefined();
    expect(ref?.videoId).toBe('yt-A');
    expect(ref?.label).toBe('Watch the turnaround demonstrated');
    expect(ref?.timeSec).toBe(42);
    // The grounding text is a query, not content — it must not survive
    // into the saved block.
    expect(ref?.body).toBeUndefined();
  });

  it('drops a video-ref naming a video outside the lesson\'s source set rather than shipping a dead link', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        '::video-ref{videoId=yt-NOPE label="Watch this"}',
        'anything',
        '::',
        '',
        '::prose{src=yt-A}',
        'Real content survives.',
        '::',
      ].join('\n'),
    );

    const result = await writeLesson(oneSection());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.some((b) => b.__component === 'lesson.video-ref')).toBe(false);
    expect(result.lesson.body.some((b) => b.__component === 'lesson.prose')).toBe(true);
  });

  it('falls back to the default link text rather than rendering an unlabelled link', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        '::video-ref{videoId=yt-A}',
        'A turnaround signals the loop back to the top of the twelve bar blues form.',
        '::',
      ].join('\n'),
    );

    const result = await writeLesson(oneSection());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.find((b) => b.__component === 'lesson.video-ref')?.label).toBe(
      'Watch this moment',
    );
  });
});

// =============================================================================
// planLesson — the lesson-level parameter the outline may declare
// =============================================================================

describe('planLesson — lesson parameter', () => {
  function planWith(outlineRaw: Record<string, unknown>) {
    mockedChat.mockResolvedValueOnce(COVERED).mockResolvedValueOnce(outlineRaw);
    return planLesson({ topic: 'movable triad shapes' });
  }

  const baseOutline = {
    title: 'Movable triad shapes',
    summary: 'Take one triad shape anywhere on the neck.',
    level: 'beginner',
    instrument: 'guitar',
    duration: '10 min',
    // Two, not one: MIN_OUTLINE_SECTIONS is 2 and a thinner outline gets
    // retried, which would consume the mocked responses these tests queue.
    sections: [
      { heading: 'The shape', goal: 'Show the shape.' },
      { heading: 'Moving it', goal: 'Move the shape to another root.' },
    ],
  };

  it('builds a lesson parameter from the label + default the outline declared', async () => {
    const result = await planWith({
      ...baseOutline,
      parameterLabel: 'Key',
      parameterDefault: 'G',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.parameter).toEqual({ name: 'key', label: 'Key', default: 'G' });
  });

  it('leaves the parameter null when the outline declares no label', async () => {
    const result = await planWith({
      ...baseOutline,
      parameterLabel: null,
      parameterDefault: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.parameter).toBeNull();
  });

  it('falls back to C rather than shipping a default resolveDiagramDots would refuse', async () => {
    const result = await planWith({
      ...baseOutline,
      parameterLabel: 'Key',
      // A flat — the theory layer is sharps-only, so this would render
      // nothing at all if it survived.
      parameterDefault: 'Bb',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.parameter).toEqual({ name: 'key', label: 'Key', default: 'C' });
  });

  it('drops a half-declared parameter (a default with no label) entirely', async () => {
    const result = await planWith({
      ...baseOutline,
      parameterLabel: '   ',
      parameterDefault: 'G',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.parameter).toBeNull();
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
        `${path}: schema has 'oneOf' — Anthropic rejects this JSON Schema type outright. A zod z.discriminatedUnion() compiles to this; flatten it into one object with nullable per-variant fields instead — or, better, do what the write and illustrate passes did and stop using structured output for it.`,
      );
    }
    if ('allOf' in obj) {
      violations.push(`${path}: schema has 'allOf' — not verified against Anthropic but not used anywhere in this pipeline; treat as suspect the same as 'oneOf'.`);
    }
    if (typeof obj.maxItems === 'number') {
      violations.push(
        `${path}: schema has maxItems (${obj.maxItems}) — Anthropic rejects array maxItems entirely (a zod array .max(n)). Drop it and enforce the real maximum in code after the call, the way sanitizeOutline does for the outline's sections and markdown-blocks.ts does for tables and degree-chips.`,
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

// -----------------------------------------------------------------------------
// Regression guard #2: Anthropic also rejects a structured-output request
// carrying more than 16 union-typed (`anyOf`) parameters — the reason
// LessonBlockOutputSchema (the write pass's block schema, before this
// branch's write/illustrate split) had to drop `inversion`, `fromFret`,
// `toFret`, and explicit-mode `dots`/`marks`, and lock diagram generation
// to `mode: "theory"` only (see that schema's own comment, and the brief
// this branch implements: ".superpowers/sdd/lesson-shape/brief.md"). That
// cap was never guarded by an automated test before this branch — only
// found by hitting it live. This walks the same compiled JSON Schema the
// schema-lint regression guard above already walks (via zod v4's own
// `~standard.jsonSchema.input`) and counts every `anyOf`/`oneOf` node in
// the WHOLE tree, not just the top level — a nested sub-object's nullable
// fields (e.g. inside an array's `items`) count against the same request
// budget as a top-level one.
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// Regression guard #3: the guards above only bind the schemas they are
// HANDED. The failure they cannot see is a third `outputSchema` arriving in
// this module and never being added to the lists — which is exactly how the
// write and illustrate passes accumulated their restrictions in the first
// place. So this reads lesson-generation.ts's own source and asserts that
// the only schemas reaching `outputSchema:` are the two the lists above
// cover. It is the same "grep the real thing, never an abstraction that
// would prove the code agrees with itself" stance as
// block-vocabulary.test.ts.
//
// Adding a third structured-output call is allowed — but it has to be a
// deliberate edit here AND in both lists above, not a quiet addition that
// passes green until a live 400.
// -----------------------------------------------------------------------------
describe('outputSchema regression guard — which calls use one at all', () => {
  const SOURCE = readFileSync(
    resolve(process.cwd(), 'src/lib/services/lesson-generation.ts'),
    'utf8',
  );
  const GUARDED = ['CoverageVerdictSchema', 'LessonOutlineSchema'];

  it('passes outputSchema only from the schemas the guards above cover', () => {
    const used = [...SOURCE.matchAll(/outputSchema:\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(used.length, 'no outputSchema call sites found — the regex broke, not the code').toBeGreaterThan(0);
    const unguarded = [...new Set(used)].filter((name) => !GUARDED.includes(name));
    expect(
      unguarded,
      `these schemas reach outputSchema but no Anthropic-compatibility guard covers them: ${unguarded.join(', ')}. Add them to both it.each lists above.`,
    ).toEqual([]);
  });

  it('the write and illustrate passes ask for markdown, not structured output', () => {
    // The single fact this whole change rests on. If either pass regains an
    // outputSchema, every restriction in the guards above comes back with
    // it — and so does the 16-union ceiling on the block vocabulary.
    expect(SOURCE).toContain('allowed: WRITE_DIRECTIVES');
    expect(SOURCE).toContain('allowed: ILLUSTRATE_DIRECTIVES');
    expect(SOURCE).not.toContain('SectionBlocksSchema');
    expect(SOURCE).not.toContain('SectionIllustrationsSchema');
  });
});

describe('outputSchema regression guard — Anthropic 16-union-parameter cap', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toDraft07JsonSchema(schema: any): unknown {
    return schema['~standard'].jsonSchema.input({ target: 'draft-07' });
  }

  function countUnionParams(node: unknown): number {
    if (!node || typeof node !== 'object') return 0;
    let count = 0;
    const obj = node as Record<string, unknown>;
    if ('anyOf' in obj || 'oneOf' in obj) count += 1;
    for (const value of Object.values(obj)) {
      if (!value || typeof value !== 'object') continue;
      if (Array.isArray(value)) {
        for (const item of value) count += countUnionParams(item);
      } else {
        count += countUnionParams(value);
      }
    }
    return count;
  }

  const ANTHROPIC_UNION_PARAM_CAP = 16;

  it.each([
    ['CoverageVerdictSchema', CoverageVerdictSchema],
    ['LessonOutlineSchema', LessonOutlineSchema],
  ])('%s stays at or under the 16 union-typed-parameter cap', (name, schema) => {
    const count = countUnionParams(toDraft07JsonSchema(schema));
    expect(count, `${name} has ${count} union-typed (anyOf) parameters — Anthropic rejects a structured-output request over ${ANTHROPIC_UNION_PARAM_CAP}`).toBeLessThanOrEqual(
      ANTHROPIC_UNION_PARAM_CAP,
    );
  });

  it('counts a known-bad schema correctly (sanity check on the walker itself)', () => {
    const tooMany = z.object(
      Object.fromEntries(
        Array.from({ length: 17 }, (_, i) => [`f${i}`, z.string().nullable()]),
      ),
    );
    expect(countUnionParams(toDraft07JsonSchema(tooMany))).toBe(17);
  });

  // The ≤16 assertions above tell you a schema is legal. They do NOT tell
  // you how much room is left, which is the number that actually decides
  // whether the next block type can be added — `param-picker` and
  // `video-ref` were cut for exactly this budget and only came back once
  // the write/illustrate split freed room. Pinning the exact counts means
  // a field added without thinking about the budget fails here, naming the
  // new number, instead of passing quietly at 15 and 400ing live at 17.
  it.each([
    ['CoverageVerdictSchema', CoverageVerdictSchema, 2],
    ['LessonOutlineSchema', LessonOutlineSchema, 3],
  ])('%s spends exactly the union budget it is documented to spend', (name, schema, expected) => {
    const count = countUnionParams(toDraft07JsonSchema(schema));
    expect(
      count,
      `${name} now uses ${count} of ${ANTHROPIC_UNION_PARAM_CAP} union-typed parameters, not ${expected}. If that is intentional, update this expectation AND the schema's own comment; if it is not, you just spent budget a future block type needs.`,
    ).toBe(expected);
  });
});

// =============================================================================
// Adversarial-review regressions
// -----------------------------------------------------------------------------
// Five defects found by running the real pipeline and reading the lessons it
// produced, not by this suite — every one of them validated, typechecked and
// passed the tests that existed at the time. They share a shape: content
// that is quietly wrong, or a drop that is quietly invisible.
// =============================================================================

function systemPromptOf(callIndex: number): string {
  const args = mockedChat.mock.calls[callIndex]?.[0] as
    | { messages: Array<{ role: string; content: string }> }
    | undefined;
  return args?.messages.find((m) => m.role === 'system')?.content ?? '';
}

// -----------------------------------------------------------------------------
// 1. A transposable diagram must not carry a caption pinned to one key.
// -----------------------------------------------------------------------------

describe('findKeyPinnedNote — captions that cannot survive being re-keyed', () => {
  it.each([
    ['C, E and G — scale degrees 1, 3 and 5', 'the shipped counter-example: a note run'],
    ['The shape puts F# under your first finger', 'an accidental'],
    ['Start from the root note G and climb', 'a note introduced as a root'],
    ['A major triad, voiced on the top three strings', 'a note letter plus a quality'],
    ['Am is the relative minor here', 'a chord name'],
    ['Play it in the key of D', 'a note introduced as a key'],
  ])('flags %j — %s', (caption) => {
    expect(findKeyPinnedNote(caption)).not.toBeNull();
  });

  it.each([
    // The caption the existing useParam test uses — a bare sentence-initial
    // "A" is the English article far more often than the note, and demoting
    // every diagram captioned like this would make the picker decorative.
    'A movable major shape.',
    // String names do not move when the key does.
    'The low E string anchors the whole shape.',
    'Root, third and fifth, on the e–B–G set.',
    // Degrees and intervals are exactly how a transposable caption should
    // be written — the guidance the prompt now gives.
    'Scale degrees 1, 3 and 5, wherever you put the root.',
    'Three frets up from the root, every time.',
  ])('does not flag %j', (caption) => {
    expect(findKeyPinnedNote(caption)).toBeNull();
  });
});

describe('writeLesson — useParam vs. the caption', () => {
  beforeEach(usePassageVideos);

  const withKeyOfA = (sections = [OUTLINE.sections[0]]) =>
    writeInput({ outline: { ...OUTLINE, parameter: KEY_PARAMETER, sections } });

  /** A theory diagram rooted on the lesson key — the root check passes. */
  const onKeyDiagram = (caption: string) =>
    [
      '::diagram{mode=theory instrument=guitar stringSet=e–B–G useParam root=A quality=major}',
      caption,
      '::',
    ].join('\n');

  // The live failure: root matched the lesson key, so honoursLessonParameter
  // said yes, and the caption named the notes anyway. Move the picker to G
  // and the diagram redraws while the caption still says A, C# and E.
  it('switches useParam off when the caption names the notes, keeping diagram and caption in agreement', async () => {
    mockedChat
      .mockResolvedValueOnce('::prose{src=yt-A}\nThe shape moves.\n::')
      .mockResolvedValueOnce(onKeyDiagram('A, C# and E — the three notes under your hand.'));

    const result = await writeLesson(withKeyOfA());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const diagram = result.lesson.body.find((b) => b.__component === 'lesson.diagram');
    expect(diagram).toBeDefined();
    // Kept and still drawn — just no longer re-keyed under a caption that
    // names three specific notes.
    expect(diagram?.root).toBe('A');
    expect(diagram?.useParam).toBe(false);
  });

  it('leaves useParam on when the caption is written in movable terms', async () => {
    mockedChat
      .mockResolvedValueOnce('::prose{src=yt-A}\nThe shape moves.\n::')
      .mockResolvedValueOnce(onKeyDiagram('Scale degrees 1, 3 and 5, from whichever root you pick.'));

    const result = await writeLesson(withKeyOfA());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.find((b) => b.__component === 'lesson.diagram')?.useParam).toBe(true);
  });

  it('tells the illustrate pass that a useParam caption may not name a note', async () => {
    mockedChat.mockResolvedValueOnce('::prose{src=yt-A}\nThe shape moves.\n::');
    await writeLesson(withKeyOfA());

    // The user prompt carries the lesson's own key; the system prompt
    // carries the rule. Both, because the model has been given the rule in
    // only one place before and ignored it.
    expect(systemPromptOf(1)).toMatch(/caption[^.]*may not name a note|must survive being re-keyed/i);
    expect(userPromptOf(1)).toContain('caption names no note at all');
  });

  // Demoting every candidate diagram can leave a picker the reader can move
  // that changes nothing — the same silence in another form.
  it('reports a key picker that nothing follows', async () => {
    mockedChat.mockResolvedValueOnce(
      ['::param-picker{label="Try it in"}', '::', '', '::prose{src=yt-A}', 'No diagram follows.', '::'].join('\n'),
    );
    const { events, onProgress } = collector();

    const result = await writeLesson(withKeyOfA(), onProgress);

    expect(result.ok).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', step: 'param-picker' }),
    );
  });
});

// -----------------------------------------------------------------------------
// 2. Prompt scaffolding must not reach the reader.
// -----------------------------------------------------------------------------

describe('writeLesson — prompt scaffolding never ships', () => {
  beforeEach(usePassageVideos);

  const oneSection = () => writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } });

  // The shipped leak: the illustrate pass is handed the section's text as a
  // numbered list so it can anchor `after=`, and it wrote a caption about
  // the numbering.
  it('strips a block index out of an illustration caption', async () => {
    mockedChat
      .mockResolvedValueOnce('::prose{src=yt-A}\nThe shape moves.\n::')
      .mockResolvedValueOnce(
        [
          '::diagram{mode=theory instrument=guitar stringSet=e–B–G root=C quality=major}',
          'Block [2] shows the shape your hand actually holds.',
          '::',
        ].join('\n'),
      );

    const result = await writeLesson(oneSection());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const caption = result.lesson.body.find((b) => b.__component === 'lesson.diagram')?.caption;
    expect(caption).toBeDefined();
    expect(caption).not.toMatch(/block/i);
    expect(caption).not.toContain('[2]');
    expect(caption).toBe('Shows the shape your hand actually holds.');
  });

  it('strips scaffolding out of prose the write pass produced', async () => {
    mockedChat.mockResolvedValueOnce('As shown in block 1, the shape moves.');

    const result = await writeLesson(oneSection());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.find((b) => b.__component === 'lesson.prose')?.body).toBe(
      'The shape moves.',
    );
  });

  it('strips a leaked placement attribute and placeholder id', async () => {
    mockedChat.mockResolvedValueOnce('Place this after=2 and cite VIDEO_ID for the rest.');

    const result = await writeLesson(oneSection());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = result.lesson.body.find((b) => b.__component === 'lesson.prose')?.body as string;
    expect(body).not.toContain('after=2');
    expect(body).not.toContain('VIDEO_ID');
  });

  it('no longer offers the illustrate pass a quotable name for the numbering', async () => {
    mockedChat.mockResolvedValueOnce('::prose{src=yt-A}\nThe shape moves.\n::');
    await writeLesson(oneSection());

    const system = systemPromptOf(1);
    // The exact phrase the shipped caption echoed.
    expect(system).not.toContain('indexed list of blocks');
    expect(system).toMatch(/never see|never sees/i);
    expect(system).toMatch(/NEVER mention a line number/i);
  });
});

// -----------------------------------------------------------------------------
// 3. Prose that names a source but carries no citation.
// -----------------------------------------------------------------------------

describe('writeLesson — unlinked sourcing claims', () => {
  beforeEach(usePassageVideos);

  const oneSection = () => writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } });

  it('reports an uncited verbatim quotation, on the section event and as an error frame', async () => {
    mockedChat.mockResolvedValueOnce(
      'The rule is simple: "count frets, not notes, every single time".',
    );
    const { events, onProgress } = collector();

    const result = await writeLesson(oneSection(), onProgress);

    // Non-fatal: the lesson still generates and still saves.
    expect(result.ok).toBe(true);
    expect(events.find((e) => e.type === 'section')).toMatchObject({ unsourced: 1 });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'error', step: 'citation' }),
    );
  });

  it('reports an uncited attribution to a source video', async () => {
    mockedChat.mockResolvedValueOnce('One video recommends starting from the fifth instead.');
    const { events, onProgress } = collector();

    await writeLesson(oneSection(), onProgress);

    expect(events.find((e) => e.type === 'section')).toMatchObject({ unsourced: 1 });
  });

  it('does not flag the same claim once it carries a citation', async () => {
    mockedChat.mockResolvedValueOnce(
      [
        '::prose{src=yt-A}',
        'One video recommends starting from the fifth instead.',
        '::',
      ].join('\n'),
    );
    const { events, onProgress } = collector();

    await writeLesson(oneSection(), onProgress);

    expect(events.find((e) => e.type === 'section')).toMatchObject({ unsourced: 0 });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('does not flag ordinary uncited prose that claims no source', async () => {
    mockedChat.mockResolvedValueOnce('A turnaround signals the loop back to the top of the form.');
    const { events, onProgress } = collector();

    await writeLesson(oneSection(), onProgress);

    expect(events.find((e) => e.type === 'section')).toMatchObject({ unsourced: 0 });
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('asks the write pass for a citation on any block that names a source', async () => {
    mockedChat.mockResolvedValueOnce('Plain prose.');
    await writeLesson(oneSection());

    expect(systemPromptOf(0)).toMatch(/names a source in its own words/i);
  });
});

// -----------------------------------------------------------------------------
// 4. The runaway backstops truncated in silence.
// -----------------------------------------------------------------------------

describe('writeLesson — backstop truncation is reported, not silent', () => {
  beforeEach(usePassageVideos);

  const oneSection = () => writeInput({ outline: { ...OUTLINE, sections: [OUTLINE.sections[0]] } });

  // SECTION_BLOCKS_BACKSTOP is 40 (module-private).
  it('counts the write pass\'s truncated blocks toward `dropped`', async () => {
    const paragraphs = Array.from({ length: 45 }, (_, i) => `Turnaround paragraph number ${i + 1}.`);
    mockedChat.mockResolvedValueOnce(paragraphs.join('\n\n'));
    const { events, onProgress } = collector();

    const result = await writeLesson(oneSection(), onProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 40 kept + the injected heading.
    expect(result.lesson.body.filter((b) => b.__component === 'lesson.prose')).toHaveLength(40);
    expect(events.find((e) => e.type === 'section')).toMatchObject({ blocks: 40, dropped: 5 });
  });

  // ILLUSTRATIONS_PER_SECTION_BACKSTOP is 10 (module-private).
  it('counts the illustrate pass\'s truncated diagrams toward `dropped`', async () => {
    const diagrams = Array.from({ length: 12 }, (_, i) =>
      [
        '::diagram{mode=theory instrument=guitar stringSet=e–B–G root=C quality=major}',
        `Shape number ${i + 1}, higher up the neck.`,
        '::',
      ].join('\n'),
    );
    mockedChat
      .mockResolvedValueOnce('::prose{src=yt-A}\nFive shapes, one neck.\n::')
      .mockResolvedValueOnce(diagrams.join('\n\n'));
    const { events, onProgress } = collector();

    const result = await writeLesson(oneSection(), onProgress);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.filter((b) => b.__component === 'lesson.diagram')).toHaveLength(10);
    expect(events.find((e) => e.type === 'illustrate')).toMatchObject({ diagrams: 10, dropped: 2 });
  });

  it('counts blocks grounding threw away toward `dropped` as well', async () => {
    // A video-ref naming a video outside the source set is dropped by
    // grounding, not by the parser — it used to be logged and nothing else.
    mockedChat.mockResolvedValueOnce(
      [
        '::video-ref{videoId=yt-NOPE label="Watch this"}',
        'The moment where the shape is shown.',
        '::',
        '',
        'But this paragraph is fine.',
      ].join('\n'),
    );
    const { events, onProgress } = collector();

    const result = await writeLesson(oneSection(), onProgress);

    expect(result.ok).toBe(true);
    expect(events.find((e) => e.type === 'section')).toMatchObject({ blocks: 1, dropped: 1 });
  });
});

// -----------------------------------------------------------------------------
// 5. A section that yields nothing after both attempts emitted no event.
// -----------------------------------------------------------------------------

describe('writeLesson — a dropped section says so', () => {
  beforeEach(usePassageVideos);

  it('emits an error event naming the section that produced nothing', async () => {
    mockedChat
      // Section 1: two attempts, both parse to nothing usable.
      .mockResolvedValueOnce('::prose{}\n::')
      .mockResolvedValueOnce('::prose{}\n::')
      // Section 2 writes normally.
      .mockResolvedValueOnce('Descend from V to IV to I.');
    const { events, onProgress } = collector();

    const result = await writeLesson(writeInput(), onProgress);

    // The run survives — one section failing is not a failed lesson.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lesson.body.map((b) => b.__component)).toEqual([
      'lesson.heading',
      'lesson.prose',
    ]);

    // The user saw a retry for section 1 and then, before this fix, nothing
    // at all — the step simply vanished from the run log.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'error',
        step: 'section',
        message: expect.stringContaining(OUTLINE.sections[0].heading),
      }),
    );
    expect(events.filter((e) => e.type === 'section')).toHaveLength(1);
  });

  it('emits one error per dropped section when several fail', async () => {
    mockedChat.mockResolvedValue('::prose{}\n::');
    const { events, onProgress } = collector();

    const result = await writeLesson(writeInput(), onProgress);

    // Every section failed, so the run fails — but each dropped section is
    // still announced individually before the terminal error.
    expect(result.ok).toBe(false);
    const sectionErrors = events.filter(
      (e) => e.type === 'error' && e.step === 'section',
    );
    // Two dropped sections + the terminal "every section failed".
    expect(sectionErrors).toHaveLength(3);
  });
});

// -----------------------------------------------------------------------------
// The key-pin detector, measured against real output.
// -----------------------------------------------------------------------------
//
// Every caption below came out of one real frontier generation ("CAGED
// System: Moving Chord Shapes Around the Neck", claude-sonnet-5, 16
// captions across 12 illustrations). A detector that demotes half of these
// would make the key picker decorative, which is its own silent failure —
// so the false-positive rate is pinned here against real writing rather
// than against captions invented to pass.
describe('findKeyPinnedNote — measured against a real generated lesson', () => {
  const REAL_CAPTIONS = [
    'Fret 0 to 12 on the low E and A strings, with the two half-step pairs banded — the map this whole lesson climbs.',
    'The musical alphabet cycle, letter to letter',
    'Which string carries the root for each CAGED shape',
    "The C shape's root sits on the A string, third fret — the middle finger anchors it.",
    "The A shape's root is the open A string itself, right where the shape gets its name.",
    "The G shape's root falls on the low E string, third fret, naming this shape.",
    "The E shape's root is the open low E string — the whole shape hangs off it.",
    "The D shape's root lands on the open D string, framed by the top three strings.",
    'The three primary string pairs',
    'Every future E-shape chord starts as this exact finger pattern — only its position on the neck will change.',
    'One fret higher, the same three fingers now form a barre instead of relying on open strings — the note under your index finger names the new chord.',
    "Match the fret under your index finger to one of these to find the chord's name.",
    'Frets on the low E string and the chord you get by barring the E shape there',
    "The root and the scale's seventh degree sit one fret apart on the low string — the same half step that closes the octave.",
  ];

  it.each(REAL_CAPTIONS)('leaves a real, movable caption alone: %j', (caption) => {
    expect(findKeyPinnedNote(caption)).toBeNull();
  });

  // The two from that same lesson that DO pin themselves. Neither diagram
  // set useParam, so neither shipped broken — but either would have.
  it('flags the one real caption that names chord tones', () => {
    const caption =
      "The E-shape scale box built around that same root: the ringed notes are the anchor you'd barre for the chord; the light dots are the C–E–G chord tones sitting inside the full scale run.";
    expect(findKeyPinnedNote(caption)).toMatchObject({ term: 'C–E' });
  });

  // Known, accepted imprecision: slash-separated string pairs that are not
  // followed by the word "pair" read exactly like a chord-tone run. The
  // cost is one diagram losing its picker and printing a warning that names
  // the caption; the alternative — letting a genuine chord-tone run through
  // — publishes a lesson that argues with itself.
  it('is documented to over-flag bare string-pair shorthand', () => {
    const caption = 'Carrying it from the E/A pair into D/G and on into B/e.';
    expect(findKeyPinnedNote(caption)).not.toBeNull();
  });
});
