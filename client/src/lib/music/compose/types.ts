// Progression Composer — data model.
//
// A Composition is a fixed 8-bar sketch expressed entirely in *scale
// degrees* relative to a key. Because nothing stores absolute pitches,
// changing `key` transposes the whole piece for free — that's the
// central design property the rest of the feature leans on.
//
// Time model (locked in during planning):
//   - 8 bars, one chord slot per bar          → chords.length === BARS
//   - 4 beats per bar, melody/bass per beat    → 32 steps total
//   - melody + bass are monophonic (one note per step, or null)
//
// Degrees are 1..7 (diatonic). Melody spans two octaves via the
// `octave` offset (0 = base, 1 = one octave up); bass is single-octave
// so its cells always carry octave 0.

import type { PitchClass } from '../types';

export const BARS = 8;
export const BEATS_PER_BAR = 4;
export const TOTAL_STEPS = BARS * BEATS_PER_BAR; // 32

export type KeyMode = 'major' | 'minor';

/** A diatonic scale degree, 1 through 7. */
export type Degree = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One placed melody/bass note: a degree plus which octave band it sits in. */
export type DegreeCell = {
  degree: Degree;
  /** 0 = base octave, 1 = one octave up. Bass always uses 0. */
  octave: 0 | 1;
};

/**
 * A chord placed on the timeline: a diatonic degree occupying a run of
 * beats. Spans never overlap and `start + length <= TOTAL_STEPS`. They
 * can be dragged (move `start`) and resized (`length`), so the chord
 * track is a list of these rather than a fixed per-bar array.
 */
export type ChordSpan = {
  id: string;
  degree: Degree;
  /** Beat index where the chord begins, 0..TOTAL_STEPS-1. */
  start: number;
  /** Duration in beats, >= 1. */
  length: number;
};

export type Composition = {
  id: string;
  name: string;
  key: { root: PitchClass; mode: KeyMode };
  /** Quarter-note tempo, 60–180. */
  bpm: number;
  /** Variable-length chord blocks across the 32-beat (8-bar) timeline. */
  chords: ChordSpan[];
  /** One cell per beat (length TOTAL_STEPS); null = rest. */
  melody: (DegreeCell | null)[];
  /** One cell per beat (length TOTAL_STEPS); null = rest. */
  bass: (DegreeCell | null)[];
};

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
    name,
    key: { root, mode },
    bpm: DEFAULT_BPM,
    chords: [],
    melody: Array.from({ length: TOTAL_STEPS }, () => null),
    bass: Array.from({ length: TOTAL_STEPS }, () => null),
  };
}
