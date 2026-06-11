import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  applyVideoScoreUpdateService,
  backfillScoreFromVerdict,
  createVideoService,
  fetchFeedService,
  fetchVideoByDocumentIdWithStatusService,
  fetchVideoByVideoIdService,
  fetchVideoByVideoIdWithStatusService,
  fetchTranscriptByVideoIdService,
  listAllVideosForEmbeddingService,
  markSummaryFailedService,
  markSummaryPendingService,
  searchTagsService,
  updateSectionTimecodeService,
  stripVideoForClient,
  updateVideoEmbeddingService,
  updateVideoPassagesService,
  updateVideoSongContentService,
  updateVideoTypeService,
  type PaginatedVideos,
  type StrapiTag,
  type StrapiVideo,
} from '#/lib/services/videos';
import {
  aggregateSignalScore,
  computeSignalScores,
} from '#/lib/services/content-signals';
import { cleanTranscript } from '#/lib/services/transcript';
import { strapiFetch } from '#/lib/services/strapi-client';
import {
  aggregateTagsFromNeighbors,
  computePassageIndex,
  computeVideoEmbedding,
  cosineSimilarity,
  embedText,
  embeddingStatus,
  passageStatus,
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_VERSION,
  CURRENT_PASSAGE_VERSION,
  type PassageStatus,
  type SuggestedTag,
  type VideoEmbeddingStatus,
} from '#/lib/services/embeddings';
import {
  fetchYouTubeMeta,
  generateVideoSummary,
  askAboutVideoService,
  regenerateVerdictForVideo,
  type ChatMessage,
  type GenerationStep,
} from '#/lib/services/learning';
import {
  clearRecentFailure,
  ensureGenerationRunning,
  getLiveState,
} from '#/lib/services/generation-state';
import {
  extractCitationsWithEvidence,
  loadStoredIndex,
  tokenize,
  type EvidenceCitation,
} from '#/lib/services/transcript';
import {
  fuseHybridRankings,
  rankByFusedScore,
} from '#/lib/services/retrieval-fusion';
import {
  CreateVideoInputSchema,
  GenerationModeSchema,
  extractYouTubeVideoId,
  parseTagInput,
  type GenerationMode,
} from '#/lib/validations/post';

// =============================================================================
// Feed
// =============================================================================

const FeedQuerySchema = z.object({
  page: z.number().int().min(1).max(1000).optional(),
  pageSize: z.number().int().min(1).max(50).optional(),
  q: z.string().max(200).optional(),
  tag: z.string().max(80).optional(),
  sort: z.enum(['recent', 'score']).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  videoType: z.enum(['lesson', 'music']).optional(),
});

export const getFeed = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof FeedQuerySchema>) => FeedQuerySchema.parse(data))
  .handler(async ({ data }): Promise<PaginatedVideos> => {
    return await fetchFeedService(data);
  });

// =============================================================================
// Music videos — tab / lyrics / source URL editing
// =============================================================================

const SongContentInputSchema = z.object({
  documentId: z.string().min(1),
  // null = clear; undefined = leave untouched. Empty string = clear too.
  tabContent: z.string().max(100_000).nullable().optional(),
  lyricsContent: z.string().max(100_000).nullable().optional(),
  tabSourceUrl: z.string().url().max(2000).nullable().optional(),
});

export type SongContentResult =
  | { status: 'ok'; video: StrapiVideo }
  | { status: 'error'; error: string };

export const saveSongContent = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof SongContentInputSchema>) =>
    SongContentInputSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SongContentResult> => {
    const result = await updateVideoSongContentService(data);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', video: stripVideoForClient(result.video)! };
  });

// =============================================================================
// Single-video lookups
// =============================================================================

const VideoIdSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\w-]+$/, 'Invalid video id'),
});

const DocumentIdSchema = z.object({ documentId: z.string().min(1) });

// Route loaders need to distinguish "video doesn't exist" from "backend
// is down" so they can render distinct UI. The two `*WithStatus`
// services return `{ video, error }`, which these server fns proxy
// directly. Internal callers (other server fns, services) keep using
// the simpler nullable variants below.
export const getVideoByDocumentId = createServerFn({ method: 'GET' })
  .inputValidator((data: { documentId: string }) => DocumentIdSchema.parse(data))
  .handler(
    async ({
      data,
    }): Promise<{ video: StrapiVideo | null; error: string | null }> => {
      return await fetchVideoByDocumentIdWithStatusService(data.documentId);
    },
  );

export const getVideoByVideoId = createServerFn({ method: 'GET' })
  .inputValidator((data: { videoId: string }) => VideoIdSchema.parse(data))
  .handler(
    async ({
      data,
    }): Promise<{ video: StrapiVideo | null; error: string | null }> => {
      return await fetchVideoByVideoIdWithStatusService(data.videoId);
    },
  );

// =============================================================================
// Share a video
//
// Extract video id → oEmbed metadata → create Video row → fire-and-forget
// the AI summary generation. By the time the user clicks through to
// /learn/$videoId the summary is usually done (or polling catches it).
// =============================================================================

const ShareVideoInputSchema = z.object({
  url: z.string().url(),
  caption: z.string().max(500).optional(),
  tags: z.string().max(240).optional(),
  mode: GenerationModeSchema.optional(),
  /** (music-kb fork) 'lesson' (default) kicks off the transcript + AI
   *  pipeline; 'music' skips it — the video is saved with metadata only
   *  for use with the LoopBuilder + visualizer. */
  videoType: z.enum(['lesson', 'music']).optional(),
});

export type ShareVideoResult =
  | { status: 'created'; video: StrapiVideo }
  | { status: 'exists'; video: StrapiVideo }
  | { status: 'error'; error: string };

// Background-generation state machine lives in `lib/services/generation-state`.
// This module wires the server-fn handlers below to the Module via two hooks:
// `markVideoFailedHook` — fires after an uncaught throw so the durable
// Strapi row never gets stuck in `pending`. Three handlers (kickoff via
// share, trigger, regenerate) share the same hook.
async function markVideoFailedHook(videoId: string): Promise<void> {
  try {
    const row = await fetchVideoByVideoIdService(videoId);
    if (row) await markSummaryFailedService(row.documentId);
  } catch (err) {
    console.error('[generation] mark-failed itself failed', { videoId, err });
  }
}

function kickoffSummaryGeneration(videoId: string, mode?: GenerationMode) {
  void ensureGenerationRunning(
    videoId,
    () => generateVideoSummary(videoId, { mode }),
    { onTerminalThrow: () => markVideoFailedHook(videoId) },
  );
}

export const shareVideo = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof ShareVideoInputSchema>) =>
    ShareVideoInputSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ShareVideoResult> => {
    const videoId = extractYouTubeVideoId(data.url);
    if (!videoId) {
      return { status: 'error', error: "Doesn't look like a YouTube URL" };
    }

    const requestedType = data.videoType ?? 'lesson';
    const alreadyExists = await fetchVideoByVideoIdService(videoId);
    if (alreadyExists) {
      // Existing row but the user is re-sharing with a different type
      // (typically converting a failed lesson → music so they can loop
      // the song without the failed-summary chrome). Convert the row
      // in place, clearing AI artifacts as needed.
      const currentType = alreadyExists.videoType ?? 'lesson';
      if (requestedType !== currentType) {
        const converted = await updateVideoTypeService(
          alreadyExists.documentId,
          requestedType,
        );
        // If the user is converting music → lesson, kick off the AI
        // pipeline so the summary actually gets generated.
        if (converted && requestedType === 'lesson') {
          kickoffSummaryGeneration(videoId, data.mode);
        }
        return {
          status: 'exists',
          video: stripVideoForClient(converted ?? alreadyExists)!,
        };
      }
      return { status: 'exists', video: stripVideoForClient(alreadyExists)! };
    }

    const parsed = CreateVideoInputSchema.parse({
      videoId,
      url: data.url,
      caption: data.caption,
      tagNames: parseTagInput(data.tags ?? ''),
    });

    const meta = await fetchYouTubeMeta(videoId);

    const videoType = data.videoType ?? 'lesson';
    const result = await createVideoService({
      videoId: parsed.videoId,
      url: parsed.url,
      caption: parsed.caption,
      tagNames: parsed.tagNames,
      videoTitle: meta.title,
      videoAuthor: meta.author,
      videoThumbnailUrl:
        meta.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      videoType,
    });

    if (!result.success) {
      if (result.kind === 'exists') {
        return { status: 'exists', video: stripVideoForClient(result.video)! };
      }

      // Race recovery — if the server dedupe check caught what our pre-check
      // missed, re-fetch and surface as 'exists' for clean redirect.
      if (/already exists/i.test(result.error)) {
        const recovered = await fetchVideoByVideoIdService(videoId);
        if (recovered) {
          return { status: 'exists', video: stripVideoForClient(recovered)! };
        }
      }
      return { status: 'error', error: result.error };
    }

    // Music videos don't go through the transcript + AI pipeline — the
    // row was already saved with summaryStatus='skipped' in
    // createVideoService. Skip the background generation kickoff.
    if (videoType !== 'music') {
      kickoffSummaryGeneration(videoId, data.mode);
    }
    return { status: 'created', video: stripVideoForClient(result.video)! };
  });

// =============================================================================
// Summary lifecycle — trigger + clear for retry
// =============================================================================

export type TriggerResult =
  | { status: 'found'; video: StrapiVideo }
  | { status: 'started' }
  | { status: 'error'; error: string };

const TriggerInputSchema = VideoIdSchema.extend({
  mode: GenerationModeSchema.optional(),
});

export const triggerSummaryGeneration = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof TriggerInputSchema>) =>
    TriggerInputSchema.parse(data),
  )
  .handler(async ({ data }): Promise<TriggerResult> => {
    const existing = await fetchVideoByVideoIdService(data.videoId);
    if (existing && existing.summaryStatus === 'generated') {
      clearRecentFailure(data.videoId);
      return { status: 'found', video: stripVideoForClient(existing)! };
    }

    const result = await ensureGenerationRunning(
      data.videoId,
      () => generateVideoSummary(data.videoId, { mode: data.mode }),
      { onTerminalThrow: () => markVideoFailedHook(data.videoId) },
    );
    if (result.status === 'recently_failed') {
      return { status: 'error', error: result.error };
    }
    if (result.status === 'failed_to_start') {
      return { status: 'error', error: result.error };
    }
    return { status: 'started' };
  });

// Manually override a section's timecode — the escape hatch for AI drift
// that BM25 grounding doesn't fix. Scoped to the single section so edits
// don't race against other summary updates.
const UpdateSectionTimecodeSchema = z.object({
  documentId: z.string().min(1),
  sectionId: z.number().int().nonnegative(),
  timeSec: z.number().int().min(0).max(24 * 3600), // sanity: <= 24h
});

export const updateSectionTimecode = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof UpdateSectionTimecodeSchema>) =>
    UpdateSectionTimecodeSchema.parse(data),
  )
  .handler(async ({ data }): Promise<{ success: true } | { success: false; error: string }> => {
    return await updateSectionTimecodeService(data);
  });

export const clearSummaryFailure = createServerFn({ method: 'POST' })
  .inputValidator((data: { videoId: string }) => VideoIdSchema.parse(data))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    clearRecentFailure(data.videoId);
    return { ok: true };
  });

// Manual regenerate — for videos that already have a summary but the user
// wants to re-run generation (e.g. after prompt changes or a mediocre result).
// Flips the Strapi row back to 'pending' and kicks off the same background
// job as the share flow. Safe to click while the old summary is on the row;
// fields are overwritten on success, preserved on failure.
export type RegenerateResult =
  | { status: 'started' }
  | { status: 'already_running' }
  | { status: 'error'; error: string };

const RegenerateInputSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\w-]+$/),
  // Skip the transcript cache and re-fetch fresh from YouTube. Needed
  // when the uploader updated captions or the cached segments are bad.
  forceRefetch: z.boolean().optional(),
  mode: GenerationModeSchema.optional(),
});

export const regenerateSummary = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof RegenerateInputSchema>) =>
    RegenerateInputSchema.parse(data),
  )
  .handler(async ({ data }): Promise<RegenerateResult> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video) {
      return { status: 'error', error: 'Video not found' };
    }

    // User-initiated regenerate: bypass the recent-failure window so
    // the click takes effect even if a prior run just failed.
    clearRecentFailure(data.videoId);

    // The pending-flip is wired as `beforeStart` so it fires only if a
    // job will actually run — `already_running` skips it, avoiding a
    // pointless DB write under contention.
    const result = await ensureGenerationRunning(
      data.videoId,
      () =>
        generateVideoSummary(data.videoId, {
          forceRefetch: data.forceRefetch,
          mode: data.mode,
        }),
      {
        beforeStart: async () => {
          const flip = await markSummaryPendingService(video.documentId);
          if (!flip.success) throw new Error(flip.error);
        },
        onTerminalThrow: () => markVideoFailedHook(data.videoId),
      },
    );
    if (result.status === 'already_running') return { status: 'already_running' };
    if (result.status === 'recently_failed') {
      // Cleared above; reaching here means a separate concurrent run
      // re-set the failure between the clear and the ensure call.
      return { status: 'error', error: result.error };
    }
    if (result.status === 'failed_to_start') {
      return { status: 'error', error: result.error };
    }
    return { status: 'started' };
  });

export type GenerationProgress = {
  step: GenerationStep | null;
  detail: string | null;
  elapsedMs: number | null;
  detailElapsedMs: number | null;
};

// POST (not GET) to sidestep any HTTP caching that would serve stale
// progress back to the UI while the background job keeps advancing. Also
// logs every read so we can spot-check "is the server returning fresh
// state on each poll tick" against what the UI shows.
export const getGenerationProgress = createServerFn({ method: 'POST' })
  .inputValidator((data: { videoId: string }) => VideoIdSchema.parse(data))
  .handler(async ({ data }): Promise<GenerationProgress> => {
    const live = getLiveState(data.videoId);
    if (live.status !== 'running') {
      return { step: null, detail: null, elapsedMs: null, detailElapsedMs: null };
    }
    // eslint-disable-next-line no-console
    console.log(
      `[${new Date().toISOString().slice(11, 23)}] [progress ${data.videoId}] ${live.step ?? '—'}${live.detail ? ` · ${live.detail}` : ''} (step +${Math.round(live.elapsedMs / 1000)}s, detail +${Math.round(live.detailElapsedMs / 1000)}s)`,
    );
    return {
      step: live.step,
      detail: live.detail,
      elapsedMs: live.elapsedMs,
      detailElapsedMs: live.detailElapsedMs,
    };
  });

// =============================================================================
// Chat about a video
// =============================================================================

const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(4000),
});

const AskAboutVideoSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\w-]+$/),
  messages: z.array(ChatMessageSchema).min(1).max(30),
});

export type AskAboutVideoResult =
  | { status: 'ok'; reply: string }
  | { status: 'not_ready' }
  | { status: 'error'; error: string };

export const askAboutVideo = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof AskAboutVideoSchema>) =>
    AskAboutVideoSchema.parse(data),
  )
  .handler(async ({ data }): Promise<AskAboutVideoResult> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video || video.summaryStatus !== 'generated') return { status: 'not_ready' };

    const result = await askAboutVideoService(video, data.messages as ChatMessage[]);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', reply: result.data };
  });

// =============================================================================
// Chat response evidence
//
// Given a completed chat response text, returns every timecode citation the
// model produced alongside the actual transcript chunk that best grounds
// each one. The chat UI renders these as expandable accordions below the
// assistant message so the user can verify each citation against the real
// source text rather than trust a raw `[mm:ss]` chip.
// =============================================================================

const ChatEvidenceSchema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\w-]+$/),
  responseText: z.string().min(1).max(50_000),
});

export const getChatResponseEvidence = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof ChatEvidenceSchema>) =>
    ChatEvidenceSchema.parse(data),
  )
  .handler(async ({ data }): Promise<EvidenceCitation[]> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    const stored = video ? loadStoredIndex(video.transcriptSegments) : null;
    if (!stored) return [];
    return extractCitationsWithEvidence(data.responseText, stored.bm25);
  });

// =============================================================================
// Embeddings
//
// - `getEmbeddingStatus` — quick check for the UI (missing / stale / current)
//   without pulling the full vector.
// - `regenerateVideoEmbedding` — recompute + persist, used by the button on
//   the learn page when the embedding is missing or stale.
// =============================================================================

const VideoIdOnlySchema = z.object({
  videoId: z.string().min(1).max(64),
});

export type EmbeddingStatusResult =
  | {
      status: VideoEmbeddingStatus;
      generatedAt: string | null;
      model: string | null;
      version: number | null;
      currentModel: string;
      currentVersion: number;
    }
  | { status: 'error'; error: string };

export const getEmbeddingStatus = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof VideoIdOnlySchema>) =>
    VideoIdOnlySchema.parse(data),
  )
  .handler(async ({ data }): Promise<EmbeddingStatusResult> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video) return { status: 'error', error: 'Video not found' };
    return {
      status: embeddingStatus(video),
      generatedAt: video.embeddingGeneratedAt,
      model: video.embeddingModel,
      version: video.embeddingVersion,
      currentModel: CURRENT_EMBEDDING_MODEL,
      currentVersion: CURRENT_EMBEDDING_VERSION,
    };
  });

export type RegenerateEmbeddingResult =
  | {
      status: 'ok';
      dims: number;
      model: string;
      version: number;
      generatedAt: string;
    }
  | { status: 'error'; error: string };

export const regenerateVideoEmbedding = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof VideoIdOnlySchema>) =>
    VideoIdOnlySchema.parse(data),
  )
  .handler(async ({ data }): Promise<RegenerateEmbeddingResult> => {
    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video) return { status: 'error', error: 'Video not found' };
    if (video.summaryStatus !== 'generated') {
      return {
        status: 'error',
        error: 'Summary not ready — generate the summary before embedding.',
      };
    }
    try {
      const computed = await computeVideoEmbedding(video);
      const saved = await updateVideoEmbeddingService({
        documentId: video.documentId,
        embedding: computed.embedding,
        model: computed.model,
        version: computed.version,
        generatedAt: computed.generatedAt,
      });
      if (!saved.success) {
        return { status: 'error', error: saved.error };
      }
      return {
        status: 'ok',
        dims: computed.embedding.length,
        model: computed.model,
        version: computed.version,
        generatedAt: computed.generatedAt,
      };
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : 'Embedding failed',
      };
    }
  });

// =============================================================================
// Embedding coverage — quick stats for the UI ("N/M videos embedded").
// =============================================================================

export type EmbeddingCoverage = {
  total: number;
  current: number;
  stale: number;
  missing: number;
  currentModel: string;
  currentVersion: number;
};

export const getEmbeddingCoverage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<EmbeddingCoverage> => {
    const videos = await listAllVideosForEmbeddingService();
    let current = 0;
    let stale = 0;
    let missing = 0;
    for (const v of videos) {
      const s = embeddingStatus(v);
      if (s === 'current') current += 1;
      else if (s === 'stale') stale += 1;
      else missing += 1;
    }
    return {
      total: videos.length,
      current,
      stale,
      missing,
      currentModel: CURRENT_EMBEDDING_MODEL,
      currentVersion: CURRENT_EMBEDDING_VERSION,
    };
  },
);

// =============================================================================
// Backfill — walk videos and compute embeddings for anything that doesn't
// have a current vector. `scope` controls which rows to touch:
//   'missing' — only rows with no vector at all (default; safest)
//   'stale'   — only rows whose model/version doesn't match current
//   'all'     — 'missing' ∪ 'stale'
//
// Concurrency is bounded (3) — Ollama's /api/embeddings serializes anyway
// and we don't want to overwhelm a laptop running Gemma + embeddings at
// the same time.
// =============================================================================

const ReindexSchema = z.object({
  scope: z.enum(['missing', 'stale', 'all']).default('missing'),
  // When true, reindex every generated-summary video regardless of stored
  // status. Bypasses the stale/missing gate. Used from the "Force reindex"
  // button when the user suspects stored vectors are wrong despite being
  // labeled current.
  force: z.boolean().optional(),
});

export type ReindexResult = {
  status: 'ok';
  scope: 'missing' | 'stale' | 'all';
  total: number;
  targeted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ youtubeVideoId: string; error: string }>;
  tookMs: number;
};

export const reindexAllEmbeddings = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof ReindexSchema>) =>
    ReindexSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ReindexResult> => {
    const started = performance.now();
    const videos = await listAllVideosForEmbeddingService();

    const candidates = data.force
      ? videos
      : videos.filter((v) => {
          const s = embeddingStatus(v);
          if (data.scope === 'missing') return s === 'missing';
          if (data.scope === 'stale') return s === 'stale';
          return s !== 'current';
        });

    const errors: Array<{ youtubeVideoId: string; error: string }> = [];
    let succeeded = 0;
    let cursor = 0;
    const CONCURRENCY = 3;

    const processOne = async (video: StrapiVideo) => {
      try {
        const computed = await computeVideoEmbedding(video);
        const saved = await updateVideoEmbeddingService({
          documentId: video.documentId,
          embedding: computed.embedding,
          model: computed.model,
          version: computed.version,
          generatedAt: computed.generatedAt,
        });
        if (!saved.success) {
          errors.push({ youtubeVideoId: video.youtubeVideoId, error: saved.error });
          return;
        }
        succeeded += 1;
      } catch (err) {
        errors.push({
          youtubeVideoId: video.youtubeVideoId,
          error: err instanceof Error ? err.message : 'embed failed',
        });
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= candidates.length) return;
        await processOne(candidates[i]);
      }
    });
    await Promise.all(workers);

    return {
      status: 'ok',
      scope: data.scope,
      total: videos.length,
      targeted: candidates.length,
      succeeded,
      failed: errors.length,
      errors,
      tookMs: Math.round(performance.now() - started),
    };
  });

// =============================================================================
// relatedVideos — semantic neighbors for one video. In-memory cosine over all
// current-vector rows in the library. Returns minimal video metadata + score.
// =============================================================================

const RelatedVideosSchema = z.object({
  videoId: z.string().min(1).max(64),
  limit: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(-1).max(1).optional(),
});

export type RelatedVideo = {
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
  score: number;
};

export type RelatedVideosResult =
  | { status: 'ok'; results: RelatedVideo[]; reason?: undefined }
  | {
      status: 'ok';
      results: [];
      reason: 'target-missing-embedding' | 'no-candidates';
    }
  | { status: 'error'; error: string };

// Hybrid related-videos: treat the target video as a "query" — its
// topical text goes through BM25 to find candidates sharing exact rare
// tokens (proper nouns like "Strapi", "Ollama", company names); its
// embedding vector goes through cosine to find topically-similar
// candidates. RRF-merge the two rankings.
//
// Why the dense-only version fails: "Strapi" embeds weakly in
// nomic-embed-text (rare token → low contribution to the final vector),
// so the target's vector is dominated by generic dev-tech semantics.
// Other Strapi videos end up ranked below generic API/auth/tool videos.
// BM25 catches the proper-noun overlap the dense path misses.
export const relatedVideos = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof RelatedVideosSchema>) =>
    RelatedVideosSchema.parse(data),
  )
  .handler(async ({ data }): Promise<RelatedVideosResult> => {
    const target = await fetchVideoByVideoIdService(data.videoId);
    if (!target) return { status: 'error', error: 'Video not found' };
    if (embeddingStatus(target) !== 'current') {
      return {
        status: 'ok',
        results: [],
        reason: 'target-missing-embedding',
      };
    }
    const targetVec = target.summaryEmbedding as number[];

    const all = await listAllVideosForEmbeddingService();
    const limit = data.limit ?? 6;
    const minScore = data.minScore ?? 0.5;

    const candidates = all.filter(
      (v) =>
        v.documentId !== target.documentId &&
        embeddingStatus(v) === 'current' &&
        Array.isArray(v.summaryEmbedding),
    );

    if (candidates.length === 0) {
      return { status: 'ok', results: [], reason: 'no-candidates' };
    }

    // Fused dense+BM25 ranking — target's topical text as the "query" over
    // the candidate corpus. Cap to the 15 highest-IDF terms: doc-as-query
    // naturally expands to hundreds of tokens that dilute BM25 into
    // noise. 15 keeps the target's most distinctive signals (product
    // names, speakers, domain terms) and drops the generic dev-content
    // shared with half the library.
    const fusion = fuseHybridRankings(
      targetVec,
      buildVideoSearchText(target),
      candidates.map((v) => ({
        embedding: v.summaryEmbedding as number[],
        text: buildVideoSearchText(v),
      })),
      { maxQueryTerms: 15 },
    );
    const { cosineScores, denseOrder, bm25Order } = fusion;

    // Two explicit boost signals that encode user-intuition-level
    // relatedness, applied on top of cosine + BM25 RRF:
    //
    // 1. Tag overlap. Strongest signal — tags are user-curated
    //    categorization. If the target is tagged "strapi" and a
    //    candidate is too, that's the clearest "these are related".
    //    Much more reliable than summary-level topical similarity,
    //    which diffuses across every topic a target's summary touches.
    //
    // 2. Title-token overlap. Secondary signal, IDF-filtered to drop
    //    generic words. Catches cases where tags aren't set — e.g.
    //    a Qwen video and a Kimi video might both be un-tagged "LLM"
    //    content and share "model" in title as their only common
    //    indicator.
    //
    // Calibrated against typical RRF range (~0.05 top):
    //   - tag boost 0.06/tag — strong enough to dominate cases where
    //     the target's summary is topically diffuse (a tutorial target
    //     shares "tutorial" vibe with many docs), pushing tag-matching
    //     candidates clearly ahead of title-only matches
    //   - title boost 0.015/token — softer, secondary signal
    const TAG_BOOST_PER_TAG = 0.06;
    const TITLE_BOOST_PER_TOKEN = 0.015;

    const targetTags = new Set((target.tags ?? []).map((t) => t.slug));
    const targetTitleTokens = new Set(
      tokenize(target.videoTitle ?? '').filter((t) => {
        const idf = fusion.bm25Index.idf[t];
        return idf !== undefined && idf >= 1.5;
      }),
    );

    // Boosts layer on top of the fused base scores; re-rank afterwards.
    const rrf = fusion.rrfScores;
    // Apply tag-overlap boost per candidate.
    const tagBoosts = new Map<number, { count: number; tags: string[] }>();
    candidates.forEach((v, i) => {
      if (targetTags.size === 0) return;
      const candTags = (v.tags ?? []).map((t) => t.slug);
      const matched: string[] = [];
      for (const slug of candTags) {
        if (targetTags.has(slug)) matched.push(slug);
      }
      if (matched.length > 0) {
        rrf.set(i, (rrf.get(i) ?? 0) + matched.length * TAG_BOOST_PER_TAG);
        tagBoosts.set(i, { count: matched.length, tags: matched });
      }
    });

    // Apply title-token boost per candidate.
    const titleBoosts = new Map<number, { count: number; tokens: string[] }>();
    candidates.forEach((v, i) => {
      if (targetTitleTokens.size === 0) return;
      const candTitleTokens = new Set(tokenize(v.videoTitle ?? ''));
      const matched: string[] = [];
      for (const t of targetTitleTokens) {
        if (candTitleTokens.has(t)) matched.push(t);
      }
      if (matched.length > 0) {
        rrf.set(
          i,
          (rrf.get(i) ?? 0) + matched.length * TITLE_BOOST_PER_TOKEN,
        );
        titleBoosts.set(i, { count: matched.length, tokens: matched });
      }
    });

    const preFilter = rankByFusedScore(rrf, cosineScores);

    // Diagnostic — same shape as the other hybrid server functions so we
    // can spot "target's rare tokens got filtered and BM25 had nothing
    // to work with" or similar failures in production data.
    // eslint-disable-next-line no-console
    console.log('[relatedVideos]', {
      target: target.videoTitle,
      candidates: candidates.length,
      bm25Size: bm25Order.length,
      targetTags: Array.from(targetTags),
      targetTitleTokens: Array.from(targetTitleTokens),
      denseTop10: denseOrder.slice(0, 10).map((i) => ({
        title: candidates[i].videoTitle,
        score: cosineScores[i].toFixed(3),
      })),
      bm25Top10: bm25Order.slice(0, 10).map((i) => ({
        title: candidates[i].videoTitle,
      })),
      rrfTop10: preFilter.slice(0, 10).map((r) => ({
        title: candidates[r.i].videoTitle,
        cosine: r.cosineScore.toFixed(3),
        rrf: r.rrfScore.toFixed(4),
        tagBoost: tagBoosts.get(r.i) ?? null,
        titleBoost: titleBoosts.get(r.i) ?? null,
      })),
    });

    const results: RelatedVideo[] = preFilter
      .filter((x) => x.cosineScore >= minScore)
      .slice(0, limit)
      .map(({ i, cosineScore }) => ({
        documentId: candidates[i].documentId,
        youtubeVideoId: candidates[i].youtubeVideoId,
        videoTitle: candidates[i].videoTitle,
        videoAuthor: candidates[i].videoAuthor,
        videoThumbnailUrl: candidates[i].videoThumbnailUrl,
        score: cosineScore,
      }));

    if (results.length === 0) {
      return { status: 'ok', results: [], reason: 'no-candidates' };
    }

    return { status: 'ok', results };
  });

// =============================================================================
// semanticSearchVideos — library-wide semantic search. Same cosine path as
// relatedVideos but seeded from an ad-hoc query string instead of a video.
// =============================================================================

const SemanticSearchSchema = z.object({
  query: z.string().min(1).max(500),
  // Bumped from 50 → 100 to give the feed's client-side pagination
  // enough rows to page through. The server-side cost is unchanged
  // (cosine-vs-everything is the same work either way; only the
  // top-N cutoff changes).
  limit: z.number().int().min(1).max(100).optional(),
  minScore: z.number().min(-1).max(1).optional(),
});

// Hit = full Video row + similarity score. Returning the full row lets the
// feed render its normal VideoCard with verdict/status unchanged.
export type SemanticHit = { video: StrapiVideo; score: number };

export type SemanticSearchResult =
  | { status: 'ok'; hits: SemanticHit[] }
  | { status: 'error'; error: string };

// Hybrid video search on the feed — same RRF pattern as passage search.
// Without BM25, proper-noun queries ("MCP", "Strapi", "Qwen") rank
// generic developer content above the videos actually about those tools.
export const semanticSearchVideos = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof SemanticSearchSchema>) =>
    SemanticSearchSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SemanticSearchResult> => {
    let qVec: number[];
    try {
      qVec = await embedText(data.query, 'query');
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : 'query embedding failed',
      };
    }

    const all = await listAllVideosForEmbeddingService();
    const limit = data.limit ?? 20;
    const minScore = data.minScore ?? 0.35;

    const candidates = all.filter(
      (v) =>
        embeddingStatus(v) === 'current' && Array.isArray(v.summaryEmbedding),
    );
    if (candidates.length === 0) return { status: 'ok', hits: [] };

    // Fused dense+BM25 ranking. The BM25 corpus is each video's topical
    // surface (title + author + description + overview + takeaways + tags)
    // — same bag of fields the embedding already sees. BM25 catches exact
    // tokens in the title and surface text that dense can miss.
    const fusion = fuseHybridRankings(
      qVec,
      data.query,
      candidates.map((v) => ({
        embedding: v.summaryEmbedding as number[],
        text: buildVideoSearchText(v),
      })),
    );
    const { cosineScores, denseOrder, bm25Order } = fusion;
    const finalRanked = fusion.ranked;

    // Diagnostic — top-10 from each retriever before the minScore filter.
    // eslint-disable-next-line no-console
    console.log('[semanticSearchVideos]', {
      query: data.query,
      candidates: candidates.length,
      bm25Size: bm25Order.length,
      denseTop10: denseOrder.slice(0, 10).map((i) => ({
        title: candidates[i].videoTitle,
        score: cosineScores[i].toFixed(3),
      })),
      bm25Top10: bm25Order.slice(0, 10).map((i) => ({
        title: candidates[i].videoTitle,
      })),
      rrfTop10: finalRanked.slice(0, 10).map((r) => ({
        title: candidates[r.i].videoTitle,
        cosine: r.cosineScore.toFixed(3),
        rrf: r.rrfScore.toFixed(4),
      })),
    });

    const lightened: SemanticHit[] = finalRanked
      .filter((x) => x.cosineScore >= minScore)
      .slice(0, limit)
      .map(({ i, cosineScore }) => ({
        // Strip server-only heavy fields before crossing the seroval
        // boundary: the BM25 token tables (transcriptSegments) and the
        // 768-d vectors (summaryEmbedding) are pure server retrieval
        // state and never read by the UI.
        video: {
          ...candidates[i],
          summaryEmbedding: null,
          transcriptSegments: null,
        },
        score: cosineScore,
      }));

    return { status: 'ok', hits: lightened };
  });

// Bag-of-fields text used for BM25 at the video level. Mirrors what the
// embedding sees so keyword matches align with semantic matches.
function buildVideoSearchText(v: StrapiVideo): string {
  const parts: string[] = [];
  if (v.videoTitle) parts.push(v.videoTitle);
  if (v.videoAuthor) parts.push(v.videoAuthor);
  if (v.summaryTitle && v.summaryTitle !== v.videoTitle) {
    parts.push(v.summaryTitle);
  }
  if (v.summaryDescription) parts.push(v.summaryDescription);
  if (v.summaryOverview) parts.push(v.summaryOverview);
  if (v.keyTakeaways && v.keyTakeaways.length > 0) {
    parts.push(v.keyTakeaways.map((t) => t.text).join(' '));
  }
  if (v.sections && v.sections.length > 0) {
    parts.push(v.sections.map((s) => s.heading).join(' '));
  }
  if (v.tags && v.tags.length > 0) {
    parts.push(v.tags.map((t) => t.name).join(' '));
  }
  return parts.join(' ');
}

// =============================================================================
// Passage embeddings (Tier 2) — moment search across the library.
// =============================================================================

export type PassageCoverage = {
  total: number;
  current: number;
  stale: number;
  missing: number;
  currentModel: string;
  currentVersion: number;
};

export const getPassageCoverage = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PassageCoverage> => {
    const videos = await listAllVideosForEmbeddingService();
    let current = 0;
    let stale = 0;
    let missing = 0;
    for (const v of videos) {
      const s = passageStatus(v.passageEmbeddings);
      if (s === 'current') current += 1;
      else if (s === 'stale') stale += 1;
      else missing += 1;
    }
    return {
      total: videos.length,
      current,
      stale,
      missing,
      currentModel: CURRENT_EMBEDDING_MODEL,
      currentVersion: CURRENT_PASSAGE_VERSION,
    };
  },
);

const ReindexPassagesSchema = z.object({
  scope: z.enum(['missing', 'stale', 'all']).default('missing'),
  force: z.boolean().optional(),
});

export type ReindexPassagesResult = {
  status: 'ok';
  scope: 'missing' | 'stale' | 'all';
  total: number;
  targeted: number;
  succeeded: number;
  failed: number;
  totalChunks: number;
  errors: Array<{ youtubeVideoId: string; error: string }>;
  tookMs: number;
};

export const reindexAllPassages = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof ReindexPassagesSchema>) =>
    ReindexPassagesSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ReindexPassagesResult> => {
    const started = performance.now();
    const videos = await listAllVideosForEmbeddingService();

    const candidates = data.force
      ? videos
      : videos.filter((v) => {
          const s: PassageStatus = passageStatus(v.passageEmbeddings);
          if (data.scope === 'missing') return s === 'missing';
          if (data.scope === 'stale') return s === 'stale';
          return s !== 'current';
        });

    const errors: Array<{ youtubeVideoId: string; error: string }> = [];
    let succeeded = 0;
    let totalChunks = 0;

    // Serial across videos — each video internally batches chunk embeds at
    // concurrency 2. Parallel video-level would thrash Ollama for no gain.
    for (const video of candidates) {
      try {
        const tx =
          video.transcript ??
          (await fetchTranscriptByVideoIdService(video.youtubeVideoId).catch(
            () => null,
          ));
        const segments = tx?.rawSegments ?? [];
        if (segments.length === 0) {
          errors.push({
            youtubeVideoId: video.youtubeVideoId,
            error: 'no raw transcript segments — regenerate summary first',
          });
          continue;
        }
        const passages = await computePassageIndex({ video, segments });
        if (passages.chunks.length === 0) {
          errors.push({
            youtubeVideoId: video.youtubeVideoId,
            error: 'transcript produced no passages',
          });
          continue;
        }
        const saved = await updateVideoPassagesService({
          documentId: video.documentId,
          passageEmbeddings: passages,
        });
        if (!saved.success) {
          errors.push({
            youtubeVideoId: video.youtubeVideoId,
            error: saved.error,
          });
          continue;
        }
        totalChunks += passages.chunks.length;
        succeeded += 1;
      } catch (err) {
        errors.push({
          youtubeVideoId: video.youtubeVideoId,
          error: err instanceof Error ? err.message : 'passage embed failed',
        });
      }
    }

    return {
      status: 'ok',
      scope: data.scope,
      total: videos.length,
      targeted: candidates.length,
      succeeded,
      failed: errors.length,
      totalChunks,
      errors,
      tookMs: Math.round(performance.now() - started),
    };
  });

// =============================================================================
// searchLibraryPassages — moment search. Embeds the query, cosine-ranks
// every passage across every video with a current passage index. Returns
// the top matches paired with minimal video metadata so the UI can render
// "this moment at 4:32 in <video title>".
// =============================================================================

const SearchLibraryPassagesSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(-1).max(1).optional(),
});

export type LibraryPassageHit = {
  video: {
    documentId: string;
    youtubeVideoId: string;
    videoTitle: string | null;
    videoAuthor: string | null;
    videoThumbnailUrl: string | null;
  };
  passage: {
    text: string;
    startSec: number;
    endSec: number;
    score: number;
  };
};

export type SearchLibraryPassagesResult =
  | { status: 'ok'; hits: LibraryPassageHit[] }
  | { status: 'error'; error: string };

// Hybrid passage search: dense cosine + BM25, merged with Reciprocal Rank
// Fusion. The fusion math (and the RRF_K / BM25_WEIGHT tuning rationale)
// lives in lib/services/retrieval-fusion.ts, shared by every hybrid surface.
export const searchLibraryPassages = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof SearchLibraryPassagesSchema>) =>
    SearchLibraryPassagesSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SearchLibraryPassagesResult> => {
    let qVec: number[];
    try {
      qVec = await embedText(data.query, 'query');
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : 'query embedding failed',
      };
    }

    const all = await listAllVideosForEmbeddingService();
    const limit = data.limit ?? 20;
    const minScore = data.minScore ?? 0.4;

    // Flatten every current passage into one corpus with a stable global
    // index. The RRF merger uses these indices as join keys.
    type FlatPassage = {
      video: StrapiVideo;
      text: string;
      startSec: number;
      endSec: number;
      embedding: number[];
    };
    const flat: FlatPassage[] = [];
    for (const v of all) {
      const index = v.passageEmbeddings;
      if (passageStatus(index) !== 'current' || !index) continue;
      for (const p of index.chunks) {
        flat.push({
          video: v,
          text: p.text,
          startSec: p.startSec,
          endSec: p.endSec,
          embedding: p.embedding,
        });
      }
    }
    if (flat.length === 0) return { status: 'ok', hits: [] };

    // Fused dense+BM25 ranking over the flattened passage corpus.
    //
    // The BM25 text includes the parent VIDEO's title + author, not just
    // the passage text. Proper nouns like "Qwen" or "Kimi" often appear
    // only in video titles — YouTube's auto-captions transcribe them
    // phonetically wrong ("Quinn", "keemi") or the speaker shows them on
    // screen without saying them. Without this, searching for "qwen"
    // matches zero passages in the Qwen video itself.
    const fusion = fuseHybridRankings(
      qVec,
      data.query,
      flat.map((p) => {
        const titleLine = [p.video.videoTitle, p.video.videoAuthor]
          .filter(Boolean)
          .join(' ');
        return {
          embedding: p.embedding,
          text: titleLine ? `${titleLine}\n${p.text}` : p.text,
        };
      }),
    );
    const { cosineScores, denseOrder, bm25Order } = fusion;
    const preFilter = fusion.ranked;

    // Diagnostic — top-10 from each retriever and the RRF merge, before
    // the minScore filter. Helps spot "BM25 found it, cosine didn't, and
    // minScore killed it" and similar failures in production data.
    // eslint-disable-next-line no-console
    console.log('[searchLibraryPassages]', {
      query: data.query,
      passages: flat.length,
      bm25Size: bm25Order.length,
      denseTop10: denseOrder.slice(0, 10).map((i) => ({
        title: flat[i].video.videoTitle,
        start: flat[i].startSec,
        score: cosineScores[i].toFixed(3),
        text: flat[i].text.slice(0, 80),
      })),
      bm25Top10: bm25Order.slice(0, 10).map((i) => ({
        title: flat[i].video.videoTitle,
        start: flat[i].startSec,
        text: flat[i].text.slice(0, 80),
      })),
      rrfTop10: preFilter.slice(0, 10).map((r) => ({
        title: flat[r.i].video.videoTitle,
        start: flat[r.i].startSec,
        cosine: r.cosineScore.toFixed(3),
        rrf: r.rrfScore.toFixed(4),
      })),
    });

    // Build the final hits list. `score` shown in the UI is the cosine
    // score (it's the familiar "% match" metric). RRF drives the ORDER;
    // we still filter by minScore so pure-keyword matches with no
    // semantic signal (cosine < minScore) don't leak in as noise.
    //
    // Per-video cap: MAX 2 passages per video in the final list. Without
    // this, long-form videos saturate the top-10 with consecutive chunks
    // about the same topic — crowding out diversity and hiding other
    // relevant videos. The second pass below enforces the cap in rank
    // order, preserving the best passage(s) from each video.
    const PER_VIDEO_CAP = 2;
    const perVideoCount = new Map<string, number>();
    const capped = preFilter
      .filter((x) => x.cosineScore >= minScore)
      .filter((x) => {
        const key = flat[x.i].video.documentId;
        const count = perVideoCount.get(key) ?? 0;
        if (count >= PER_VIDEO_CAP) return false;
        perVideoCount.set(key, count + 1);
        return true;
      });

    const ranked: LibraryPassageHit[] = capped
      .slice(0, limit)
      .map(({ i, cosineScore }) => {
        const p = flat[i];
        return {
          video: {
            documentId: p.video.documentId,
            youtubeVideoId: p.video.youtubeVideoId,
            videoTitle: p.video.videoTitle,
            videoAuthor: p.video.videoAuthor,
            videoThumbnailUrl: p.video.videoThumbnailUrl,
          },
          passage: {
            text: p.text,
            startSec: p.startSec,
            endSec: p.endSec,
            score: cosineScore,
          },
        };
      });

    return { status: 'ok', hits: ranked };
  });

// =============================================================================
// Suggest tags at ingest — given a YouTube URL the user is about to share,
// embed a lightweight description (title + author from oEmbed) and aggregate
// tags from the K most semantically similar videos already in the library.
//
// Best-effort everywhere: any failure (Ollama down, empty library, oEmbed
// rate-limited, URL can't be parsed) returns an empty suggestion list so
// the form shows nothing rather than blocking or erroring.
// =============================================================================

const SuggestTagsSchema = z.object({
  url: z.string().min(1).max(500),
});

export type SuggestTagsResult =
  | { status: 'ok'; suggestions: SuggestedTag[] }
  | { status: 'error'; error: string };

export const suggestTagsForUrl = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof SuggestTagsSchema>) =>
    SuggestTagsSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SuggestTagsResult> => {
    const videoId = extractYouTubeVideoId(data.url);
    if (!videoId) return { status: 'ok', suggestions: [] };

    // Lightweight metadata — oEmbed gives us title + author, enough to
    // place the video in topic space before the full summary exists.
    const meta = await fetchYouTubeMeta(videoId).catch(
      () => ({ title: undefined, author: undefined }) as const,
    );
    const probeText = [meta.title, meta.author]
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!probeText) return { status: 'ok', suggestions: [] };

    let qVec: number[];
    try {
      qVec = await embedText(probeText, 'query');
    } catch {
      // Ollama down / embed model not pulled — silent fallback.
      return { status: 'ok', suggestions: [] };
    }

    const all = await listAllVideosForEmbeddingService();
    const candidates = all.filter(
      (v) =>
        v.youtubeVideoId !== videoId &&
        embeddingStatus(v) === 'current' &&
        Array.isArray(v.summaryEmbedding),
    );
    if (candidates.length === 0) return { status: 'ok', suggestions: [] };

    const K = 5;
    const MIN_NEIGHBOR_SCORE = 0.4;
    const neighbors = candidates
      .map((video) => ({
        score: cosineSimilarity(qVec, video.summaryEmbedding as number[]),
        tags: video.tags,
      }))
      .filter((n) => n.score >= MIN_NEIGHBOR_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, K);

    const suggestions = aggregateTagsFromNeighbors(neighbors, 5);
    return { status: 'ok', suggestions };
  });

// =============================================================================
// Tag autocomplete
// =============================================================================

const TagSearchSchema = z.object({ q: z.string().max(40).default('') });

export const searchTags = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof TagSearchSchema>) => TagSearchSchema.parse(data))
  .handler(async ({ data }): Promise<StrapiTag[]> => {
    return await searchTagsService(data.q);
  });

// =============================================================================
// Verdict score backfill
//
// Walks every Video that already has a `watchVerdict` but no `valueScore`
// and SQL-updates the score from the verdict via `backfillScoreFromVerdict`.
// No AI calls — runs in milliseconds. Used by the Settings UI for older
// rows generated before the `valueScore` field existed.
// =============================================================================

export type BackfillValueScoresResult = {
  status: 'ok';
  /** How many rows were updated this run. */
  updated: number;
  /** How many rows were eligible (had watchVerdict, no valueScore). */
  total: number;
};

export const countMissingValueScores = createServerFn({ method: 'GET' })
  .handler(async (): Promise<{ missing: number }> => {
    const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
      query: {
        filters: {
          watchVerdict: { $notNull: true },
          valueScore: { $null: true },
        },
        // Light fields — we just want the count via meta.pagination.total.
        fields: ['documentId'],
        pagination: { page: 1, pageSize: 1, withCount: true },
      },
    });
    if (!result.ok) return { missing: 0 };
    return { missing: result.meta?.pagination?.total ?? 0 };
  });

export const backfillValueScores = createServerFn({ method: 'POST' })
  .handler(async (): Promise<BackfillValueScoresResult> => {
    let updated = 0;
    let total = 0;
    // Page through all eligible rows. Cap at 50 pages × 100 rows = 5,000
    // videos as a safety belt against an unbounded loop.
    const PAGE_SIZE = 100;
    for (let page = 1; page <= 50; page += 1) {
      const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
        query: {
          filters: {
            watchVerdict: { $notNull: true },
            valueScore: { $null: true },
          },
          // signalScore rides along so the unified writer can blend the
          // hybrid finalScore against the row's existing signal component.
          fields: ['documentId', 'watchVerdict', 'signalScore'],
          pagination: { page, pageSize: PAGE_SIZE, withCount: true },
        },
      });
      if (!result.ok) break;
      const rows = result.data ?? [];
      total = result.meta?.pagination?.total ?? total;
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!row.watchVerdict || !row.documentId) continue;
        const score = backfillScoreFromVerdict(row.watchVerdict);
        // 'derived' tags the source so UI surfaces can treat this as a
        // "needs upgrade" placeholder vs a real model score.
        const write = await applyVideoScoreUpdateService(
          row.documentId,
          { kind: 'value', valueScore: score, valueScoreSource: 'derived' },
          row,
        );
        if (write.success) updated += 1;
      }
      const pageCount = result.meta?.pagination?.pageCount ?? 1;
      if (page >= pageCount) break;
    }
    return { status: 'ok', updated, total };
  });

// =============================================================================
// AI verdict regeneration
//
// Re-rates ONE video's verdict (watchVerdict + valueScore + verdictSummary
// + verdictReason) by running the verdict-only AI path. Used by the
// per-video "Regenerate verdict" UI button.
//
// The Settings bulk path calls this in a loop, one video at a time. Loop
// lives client-side so progress is naturally visible and the work is
// cancellable by closing the page.
// =============================================================================

export type RegenerateVerdictResult =
  | {
      status: 'ok';
      watchVerdict: 'skip' | 'skim' | 'worth_it';
      valueScore: number;
    }
  | { status: 'error'; error: string };

const RegenerateVerdictSchema = VideoIdSchema;

export const regenerateVideoVerdict = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof RegenerateVerdictSchema>) =>
    RegenerateVerdictSchema.parse(data),
  )
  .handler(async ({ data }): Promise<RegenerateVerdictResult> => {
    const generation = await regenerateVerdictForVideo(data.videoId);
    if (!generation.success) {
      return { status: 'error', error: generation.error };
    }

    const video = await fetchVideoByVideoIdService(data.videoId);
    if (!video) {
      return { status: 'error', error: 'Video not found after regen' };
    }

    // The unified writer blends the hybrid finalScore against the row's
    // existing signalScore (untouched by the verdict-only path).
    const write = await applyVideoScoreUpdateService(
      video.documentId,
      {
        kind: 'verdict',
        watchVerdict: generation.data.watchVerdict,
        verdictSummary: generation.data.verdictSummary,
        verdictReason: generation.data.verdictReason,
        valueScore: generation.data.valueScore,
      },
      video,
    );
    if (!write.success) {
      return { status: 'error', error: write.error };
    }

    return {
      status: 'ok',
      watchVerdict: generation.data.watchVerdict,
      valueScore: generation.data.valueScore,
    };
  });

// Light list endpoint that returns just the videoIds eligible for verdict
// regeneration (have a transcript, currently `summaryStatus: 'generated'`).
// The Settings bulk path uses this to know which rows to iterate over.
export type RegenerableVideo = {
  videoId: string;
  videoTitle: string | null;
};

export const listRegenerableVideos = createServerFn({ method: 'GET' })
  .handler(async (): Promise<RegenerableVideo[]> => {
    const out: RegenerableVideo[] = [];
    const PAGE_SIZE = 100;
    for (let page = 1; page <= 50; page += 1) {
      const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
        query: {
          filters: { summaryStatus: { $eq: 'generated' } },
          fields: ['youtubeVideoId', 'videoTitle'],
          sort: 'createdAt:desc',
          pagination: { page, pageSize: PAGE_SIZE, withCount: true },
        },
      });
      if (!result.ok) break;
      const rows = result.data ?? [];
      if (rows.length === 0) break;
      for (const row of rows) {
        if (row.youtubeVideoId) {
          out.push({
            videoId: row.youtubeVideoId,
            videoTitle: row.videoTitle ?? null,
          });
        }
      }
      const pageCount = result.meta?.pagination?.pageCount ?? 1;
      if (page >= pageCount) break;
    }
    return out;
  });

// =============================================================================
// Signal-score backfill
//
// Walks every video that has a generated summary but no `signalScore`
// computed yet, runs the deterministic content-signals pipeline against
// the cached transcript, and writes the result. No LLM calls — the
// whole library typically completes in seconds.
//
// Different from the verdict regenerate path:
//  • verdict regen runs Ollama on each video (slow, ~5–15s/video)
//  • signal backfill is pure text analysis (fast, ~50ms/video)
// Both can run independently — a video can have signals but no real
// verdict score, or vice versa.
// =============================================================================

type StrapiVideoWithTranscript = StrapiVideo & {
  transcript?: { rawText?: string | null } | null;
};

// Deterministic signal computation from a cached raw transcript — shared
// by the single-video regenerate and the bulk backfill. (The full summary
// pipeline computes its own variant with segment-aware word counts.)
function signalsFromRawTranscript(
  rawText: string,
  durationSec: number | null,
): {
  signalScores: NonNullable<StrapiVideo['signalScores']>;
  signalScore: number;
} {
  const cleanedText = cleanTranscript(rawText);
  const wordCount = (cleanedText.match(/\b[\w'-]+\b/g) ?? []).length;
  const signalScores = computeSignalScores({
    rawText,
    cleanedText,
    wordCount,
    durationSec,
  });
  return { signalScores, signalScore: aggregateSignalScore(signalScores) };
}

export const countMissingSignalScores = createServerFn({ method: 'GET' })
  .handler(async (): Promise<{ missing: number }> => {
    const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
      query: {
        filters: {
          summaryStatus: { $eq: 'generated' },
          signalScore: { $null: true },
        },
        fields: ['documentId'],
        pagination: { page: 1, pageSize: 1, withCount: true },
      },
    });
    if (!result.ok) return { missing: 0 };
    return { missing: result.meta?.pagination?.total ?? 0 };
  });

export type BackfillSignalScoresResult = {
  status: 'ok';
  updated: number;
  skipped: number;
  total: number;
};

// Single-video signal regenerate. Used by the "Generate score" button on
// the VideoCard — the bulk backfill is overkill for one row, and the
// AI verdict regen path doesn't touch signalScore.
const RegenerateSignalsSchema = VideoIdSchema;

export type RegenerateSignalsResult =
  | { status: 'ok'; signalScore: number }
  | { status: 'error'; error: string };

export const regenerateVideoSignals = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof RegenerateSignalsSchema>) =>
    RegenerateSignalsSchema.parse(data),
  )
  .handler(async ({ data }): Promise<RegenerateSignalsResult> => {
    // Strapi REST: filter by youtubeVideoId, populate transcript so we
    // get rawText + durationSec in one call.
    const fetched = await strapiFetch<StrapiVideoWithTranscript[]>(
      'GET',
      '/api/videos',
      {
        query: {
          filters: { youtubeVideoId: { $eq: data.videoId } },
          populate: { transcript: true },
          pagination: { pageSize: 1 },
        },
      },
    );
    if (!fetched.ok || !fetched.data || fetched.data.length === 0) {
      return { status: 'error', error: 'Video not found' };
    }
    const row = fetched.data[0];
    const rawText = row.transcript?.rawText;
    if (!row.documentId || !rawText) {
      return {
        status: 'error',
        error: 'No cached transcript yet — full Regenerate first.',
      };
    }
    const durationSec =
      (row.transcript as { durationSec?: number | null } | null | undefined)
        ?.durationSec ?? null;
    const { signalScores, signalScore } = signalsFromRawTranscript(
      rawText,
      durationSec,
    );
    // The unified writer blends finalScore against the row's existing
    // valueScore.
    const write = await applyVideoScoreUpdateService(
      row.documentId,
      { kind: 'signals', signalScores, signalScore },
      row,
    );
    if (!write.success) return { status: 'error', error: write.error };
    return { status: 'ok', signalScore };
  });

export const backfillSignalScores = createServerFn({ method: 'POST' })
  .handler(async (): Promise<BackfillSignalScoresResult> => {
    let updated = 0;
    let skipped = 0;
    let total = 0;
    const PAGE_SIZE = 50;
    for (let page = 1; page <= 50; page += 1) {
      const result = await strapiFetch<StrapiVideoWithTranscript[]>(
        'GET',
        '/api/videos',
        {
          query: {
            filters: {
              summaryStatus: { $eq: 'generated' },
              signalScore: { $null: true },
            },
            // We need transcript.rawText for the actual signal computation
            // and durationSec from the transcript row for speaking pace.
            populate: { transcript: true },
            pagination: { page, pageSize: PAGE_SIZE, withCount: true },
          },
        },
      );
      if (!result.ok) break;
      const rows = result.data ?? [];
      total = result.meta?.pagination?.total ?? total;
      if (rows.length === 0) break;
      for (const row of rows) {
        const rawText = row.transcript?.rawText;
        if (!row.documentId || !rawText) {
          skipped += 1;
          continue;
        }
        const durationSec =
          (row.transcript as { durationSec?: number | null } | null | undefined)
            ?.durationSec ?? null;
        const { signalScores, signalScore } = signalsFromRawTranscript(
          rawText,
          durationSec,
        );
        const write = await applyVideoScoreUpdateService(
          row.documentId,
          { kind: 'signals', signalScores, signalScore },
          row,
        );
        if (write.success) updated += 1;
        else skipped += 1;
      }
      const pageCount = result.meta?.pagination?.pageCount ?? 1;
      if (page >= pageCount) break;
    }
    return { status: 'ok', updated, skipped, total };
  });

// =============================================================================
// Final-score backfill
//
// Computes the hybrid `finalScore` (weighted blend of valueScore +
// signalScore, see `computeFinalScore`) for any row that has at least
// one of the two component scores but no finalScore yet. Pure SQL
// pass — no LLM, no transcript reads. Runs in milliseconds for the
// whole library.
//
// New videos get finalScore at summary-generation time. This path is
// for the transition window where existing rows have valueScore +
// signalScore but never had a finalScore field to write into.
// =============================================================================

export type BackfillFinalScoresResult = {
  status: 'ok';
  updated: number;
  total: number;
};

export const countMissingFinalScores = createServerFn({ method: 'GET' })
  .handler(async (): Promise<{ missing: number }> => {
    const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
      query: {
        filters: {
          // Eligible: has at least one component score AND no finalScore.
          $or: [
            { valueScore: { $notNull: true } },
            { signalScore: { $notNull: true } },
          ],
          finalScore: { $null: true },
        },
        fields: ['documentId'],
        pagination: { page: 1, pageSize: 1, withCount: true },
      },
    });
    if (!result.ok) return { missing: 0 };
    return { missing: result.meta?.pagination?.total ?? 0 };
  });

export const backfillFinalScores = createServerFn({ method: 'POST' })
  .handler(async (): Promise<BackfillFinalScoresResult> => {
    let updated = 0;
    let total = 0;
    const PAGE_SIZE = 100;
    for (let page = 1; page <= 50; page += 1) {
      const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
        query: {
          filters: {
            $or: [
              { valueScore: { $notNull: true } },
              { signalScore: { $notNull: true } },
            ],
            finalScore: { $null: true },
          },
          fields: ['documentId', 'valueScore', 'signalScore'],
          pagination: { page, pageSize: PAGE_SIZE, withCount: true },
        },
      });
      if (!result.ok) break;
      const rows = result.data ?? [];
      total = result.meta?.pagination?.total ?? total;
      if (rows.length === 0) break;
      for (const row of rows) {
        if (!row.documentId) continue;
        // 'rederive' recomputes finalScore from the stored components and
        // no-ops (finalScore: null) when both are missing.
        const write = await applyVideoScoreUpdateService(
          row.documentId,
          { kind: 'rederive' },
          row,
        );
        if (write.success && write.finalScore !== null) updated += 1;
      }
      const pageCount = result.meta?.pagination?.pageCount ?? 1;
      if (page >= pageCount) break;
    }
    return { status: 'ok', updated, total };
  });
