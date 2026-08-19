// Three-notes-per-string pattern generation.
//
// positions.ts covers the *box* systems (CAGED shapes + fret-window
// pentatonic boxes) because those are hand-curated fingerings transcribed
// from guitarscale.org. The 3NPS system needs no transcription — it's
// fully mechanical: walk the scale upward and put exactly three notes on
// each string. Generating it beats storing 7 × 18 hand-typed frets.
//
// Used by /lessons/scale-systems-on-the-neck to draw all seven patterns
// inline instead of deep-linking out to /builder for each one.

import type { PitchClass } from '../types';
import { PITCH_CLASSES } from '../types';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';

export type NeckPosition = { string: number; fret: number };

/**
 * The lowest fret at or above `minFret` on `stringMidi` that sounds `pc`.
 */
function lowestFretFor(
  stringMidi: number,
  pc: PitchClass,
  minFret: number,
): number {
  const target = PITCH_CLASSES.indexOf(pc);
  const openPc = ((stringMidi % 12) + 12) % 12;
  // Standard MIDI: pitch class 0 is C, and midi % 12 === 0 is also C, so the
  // two indexings line up directly.
  const offset = (target - openPc + 12) % 12;
  let fret = offset;
  while (fret < minFret) fret += 12;
  return fret;
}

/**
 * Realize one 3-notes-per-string pattern.
 *
 * `startDegree` is a 0-based index into `scalePcs` — pattern 1 starts on
 * the root (index 0), pattern 2 on the 2nd degree, and so on, matching the
 * conventional numbering where the pattern is named for the scale note it
 * begins on at the lowest string.
 *
 * Notes are assigned strictly in ascending pitch order, three per string,
 * from the lowest string upward. That's the definition of the system, and
 * it automatically produces the familiar +1 fret shift across the G→B
 * string pair (where the tuning gap is a major 3rd, not a perfect 4th).
 */
export function threeNotesPerString(
  scalePcs: PitchClass[],
  startDegree: number,
  opts: { tuning?: number[]; minFret?: number } = {},
): NeckPosition[] {
  const tuning = opts.tuning ?? STANDARD_TUNING_MIDI;
  const minFret = opts.minFret ?? 1;
  if (scalePcs.length === 0) return [];

  const stringCount = tuning.length;
  // tuning is indexed highest-pitch-first; walk it in reverse.
  const lowestString = stringCount - 1;

  const startPc = scalePcs[startDegree % scalePcs.length];
  const startFret = lowestFretFor(tuning[lowestString], startPc, minFret);
  let midi = tuning[lowestString] + startFret;
  let degree = startDegree % scalePcs.length;

  const out: NeckPosition[] = [];
  for (let i = 0; i < stringCount; i++) {
    const stringIdx = lowestString - i;
    for (let n = 0; n < 3; n++) {
      out.push({ string: stringIdx, fret: midi - tuning[stringIdx] });
      // Advance to the next scale tone above the current one.
      const nextDegree = (degree + 1) % scalePcs.length;
      const step =
        (PITCH_CLASSES.indexOf(scalePcs[nextDegree]) -
          PITCH_CLASSES.indexOf(scalePcs[degree]) +
          12) %
        12;
      midi += step === 0 ? 12 : step;
      degree = nextDegree;
    }
  }
  return out;
}
