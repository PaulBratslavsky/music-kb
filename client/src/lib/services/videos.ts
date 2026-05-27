import { STRAPI_URL } from '#/lib/env';
import { strapiFetch, type StrapiQuery } from './strapi-client';
import type { StoredTranscriptIndex } from './transcript';

// `STRAPI_URL` is kept here only for `strapiAssetUrl` (asset URL composition
// for uploaded media). Every REST call goes through `strapi-client` instead.

// =============================================================================
// Types
// =============================================================================

export type StrapiMedia = {
  url: string;
  alternativeText: string | null;
} | null;

export type StrapiTag = {
  id: number;
  documentId: string;
  name: string;
  slug: string;
};

export type StrapiTakeaway = {
  id: number;
  text: string;
};

export type StrapiSection = {
  id: number;
  timeSec: number | null;
  heading: string;
  body: string;
};

export type StrapiActionStep = {
  id: number;
  title: string;
  body: string;
};

// Transcript = the cached YouTube caption source-of-truth. 1:1 with Video,
// but lives on its own row so the fetch is resilient: if AI generation
// fails after the fetch, the Transcript survives and regen skips YouTube.
export type StrapiTranscriptSegment = {
  text: string;
  startMs: number;
  endMs?: number;
};

export type StrapiTranscript = {
  id: number;
  documentId: string;
  youtubeVideoId: string;
  title: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  language: string | null;
  durationSec: number | null;
  rawSegments: StrapiTranscriptSegment[] | null;
  rawText: string | null;
  fetchedAt: string | null;
};

export type SummaryStatus = 'pending' | 'generated' | 'failed' | 'skipped';

/** (music-kb fork) Distinguishes a "lesson" (the default — instructional
 *  video that goes through the transcript + AI summary pipeline) from a
 *  "music" video (just-the-song, no transcript, used with the
 *  LoopBuilder + visualizer to figure out parts by ear). Music videos
 *  always carry summaryStatus='skipped'. */
export type VideoType = 'lesson' | 'music';

export type WatchVerdict = 'skip' | 'skim' | 'worth_it';

// Threshold-based mapping for the numeric `valueScore`. New videos get
// model-produced scores at generation time; this mapping only defines the
// thresholds the verdict band falls into AND the backfill values for
// pre-existing rows that have a verdict but no score yet.
//
// Tune-ability: change a number here, re-run the Settings backfill, every
// row updates without touching the AI pipeline. The verdict↔score
// thresholds let consumers query e.g. `valueScore >= 56` to filter to
// "worth_it tier" without locking the meaning into the categorical.
export const VERDICT_THRESHOLD = {
  skip: { min: 0, max: 25, backfill: 20 },
  skim: { min: 26, max: 55, backfill: 40 },
  worth_it: { min: 56, max: 100, backfill: 70 },
} as const;

export function deriveVerdictFromScore(score: number): WatchVerdict {
  if (score < 26) return 'skip';
  if (score < 56) return 'skim';
  return 'worth_it';
}

export function backfillScoreFromVerdict(verdict: WatchVerdict): number {
  return VERDICT_THRESHOLD[verdict].backfill;
}

// Hybrid blend weights for `finalScore`. Programmatic dominant because
// signalScore varies smoothly across the library; the LLM `valueScore`
// adds contextual judgment (is this useful for someone who already
// knows X) but clusters at mental anchor values. Tunable later — change
// these and re-run the Settings backfill to update every row.
export const FINAL_SCORE_WEIGHTS = {
  signal: 0.6,
  value: 0.4,
} as const;

// Compute the hybrid `finalScore` from the two component scores.
// Fallbacks: if only one component exists, finalScore = that component
// (unweighted — there's nothing to blend it with). Returns null only
// when both components are null.
export function computeFinalScore(
  valueScore: number | null | undefined,
  signalScore: number | null | undefined,
): number | null {
  const v = typeof valueScore === 'number' ? valueScore : null;
  const s = typeof signalScore === 'number' ? signalScore : null;
  if (v === null && s === null) return null;
  if (v === null) return s;
  if (s === null) return v;
  return Math.round(
    FINAL_SCORE_WEIGHTS.signal * s + FINAL_SCORE_WEIGHTS.value * v,
  );
}

export type StrapiVideo = {
  id: number;
  documentId: string;
  youtubeVideoId: string;
  url: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
  caption: string | null;
  createdAt: string;
  tags: StrapiTag[] | null;
  /** (music-kb fork) 'lesson' (default) runs the transcript + AI pipeline;
   *  'music' is just-the-song, saved with summaryStatus='skipped'. */
  videoType: VideoType;
  summaryStatus: SummaryStatus;
  summaryTitle: string | null;
  summaryDescription: string | null;
  summaryOverview: string | null;
  watchVerdict: WatchVerdict | null;
  verdictSummary: string | null;
  verdictReason: string | null;
  /** Canonical numeric score 0–100 for SQL queries / sort / threshold
   * filtering. See `VERDICT_THRESHOLD` for the score↔verdict bands. */
  valueScore: number | null;
  /** How the score was produced:
   *   • `'model'` — real, varied number from an Ollama call (new summaries
   *     or the verdict-only regenerate). Trust for ranking.
   *   • `'derived'` — placeholder midpoint (skip=20, skim=40, worth_it=70)
   *     written by the cheap SQL backfill. Useful for filtering only;
   *     UI surfaces should treat it as "needs upgrade" and offer to run
   *     the AI regenerate.
   *   • `null` — pre-feature row that was never scored, OR a video
   *     summarized before this field existed. Same UI treatment as
   *     `'derived'` — needs the AI regenerate. */
  valueScoreSource: 'model' | 'derived' | null;
  /** Per-signal sub-scores from `content-signals.ts`. Null on rows
   * generated before this field existed. Stored alongside the composite
   * for inspection and future re-tuning of the aggregation weights. */
  signalScores: {
    fillerDensity: number;
    lexicalDensity: number;
    compressionRatio: number;
    speakingPace: number;
    sponsorPresence: number;
  } | null;
  /** Composite of `signalScores` (weighted mean, 0–100). Deterministic,
   * computed from the cleaned transcript at summary-generation time. */
  signalScore: number | null;
  /** Hybrid score: weighted blend of `valueScore` (LLM contextual
   * judgment) and `signalScore` (programmatic signals). The canonical
   * field for sort/filter/rank UI. Falls back to whichever of the two
   * exists when only one is populated; null only when both are null.
   * Computed via `computeFinalScore` whenever either input is written. */
  finalScore: number | null;
  readableArticle: string | null;
  readableArticleGeneratedAt: string | null;
  readableArticleModel: string | null;
  summaryGeneratedAt: string | null;
  aiModel: string | null;
  transcriptSegments: StoredTranscriptIndex | null;
  summaryEmbedding: number[] | null;
  embeddingModel: string | null;
  embeddingVersion: number | null;
  embeddingGeneratedAt: string | null;
  passageEmbeddings: {
    model: string;
    version: number;
    generatedAt: string;
    chunks: Array<{
      text: string;
      startSec: number;
      endSec: number;
      embedding: number[];
    }>;
  } | null;
  keyTakeaways: StrapiTakeaway[] | null;
  sections: StrapiSection[] | null;
  actionSteps: StrapiActionStep[] | null;
  // 1:1 relation to Transcript (source of truth for caption data).
  // Null on pre-migration rows; populated on all freshly-generated videos.
  transcript: StrapiTranscript | null;
};

export type PaginatedVideos = {
  videos: StrapiVideo[];
  page: number;
  pageCount: number;
  total: number;
  /** Set when the Strapi call failed. Distinguishes "library is empty"
   * (videos=[], no error) from "backend is unreachable / errored"
   * (videos=[], error set). UI uses this to show a banner instead of
   * the regular empty state. */
  error?: string;
};

// Translates a strapi-client failure into a UX-friendly message.
// Status `0` = network error (DNS, connection refused, fetch threw).
// 5xx = backend up but broken. 4xx = caller error (bad query/auth).
function friendlyBackendError(status: number, raw: string): string {
  if (status === 0) {
    return 'Backend unreachable. Check that Strapi is running on port 1350.';
  }
  if (status >= 500) {
    return 'Backend error. Strapi is up but rejected the request — check its console for details.';
  }
  return raw || `Backend error ${status}`;
}

// =============================================================================
// Feed / search
// =============================================================================

export type FeedSort = 'recent' | 'score';

export type FeedQuery = {
  page?: number;
  pageSize?: number;
  q?: string;
  tag?: string; // slug
  /** Default `'recent'` (createdAt desc); `'score'` orders by signalScore
   * desc so highest-quality videos surface first. */
  sort?: FeedSort;
  /** Lower bound on `finalScore` (0–100). Videos with no finalScore
   * are excluded when this is set — "min score N" implies "must have
   * a score". Omit/0 = no filter. */
  minScore?: number;
  /** (music-kb fork) Filter by video type. Defaults to undefined =
   *  no filter, but `/feed` passes 'lesson' to hide music-only videos
   *  and `/music` passes 'music' to show only those. */
  videoType?: VideoType;
};

// Strapi sort string per FeedSort. Multi-key sort puts the secondary
// fallback in last position so paginated rows are stable when many
// videos share the same score.
const SORT_BY: Record<FeedSort, string[]> = {
  recent: ['createdAt:desc'],
  // Sort by the hybrid finalScore (60% programmatic + 40% LLM).
  // Falls back to recency when scores tie.
  score: ['finalScore:desc', 'createdAt:desc'],
};

function feedQuery({
  page = 1,
  pageSize = 20,
  q,
  tag,
  sort = 'recent',
  minScore,
  videoType,
}: FeedQuery): StrapiQuery {
  // Keep the feed payload light. No component populate on the list view —
  // summary fields are only needed on the detail page.
  const filters: Record<string, unknown> = {};
  const trimmed = q?.trim();
  if (trimmed) {
    filters.$or = [
      { videoTitle: { $containsi: trimmed } },
      { videoAuthor: { $containsi: trimmed } },
      { caption: { $containsi: trimmed } },
      { summaryTitle: { $containsi: trimmed } },
    ];
  }
  if (tag) {
    filters.tags = { slug: { $eq: tag } };
  }
  if (typeof minScore === 'number' && minScore > 0) {
    // `$gte` excludes rows where finalScore is null, which is what we want:
    // "min score 50" should hide unrated videos, not lump them in.
    filters.finalScore = { $gte: minScore };
  }
  if (videoType) {
    filters.videoType = { $eq: videoType };
  }
  return {
    populate: ['tags'],
    sort: SORT_BY[sort],
    pagination: { page, pageSize, withCount: true },
    ...(Object.keys(filters).length > 0
      ? { filters: filters as StrapiQuery['filters'] }
      : {}),
  };
}

export async function fetchFeedService(query: FeedQuery): Promise<PaginatedVideos> {
  const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
    query: feedQuery(query),
  });
  if (!result.ok) {
    return {
      videos: [],
      page: query.page ?? 1,
      pageCount: 0,
      total: 0,
      error: friendlyBackendError(result.status, result.error),
    };
  }
  const cleaned = (result.data ?? []).map(
    (v) => stripVideoForClient(v) as StrapiVideo,
  );
  return {
    videos: cleaned,
    page: result.meta?.pagination?.page ?? 1,
    pageCount: result.meta?.pagination?.pageCount ?? 0,
    total: result.meta?.pagination?.total ?? 0,
  };
}

// =============================================================================
// Single-video lookups
// =============================================================================

// Populate strategy for the detail page — everything, including the heavy
// components that the summary view needs.
const detailQuery: StrapiQuery = {
  populate: ['tags', 'keyTakeaways', 'sections', 'actionSteps', 'transcript'],
};

// Lightweight listing used by embedding-dependent features (backfill,
// relatedVideos, semantic search). Pulls the fields needed to rebuild the
// embedding text + the existing vector for comparison — nothing else.
// Paginates internally so one call returns every eligible row.
export async function listAllVideosForEmbeddingService(): Promise<StrapiVideo[]> {
  const pageSize = 100;
  const all: StrapiVideo[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
      query: {
        populate: ['tags', 'keyTakeaways', 'sections'],
        filters: { summaryStatus: { $eq: 'generated' } },
        sort: 'createdAt:desc',
        pagination: { page, pageSize, withCount: true },
      },
    });
    if (!result.ok) break;
    for (const v of result.data ?? []) {
      const cleaned = stripVideoForClient(v);
      if (cleaned) all.push(cleaned);
    }
    const pageCount = result.meta?.pagination?.pageCount ?? 1;
    if (page >= pageCount) break;
  }
  return all;
}

// NOTE: these two fetchers return the FULL video row including
// `transcriptSegments`. They're used by server-internal callers (chat
// retrieval, evidence extraction, digest chat) that read the BM25 index.
// Server functions / route loaders that ship a video to the client must
// pass it through `stripVideoForClient` before returning, or use the
// `*WithStatus` siblings below which strip automatically.
export async function fetchVideoByDocumentIdService(
  documentId: string,
): Promise<StrapiVideo | null> {
  const result = await strapiFetch<StrapiVideo>(
    'GET',
    `/api/videos/${documentId}`,
    { query: detailQuery },
  );
  return result.ok ? (result.data ?? null) : null;
}

export async function fetchVideoByVideoIdService(
  videoId: string,
): Promise<StrapiVideo | null> {
  const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
    query: {
      ...detailQuery,
      filters: { youtubeVideoId: { $eq: videoId } },
      pagination: { pageSize: 1 },
    },
  });
  return result.ok ? (result.data?.[0] ?? null) : null;
}

// Sibling shape that distinguishes "video doesn't exist" (video=null,
// error=null) from "couldn't reach the backend" (video=null, error
// set). Used by route loaders so the UI can render a backend-down
// banner instead of a generic "not found" page when Strapi is down.
//
// 404 from Strapi is treated as `video: null, error: null` — the row
// simply doesn't exist. Other failures (status 0, 5xx, etc.) populate
// `error` via friendlyBackendError. Existing callers that use
// fetchVideoByVideoIdService directly are unaffected.
export type VideoLookup = { video: StrapiVideo | null; error: string | null };

// Strip `transcriptSegments` from any video that's about to cross the
// server→client serialization boundary. Seroval rejects ANY object with
// `constructor` (and other reserved Object.prototype names) as own
// properties — even with clean number values — so a BM25 token table
// containing a token like "constructor" or "toString" crashes the loader
// stream regardless of whether the values are corrupted. The UI never
// reads `transcriptSegments` (it's pure server-side BM25 cache for chat
// retrieval / evidence extraction), so stripping it at the boundary is
// both the only correct fix and a bandwidth win. Internal callers that
// need the BM25 data (chat / evidence / digest retrieval) use the
// non-stripping fetchers below.
export function stripVideoForClient(video: StrapiVideo | null): StrapiVideo | null {
  if (!video) return video;
  return { ...video, transcriptSegments: null };
}

export async function fetchVideoByDocumentIdWithStatusService(
  documentId: string,
): Promise<VideoLookup> {
  const result = await strapiFetch<StrapiVideo>(
    'GET',
    `/api/videos/${documentId}`,
    { query: detailQuery },
  );
  if (result.ok) {
    return { video: stripVideoForClient(result.data ?? null), error: null };
  }
  if (result.status === 404) return { video: null, error: null };
  return { video: null, error: friendlyBackendError(result.status, result.error) };
}

export async function fetchVideoByVideoIdWithStatusService(
  videoId: string,
): Promise<VideoLookup> {
  const result = await strapiFetch<StrapiVideo[]>('GET', '/api/videos', {
    query: {
      ...detailQuery,
      filters: { youtubeVideoId: { $eq: videoId } },
      pagination: { pageSize: 1 },
    },
  });
  if (result.ok) {
    return { video: stripVideoForClient(result.data?.[0] ?? null), error: null };
  }
  // The list endpoint never 404s — an unknown id returns `data: []`.
  // So any non-OK is a real backend failure.
  return { video: null, error: friendlyBackendError(result.status, result.error) };
}

// =============================================================================
// Create a video (with tag upsert)
// =============================================================================

export type CreateVideoServiceInput = {
  videoId: string;
  url: string;
  caption?: string;
  videoTitle?: string;
  videoAuthor?: string;
  videoThumbnailUrl?: string;
  tagNames: string[];
  /** (music-kb fork) Defaults to 'lesson'. When 'music', the row is
   *  created with summaryStatus='skipped' and the AI pipeline never runs. */
  videoType?: VideoType;
};

export type CreateVideoServiceResult =
  | { success: true; video: StrapiVideo }
  | { success: false; kind: 'exists'; video: StrapiVideo }
  | { success: false; kind: 'error'; error: string };

export async function createVideoService(
  input: CreateVideoServiceInput,
): Promise<CreateVideoServiceResult> {
  // Pre-check dedupe so we can return 'exists' without parsing Strapi
  // error strings. Server middleware catches races as a second line of
  // defense.
  const existing = await fetchVideoByVideoIdService(input.videoId);
  if (existing) return { success: false, kind: 'exists', video: existing };

  const tagDocumentIds: string[] = [];
  for (const raw of input.tagNames) {
    const existingTag = await findTagByNameService(raw);
    if (existingTag) {
      tagDocumentIds.push(existingTag.documentId);
      continue;
    }
    const created = await createTagService(raw);
    if (created) tagDocumentIds.push(created.documentId);
  }

  const isMusic = input.videoType === 'music';
  const body = {
    data: {
      youtubeVideoId: input.videoId,
      url: input.url,
      caption: input.caption,
      videoTitle: input.videoTitle,
      videoAuthor: input.videoAuthor,
      videoThumbnailUrl: input.videoThumbnailUrl,
      tags: tagDocumentIds,
      videoType: (input.videoType ?? 'lesson') as VideoType,
      // Music videos skip the AI pipeline entirely — set status='skipped'
      // up front so polling UIs don't wait for a generation that never runs.
      summaryStatus: (isMusic ? 'skipped' : 'pending') as SummaryStatus,
    },
  };

  const result = await strapiFetch<StrapiVideo>('POST', '/api/videos', { body });
  if (!result.ok) {
    return { success: false, kind: 'error', error: result.error };
  }
  return { success: true, video: result.data };
}

// =============================================================================
// Update a video (used by the summary-generation pipeline to land AI output)
// =============================================================================

export type UpdateVideoSummaryInput = {
  documentId: string;
  summaryTitle: string;
  summaryDescription: string;
  summaryOverview: string;
  watchVerdict: WatchVerdict;
  verdictSummary: string;
  verdictReason: string;
  valueScore: number;
  /** Always `'model'` when written through this path — full summary
   * generation and the verdict-only regen both produce real scores. */
  valueScoreSource: 'model';
  /** Programmatic content-quality sub-scores (filler / lexical / etc).
   * Computed by `computeSignalScores` in `content-signals.ts`. */
  signalScores: {
    fillerDensity: number;
    lexicalDensity: number;
    compressionRatio: number;
    speakingPace: number;
    sponsorPresence: number;
  };
  /** Composite weighted aggregate of `signalScores`. */
  signalScore: number;
  /** Hybrid blend of `valueScore` + `signalScore` (see `computeFinalScore`).
   * Always derivable from the other two fields — caller computes and
   * passes it. Storing avoids client-side post-processing for sort. */
  finalScore: number;
  aiModel: string;
  transcriptSegments?: StoredTranscriptIndex;
  keyTakeaways: Array<{ text: string }>;
  sections: Array<{ timeSec?: number; heading: string; body: string }>;
  actionSteps: Array<{ title: string; body: string }>;
};

export async function updateVideoSummaryService(
  input: UpdateVideoSummaryInput,
): Promise<{ success: true; video: StrapiVideo } | { success: false; error: string }> {
  const { documentId, ...rest } = input;
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${documentId}`,
    {
      body: {
        data: {
          ...rest,
          summaryStatus: 'generated' as SummaryStatus,
          summaryGeneratedAt: new Date().toISOString(),
        },
      },
    },
  );
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, video: result.data };
}

// Dedicated writer for embedding fields. Keeping this isolated from the
// summary write path lets the embedding layer evolve (different storage,
// pgvector migration, tier-2 passage-level vectors) without touching
// summary code.
export async function updateVideoEmbeddingService(input: {
  documentId: string;
  embedding: number[];
  model: string;
  version: number;
  generatedAt: string;
}): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${input.documentId}`,
    {
      body: {
        data: {
          summaryEmbedding: input.embedding,
          embeddingModel: input.model,
          embeddingVersion: input.version,
          embeddingGeneratedAt: input.generatedAt,
        },
      },
    },
  );
  return result.ok ? { success: true } : { success: false, error: result.error };
}

// Dedicated writer for the Tier-2 passage-index JSON blob.
export async function updateVideoPassagesService(input: {
  documentId: string;
  passageEmbeddings: NonNullable<StrapiVideo['passageEmbeddings']>;
}): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${input.documentId}`,
    { body: { data: { passageEmbeddings: input.passageEmbeddings } } },
  );
  return result.ok ? { success: true } : { success: false, error: result.error };
}

export async function markSummaryFailedService(documentId: string): Promise<void> {
  // Best-effort — the chat UI will show the error via its own retry path.
  await strapiFetch('PUT', `/api/videos/${documentId}`, {
    body: { data: { summaryStatus: 'failed' } },
  });
}

/**
 * (music-kb fork) Convert a video between 'lesson' and 'music' types.
 * Used when re-sharing an existing video with the opposite type — the
 * user is saying "I changed my mind, this should be the other kind."
 *
 * lesson → music: clears the AI-summary artifacts (status, summary
 * fields, verdict, scores) and marks status='skipped'. The music page
 * shouldn't show "SUMMARY FAILED" or stale summary content.
 *
 * music → lesson: resets status='pending'. The caller is responsible
 * for kicking off generation if it wants the AI flow to run.
 */
export async function updateVideoTypeService(
  documentId: string,
  videoType: VideoType,
): Promise<StrapiVideo | null> {
  const data: Record<string, unknown> = { videoType };
  if (videoType === 'music') {
    data.summaryStatus = 'skipped';
    // Wipe AI-summary artifacts so the music page presents a clean card.
    data.summaryTitle = null;
    data.summaryDescription = null;
    data.summaryOverview = null;
    data.watchVerdict = null;
    data.verdictSummary = null;
    data.verdictReason = null;
    data.valueScore = null;
    data.valueScoreSource = null;
    data.signalScore = null;
    data.finalScore = null;
    data.signalScores = null;
    data.aiModel = null;
    data.summaryGeneratedAt = null;
  } else {
    // Reverting to lesson — let the caller decide whether to retrigger.
    data.summaryStatus = 'pending';
  }
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${documentId}`,
    { body: { data } },
  );
  if (!result.ok) return null;
  return result.data;
}

// Partial-update path for the verdict-only fields (regenerate-verdict
// surface). Touches ONLY the four verdict-shaped fields — leaves
// summaryTitle / sections / takeaways / actionSteps / transcriptSegments
// alone. Used by per-video "Regenerate verdict" and the Settings bulk.
export async function updateVideoVerdictService(input: {
  documentId: string;
  watchVerdict: WatchVerdict;
  verdictSummary: string;
  verdictReason: string;
  valueScore: number;
  /** Recomputed hybrid score. Caller is expected to derive this from the
   * new valueScore + the row's existing signalScore via
   * `computeFinalScore` and pass it here so we keep all three fields
   * in sync after a verdict-only regen. */
  finalScore: number;
}): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${input.documentId}`,
    {
      body: {
        data: {
          watchVerdict: input.watchVerdict,
          verdictSummary: input.verdictSummary,
          verdictReason: input.verdictReason,
          valueScore: input.valueScore,
          valueScoreSource: 'model',
          finalScore: input.finalScore,
        },
      },
    },
  );
  return result.ok ? { success: true } : { success: false, error: result.error };
}

// Partial-update path for the signal-score fields (programmatic content
// signals). Touches ONLY the two signal fields — verdict + summary
// fields stay untouched. Used by the Settings signal-scores backfill.
export async function updateVideoSignalScoresService(input: {
  documentId: string;
  signalScores: NonNullable<StrapiVideo['signalScores']>;
  signalScore: number;
  /** Recomputed hybrid score. Caller derives this from the new
   * signalScore + the row's existing valueScore via
   * `computeFinalScore` and passes it here. Keeps all three fields in
   * sync after a signal-only regen. */
  finalScore: number;
}): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${input.documentId}`,
    {
      body: {
        data: {
          signalScores: input.signalScores,
          signalScore: input.signalScore,
          finalScore: input.finalScore,
        },
      },
    },
  );
  return result.ok ? { success: true } : { success: false, error: result.error };
}

// Manually set the timeSec of a single section on a Video row. Strapi's
// repeatable-component semantics mean we have to PUT the whole sections
// array back with the one field updated. Keeps heading/body untouched.
export async function updateSectionTimecodeService(input: {
  documentId: string;
  sectionId: number;
  timeSec: number;
}): Promise<{ success: true } | { success: false; error: string }> {
  // Fetch current sections so we can resend the array with one edit.
  const read = await strapiFetch<StrapiVideo>(
    'GET',
    `/api/videos/${input.documentId}`,
    { query: detailQuery },
  );
  if (!read.ok) return { success: false, error: read.error };
  const video = read.data;
  if (!video) return { success: false, error: 'Video not found' };

  const currentSections = video.sections ?? [];
  let matched = false;
  const nextSections = currentSections.map((s) => {
    if (s.id !== input.sectionId) return { heading: s.heading, body: s.body, timeSec: s.timeSec };
    matched = true;
    return { heading: s.heading, body: s.body, timeSec: input.timeSec };
  });
  if (!matched) return { success: false, error: 'Section not found on this video' };

  const write = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${input.documentId}`,
    { body: { data: { sections: nextSections } } },
  );
  return write.ok ? { success: true } : { success: false, error: write.error };
}

// Flip a completed (or failed) summary back to 'pending' so the generation
// pipeline treats it as fresh work. Intentionally does NOT clear the old
// summary fields — if regeneration fails, the previous content is still on
// the row and can be recovered by clearing the pending flag.
export async function markSummaryPendingService(
  documentId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>('PUT', `/api/videos/${documentId}`, {
    body: { data: { summaryStatus: 'pending' } },
  });
  return result.ok ? { success: true } : { success: false, error: result.error };
}

// =============================================================================
// Transcript (cached YouTube caption source)
//
// Transcripts live on their own collection keyed by youtubeVideoId. The
// generation pipeline looks one up before hitting YouTube; if found, it
// reuses the cached segments. If the AI generation crashes downstream,
// the Transcript remains saved — next retry skips the YouTube fetch.
// =============================================================================

export async function fetchTranscriptByVideoIdService(
  videoId: string,
): Promise<StrapiTranscript | null> {
  const result = await strapiFetch<StrapiTranscript[]>('GET', '/api/transcripts', {
    query: {
      filters: { youtubeVideoId: { $eq: videoId } },
      pagination: { pageSize: 1 },
    },
  });
  return result.ok ? (result.data?.[0] ?? null) : null;
}

export type CreateTranscriptServiceInput = {
  youtubeVideoId: string;
  title?: string;
  author?: string;
  thumbnailUrl?: string;
  language?: string;
  durationSec?: number | null;
  rawSegments: StrapiTranscriptSegment[];
  rawText: string;
};

export async function createTranscriptService(
  input: CreateTranscriptServiceInput,
): Promise<{ success: true; transcript: StrapiTranscript } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiTranscript>('POST', '/api/transcripts', {
    body: { data: { ...input, fetchedAt: new Date().toISOString() } },
  });
  return result.ok
    ? { success: true, transcript: result.data }
    : { success: false, error: result.error };
}

// Attach a Transcript to a Video via the 1:1 relation. Used after the
// Transcript row is created so subsequent reads of the Video populate it.
export async function linkVideoToTranscriptService(
  videoDocumentId: string,
  transcriptDocumentId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const result = await strapiFetch<StrapiVideo>(
    'PUT',
    `/api/videos/${videoDocumentId}`,
    { body: { data: { transcript: transcriptDocumentId } } },
  );
  return result.ok ? { success: true } : { success: false, error: result.error };
}

// =============================================================================
// Tags
// =============================================================================

export async function findTagByNameService(rawName: string): Promise<StrapiTag | null> {
  const name = rawName.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!name) return null;
  const result = await strapiFetch<StrapiTag[]>('GET', '/api/tags', {
    query: {
      filters: { name: { $eq: name } },
      pagination: { pageSize: 1 },
    },
  });
  return result.ok ? (result.data?.[0] ?? null) : null;
}

export async function searchTagsService(query: string, limit = 8): Promise<StrapiTag[]> {
  const q = query.trim().toLowerCase();
  const result = await strapiFetch<StrapiTag[]>('GET', '/api/tags', {
    query: {
      ...(q ? { filters: { name: { $containsi: q } } } : {}),
      sort: 'name:asc',
      pagination: { pageSize: limit },
    },
  });
  return result.ok ? (result.data ?? []) : [];
}

async function createTagService(name: string): Promise<StrapiTag | null> {
  const result = await strapiFetch<StrapiTag>('POST', '/api/tags', {
    body: { data: { name } },
  });
  return result.ok ? result.data : null;
}

// =============================================================================
// Asset URL helper
// =============================================================================

export const strapiAssetUrl = (path: string | null | undefined) => {
  if (!path) return null;
  if (path.startsWith('data:') || path.startsWith('http') || path.startsWith('//')) {
    return path;
  }
  return `${STRAPI_URL}${path}`;
};
