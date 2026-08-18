// Triads as playable shapes: one string set, one inversion at a time.
//
// A triad has three notes, so on guitar it lives on three adjacent strings
// — a "string set" — and comes in three inversions depending on which note
// is lowest. That grid (set x inversion) is how triads are actually taught
// and practised, and it's what a cheat-sheet poster lays out.
//
// The interval formula is the only thing that changes between qualities,
// which is why one generator covers all four:
//   major R-3-5 · minor R-b3-5 · augmented R-3-#5 · diminished R-b3-b5
//
// Generated rather than transcribed because, unlike the scale boxes, a
// triad shape IS mechanical once you know the string set and inversion —
// there are no fingering choices to preserve.

import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { PITCH_CLASSES, type PitchClass } from '../types';

export type TriadQuality = 'major' | 'minor' | 'augmented' | 'diminished';

/** Semitones above the root. Straight from the poster's formulas. */
export const TRIAD_INTERVALS: Record<TriadQuality, [number, number, number]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  augmented: [0, 4, 8],
  diminished: [0, 3, 6],
};

export const TRIAD_FORMULA: Record<TriadQuality, string> = {
  major: 'R - 3 - 5',
  minor: 'R - ♭3 - 5',
  augmented: 'R - 3 - ♯5',
  diminished: 'R - ♭3 - ♭5',
};

/** Role names in the same order as TRIAD_INTERVALS. */
export const TRIAD_ROLES: Record<TriadQuality, [string, string, string]> = {
  major: ['R', '3', '5'],
  minor: ['R', '♭3', '5'],
  augmented: ['R', '3', '♯5'],
  diminished: ['R', '♭3', '♭5'],
};

/**
 * The playable three-string sets, highest-sounding first. String 0 is the
 * high e, so a set is [high, middle, low] by index.
 *
 * Only adjacent sets: a triad you have to skip a string for isn't the
 * shape anyone practises.
 */
export const STRING_SETS = [
  { name: 'e–B–G', strings: [0, 1, 2] as const },
  { name: 'B–G–D', strings: [1, 2, 3] as const },
  { name: 'G–D–A', strings: [2, 3, 4] as const },
  { name: 'D–A–E', strings: [3, 4, 5] as const },
];

export type Inversion = 0 | 1 | 2;

export const INVERSION_NAME: Record<Inversion, string> = {
  0: 'Root position',
  1: '1st inversion',
  2: '2nd inversion',
};

export type TriadVoicing = {
  /** One per string in the set, ordered low string → high string. */
  notes: { string: number; fret: number; pc: PitchClass; role: string }[];
  lowestFret: number;
  /** How many frets the shape spans — a stretch over 4 is a warning sign. */
  span: number;
};

/**
 * Build one triad shape.
 *
 * `inversion` rotates which chord tone is lowest: 0 puts the root on the
 * lowest string of the set, 1 the third, 2 the fifth. Each higher string
 * then takes the next tone up, at the lowest fret that is actually higher
 * in pitch — which is what makes it a CLOSED voicing rather than three
 * notes that merely belong to the chord.
 *
 * Returns null when the shape can't be closed within `maxFret`.
 */
export function triadVoicing(
  root: PitchClass,
  quality: TriadQuality,
  set: (typeof STRING_SETS)[number],
  inversion: Inversion,
  maxFret = 15,
): TriadVoicing | null {
  const intervals = TRIAD_INTERVALS[quality];
  const roles = TRIAD_ROLES[quality];
  const rootIdx = PITCH_CLASSES.indexOf(root);

  // Rotate so the chosen tone is lowest, keeping ascending pitch order.
  const order = [0, 1, 2].map((i) => (i + inversion) % 3);

  // Strings low → high (the set lists them high-first).
  const strings = [...set.strings].reverse();

  // Try every octave placement of the lowest note and keep the most
  // compact result. Always starting the lowest note at its first available
  // fret is wrong: if that fret is high, the notes above it get pushed an
  // octave up and the "shape" spans half the neck. A closed triad is a
  // hand position, so the compact one is the real answer.
  let best: TriadVoicing | null = null;

  for (let start = 0; start < 12; start += 1) {
    const notes: TriadVoicing['notes'] = [];
    let prevMidi = -Infinity;
    let ok = true;

    for (let i = 0; i < 3; i += 1) {
      const which = order[i];
      const pc = PITCH_CLASSES[(rootIdx + intervals[which]) % 12];
      const open = STANDARD_TUNING_MIDI[strings[i]];
      let fret = (((PITCH_CLASSES.indexOf(pc) - (open % 12)) % 12) + 12) % 12;
      if (i === 0) {
        fret += start >= fret ? 0 : 0; // the loop below does the lifting
        while (fret < start) fret += 12;
      } else {
        while (open + fret <= prevMidi) fret += 12;
      }
      if (fret > maxFret) { ok = false; break; }
      prevMidi = open + fret;
      notes.push({ string: strings[i], fret, pc, role: roles[which] });
    }
    if (!ok) continue;

    const frets = notes.map((n) => n.fret);
    const candidate: TriadVoicing = {
      notes,
      lowestFret: Math.min(...frets),
      span: Math.max(...frets) - Math.min(...frets) + 1,
    };
    if (!best || candidate.span < best.span) best = candidate;
    if (best.span <= 4) break; // good enough; a triad never needs more
  }

  return best;
}
