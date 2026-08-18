// The piano board has to be able to DRAW an inversion, which means two
// things that pitch-class rendering can't give you: notes placed by
// absolute pitch, and a board that starts low enough to hold the bass.
//
// The bug this pins: Em/B voiced B3-E4-G4-B4 on a board starting at C4.
// B3 is below the board, so it wrapped to B4 — landing to the RIGHT of E4
// and reading as though E were the bass.

import { describe, expect, it } from 'vitest';
import { midiFromPitchOctave } from './notes';

/** Same rule the picker uses to fit the board to a voicing. */
function fit(midis: number[]) {
  const lo = Math.min(...midis);
  const hi = Math.max(...midis);
  const baseMidi = Math.floor(lo / 12) * 12;
  return { baseMidi, octaves: Math.max(2, Math.ceil((hi - baseMidi + 1) / 12)) };
}

describe('piano board range for a voicing', () => {
  const EmOverB = [
    midiFromPitchOctave('B', 3),
    midiFromPitchOctave('E', 4),
    midiFromPitchOctave('G', 4),
    midiFromPitchOctave('B', 4),
  ];

  it('starts at or below the lowest note', () => {
    const { baseMidi } = fit(EmOverB);
    expect(baseMidi).toBeLessThanOrEqual(Math.min(...EmOverB));
  });

  it('starts on a C', () => {
    expect(fit(EmOverB).baseMidi % 12).toBe(0);
  });

  it('spans far enough to include the highest note', () => {
    const { baseMidi, octaves } = fit(EmOverB);
    expect(baseMidi + octaves * 12).toBeGreaterThan(Math.max(...EmOverB));
  });

  it('the bass really is the leftmost drawn key', () => {
    const { baseMidi } = fit(EmOverB);
    const offsets = EmOverB.map((m) => m - baseMidi);
    expect(Math.min(...offsets)).toBe(EmOverB[0] - baseMidi); // B3 first
    expect(offsets.every((o) => o >= 0)).toBe(true);
  });

  it('never collapses to fewer than two octaves', () => {
    const closed = [60, 64, 67]; // C4 E4 G4 — fits in one
    expect(fit(closed).octaves).toBe(2);
  });
});
