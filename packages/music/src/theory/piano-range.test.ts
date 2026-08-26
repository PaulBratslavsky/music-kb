// The piano board has to be able to DRAW an inversion, which means two
// things that pitch-class rendering can't give you: notes placed by
// absolute pitch, and a board that starts low enough to hold the bass.
//
// The bug this pins: Em/B voiced B3-E4-G4-B4 on a board starting at C4.
// B3 is below the board, so it wrapped to B4 — landing to the RIGHT of E4
// and reading as though E were the bass.

import { describe, expect, it } from 'vitest';
import { midiFromPitchOctave } from './notes';
import { fitPianoRange } from './piano-range';

// The shipping function, not a copy of its rule. This file used to declare
// its own `fit` and verify THAT — which passes just as happily when the
// pickers and the chord card have drifted away from it.
const fit = (midis: number[]) => fitPianoRange(midis);

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

describe('a chord card fits the voicing exactly (minOctaves: 1)', () => {
  const Gm = [
    midiFromPitchOctave('G', 4),
    midiFromPitchOctave('A#', 4),
    midiFromPitchOctave('D', 5),
  ];
  const GmOverD = [
    midiFromPitchOctave('D', 4),
    midiFromPitchOctave('G', 4),
    midiFromPitchOctave('A#', 4),
  ];

  it('a voicing inside one octave draws one octave', () => {
    expect(fitPianoRange([60, 64, 67], { minOctaves: 1 }).octaves).toBe(1);
  });

  it('a voicing that crosses a C boundary draws two', () => {
    // G4-A#4-D5 straddles C5, so one octave cannot hold it.
    expect(fitPianoRange(Gm, { minOctaves: 1 }).octaves).toBe(2);
  });

  it('the two chords that share a pitch-class set draw different pictures', () => {
    // Gm and Gm/D light the identical pitch classes. The card can only tell
    // them apart by where the notes SIT, which is the whole reason it draws
    // absolute pitch instead of pitch classes.
    const a = fitPianoRange(Gm, { minOctaves: 1 });
    const b = fitPianoRange(GmOverD, { minOctaves: 1 });
    const offsets = (midis: number[], base: number) => midis.map((m) => m - base);
    expect(offsets(Gm, a.baseMidi)).not.toEqual(offsets(GmOverD, b.baseMidi));
  });

  it('the bass is the leftmost drawn key in an inversion', () => {
    const { baseMidi } = fitPianoRange(GmOverD, { minOctaves: 1 });
    const offsets = GmOverD.map((m) => m - baseMidi);
    expect(Math.min(...offsets)).toBe(GmOverD[0] - baseMidi); // D4 first
    expect(offsets.every((o) => o >= 0)).toBe(true);
  });

  it('an empty voicing still yields a drawable board', () => {
    expect(fitPianoRange([], { minOctaves: 1 })).toEqual({ baseMidi: 60, octaves: 1 });
    expect(fitPianoRange([])).toEqual({ baseMidi: 60, octaves: 2 });
  });
});
