// Interval calculator helpers — pure functions for naming intervals by
// semitone distance, computing inversions, and listing well-known chord
// uses for each interval.
//
// Within an octave (0..12 semitones), there's one canonical name per
// interval, with the augmented-4th / diminished-5th pair sharing the
// name "tritone" since both spell the same set of notes. Distinguishing
// the two requires the actual note letters, which we don't track here.

import type { PitchClass } from '@music-kb/music/types';
import { PITCH_CLASSES } from '@music-kb/music/types';

export type Interval = {
  /** Semitones from low to high, in [0, 12]. */
  semitones: number;
  /** Short label, e.g. "M3", "P5", "TT". */
  short: string;
  /** Long label, e.g. "Major 3rd". */
  long: string;
  /** Quality, useful for filtering (perfect / major / minor / tritone). */
  quality: 'perfect' | 'major' | 'minor' | 'tritone';
  /** One-line example of where this interval shows up in common music. */
  example: string;
};

const INTERVAL_TABLE: Interval[] = [
  { semitones: 0,  short: 'P1', long: 'Perfect Unison',         quality: 'perfect', example: 'Two voices on the same note (unison).' },
  { semitones: 1,  short: 'm2', long: 'Minor 2nd',              quality: 'minor',   example: 'The "Jaws" theme; half-step tension.' },
  { semitones: 2,  short: 'M2', long: 'Major 2nd',              quality: 'major',   example: 'First two notes of "Happy Birthday".' },
  { semitones: 3,  short: 'm3', long: 'Minor 3rd',              quality: 'minor',   example: 'Defines minor chords (C → E♭).' },
  { semitones: 4,  short: 'M3', long: 'Major 3rd',              quality: 'major',   example: 'Defines major chords (C → E).' },
  { semitones: 5,  short: 'P4', long: 'Perfect 4th',            quality: 'perfect', example: '"Here Comes the Bride"; root → 4th.' },
  { semitones: 6,  short: 'TT', long: 'Tritone (♯4 / ♭5)',      quality: 'tritone', example: 'The dissonance in V7 chords (B → F in G7).' },
  { semitones: 7,  short: 'P5', long: 'Perfect 5th',            quality: 'perfect', example: '"Twinkle Twinkle"; the most stable interval after the octave.' },
  { semitones: 8,  short: 'm6', long: 'Minor 6th',              quality: 'minor',   example: 'Wistful, common in minor-key melodies.' },
  { semitones: 9,  short: 'M6', long: 'Major 6th',              quality: 'major',   example: '"My Bonnie Lies Over the Ocean".' },
  { semitones: 10, short: 'm7', long: 'Minor 7th',              quality: 'minor',   example: 'The 7th of a dominant 7 chord (G → F in G7).' },
  { semitones: 11, short: 'M7', long: 'Major 7th',              quality: 'major',   example: 'The 7th of a maj7 chord (C → B in Cmaj7).' },
  { semitones: 12, short: 'P8', long: 'Perfect Octave',         quality: 'perfect', example: 'The same note an octave apart; the most consonant interval.' },
];

/** Look up the interval that corresponds to `semitones` semitones. */
export function intervalFromSemitones(semitones: number): Interval {
  const s = Math.max(0, Math.min(12, Math.abs(semitones)));
  return INTERVAL_TABLE[s];
}

/** Compute the semitone distance between two pitch classes, low→high. */
export function semitonesBetween(a: PitchClass, b: PitchClass): number {
  const ai = PITCH_CLASSES.indexOf(a);
  const bi = PITCH_CLASSES.indexOf(b);
  return ((bi - ai) % 12 + 12) % 12;
}

/** The "complementary" interval that sums to 12 with this one. P5 inverts
 *  to P4, M3 inverts to m6, etc. P1 inverts to P8; tritone inverts to itself. */
export function invertInterval(interval: Interval): Interval {
  return intervalFromSemitones(12 - interval.semitones);
}
