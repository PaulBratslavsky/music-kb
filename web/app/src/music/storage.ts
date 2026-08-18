// localStorage-backed music library — no backend. Both collections are
// stored as a single JSON-encoded array each:
//   tv:videos → SavedVideo[]
//   tv:loops  → SavedLoop[]
//
// At personal scale (tens of videos, hundreds of loops) full-array
// rewrites on every change cost nothing. Per-record keys would only
// matter for multi-MB datasets we won't hit here.
//
// All reads are defensive: a corrupted JSON blob or absent key returns
// an empty array, never throws. Writes silently no-op when localStorage
// is unavailable (private windows, quota) — the caller can detect
// success by re-reading and checking for the new id.

import type { SavedLoop, SavedProgression, SavedVideo } from './types';

const VIDEOS_KEY = 'tv:videos';
const LOOPS_KEY = 'tv:loops';
const PROGRESSIONS_KEY = 'tv:progressions';

function safeReadArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function safeWriteArray<T>(key: string, value: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — silently ignore */
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for old browsers — collision risk is fine at personal scale.
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

export function listVideos(): SavedVideo[] {
  return safeReadArray<SavedVideo>(VIDEOS_KEY).sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
}

export function getVideo(id: string): SavedVideo | null {
  return safeReadArray<SavedVideo>(VIDEOS_KEY).find((v) => v.id === id) ?? null;
}

/** Add a new video. Caller supplies parsed metadata; this function
 *  assigns id + createdAt. Returns the persisted record. */
export function addVideo(
  input: Omit<SavedVideo, 'id' | 'createdAt'>,
): SavedVideo {
  const record: SavedVideo = {
    ...input,
    id: newId(),
    createdAt: new Date().toISOString(),
  };
  const all = safeReadArray<SavedVideo>(VIDEOS_KEY);
  safeWriteArray(VIDEOS_KEY, [record, ...all]);
  return record;
}

/** Update fields on an existing video — used by the manual-entry
 *  fallback when noembed didn't return a title. Silently no-ops if id
 *  doesn't exist. */
export function updateVideo(
  id: string,
  patch: Partial<Omit<SavedVideo, 'id' | 'createdAt'>>,
): SavedVideo | null {
  const all = safeReadArray<SavedVideo>(VIDEOS_KEY);
  const idx = all.findIndex((v) => v.id === id);
  if (idx === -1) return null;
  const next = { ...all[idx], ...patch };
  all[idx] = next;
  safeWriteArray(VIDEOS_KEY, all);
  return next;
}

/** Remove a video AND cascade-delete its loops. Returns true if a
 *  record was removed. */
export function deleteVideo(id: string): boolean {
  const videos = safeReadArray<SavedVideo>(VIDEOS_KEY);
  const filtered = videos.filter((v) => v.id !== id);
  if (filtered.length === videos.length) return false;
  safeWriteArray(VIDEOS_KEY, filtered);
  const loops = safeReadArray<SavedLoop>(LOOPS_KEY);
  safeWriteArray(LOOPS_KEY, loops.filter((l) => l.videoId !== id));
  const progressions = safeReadArray<SavedProgression>(PROGRESSIONS_KEY);
  safeWriteArray(
    PROGRESSIONS_KEY,
    progressions.filter((p) => p.videoId !== id),
  );
  return true;
}

// ---------------------------------------------------------------------------
// Loops
// ---------------------------------------------------------------------------

/** All loops for a given video, sorted by startSec ascending so a song
 *  reads top-to-bottom in playback order. */
export function loopsForVideo(videoId: string): SavedLoop[] {
  return safeReadArray<SavedLoop>(LOOPS_KEY)
    .filter((l) => l.videoId === videoId)
    .sort((a, b) => a.startSec - b.startSec);
}

export function getLoop(id: string): SavedLoop | null {
  return safeReadArray<SavedLoop>(LOOPS_KEY).find((l) => l.id === id) ?? null;
}

export function addLoop(
  input: Omit<SavedLoop, 'id' | 'createdAt'>,
): SavedLoop {
  const record: SavedLoop = {
    ...input,
    id: newId(),
    createdAt: new Date().toISOString(),
  };
  const all = safeReadArray<SavedLoop>(LOOPS_KEY);
  safeWriteArray(LOOPS_KEY, [...all, record]);
  return record;
}

/** Patch a loop — rename, retime, or link/unlink its progression. */
export function updateLoop(
  id: string,
  patch: Partial<Omit<SavedLoop, 'id' | 'videoId' | 'createdAt'>>,
): SavedLoop | null {
  const all = safeReadArray<SavedLoop>(LOOPS_KEY);
  const idx = all.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  const next = { ...all[idx], ...patch };
  all[idx] = next;
  safeWriteArray(LOOPS_KEY, all);
  return next;
}

export function deleteLoop(id: string): boolean {
  const all = safeReadArray<SavedLoop>(LOOPS_KEY);
  const filtered = all.filter((l) => l.id !== id);
  if (filtered.length === all.length) return false;
  safeWriteArray(LOOPS_KEY, filtered);
  return true;
}

// ---------------------------------------------------------------------------
// Progressions
// ---------------------------------------------------------------------------
// Scoped to a video: a section of one song should only be offered chords
// saved against that song. Newest first so a just-saved progression is at
// the top of the picker.

export function progressionsForVideo(videoId: string): SavedProgression[] {
  return safeReadArray<SavedProgression>(PROGRESSIONS_KEY)
    .filter((p) => p.videoId === videoId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getProgression(id: string): SavedProgression | null {
  return (
    safeReadArray<SavedProgression>(PROGRESSIONS_KEY).find((p) => p.id === id) ??
    null
  );
}

export function addProgression(
  input: Omit<SavedProgression, 'id' | 'createdAt'>,
): SavedProgression {
  const record: SavedProgression = {
    ...input,
    id: newId(),
    createdAt: new Date().toISOString(),
  };
  const all = safeReadArray<SavedProgression>(PROGRESSIONS_KEY);
  safeWriteArray(PROGRESSIONS_KEY, [record, ...all]);
  return record;
}

export function updateProgression(
  id: string,
  patch: Partial<Omit<SavedProgression, 'id' | 'videoId' | 'createdAt'>>,
): SavedProgression | null {
  const all = safeReadArray<SavedProgression>(PROGRESSIONS_KEY);
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const next = { ...all[idx], ...patch };
  all[idx] = next;
  safeWriteArray(PROGRESSIONS_KEY, all);
  return next;
}

/** Delete a progression and unlink it from any section that used it, so a
 *  section never points at an id that no longer exists. */
export function deleteProgression(id: string): boolean {
  const all = safeReadArray<SavedProgression>(PROGRESSIONS_KEY);
  const filtered = all.filter((p) => p.id !== id);
  if (filtered.length === all.length) return false;
  safeWriteArray(PROGRESSIONS_KEY, filtered);
  const loops = safeReadArray<SavedLoop>(LOOPS_KEY);
  safeWriteArray(
    LOOPS_KEY,
    loops.map((l) => (l.progressionId === id ? { ...l, progressionId: null } : l)),
  );
  return true;
}
