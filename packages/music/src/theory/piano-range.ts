// Fit a keyboard window to a voicing.
//
// A picture that lights PITCH CLASSES cannot tell Gm from Gm/D: the two have
// the identical pitch-class set, and the only thing separating them is which
// note sits at the BOTTOM. Drawing an inversion therefore needs absolute
// pitch — and absolute pitch needs a board that starts low enough to hold
// the bass. Em/B voiced B3-E4-G4-B4 on a board starting at C4 has nowhere to
// put B3, so it wraps to B4 and lands to the RIGHT of E4, reading as though
// E were the bass. The board has to move, not the note.
//
// The rule: start on the C at or below the lowest note, and span enough
// octaves to reach the highest.

export type PianoRange = {
  /** MIDI note of the leftmost key. Always a C. */
  baseMidi: number;
  octaves: number;
};

export type FitPianoRangeOptions = {
  /**
   * Smallest board to draw. The interactive pickers pass 2, so a closed
   * triad still has neighbouring keys around it for context. A chord card
   * passes 1, where a second octave is dead space that halves the key width
   * and buys nothing.
   */
  minOctaves?: number;
};

export function fitPianoRange(
  midis: number[],
  opts: FitPianoRangeOptions = {},
): PianoRange {
  const minOctaves = opts.minOctaves ?? 2;
  // Nothing to fit — centre on middle C rather than returning a zero-width
  // board the caller has to special-case.
  if (midis.length === 0) return { baseMidi: 60, octaves: minOctaves };
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  const baseMidi = Math.floor(lo / 12) * 12;
  return {
    baseMidi,
    octaves: Math.max(minOctaves, Math.ceil((hi - baseMidi + 1) / 12)),
  };
}
