import { describe, expect, it } from 'vitest';
import {
  chordGrip,
  offsetToNextString,
  powerChordGrip,
  powerChordGrips,
} from './power-chords';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';

// string 0 = high e … 5 = low E
const E = 5, A = 4, D = 3, G = 2, B = 1, e = 0;

describe('offsetToNextString', () => {
  it('is +2 across the perfect-fourth pairs', () => {
    for (const s of [E, A, D, B]) expect(offsetToNextString(s)).toBe(2);
  });

  it('is +3 across G→B, where the tuning gap is a major third', () => {
    expect(offsetToNextString(G)).toBe(3);
  });

  it('has no answer from the highest string', () => {
    expect(offsetToNextString(e)).toBeNull();
  });
});

describe('powerChordGrip', () => {
  it('roots on the low E: A5 at fret 5 is E on the A string, fret 7', () => {
    expect(powerChordGrip(E, 5)).toEqual([
      { string: E, fret: 5 },
      { string: A, fret: 7 },
    ]);
  });

  it('roots on the G string with the +3 offset, not +2', () => {
    const grip = powerChordGrip(G, 5)!;
    expect(grip[1]).toEqual({ string: B, fret: 8 });
  });

  it('the second note really IS a perfect fifth above the root', () => {
    for (const s of [E, A, D, G, B]) {
      for (const fret of [0, 3, 5, 7, 12]) {
        const grip = powerChordGrip(s, fret);
        if (!grip) continue;
        const rootMidi = STANDARD_TUNING_MIDI[grip[0].string] + grip[0].fret;
        const fifthMidi = STANDARD_TUNING_MIDI[grip[1].string] + grip[1].fret;
        expect(fifthMidi - rootMidi).toBe(7);
      }
    }
  });

  it('returns null from the highest string — nothing above it to reach', () => {
    expect(powerChordGrip(e, 5)).toBeNull();
  });

  it('returns null when the fifth falls off the neck', () => {
    expect(powerChordGrip(E, 22, 22)).toBeNull();
  });

  it('a diminished degree asks for the FLAT fifth, 6 semitones', () => {
    const grip = powerChordGrip(E, 5, 22, 6)!;
    const rootMidi = STANDARD_TUNING_MIDI[grip[0].string] + grip[0].fret;
    const fifthMidi = STANDARD_TUNING_MIDI[grip[1].string] + grip[1].fret;
    expect(fifthMidi - rootMidi).toBe(6);
    // And it is NOT the standard shape — one fret lower than +2.
    expect(grip[1].fret).toBe(6);
  });
});

describe('powerChordGrips', () => {
  it('keeps the shape even when the fifth leaves the box', () => {
    // A grip is a fixed hand position; clipping it to a fret window would
    // draw a power chord that is not one.
    const grips = powerChordGrips([{ string: E, fret: 8 }]);
    expect(grips).toHaveLength(1);
    expect(grips[0][1]).toEqual({ string: A, fret: 10 });
  });

  it('drops roots that cannot form a grip', () => {
    expect(powerChordGrips([{ string: e, fret: 5 }])).toEqual([]);
  });
});

describe('chordGrip — triads are grips too', () => {
  const E = 5, A = 4, D = 3, B = 1;
  const TUNING = [64, 59, 55, 50, 45, 40];
  const midi = (p: { string: number; fret: number }) => TUNING[p.string] + p.fret;

  it('a major triad sits on three consecutive strings', () => {
    const grip = chordGrip(E, 3, [0, 4, 7])!;
    expect(grip.map((p) => p.string)).toEqual([E, A, D]);
  });

  it('every note is the interval it claims to be', () => {
    for (const s of [E, A, D]) {
      for (const intervals of [[0, 4, 7], [0, 3, 7], [0, 3, 6]]) {
        const grip = chordGrip(s, 5, intervals);
        if (!grip) continue;
        grip.forEach((p, i) => {
          expect(midi(p) - midi(grip[0])).toBe(intervals[i]);
        });
      }
    }
  });

  it('picks up the G→B major third when the shape crosses it', () => {
    // Rooted on D: the 5th lands on the B string, across the odd pair.
    const grip = chordGrip(D, 5, [0, 4, 7])!;
    expect(grip[2].string).toBe(B);
    expect(midi(grip[2]) - midi(grip[0])).toBe(7);
  });

  it('returns null rather than clipping when the shape runs out of strings', () => {
    expect(chordGrip(B, 5, [0, 4, 7])).toBeNull();
  });
});

describe('the three-note power chord shape, against a published chart', () => {
  // Guitar Tricks' chart: root, fifth on the next string, octave on the
  // one after. E5 = E0 / A2 / D2. G5 = E3 / A5 / D5.
  const E = 5, A = 4, D = 3, G = 2;
  const POWER = [0, 7, 12];

  it('E5 rooted on the open low E', () => {
    expect(chordGrip(E, 0, POWER)).toEqual([
      { string: E, fret: 0 },
      { string: A, fret: 2 },
      { string: D, fret: 2 },
    ]);
  });

  it('G5 at the 3rd fret — the same shape, moved up', () => {
    expect(chordGrip(E, 3, POWER)).toEqual([
      { string: E, fret: 3 },
      { string: A, fret: 5 },
      { string: D, fret: 5 },
    ]);
  });

  it('A5 and D5 rooted on the A string, 5th fret', () => {
    expect(chordGrip(A, 5, POWER)).toEqual([
      { string: A, fret: 5 },
      { string: D, fret: 7 },
      { string: G, fret: 7 },
    ]);
  });

  it('the shape is the SAME at every root — it just slides', () => {
    const shapeAt = (fret: number) => {
      const g = chordGrip(E, fret, POWER)!;
      return g.map((p) => [p.string - g[0].string, p.fret - g[0].fret]);
    };
    const base = JSON.stringify(shapeAt(0));
    for (const fret of [1, 3, 5, 7, 8, 10, 12]) {
      expect(JSON.stringify(shapeAt(fret))).toBe(base);
    }
  });

  it('but it CHANGES across the B string, which is the exception', () => {
    // Rooted on G, the octave crosses G→B, so the flat +2/+2 no longer
    // holds — that pair is a major third, not a fourth.
    const onG = chordGrip(G, 5, POWER)!;
    expect(onG[1].fret - onG[0].fret).toBe(3); // fifth: +3 across G→B
    expect(onG[2].string).toBe(0);             // octave lands on high e
  });
});
