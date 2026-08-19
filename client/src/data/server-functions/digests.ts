import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  createDigestService,
  listDigestsService,
  fetchDigestByDocumentIdService,
  deleteDigestService,
  findDigestByVideoSetKeyService,
  makeVideoSetKey,
  updateDigestService,
  strapiRowToDigest,
  type StrapiDigest,
  type PaginatedDigests,
} from '#/lib/services/digests';
import {
  DigestSchema,
  generateDigestByIds,
  type Digest,
} from '#/lib/services/digest';
import { OLLAMA_MODEL } from '#/lib/env';
import {
  fetchVideoByVideoIdService,
  fetchVideoByDocumentIdService,
  stripVideoForClient,
  type StrapiVideo,
} from '#/lib/services/videos';

// =============================================================================
// Save a digest — persists the structured data + optional article variant.
// Replaces the old `saveDigestAsNote` flow, which appended markdown to a
// single source video's notes field (semantically wrong — a digest belongs
// to all its source videos, not one of them).
// =============================================================================

// Upsert by a deterministic key derived from the youtubeVideoId set — so
// clicking Save on the same /digest URL twice updates one row instead of
// creating duplicates. The URL's `?videos=A,B` param is the authoritative
// identifier for "which digest is this"; the key is just that list sorted.
const SaveDigestSchema = z.object({
  digest: DigestSchema,
  // YouTube ids (not documentIds) — matches the /digest URL param so the
  // key is reproducible across sessions. documentIds are resolved server-
  // side for the m2m relation payload.
  youtubeVideoIds: z.array(z.string().min(1).max(64)).min(2).max(5),
  articleMarkdown: z.string().max(50_000).optional(),
});

export type SaveDigestResult =
  | { status: 'ok'; digestDocumentId: string; created: boolean }
  | { status: 'error'; error: string };

export const saveDigest = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof SaveDigestSchema>) =>
    SaveDigestSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SaveDigestResult> => {
    const videoSetKey = makeVideoSetKey(data.youtubeVideoIds);

    // Resolve youtubeVideoIds → documentIds for the m2m relation.
    const resolved: string[] = [];
    const missing: string[] = [];
    await Promise.all(
      data.youtubeVideoIds.map(async (id) => {
        const v = await fetchVideoByVideoIdService(id).catch(() => null);
        if (v) resolved.push(v.documentId);
        else missing.push(id);
      }),
    );
    if (missing.length > 0) {
      return { status: 'error', error: `Could not find: ${missing.join(', ')}` };
    }

    const existing = await findDigestByVideoSetKeyService(videoSetKey);
    if (!existing.success) return { status: 'error', error: existing.error };

    if (existing.data) {
      const updated = await updateDigestService({
        documentId: existing.data.documentId,
        title: data.digest.title,
        description: data.digest.description,
        digest: data.digest,
        // Preserve any previously-saved article if the caller didn't pass
        // one this round (user clicked Save before opening the Article tab).
        articleMarkdown:
          data.articleMarkdown !== undefined
            ? data.articleMarkdown
            : existing.data.articleMarkdown,
        videoDocumentIds: resolved,
        model: OLLAMA_MODEL,
      });
      if (!updated.success) return { status: 'error', error: updated.error };
      return {
        status: 'ok',
        digestDocumentId: updated.data.documentId,
        created: false,
      };
    }

    const created = await createDigestService({
      title: data.digest.title,
      description: data.digest.description,
      digest: data.digest,
      articleMarkdown: data.articleMarkdown ?? null,
      videoDocumentIds: resolved,
      videoSetKey,
      model: OLLAMA_MODEL,
    });
    if (!created.success) return { status: 'error', error: created.error };
    return {
      status: 'ok',
      digestDocumentId: created.data.documentId,
      created: true,
    };
  });

// =============================================================================
// Page loader — check for a saved digest first, and only run the LLM when
// there's no cached row for this video set. Replaces the old loader path
// that called `generateDigest` unconditionally.
// =============================================================================

const LoadDigestSchema = z.object({
  videoIds: z.array(z.string().min(1).max(64)).min(2).max(5),
});

export type LoadDigestResult =
  | {
      status: 'ok';
      digest: Digest;
      videos: StrapiVideo[];
      savedDigest: StrapiDigest | null;
      cached: boolean;
    }
  | { status: 'error'; error: string };

async function resolveVideo(id: string): Promise<StrapiVideo | null> {
  const byVid = await fetchVideoByVideoIdService(id).catch(() => null);
  if (byVid) return byVid;
  return await fetchVideoByDocumentIdService(id).catch(() => null);
}

export const loadDigest = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof LoadDigestSchema>) =>
    LoadDigestSchema.parse(data),
  )
  .handler(async ({ data }): Promise<LoadDigestResult> => {
    // Try cache first. Only youtubeVideoIds produce a stable videoSetKey —
    // callers that pass documentIds would get different cache behavior, so
    // the /digest URL contract is youtubeVideoIds only (which it already is).
    const key = makeVideoSetKey(data.videoIds);
    const lookup = await findDigestByVideoSetKeyService(key);
    if (lookup.success && lookup.data) {
      // Cache hit: resolve the source videos for rendering (chips,
      // thumbnails, etc.) and return the persisted structured digest.
      const videos: StrapiVideo[] = [];
      const missing: string[] = [];
      await Promise.all(
        data.videoIds.map(async (id) => {
          const v = await resolveVideo(id);
          if (v) videos.push(v);
          else missing.push(id);
        }),
      );
      if (missing.length > 0) {
        return { status: 'error', error: `Could not find: ${missing.join(', ')}` };
      }
      return {
        status: 'ok',
        digest: strapiRowToDigest(lookup.data),
        videos: videos.map((v) => stripVideoForClient(v)!),
        savedDigest: lookup.data,
        cached: true,
      };
    }

    // Cache miss (or lookup failure): generate fresh.
    const result = await generateDigestByIds(data.videoIds);
    if (!result.success) return { status: 'error', error: result.error };
    return {
      status: 'ok',
      digest: result.digest,
      videos: result.videos.map((v) => stripVideoForClient(v)!),
      savedDigest: null,
      cached: false,
    };
  });

// =============================================================================
// Lookup a saved digest by the youtubeVideoId set from the URL. Returns null
// if there's no saved row yet. Used on the /digest page to detect cache-hits
// for the pre-generated article so we don't regenerate on every visit.
// =============================================================================

const FetchSavedDigestByVideosSchema = z.object({
  youtubeVideoIds: z.array(z.string().min(1).max(64)).min(1).max(10),
});

export type FetchSavedDigestByVideosResult =
  | { status: 'ok'; digest: StrapiDigest | null }
  | { status: 'error'; error: string };

export const fetchSavedDigestByVideoIds = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof FetchSavedDigestByVideosSchema>) =>
    FetchSavedDigestByVideosSchema.parse(data),
  )
  .handler(async ({ data }): Promise<FetchSavedDigestByVideosResult> => {
    const key = makeVideoSetKey(data.youtubeVideoIds);
    const res = await findDigestByVideoSetKeyService(key);
    if (!res.success) return { status: 'error', error: res.error };
    return { status: 'ok', digest: res.data };
  });

// =============================================================================
// List saved digests — powers /digests (the library page) with search and
// pagination over the Digest collection.
// =============================================================================

const ListSavedDigestsSchema = z.object({
  q: z.string().max(200).optional(),
  page: z.number().int().min(1).max(1000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

export type ListSavedDigestsResult =
  | { status: 'ok'; result: PaginatedDigests }
  | { status: 'error'; error: string };

export const listSavedDigests = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof ListSavedDigestsSchema>) =>
    ListSavedDigestsSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ListSavedDigestsResult> => {
    const res = await listDigestsService({
      q: data.q,
      page: data.page,
      pageSize: data.pageSize,
    });
    if (!res.success) return { status: 'error', error: res.error };
    return { status: 'ok', result: res.data };
  });

// =============================================================================
// Fetch a single saved digest by documentId — hydrates the structured view.
// =============================================================================

const FetchSavedDigestSchema = z.object({
  documentId: z.string().min(1).max(64),
});

export type FetchSavedDigestResult =
  | { status: 'ok'; digest: StrapiDigest; structuredData: Digest }
  | { status: 'error'; error: string };

export const fetchSavedDigest = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof FetchSavedDigestSchema>) =>
    FetchSavedDigestSchema.parse(data),
  )
  .handler(async ({ data }): Promise<FetchSavedDigestResult> => {
    const digest = await fetchDigestByDocumentIdService(data.documentId);
    if (!digest) return { status: 'error', error: 'Digest not found' };
    return { status: 'ok', digest, structuredData: strapiRowToDigest(digest) };
  });

// =============================================================================
// Delete a saved digest. No undo — Strapi doesn't preserve tombstones.
// =============================================================================

const DeleteSavedDigestSchema = z.object({
  documentId: z.string().min(1).max(64),
});

export const deleteSavedDigest = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof DeleteSavedDigestSchema>) =>
    DeleteSavedDigestSchema.parse(data),
  )
  .handler(
    async ({
      data,
    }): Promise<{ status: 'ok' } | { status: 'error'; error: string }> => {
      const result = await deleteDigestService(data.documentId);
      if (!result.success) return { status: 'error', error: result.error };
      return { status: 'ok' };
    },
  );
