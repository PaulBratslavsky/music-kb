// Power chords as SHAPES, not as pitch-class sets.
//
// A power chord is a grip: the root, and the fifth two frets up on the next
// string. Treating it as "every root and fifth in this box" scatters it
// across the neck and loses the one thing that makes it a power chord — the
// hand position you can slide anywhere.
//
// The exception that makes this worth its own module: standard tuning is
// all perfect fourths EXCEPT G→B, which is a major third. A fifth is 7
// semitones, so the fret offset to the next string is 7 - (that string
// gap): +2 across the fourths, +3 across G→B. Get that wrong and every
// shape rooted on the G string is a semitone flat.

import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';

export type GripPosition = { string: number; fret: number };

/** Semitone gap from `string` to the next string up in pitch (lower index). */
function stringGap(string: number): number | null {
  if (string <= 0) return null; // already the highest string
  return STANDARD_TUNING_MIDI[string - 1] - STANDARD_TUNING_MIDI[string];
}

/**
 * The fret offset that lands `semitones` above a root, one string up.
 * +2 across a perfect-fourth pair, +3 across G→B.
 */
export function offsetToNextString(string: number, semitones = 7): number | null {
  const gap = stringGap(string);
  return gap == null ? null : semitones - gap;
}

/**
 * The two-note power-chord grip rooted at (string, fret).
 *
 * Returns null when it can't be played: no string above the root, or the
 * fifth would land off the neck. `semitones` lets a diminished degree ask
 * for its FLAT fifth (6) — that is deliberately not the standard shape,
 * which is exactly why it's worth drawing differently.
 */
export function powerChordGrip(
  string: number,
  fret: number,
  maxFret = 22,
  semitones = 7,
): GripPosition[] | null {
  const offset = offsetToNextString(string, semitones);
  if (offset == null) return null;
  const fifthFret = fret + offset;
  if (fifthFret < 0 || fifthFret > maxFret) return null;
  return [
    { string, fret },
    { string: string - 1, fret: fifthFret },
  ];
}

/**
 * The fret offset that lands `semitones` above a root, `up` strings higher.
 * Sums the tuning gaps in between, so it picks up the G→B major third
 * wherever the shape crosses it.
 */
export function offsetAcrossStrings(
  string: number,
  up: number,
  semitones: number,
): number | null {
  let gaps = 0;
  for (let i = 0; i < up; i += 1) {
    const g = stringGap(string - i);
    if (g == null) return null;
    gaps += g;
  }
  return semitones - gaps;
}

/**
 * A chord grip: one note per string, on consecutive strings, rooted at
 * (string, fret). `intervals` are semitones above the root — [0,4,7] for a
 * major triad, [0,7] for a power chord — so a triad is the same idea as a
 * power chord with one more string.
 *
 * Returns null when the shape doesn't fit: not enough strings above the
 * root, or a note lands off the neck. Nothing is clipped or nudged, because
 * a grip that has been adjusted to fit is a different grip.
 */
export function chordGrip(
  string: number,
  fret: number,
  intervals: readonly number[],
  maxFret = 22,
): GripPosition[] | null {
  const out: GripPosition[] = [];
  for (let i = 0; i < intervals.length; i += 1) {
    const offset = i === 0 ? 0 : offsetAcrossStrings(string, i, intervals[i]);
    if (offset == null) return null;
    const s = string - i;
    const f = fret + offset;
    if (s < 0 || f < 0 || f > maxFret) return null;
    out.push({ string: s, fret: f });
  }
  return out;
}

/** Every playable grip of `intervals` rooted on `rootPositions`. */
export function chordGrips(
  rootPositions: readonly GripPosition[],
  intervals: readonly number[],
  maxFret = 22,
): GripPosition[][] {
  const out: GripPosition[][] = [];
  for (const p of rootPositions) {
    const grip = chordGrip(p.string, p.fret, intervals, maxFret);
    if (grip) out.push(grip);
  }
  return out;
}

/**
 * Every playable power-chord grip for `rootPositions`.
 *
 * The fifth is allowed to sit outside whatever box the roots came from: the
 * grip is a fixed shape, and clipping it to a fret window would draw a
 * power chord that isn't one.
 */
export function powerChordGrips(
  rootPositions: readonly GripPosition[],
  maxFret = 22,
  semitones = 7,
): GripPosition[][] {
  const out: GripPosition[][] = [];
  for (const p of rootPositions) {
    const grip = powerChordGrip(p.string, p.fret, maxFret, semitones);
    if (grip) out.push(grip);
  }
  return out;
}
