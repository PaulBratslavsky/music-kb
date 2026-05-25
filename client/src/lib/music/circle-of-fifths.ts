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
// half uses Db/Ab/Eb/Bb conventions).
export const CIRCLE_MAJOR_DISPLAY = [
  'C', 'G', 'D', 'A', 'E', 'B',
  'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F',
] as const;

export const CIRCLE_MINOR_DISPLAY = [
  'Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m',
  'D♯m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm',
] as const;

/** Diatonic chord positions for the major-key tonic at the given circle index. */
export function diatonicPositions(tonicIdx: number) {
  const mod = (n: number) => ((n % 12) + 12) % 12;
  return {
    I: { idx: tonicIdx, ring: 'outer' as const, numeral: 'I' },
    IV: { idx: mod(tonicIdx - 1), ring: 'outer' as const, numeral: 'IV' },
    V: { idx: mod(tonicIdx + 1), ring: 'outer' as const, numeral: 'V' },
    ii: { idx: mod(tonicIdx - 1), ring: 'inner' as const, numeral: 'ii' },
    iii: { idx: mod(tonicIdx + 1), ring: 'inner' as const, numeral: 'iii' },
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
