// Composition CRUD — saved 8-bar progression sketches from the
// Theory → Compose tool.
//
// The whole Composition (key, tempo, chord spans, melody/bass note
// spans — all in scale degrees over a 128-tick grid) is stored in the
// Strapi `data` JSON field so reload is just JSON.parse → drop back into
// the composer state with no flattening. `title` mirrors the
// composition name so the saved-list can render without parsing `data`.

import { strapiFetch, type StrapiQuery } from './strapi-client';
import type { Composition } from '#/lib/music/compose/types';

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type StrapiComposition = {
  id: number;
  documentId: string;
  title: string;
  data: Composition;
  createdAt: string;
  updatedAt: string;
};

// Newest-edited first so the saved list shows recent work at the top.
const listQuery: StrapiQuery = {
  sort: 'updatedAt:desc',
  pagination: { pageSize: 100 },
};

export async function listCompositionsService(): Promise<
  ServiceResult<StrapiComposition[]>
> {
  const result = await strapiFetch<StrapiComposition[]>(
    'GET',
    '/api/compositions',
    { query: listQuery },
  );
  return result.ok
    ? { success: true, data: result.data ?? [] }
    : { success: false, error: result.error };
}

export async function createCompositionService(
  title: string,
  data: Composition,
): Promise<ServiceResult<StrapiComposition>> {
  const result = await strapiFetch<StrapiComposition>(
    'POST',
    '/api/compositions',
    { body: { data: { title, data } } },
  );
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export async function updateCompositionService(
  documentId: string,
  title: string,
  data: Composition,
): Promise<ServiceResult<StrapiComposition>> {
  const result = await strapiFetch<StrapiComposition>(
    'PUT',
    `/api/compositions/${documentId}`,
    { body: { data: { title, data } } },
  );
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export async function deleteCompositionService(
  documentId: string,
): Promise<ServiceResult<void>> {
  const result = await strapiFetch<unknown>(
    'DELETE',
    `/api/compositions/${documentId}`,
  );
  if (!result.ok && result.status !== 404) {
    return { success: false, error: result.error };
  }
  return { success: true, data: undefined };
}
