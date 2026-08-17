// Loop CRUD — A/B video region + discovered key + chord progression.
//
// A Loop is the persistent artifact of a play-along discovery session:
// the user picks a chunk of a video, finds the key by ear, and captures
// the progression they hear by clicking diatonic chord chips against the
// loop. Each row owns the full snapshot — re-opening a Loop rehydrates
// the player (region) + visualizer (key) + LoopBuilder (progression)
// without further round-trips.
//
// `key` and `progression` are stored as JSON to match the visualizer's
// ScaleSelection / ChordSelection shapes so reload is essentially
// JSON.parse → pass into useAppState({ initialState }).

import { strapiFetch, type StrapiQuery } from './strapi-client';

type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

// =============================================================================
// Types — mirror server/src/api/loop/content-types/loop/schema.json
// =============================================================================

/** Music-theory key signature, matches AppState['scale'] in the visualizer. */
export type KeySig = {
  root: string; // PitchClass: 'C' | 'C#' | ... | 'B'
  type: string; // ScaleType: 'major' | 'minor' | 'dorian' | ...
};

/** One entry in a saved progression. `durationBeats` is null in v1 (chord
 *  order only); v2 fills it in to enable synced playback. Additive — no
 *  migration when v2 lands. */
export type ChordEntry = {
  root: string; // PitchClass
  quality: string; // ChordQuality: 'maj' | 'min' | '7' | 'maj7' | ...
  durationBeats: number | null;
};

import type { ProgressionChord } from '#/lib/services/progressions';

export type StrapiLoopVideo = {
  id: number;
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
};

/** The saved Progression a section is linked to, as populated on a Loop. */
export type StrapiLoopProgression = {
  id: number;
  documentId: string;
  name: string;
  /** Full builder selections — inversion / voicingIndex / positions pin the
   *  exact on-screen shape, so a section renders the same diagram the
   *  Chord Progression panel does. */
  chords: ProgressionChord[] | null;
};

export type StrapiLoop = {
  id: number;
  documentId: string;
  label: string;
  startSec: number;
  endSec: number;
  key: KeySig | null;
  progression: ChordEntry[] | null;
  // Reserved for v3; always null in v1/v2. Typed `null` (not `unknown`)
  // because these rows flow back through a TanStack server function whose
  // return type must be serializable — `unknown` fails that constraint
  // and breaks the createServerFn handler typing. Retype when v3 lands.
  melody: null; // reserved for v3
  bpm: number | null;
  bars: number | null;
  notes: string | null;
  /** Populated link to the saved progression this section plays. */
  savedProgression?: StrapiLoopProgression | null;
  video: StrapiLoopVideo | null;
  createdAt: string;
  updatedAt: string;
};

// =============================================================================
// CRUD
// =============================================================================

// Loops always populate `video` so the right-column list can show
// label + range without a second round-trip per loop, and
// `savedProgression` so each section row can show its chords without one
// request per row.
const loopQuery: StrapiQuery = { populate: ['video', 'savedProgression'] };

export async function listLoopsForVideoService(
  videoDocumentId: string,
): Promise<ServiceResult<StrapiLoop[]>> {
  const result = await strapiFetch<StrapiLoop[]>('GET', '/api/loops', {
    query: {
      ...loopQuery,
      filters: { video: { documentId: { $eq: videoDocumentId } } },
      // startSec ascending so the list reads top-to-bottom in time order.
      sort: 'startSec:asc',
      pagination: { pageSize: 100 },
    },
  });
  return result.ok
    ? { success: true, data: result.data ?? [] }
    : { success: false, error: result.error };
}

export async function getLoopByDocumentIdService(
  documentId: string,
): Promise<ServiceResult<StrapiLoop | null>> {
  const result = await strapiFetch<StrapiLoop>('GET', `/api/loops/${documentId}`, {
    query: loopQuery,
  });
  if (result.ok) return { success: true, data: result.data };
  // 404 = doesn't exist; treat as null rather than an error so callers
  // can distinguish "missing row" from "backend down."
  if (result.status === 404) return { success: true, data: null };
  return { success: false, error: result.error };
}

export type CreateLoopInput = {
  videoDocumentId: string;
  label: string;
  startSec: number;
  endSec: number;
  key: KeySig | null;
  progression: ChordEntry[];
  bpm?: number | null;
  notes?: string | null;
};

export async function createLoopService(
  input: CreateLoopInput,
): Promise<ServiceResult<StrapiLoop>> {
  const result = await strapiFetch<StrapiLoop>('POST', '/api/loops', {
    query: loopQuery,
    body: {
      data: {
        video: input.videoDocumentId,
        label: input.label,
        startSec: input.startSec,
        endSec: input.endSec,
        key: input.key,
        progression: input.progression,
        bpm: input.bpm ?? null,
        notes: input.notes ?? null,
      },
    },
  });
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export type UpdateLoopInput = {
  documentId: string;
  label?: string;
  startSec?: number;
  endSec?: number;
  key?: KeySig | null;
  progression?: ChordEntry[];
  bpm?: number | null;
  bars?: number | null;
  notes?: string | null;
  /** documentId of the saved Progression to link, or null to unlink. */
  savedProgression?: string | null;
};

export async function updateLoopService(
  input: UpdateLoopInput,
): Promise<ServiceResult<StrapiLoop>> {
  const data: Record<string, unknown> = {};
  if (input.label !== undefined) data.label = input.label;
  if (input.startSec !== undefined) data.startSec = input.startSec;
  if (input.endSec !== undefined) data.endSec = input.endSec;
  if (input.key !== undefined) data.key = input.key;
  if (input.progression !== undefined) data.progression = input.progression;
  if (input.bpm !== undefined) data.bpm = input.bpm;
  if (input.bars !== undefined) data.bars = input.bars;
  if (input.notes !== undefined) data.notes = input.notes;
  // Strapi 5 relations accept a documentId (or null to detach) directly.
  if (input.savedProgression !== undefined) {
    data.savedProgression = input.savedProgression;
  }
  const result = await strapiFetch<StrapiLoop>(
    'PUT',
    `/api/loops/${input.documentId}`,
    { query: loopQuery, body: { data } },
  );
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export async function deleteLoopService(
  documentId: string,
): Promise<ServiceResult<void>> {
  const result = await strapiFetch<unknown>('DELETE', `/api/loops/${documentId}`);
  if (!result.ok && result.status !== 404) {
    return { success: false, error: result.error };
  }
  return { success: true, data: undefined };
}
