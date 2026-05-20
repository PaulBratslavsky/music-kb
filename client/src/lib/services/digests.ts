// Digest CRUD against `api::digest.digest`. Persists the structured data
// as Strapi components (matching how Video stores sections/takeaways/etc.)
// rather than a single JSON blob — so digests are first-class editable
// content in the admin panel and queryable by sub-field.
//
// The service boundary translates between the LLM-shaped `Digest` Zod
// type (what the UI consumes) and the decomposed Strapi row + components.
// Callers never see the raw component arrays; they get a `Digest`.

import { strapiFetch, type StrapiQuery } from './strapi-client';
import type { Digest } from './digest';

type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

// =============================================================================
// Strapi row types — shape of what /api/digests returns when fully populated.
// =============================================================================

export type StrapiDigestVideo = {
  id: number;
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
};

type StrapiDigestVideoTitle = { id: number; title: string };

type StrapiDigestSharedTheme = {
  id: number;
  title: string;
  body: string;
  videoTitles: StrapiDigestVideoTitle[] | null;
};

type StrapiDigestUniqueInsight = {
  id: number;
  videoTitle: string;
  insight: string;
};

type StrapiDigestContradictionPosition = {
  id: number;
  videoTitle: string;
  stance: string;
};

type StrapiDigestContradiction = {
  id: number;
  topic: string;
  positions: StrapiDigestContradictionPosition[] | null;
};

type StrapiDigestViewingOrder = {
  id: number;
  videoTitle: string;
  why: string;
};

export type StrapiDigest = {
  id: number;
  documentId: string;
  title: string;
  description: string | null;
  overallTheme: string | null;
  bottomLine: string | null;
  sharedThemes: StrapiDigestSharedTheme[] | null;
  uniqueInsights: StrapiDigestUniqueInsight[] | null;
  contradictions: StrapiDigestContradiction[] | null;
  viewingOrder: StrapiDigestViewingOrder[] | null;
  articleMarkdown: string | null;
  model: string | null;
  videoSetKey: string | null;
  videos: StrapiDigestVideo[];
  createdAt: string;
  updatedAt: string;
};

// =============================================================================
// (Dis)assembly — translate between the LLM-shaped `Digest` and the component
// arrays Strapi stores. The UI only ever sees `Digest`.
// =============================================================================

// Pull a `Digest` out of a populated Strapi row. Missing/null component
// arrays collapse to empty arrays; missing scalar strings collapse to ''.
// This keeps the UI rendering code unchanged — it still consumes a Digest.
export function strapiRowToDigest(row: StrapiDigest): Digest {
  return {
    title: row.title,
    description: row.description ?? '',
    overallTheme: row.overallTheme ?? '',
    bottomLine: row.bottomLine ?? '',
    sharedThemes: (row.sharedThemes ?? []).map((t) => ({
      title: t.title,
      body: t.body,
      videoTitles: (t.videoTitles ?? []).map((vt) => vt.title),
    })),
    uniqueInsights: (row.uniqueInsights ?? []).map((u) => ({
      videoTitle: u.videoTitle,
      insight: u.insight,
    })),
    contradictions: (row.contradictions ?? []).map((c) => ({
      topic: c.topic,
      positions: (c.positions ?? []).map((p) => ({
        videoTitle: p.videoTitle,
        stance: p.stance,
      })),
    })),
    viewingOrder: (row.viewingOrder ?? []).map((v) => ({
      videoTitle: v.videoTitle,
      why: v.why,
    })),
  };
}

// Inverse: build the Strapi POST/PUT payload fragment from a Digest.
// Component writes are inline in the data payload — Strapi creates the
// component rows and links them.
function digestToComponentPayload(d: Digest): Record<string, unknown> {
  return {
    overallTheme: d.overallTheme,
    bottomLine: d.bottomLine,
    sharedThemes: d.sharedThemes.map((t) => ({
      title: t.title,
      body: t.body,
      videoTitles: t.videoTitles.map((title) => ({ title })),
    })),
    uniqueInsights: d.uniqueInsights.map((u) => ({
      videoTitle: u.videoTitle,
      insight: u.insight,
    })),
    contradictions: d.contradictions.map((c) => ({
      topic: c.topic,
      positions: c.positions.map((p) => ({
        videoTitle: p.videoTitle,
        stance: p.stance,
      })),
    })),
    viewingOrder: d.viewingOrder.map((v) => ({
      videoTitle: v.videoTitle,
      why: v.why,
    })),
  };
}

// =============================================================================
// CRUD
// =============================================================================

// Populate every component array + their nested components so the row
// comes back fully reassemble-able.
const digestQuery: StrapiQuery = {
  populate: {
    videos: true,
    sharedThemes: { populate: { videoTitles: true } },
    uniqueInsights: true,
    contradictions: { populate: { positions: true } },
    viewingOrder: true,
  },
};

export function makeVideoSetKey(youtubeVideoIds: string[]): string {
  return [...youtubeVideoIds]
    .map((s) => s.trim())
    .filter(Boolean)
    .sort()
    .join(',');
}

export async function createDigestService(input: {
  title: string;
  description?: string | null;
  digest: Digest;
  articleMarkdown?: string | null;
  videoDocumentIds: string[];
  videoSetKey: string;
  model?: string | null;
}): Promise<ServiceResult<StrapiDigest>> {
  const componentPayload = digestToComponentPayload(input.digest);
  const result = await strapiFetch<StrapiDigest>('POST', '/api/digests', {
    query: digestQuery,
    body: {
      data: {
        title: input.title,
        description: input.description ?? null,
        ...componentPayload,
        articleMarkdown: input.articleMarkdown ?? null,
        model: input.model ?? null,
        videoSetKey: input.videoSetKey,
        videos: input.videoDocumentIds,
      },
    },
  });
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export type PaginatedDigests = {
  digests: StrapiDigest[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

export async function listDigestsService(input?: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<ServiceResult<PaginatedDigests>> {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 20;
  const q = input?.q?.trim();
  const result = await strapiFetch<StrapiDigest[]>('GET', '/api/digests', {
    query: {
      ...digestQuery,
      sort: 'createdAt:desc',
      pagination: { page, pageSize, withCount: true },
      ...(q
        ? {
            filters: {
              $or: [
                { title: { $containsi: q } },
                { description: { $containsi: q } },
              ],
            },
          }
        : {}),
    },
  });
  if (!result.ok) return { success: false, error: result.error };
  const digests = result.data ?? [];
  const total = result.meta?.pagination?.total ?? digests.length;
  const pageCount = result.meta?.pagination?.pageCount ?? 1;
  return {
    success: true,
    data: { digests, total, page, pageSize, pageCount },
  };
}

export async function fetchDigestByDocumentIdService(
  documentId: string,
): Promise<StrapiDigest | null> {
  const result = await strapiFetch<StrapiDigest>(
    'GET',
    `/api/digests/${documentId}`,
    { query: digestQuery },
  );
  if (!result.ok) return null;
  return result.data ?? null;
}

export async function updateDigestService(input: {
  documentId: string;
  title?: string;
  description?: string | null;
  digest?: Digest;
  articleMarkdown?: string | null;
  videoDocumentIds?: string[];
  model?: string | null;
}): Promise<ServiceResult<StrapiDigest>> {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.digest !== undefined) {
    Object.assign(data, digestToComponentPayload(input.digest));
  }
  if (input.articleMarkdown !== undefined) data.articleMarkdown = input.articleMarkdown;
  if (input.videoDocumentIds !== undefined) data.videos = input.videoDocumentIds;
  if (input.model !== undefined) data.model = input.model;
  const result = await strapiFetch<StrapiDigest>(
    'PUT',
    `/api/digests/${input.documentId}`,
    { query: digestQuery, body: { data } },
  );
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export async function findDigestByVideoSetKeyService(
  videoSetKey: string,
): Promise<ServiceResult<StrapiDigest | null>> {
  const result = await strapiFetch<StrapiDigest[]>('GET', '/api/digests', {
    query: {
      ...digestQuery,
      filters: { videoSetKey: { $eq: videoSetKey } },
      pagination: { pageSize: 1 },
    },
  });
  return result.ok
    ? { success: true, data: result.data?.[0] ?? null }
    : { success: false, error: result.error };
}

export async function deleteDigestService(
  documentId: string,
): Promise<ServiceResult<void>> {
  const result = await strapiFetch<unknown>('DELETE', `/api/digests/${documentId}`);
  if (!result.ok && result.status !== 404) {
    return { success: false, error: result.error };
  }
  return { success: true, data: undefined };
}
