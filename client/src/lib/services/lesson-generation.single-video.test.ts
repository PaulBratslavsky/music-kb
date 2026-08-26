// Contract tests for the single-video lesson path — planSingleVideoLesson,
// plus proof that the WRITE phase it feeds is the exact same writeLesson()
// the library path uses (see lesson-generation.ts's "Single-video lesson"
// section header). Split into its own file rather than appended to the
// (already 2000+ line) lesson-generation.test.ts: this pipeline was added
// while another task was mid-edit inside lesson-generation.ts itself, and a
// second file avoids two concurrent edits landing in the same giant test
// file. Mocking setup deliberately mirrors lesson-generation.test.ts.
//
// Covers, per the brief's own test list:
//   - a video with no transcript refuses before any model call
//   - the single-video path never invokes retrieval, coverage, or the
//     digest service (asserted on the mocks, not inferred from behavior)
//   - both entry points (planLesson+writeLesson vs. planSingleVideoLesson+
//     writeLesson) produce blocks through the exact same writeLesson() call
//   - NO_DIGEST validates against the real DigestSchema (a stale/incorrect
//     "empty digest" would fail writeLesson's own input validation, not a
//     mock — see the guard test below)

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/ai', () => ({
  chat: vi.fn(),
}));

const resolveLessonModelMock = vi.fn();
vi.mock('./lesson-model', () => ({
  resolveLessonModel: () => resolveLessonModelMock(),
  redactAnthropicKey: (text: string) => text,
}));

// Stands in for a `ResolvedModel` from model-policy.ts — the tier-specific
// modelOptions/friendlyError/redact are MEMBERS of it now, so omitting them
// makes every chat() call throw "modelOptions is not a function".
const LOCAL_MODEL = {
  adapter: {},
  tier: 'local' as const,
  model: 'gemma4-kb:latest',
  modelOptions: (temperature: number) => ({
    model: 'gemma4-kb:latest',
    options: { temperature },
  }),
  friendlyError: (raw: string) => raw,
  redact: (raw: string) => raw,
};

const embedTextMock = vi.fn();
vi.mock('./embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./embeddings')>();
  return { ...actual, embedText: (...args: unknown[]) => embedTextMock(...args) };
});

const listAllVideosMock = vi.fn();
const fetchVideoByVideoIdMock = vi.fn();
const fetchVideoByDocumentIdMock = vi.fn();
vi.mock('./videos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./videos')>();
  return {
    ...actual,
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
  return { ...actual, findDigestByVideoSetKeyService: (key: string) => findDigestByVideoSetKeyMock(key) };
});

const synthesizeDigestMock = vi.fn();
vi.mock('./digest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./digest')>();
  return {
    ...actual,
    synthesizeDigest: (videos: unknown, model?: unknown) =>
      synthesizeDigestMock(videos, model),
  };
});

import { chat } from '@tanstack/ai';
import { buildBM25Index, type TranscriptChunk } from './transcript';
import { DigestSchema } from './digest';
import type { StrapiVideo } from './videos';
import {
  NO_DIGEST,
  planSingleVideoLesson,
  writeLesson,
  type LessonOutline,
  type SourceVideo,
  type WriteLessonInput,
} from './lesson-generation';

const mockedChat = vi.mocked(chat);

function bm25ForChunks(count: number): ReturnType<typeof buildBM25Index> {
  const chunks: TranscriptChunk[] = Array.from({ length: count }, (_, i) => ({
    id: i,
    text: `Fret ${i + 3} on the low E string is the note ${['A', 'B', 'C', 'D', 'E', 'F', 'G'][i % 7]}, part ${i} of this video's own explanation of the shape.`,
    startWord: i * 150,
    timeSec: i * 60,
  }));
  return buildBM25Index(chunks);
}

function makeSingleVideo(overrides: Partial<StrapiVideo> = {}): StrapiVideo {
  const base: Partial<StrapiVideo> = {
    documentId: 'doc-1',
    youtubeVideoId: 'yt-1',
    videoTitle: 'How to play the blues turnaround',
    summaryTitle: 'The blues turnaround, start to finish',
    summaryDescription: 'A single-video walkthrough of the classic turnaround shape.',
    summaryOverview: null,
    musicExtraction: null,
    summaryStatus: 'generated',
    transcriptSegments: { version: 1, bm25: bm25ForChunks(8) },
  };
  return { ...base, ...overrides } as StrapiVideo;
}

const OUTLINE_RAW = {
  title: 'The blues turnaround, start to finish',
  summary: 'Learn the classic turnaround shape from one video.',
  level: 'beginner',
  instrument: 'guitar',
  duration: '10 min',
  parameterLabel: null,
  parameterDefault: null,
  sections: [
    { heading: 'What the turnaround does', goal: 'Explain its function.' },
    { heading: 'Playing the shape', goal: 'Walk through the fretting.' },
  ],
};

beforeEach(() => {
  mockedChat.mockReset();
  resolveLessonModelMock.mockReset();
  resolveLessonModelMock.mockReturnValue(LOCAL_MODEL);
  embedTextMock.mockReset();
  listAllVideosMock.mockReset();
  fetchVideoByVideoIdMock.mockReset();
  fetchVideoByDocumentIdMock.mockReset();
  fetchVideoByVideoIdMock.mockResolvedValue(makeSingleVideo());
  findDigestByVideoSetKeyMock.mockReset();
  synthesizeDigestMock.mockReset();
});

describe('NO_DIGEST', () => {
  it('validates against the real DigestSchema, so writeLesson accepts it without a real synthesis', () => {
    expect(DigestSchema.safeParse(NO_DIGEST).success).toBe(true);
  });
});

describe('planSingleVideoLesson — guard rails', () => {
  it('refuses before any model call when the video has no transcript index at all', async () => {
    fetchVideoByVideoIdMock.mockResolvedValue(
      makeSingleVideo({ transcriptSegments: null, summaryStatus: 'pending' }),
    );

    const result = await planSingleVideoLesson({ videoId: 'yt-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/summary hasn't finished/i);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('names summary generation failure distinctly when summaryStatus is failed', async () => {
    fetchVideoByVideoIdMock.mockResolvedValue(
      makeSingleVideo({ transcriptSegments: null, summaryStatus: 'failed' }),
    );
    const result = await planSingleVideoLesson({ videoId: 'yt-1' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/summary generation failed/i);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('refuses before any model call when the transcript is too short', async () => {
    fetchVideoByVideoIdMock.mockResolvedValue(
      makeSingleVideo({ transcriptSegments: { version: 1, bm25: bm25ForChunks(2) } }),
    );

    const result = await planSingleVideoLesson({ videoId: 'yt-1' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too short/i);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('refuses when the video does not exist in the library', async () => {
    fetchVideoByVideoIdMock.mockResolvedValue(null);
    const result = await planSingleVideoLesson({ videoId: 'unknown' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not in the library/i);
    expect(mockedChat).not.toHaveBeenCalled();
  });
});

describe('planSingleVideoLesson — never invokes retrieval, coverage, or the digest service', () => {
  it('calls chat() exactly once (the outline) and never touches retrieval/coverage/digest mocks', async () => {
    mockedChat.mockResolvedValueOnce(OUTLINE_RAW);

    const result = await planSingleVideoLesson({ videoId: 'yt-1' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toEqual<SourceVideo>({
      documentId: 'doc-1',
      youtubeVideoId: 'yt-1',
      title: 'The blues turnaround, start to finish',
      score: 1,
    });

    // Exactly one chat() call — the outline. A coverage call would be a
    // second one, using CoverageVerdictSchema; this path has none.
    expect(mockedChat).toHaveBeenCalledTimes(1);

    // Retrieval (embedText + listAllVideosForEmbeddingWithStatusService)
    // and the digest service (cache lookup + synthesis) are never called —
    // this IS the point of the shorter, single-video path.
    expect(embedTextMock).not.toHaveBeenCalled();
    expect(listAllVideosMock).not.toHaveBeenCalled();
    expect(findDigestByVideoSetKeyMock).not.toHaveBeenCalled();
    expect(synthesizeDigestMock).not.toHaveBeenCalled();
  });

  it('emits only tier/outline progress events — no retrieve/coverage/digest frames', async () => {
    mockedChat.mockResolvedValueOnce(OUTLINE_RAW);
    const events: Array<{ type: string }> = [];

    await planSingleVideoLesson({ videoId: 'yt-1' }, (e) => events.push(e));

    expect(events.map((e) => e.type)).toEqual(['tier', 'outline']);
  });
});

describe('both entry points produce blocks through the same shared writeLesson()', () => {
  const sectionMarkdown = (videoId: string) =>
    `::prose{src=${videoId}}\nFret 3 on the low E string is G, the root of this shape.\n::`;

  function libraryOutline(): LessonOutline {
    return {
      title: 'Blues turnarounds across the library',
      summary: 'Cross-video synthesis of the turnaround shape.',
      level: 'beginner',
      instrument: 'guitar',
      duration: '15 min',
      parameter: null,
      sections: [{ heading: 'The shape', goal: 'Explain it.' }],
    };
  }

  function singleVideoOutline(): LessonOutline {
    return {
      title: 'The blues turnaround, start to finish',
      summary: 'One video, one lesson.',
      level: 'beginner',
      instrument: 'guitar',
      duration: '10 min',
      parameter: null,
      sections: [{ heading: 'The shape', goal: 'Explain it.' }],
    };
  }

  it('assembles an identically-shaped body whether writeLesson is fed a multi-source digest plan or a single-video NO_DIGEST plan', async () => {
    // Library-shaped input: two sources, a real (non-empty) digest.
    mockedChat.mockResolvedValueOnce(sectionMarkdown('yt-A'));
    const libraryInput: WriteLessonInput = {
      topic: 'blues turnarounds',
      outline: libraryOutline(),
      sources: [
        { documentId: 'A', youtubeVideoId: 'yt-A', title: 'Video A', score: 0.9 },
        { documentId: 'B', youtubeVideoId: 'yt-B', title: 'Video B', score: 0.7 },
      ],
      digest: {
        title: 'Turnarounds',
        description: 'desc',
        overallTheme: 'theme',
        sharedThemes: [],
        uniqueInsights: [],
        contradictions: [],
        viewingOrder: [],
        bottomLine: 'bottom line',
      },
    };
    fetchVideoByVideoIdMock.mockResolvedValue(null);
    fetchVideoByDocumentIdMock.mockImplementation((id: string) =>
      Promise.resolve(makeSingleVideo({ documentId: id, youtubeVideoId: id })),
    );
    const libraryResult = await writeLesson(libraryInput);

    // Single-video-shaped input: exactly what planSingleVideoLesson hands
    // back, wrapped as `[source]` + NO_DIGEST — the shape
    // /api/lesson-plan-video actually produces.
    mockedChat.mockResolvedValueOnce(sectionMarkdown('yt-1'));
    fetchVideoByVideoIdMock.mockResolvedValue(makeSingleVideo());
    const singleVideoInput: WriteLessonInput = {
      topic: 'The blues turnaround, start to finish',
      outline: singleVideoOutline(),
      sources: [{ documentId: 'doc-1', youtubeVideoId: 'yt-1', title: 'The video', score: 1 }],
      digest: NO_DIGEST,
    };
    const singleResult = await writeLesson(singleVideoInput);

    expect(libraryResult.ok).toBe(true);
    expect(singleResult.ok).toBe(true);
    if (!libraryResult.ok || !singleResult.ok) return;

    // Same assembly code produced the same shape: one heading block + one
    // grounded prose block, both citing their (respective) source video.
    const shapeOf = (blocks: typeof libraryResult.lesson.body) =>
      blocks.map((b) => b.__component);
    expect(shapeOf(libraryResult.lesson.body)).toEqual(['lesson.heading', 'lesson.prose']);
    expect(shapeOf(singleResult.lesson.body)).toEqual(['lesson.heading', 'lesson.prose']);

    // The SAME grounding code ran in both: each cited paragraph resolved
    // to a real source, not just a bare, unsourced sentence.
    expect((libraryResult.lesson.body[1] as { source?: unknown }).source).toBeTruthy();
    expect((singleResult.lesson.body[1] as { source?: unknown }).source).toBeTruthy();

    // No cross-video contradiction callouts on the single-video lesson —
    // NO_DIGEST.contradictions is empty, exactly like an empty digest
    // should behave (this is the "skip the digest entirely" amendment,
    // proven structurally rather than by a special case in writeLesson).
    expect(
      singleResult.lesson.body.some((b) => b.__component === 'lesson.callout'),
    ).toBe(false);
  });
});
