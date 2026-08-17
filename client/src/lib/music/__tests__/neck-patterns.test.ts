import { describe, expect, it } from 'vitest';
import { threeNotesPerString } from '../theory/neck-patterns';
import { getScalePitchClasses } from '../theory/scales';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { pitchClassFromMidi } from '../theory/notes';

const G_MAJOR = getScalePitchClasses({ root: 'G', type: 'major' });

/** frets grouped by string, indexed 0 = high e … 5 = low E. */
function fretsByString(positions: { string: number; fret: number }[]) {
  const out: number[][] = Array.from({ length: 6 }, () => []);
  for (const p of positions) out[p.string].push(p.fret);
  return out;
}

describe('threeNotesPerString', () => {
  it('puts exactly three notes on every string', () => {
    for (let degree = 0; degree < 7; degree++) {
      const frets = fretsByString(threeNotesPerString(G_MAJOR, degree));
      expect(frets.map((f) => f.length)).toEqual([3, 3, 3, 3, 3, 3]);
    }
  });

  it('matches the canonical G major pattern 1', () => {
    // Pattern 1 starts on the root (G, fret 3 on the low E). The +1 shift
    // on the B and high-e strings is the G→B major-3rd tuning gap.
    expect(fretsByString(threeNotesPerString(G_MAJOR, 0))).toEqual([
      [5, 7, 8], // high e — A B C
      [5, 7, 8], // B      — E F# G
      [4, 5, 7], // G      — B C D
      [4, 5, 7], // D      — F# G A
      [3, 5, 7], // A      — C D E
      [3, 5, 7], // low E  — G A B
    ]);
  });

  it('starts each pattern on its named scale degree', () => {
    for (let degree = 0; degree < 7; degree++) {
      const positions = threeNotesPerString(G_MAJOR, degree);
      const lowE = positions.filter((p) => p.string === 5);
      const firstMidi = STANDARD_TUNING_MIDI[5] + Math.min(...lowE.map((p) => p.fret));
      expect(pitchClassFromMidi(firstMidi)).toBe(G_MAJOR[degree]);
    }
  });

  it('only emits notes that belong to the scale', () => {
    const positions = threeNotesPerString(G_MAJOR, 3);
    for (const p of positions) {
      const pc = pitchClassFromMidi(STANDARD_TUNING_MIDI[p.string] + p.fret);
      expect(G_MAJOR).toContain(pc);
    }
  });

  it('chains the seven patterns up the neck when given a shared fret floor', () => {
    // How the system is always taught in G major: pattern n starts on the
    // nth scale degree, each one further up than the last. Without the
    // floor, pattern 7 (F#) wraps back to fret 2 instead of landing at 14.
    const starts = [0, 1, 2, 3, 4, 5, 6].map((degree) =>
      Math.min(
        ...threeNotesPerString(G_MAJOR, degree, { minFret: 3 })
          .filter((p) => p.string === 5)
          .map((p) => p.fret),
      ),
    );
    expect(starts).toEqual([3, 5, 7, 8, 10, 12, 14]);
  });

  it('keeps every note on a playable fret', () => {
    for (let degree = 0; degree < 7; degree++) {
      const frets = threeNotesPerString(G_MAJOR, degree, { minFret: 3 }).map(
        (p) => p.fret,
      );
      expect(Math.max(...frets)).toBeLessThanOrEqual(20);
      expect(Math.min(...frets)).toBeGreaterThanOrEqual(0);
    }
  });

  it('ascends monotonically in pitch across the whole pattern', () => {
    const positions = threeNotesPerString(G_MAJOR, 5);
    const midis = positions.map((p) => STANDARD_TUNING_MIDI[p.string] + p.fret);
    for (let i = 1; i < midis.length; i++) {
      expect(midis[i]).toBeGreaterThan(midis[i - 1]);
    }
  });
});
