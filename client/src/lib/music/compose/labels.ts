// Progression Composer — triad labels. getDiatonicChords builds 4-note
// seventh chords (Cmaj7, G7, Am7, …), but the composer plays and thinks
// in plain triads, so the chips/bars need triad-level names + Roman
// numerals that match what's actually sounded. This derives them from a
// DiatonicChord's first three pitch classes.

import type { DiatonicChord } from '../theory/diatonic';
import { PITCH_CLASSES } from '../types';

const ROMAN_UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const ROMAN_LOWER = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

function semitones(a: string, b: string): number {
  const ai = PITCH_CLASSES.indexOf(a as never);
  const bi = PITCH_CLASSES.indexOf(b as never);
  return ((bi - ai) % 12 + 12) % 12;
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
