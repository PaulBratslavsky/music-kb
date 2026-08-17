import type { ChordQuality, PitchClass } from '../types';

// Music feature data model — saved on the client in localStorage. Both
// types carry their own `id` (generated client-side via crypto.randomUUID)
// so they're stable across renames and recoverable on import/export.

export type SavedVideo = {
  id: string;
  /** The pasted URL the user provided. Kept verbatim for re-share / export. */
  url: string;
  /** Parsed out of the URL up-front so we never need to re-parse on load. */
  youtubeVideoId: string;
  title: string;
  author: string;
  /** YouTube thumbnail. Either the noembed-returned URL or the
   *  convention `i.ytimg.com/vi/<id>/hqdefault.jpg` fallback. */
  thumbnailUrl: string;
  /** ISO timestamp. Useful for sorting by recency. */
  createdAt: string;
};

export type SavedLoop = {
  id: string;
  /** Foreign-key to SavedVideo.id. */
  videoId: string;
  /** User-supplied label — required at save time, renameable after. */
  label: string;
  startSec: number;
  endSec: number;
  createdAt: string;
  /**
   * Foreign-key to SavedProgression.id, or null/absent when the section
   * has no chords yet. A section LINKS to a progression rather than owning
   * one, so the same progression can back several sections (verse 1 /
   * verse 2) and editing it updates all of them.
   */
  progressionId?: string | null;
  /**
   * Length of this section in bars. Chord timing divides the section by
   * bars rather than by chord count, so a 4-chord progression over an
   * 8-bar section cycles twice instead of stretching each chord to double
   * length. Absent = fall back to one equal slice per chord.
   */
  bars?: number | null;
  /**
   * The scale to play over this section, chosen by the user. Absent means
   * "work it out" — the scale panel infers one from the progression's own
   * chords instead. Mirrors music-kb's Loop.key so the two apps store the
   * same thing under the same name.
   */
  key?: { root: string; type: string } | null;
};

/**
 * One chord in a saved progression. The full selection is kept —
 * `inversion` and `voicingIndex` pin the exact on-screen shape, so a
 * progression redraws the same diagram it was built with rather than
 * being re-voiced to some default.
 */
export type ProgressionChord = {
  root: PitchClass;
  quality: ChordQuality;
  inversion?: number;
  voicingIndex?: number;
  /**
   * Exact tapped `${string}-${fret}` positions, set only for chords
   * captured with Detect chord. A detected shape is whatever the user
   * actually fretted — it may not correspond to any generated voicing, so
   * it has to be stored verbatim or it would be redrawn as something else.
   */
  positions?: string[];
  /**
   * Pitch classes actually played, set only for chords captured with
   * Detect chord on the KEYBOARD. `positions` is a fretboard concept and
   * doesn't apply there, but the mini keyboard still needs to light what
   * was played rather than the theoretical tones of root + quality.
   */
  pitchClasses?: PitchClass[];
  /**
   * tonal's name for a detected shape (e.g. "Cmaj7/E"). Root + quality is
   * only a fallback for shapes that map onto a known quality.
   */
  detectedLabel?: string;
};

export type SavedProgression = {
  id: string;
  /** Foreign-key to SavedVideo.id — progressions are scoped to a song. */
  videoId: string;
  /** User-supplied name shown in the picker and saved list. */
  name: string;
  chords: ProgressionChord[];
  createdAt: string;
};
