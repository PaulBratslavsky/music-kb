// Progression CRUD — saved chord progressions from the /builder tool.
//
// A progression is just an ordered list of chords, each { root, quality }
// mirroring the builder's ChordSelection. The list lives in the Strapi
// `chords` JSON field so reload drops straight back into the builder with
// no flattening; `name` is the user label for the saved list.

import { strapiFetch, type StrapiQuery } from './strapi-client';
import type { ChordSelection } from '#/lib/music/types';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** One chord in a saved progression — the full builder ChordSelection so the
 *  exact voicing round-trips: `root` + `quality` + `inversion` +
 *  `voicingIndex` (the latter two pin the guitar shape / piano inversion that
 *  was on screen when it was added). Legacy rows saved before voicings were
 *  captured simply lack inversion/voicingIndex; readers default them to 0. */
export type ProgressionChord = ChordSelection;

export type StrapiProgression = {
  id: number;
  documentId: string;
  name: string;
  chords: ProgressionChord[];
  createdAt: string;
  updatedAt: string;
};

// Newest-edited first so the saved list shows recent work at the top.
const listQuery: StrapiQuery = {
  sort: 'updatedAt:desc',
  pagination: { pageSize: 100 },
};

// Standalone progressions (from /builder) — NOT tied to a video. Video-tied
// ones are listed per-video via listProgressionsForVideoService so the two
// surfaces don't show each other's progressions.
export async function listProgressionsService(): Promise<
  ServiceResult<StrapiProgression[]>
> {
  const result = await strapiFetch<StrapiProgression[]>(
    'GET',
    '/api/progressions',
    { query: { ...listQuery, filters: { video: { $null: true } } } },
  );
  return result.ok
    ? { success: true, data: result.data ?? [] }
    : { success: false, error: result.error };
}

// Progressions saved against a specific music video.
export async function listProgressionsForVideoService(
  videoDocumentId: string,
): Promise<ServiceResult<StrapiProgression[]>> {
  const result = await strapiFetch<StrapiProgression[]>(
    'GET',
    '/api/progressions',
    {
      query: {
        ...listQuery,
        filters: { video: { documentId: { $eq: videoDocumentId } } },
      },
    },
  );
  return result.ok
    ? { success: true, data: result.data ?? [] }
    : { success: false, error: result.error };
}

export async function createProgressionService(
  name: string,
  chords: ProgressionChord[],
  videoDocumentId?: string | null,
): Promise<ServiceResult<StrapiProgression>> {
  // Strapi 5 connects a relation from a documentId string.
  const data: Record<string, unknown> = { name, chords };
  if (videoDocumentId) data.video = videoDocumentId;
  const result = await strapiFetch<StrapiProgression>(
    'POST',
    '/api/progressions',
    { body: { data } },
  );
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export async function updateProgressionService(
  documentId: string,
  name: string,
  chords: ProgressionChord[],
): Promise<ServiceResult<StrapiProgression>> {
  const result = await strapiFetch<StrapiProgression>(
    'PUT',
    `/api/progressions/${documentId}`,
    { body: { data: { name, chords } } },
  );
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export async function deleteProgressionService(
  documentId: string,
): Promise<ServiceResult<void>> {
  const result = await strapiFetch<unknown>(
    'DELETE',
    `/api/progressions/${documentId}`,
  );
  if (!result.ok && result.status !== 404) {
    return { success: false, error: result.error };
  }
  return { success: true, data: undefined };
}
