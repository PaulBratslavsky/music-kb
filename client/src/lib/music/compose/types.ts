// Progression Composer — data model.
//
// A Composition is a fixed 8-bar sketch expressed entirely in *scale
// degrees* relative to a key. Because nothing stores absolute pitches,
// changing `key` transposes the whole piece for free.
//
// Time is measured in TICKS at sixteenth-note resolution:
//   - 4 ticks per beat, 4 beats per bar  → 16 ticks/bar
//   - 8 bars                             → 128 ticks total
// Chords and melody/bass notes are all variable-length time spans on
// this grid, so a note can be a sixteenth, a quarter, a whole bar, etc.

import type { PitchClass } from '@music-kb/music/types';

export const TICKS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const BARS = 8;
export const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR; // 16
export const TOTAL_TICKS = BARS * TICKS_PER_BAR; // 128

export type KeyMode = 'major' | 'minor';

/** A diatonic scale degree, 1 through 7. */
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Any object that occupies a run of ticks on the timeline. */
export type TimeSpan = {
  id: string;
  /** Tick index where it begins, 0..TOTAL_TICKS-1. */
  start: number;
  /** Duration in ticks, >= 1. */
  length: number;
};

/** A chord placed on the timeline: a diatonic degree over a run of ticks.
 *  `seventh` extends the diatonic triad to its four-note seventh chord
 *  (Imaj7, iim7, V7, viiø …) — quality is still derived from the key, so
 *  the piece transposes for free either way. */
export type ChordSpan = TimeSpan & {
  degree: Degree;
  seventh: boolean;
};

/** A monophonic melody/bass note: a degree (+ octave band) over a run of ticks. */
export type NoteSpan = TimeSpan & {
  degree: Degree;
  /** 0 = base octave, 1 = one octave up. Bass always uses 0. */
  octave: 0 | 1;
};

/**
 * Persisted-shape version. Bump when the Composition layout changes in a
 * way that old saved rows can't be read as-is, and add a migration
 * branch in compose/schema.ts → parseStoredComposition. (History: v1 is
 * the tick-based model; the earlier beats-based shape predates this
 * Strapi content type, so there are no v0 rows to migrate.)
 *
 * v2 adds `seventh` to ChordSpan; v1 rows are migrated by defaulting it
 * to false (triad) in compose/schema.ts → parseStoredComposition.
 */
export const SCHEMA_VERSION = 2;

export type Composition = {
  id: string;
  /** Persisted-shape version; see SCHEMA_VERSION. */
  version: number;
  name: string;
  key: { root: PitchClass; mode: KeyMode };
  /** Quarter-note tempo, 60–180. */
  bpm: number;
  /** Variable-length chord blocks across the 128-tick (8-bar) timeline. */
  chords: ChordSpan[];
  /** Monophonic melody notes. */
  melody: NoteSpan[];
  /** Monophonic bass notes. */
  bass: NoteSpan[];
};

/** Selectable note durations, in ticks. */
export const DURATIONS: Array<{ label: string; ticks: number }> = [
  { label: '1/16', ticks: 1 },
  { label: '1/8', ticks: 2 },
  { label: '1/4', ticks: 4 },
  { label: '1/2', ticks: 8 },
  { label: 'bar', ticks: TICKS_PER_BAR },
];

/** Default new-chord length: one bar. */
export const DEFAULT_CHORD_TICKS = TICKS_PER_BAR;
/** Default tempo for a fresh sketch. */
export const DEFAULT_BPM = 100;

/** An empty 8-bar composition in the given key. */
export function emptyComposition(
  id: string,
  name = 'Untitled',
  root: PitchClass = 'C',
  mode: KeyMode = 'major',
): Composition {
  return {
    id,
    version: SCHEMA_VERSION,
    name,
    key: { root, mode },
    bpm: DEFAULT_BPM,
    chords: [],
    melody: [],
    bass: [],
  };
}
