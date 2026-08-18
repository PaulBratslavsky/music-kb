// Circle of Fifths data + helpers.
//
// Standard clockwise layout starting at 12 o'clock = C major. Each step
// clockwise is a perfect fifth up. The inner ring holds the relative minor
// of each major (a minor third below).
//
// The diatonic chord positions for a major key tonic at index P:
//   I    = outer[P]
//   V    = outer[P+1]
//   IV   = outer[P-1]
//   vi   = inner[P]            (relative minor)
//   iii  = inner[P+1]
//   ii   = inner[P-1]
//   vii° = outer[P+5]          (the "leading-tone diminished")
//
// The first six form a 2×3 cluster on the wheel; vii° sits across at the
// bottom. This neighborhood is the visual payoff of the circle — it makes
// "the IV-V-vi-I family" something you can see at a glance.

import type { PitchClass } from '../types';

export const CIRCLE_MAJORS = [
  'C',  // 0  — 12 o'clock
  'G',  // 1
  'D',  // 2
  'A',  // 3
  'E',  // 4
  'B',  // 5
  'F#', // 6  — 6 o'clock
  'C#', // 7  (enharmonic Db)
  'G#', // 8  (enharmonic Ab)
  'D#', // 9  (enharmonic Eb)
  'A#', // 10 (enharmonic Bb)
  'F',  // 11
] as const;

// Standard enharmonic spellings used on a printed circle. Sharp-side gets
// shown sharp (G has F#, not Gb); flat-side gets shown flat (the bottom
// half uses Db/Ab/Eb/Bb conventions). The all-sharp and all-flat arrays
// below let the user override to a single style — guitarists often think
// in sharps (C# minor barre), horn arrangers in flats (Eb concert).
export const CIRCLE_MAJOR_DISPLAY = [
  'C', 'G', 'D', 'A', 'E', 'B',
  'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F',
] as const;

export const CIRCLE_MINOR_DISPLAY = [
  'Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m',
  'D♯m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm',
] as const;

export const CIRCLE_MAJOR_DISPLAY_SHARP = [
  'C', 'G', 'D', 'A', 'E', 'B',
  'F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'F',
] as const;

export const CIRCLE_MINOR_DISPLAY_SHARP = [
  'Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m',
  'D♯m', 'A♯m', 'Fm', 'Cm', 'Gm', 'Dm',
] as const;

export const CIRCLE_MAJOR_DISPLAY_FLAT = [
  'C', 'G', 'D', 'A', 'E', 'B',
  'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F',
] as const;

export const CIRCLE_MINOR_DISPLAY_FLAT = [
  'Am', 'Em', 'Bm', 'G♭m', 'D♭m', 'A♭m',
  'E♭m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm',
] as const;

export type Enharmonic = 'standard' | 'sharps' | 'flats';

/** Direction the wheel proceeds when read clockwise.
 *  - 'fifths' (default): each step CW is a perfect fifth up (C → G → D → ...).
 *    The Roman-numeral V sits at +1, IV at -1 — the standard layout.
 *  - 'fourths': mirror image; each step CW is a perfect fourth up
 *    (C → F → B♭ → ...). V is at -1, IV at +1. More guitar-friendly:
 *    matches how the strings are tuned (E-A-D-G is three fourths in a row). */
export type CircleDirection = 'fifths' | 'fourths';

// In fourths direction the array is the fifths array reversed, except C stays
// at index 0. fourths[i] === fifths[(12 - i) % 12].
function fourthsView<T>(arr: readonly T[]): T[] {
  return arr.map((_, i) => arr[(12 - i) % 12]);
}

export function majorDisplay(
  idx: number,
  mode: Enharmonic = 'standard',
  direction: CircleDirection = 'fifths',
): string {
  const base =
    mode === 'sharps'
      ? CIRCLE_MAJOR_DISPLAY_SHARP
      : mode === 'flats'
        ? CIRCLE_MAJOR_DISPLAY_FLAT
        : CIRCLE_MAJOR_DISPLAY;
  const arr = direction === 'fourths' ? fourthsView(base) : base;
  return arr[idx];
}

export function minorDisplay(
  idx: number,
  mode: Enharmonic = 'standard',
  direction: CircleDirection = 'fifths',
): string {
  const base =
    mode === 'sharps'
      ? CIRCLE_MINOR_DISPLAY_SHARP
      : mode === 'flats'
        ? CIRCLE_MINOR_DISPLAY_FLAT
        : CIRCLE_MINOR_DISPLAY;
  const arr = direction === 'fourths' ? fourthsView(base) : base;
  return arr[idx];
}

/** Pitch class (used by deep-link builders + click-to-play synth dispatch)
 *  at a given wheel index. CIRCLE_MAJORS uses the sharp-side spelling
 *  internally, which is exactly the PitchClass enum, so the cast is safe. */
export function majorKeyAt(
  idx: number,
  direction: CircleDirection = 'fifths',
): PitchClass {
  const arr = direction === 'fourths' ? fourthsView(CIRCLE_MAJORS) : CIRCLE_MAJORS;
  return arr[idx] as PitchClass;
}

export type KeyMode = 'major' | 'minor';

/** Diatonic chord positions for the tonic at the given circle index.
 *  In major mode the tonic sits on the outer ring; in minor mode it
 *  sits on the inner ring. The same 6 wedges light up either way (a
 *  major key and its relative minor share their diatonic chord set);
 *  only the Roman-numeral labels + which wedge is "I/i" change.
 *
 *  In fourths direction the wheel is mirrored, so what was +1 (V in
 *  fifths) becomes IV, and what was -1 (IV) becomes V. The wedges still
 *  cluster the same way — only the labels flip on the two adjacent
 *  outer wedges (and on iii/ii on the inner ring). */
export function diatonicPositions(
  tonicIdx: number,
  mode: KeyMode = 'major',
  direction: CircleDirection = 'fifths',
) {
  const mod = (n: number) => ((n % 12) + 12) % 12;
  // The +1/-1 wedges encode V/IV; in fourths direction the assignment swaps.
  const upFifth = direction === 'fifths' ? mod(tonicIdx + 1) : mod(tonicIdx - 1);
  const upFourth = direction === 'fifths' ? mod(tonicIdx - 1) : mod(tonicIdx + 1);
  if (mode === 'minor') {
    // Natural minor: iv on the up-fourth wedge, v on the up-fifth wedge
    // (relative to fifths direction; swaps in fourths direction).
    return {
      i: { idx: tonicIdx, ring: 'inner' as const, numeral: 'i' },
      iv: { idx: upFourth, ring: 'inner' as const, numeral: 'iv' },
      v: { idx: upFifth, ring: 'inner' as const, numeral: 'v' },
      III: { idx: tonicIdx, ring: 'outer' as const, numeral: 'III' },
      VI: { idx: upFourth, ring: 'outer' as const, numeral: 'VI' },
      VII: { idx: upFifth, ring: 'outer' as const, numeral: 'VII' },
      iiDim: { idx: mod(tonicIdx + 5), ring: 'outer' as const, numeral: 'ii°' },
    };
  }
  return {
    I: { idx: tonicIdx, ring: 'outer' as const, numeral: 'I' },
    IV: { idx: upFourth, ring: 'outer' as const, numeral: 'IV' },
    V: { idx: upFifth, ring: 'outer' as const, numeral: 'V' },
    ii: { idx: upFourth, ring: 'inner' as const, numeral: 'ii' },
    iii: { idx: upFifth, ring: 'inner' as const, numeral: 'iii' },
    vi: { idx: tonicIdx, ring: 'inner' as const, numeral: 'vi' },
    viiDim: { idx: mod(tonicIdx + 5), ring: 'outer' as const, numeral: 'vii°' },
  };
}

/** Returns the sharp/flat count for a major key (negative = flats). */
export function keySignatureCount(tonicIdx: number): number {
  // Sharp side: C=0, G=+1, D=+2, A=+3, E=+4, B=+5, F#=+6
  // Flat side: F=-1, Bb=-2, Eb=-3, Ab=-4, Db=-5, Gb=-6
  if (tonicIdx <= 6) return tonicIdx;
  return tonicIdx - 12;
}

/** Human-readable key signature label, e.g. "1 sharp (F♯)", "3 flats (B♭ E♭ A♭)". */
export function keySignatureLabel(tonicIdx: number): string {
  const n = keySignatureCount(tonicIdx);
  if (n === 0) return 'No sharps or flats';
  const SHARPS = ['F♯', 'C♯', 'G♯', 'D♯', 'A♯', 'E♯', 'B♯'];
  const FLATS = ['B♭', 'E♭', 'A♭', 'D♭', 'G♭', 'C♭', 'F♭'];
  if (n > 0) {
    return `${n} sharp${n === 1 ? '' : 's'} (${SHARPS.slice(0, n).join(' ')})`;
  }
  const k = -n;
  return `${k} flat${k === 1 ? '' : 's'} (${FLATS.slice(0, k).join(' ')})`;
}
