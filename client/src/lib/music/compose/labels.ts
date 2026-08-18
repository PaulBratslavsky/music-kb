// Progression Composer — triad labels. getDiatonicChords builds 4-note
// seventh chords (Cmaj7, G7, Am7, …), but the composer plays and thinks
// in plain triads, so the chips/bars need triad-level names + Roman
// numerals that match what's actually sounded. This derives them from a
// DiatonicChord's first three pitch classes.

import type { DiatonicChord } from '@music-kb/music/theory/diatonic';
import { PITCH_CLASSES } from '@music-kb/music/types';

const ROMAN_UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const ROMAN_LOWER = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

function semitones(a: string, b: string): number {
  const ai = PITCH_CLASSES.indexOf(a as never);
  const bi = PITCH_CLASSES.indexOf(b as never);
  return ((bi - ai) % 12 + 12) % 12;
}

/**
 * The scale degrees (1–7) that make up the chord on `degree`: the degree
 * itself plus a third and fifth stacked diatonically, and the seventh too
 * when `seventh` is set. E.g. I → [1,3,5] (or [1,3,5,7]); V → [5,7,2]
 * (or [5,7,2,4]); vi → [6,1,3].
 */
export function chordToneDegrees(degree: number, seventh = false): number[] {
  const i = degree - 1;
  const steps = seventh ? [0, 2, 4, 6] : [0, 2, 4];
  return steps.map((s) => ((i + s) % 7) + 1);
}

export type TriadLabel = { roman: string; name: string };

/** Triad-level Roman numeral + chord name for a diatonic chord. */
export function triadLabel(chord: DiatonicChord): TriadLabel {
  const [root, third, fifth] = chord.pitchClasses;
  const t = semitones(root, third);
  const f = semitones(root, fifth);
  const i = chord.degree - 1;
  const upper = ROMAN_UPPER[i];
  const lower = ROMAN_LOWER[i];

  // major
  if (t === 4 && f === 7) return { roman: upper, name: chord.rootDisplay };
  // minor
  if (t === 3 && f === 7) return { roman: lower, name: `${chord.rootDisplay}m` };
  // diminished
  if (t === 3 && f === 6)
    return { roman: `${lower}°`, name: `${chord.rootDisplay}°` };
  // augmented
  if (t === 4 && f === 8)
    return { roman: `${upper}+`, name: `${chord.rootDisplay}+` };
  // fallback — shouldn't happen for diatonic triads
  return { roman: upper, name: chord.rootDisplay };
}

/**
 * Seventh-chord label for a diatonic chord. getDiatonicChords already
 * analyses the four-note quality, so we reuse its Roman numeral
 * (e.g. "Imaj7", "V7", "viiø") and full chord name (e.g. "Cmaj7", "G7").
 */
export function seventhLabel(chord: DiatonicChord): TriadLabel {
  return { roman: chord.roman, name: chord.chordName };
}

/** Triad + seventh labels for a diatonic chord, keyed by `seventh`. */
export type DegreeLabel = { triad: TriadLabel; seventh: TriadLabel };

export function degreeLabel(chord: DiatonicChord): DegreeLabel {
  return { triad: triadLabel(chord), seventh: seventhLabel(chord) };
}
