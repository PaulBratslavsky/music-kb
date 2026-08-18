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
 *  captured simply lack inversion/voicingIndex; readers default them to 0.
 *
 *  Chords captured via the reverse-detect fretboard also carry:
 *   - `positions`: the exact tapped frets (`${string}-${fret}`, string 0 =
 *     high E). When present, renderers draw this verbatim instead of
 *     recomputing a voicing from root+quality, so a custom/unknown shape is
 *     preserved faithfully.
 *   - `detectedLabel`: the tonal-detected chord name to show (e.g. "Cmaj7",
 *     "Em7/C"), since root+quality is only a best-effort fallback for shapes
 *     that don't map cleanly to a known quality.
 *   - `midis`: every note that actually sounded, as absolute MIDI numbers,
 *     ascending. This is the only field that preserves OCTAVES and SPACING.
 *     `inversion` records which chord tone is in the bass, which is enough
 *     to stop a slash chord collapsing to root position, but it cannot
 *     describe B3-E4-G4-B4 versus a closed second inversion — the spread is
 *     part of what you played. Renderers that can show octaves (the piano
 *     board, the Push grid) prefer this and fall back to deriving a voicing
 *     when it's absent, which is every chord saved before this field
 *     existed. Instrument-neutral by construction: a MIDI number means the
 *     same thing on a fretboard and a keyboard. */
export type ProgressionChord = ChordSelection & {
  positions?: string[];
  detectedLabel?: string;
  midis?: number[];
};

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
