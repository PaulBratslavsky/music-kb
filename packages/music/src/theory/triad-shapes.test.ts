import { describe, expect, it } from 'vitest';
import {
  STRING_SETS,
  TRIAD_FORMULA,
  TRIAD_INTERVALS,
  triadVoicing,
  type Inversion,
  type TriadQuality,
} from './triad-shapes';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { PITCH_CLASSES, type PitchClass } from '../types';

const QUALITIES: TriadQuality[] = ['major', 'minor', 'augmented', 'diminished'];
const midi = (n: { string: number; fret: number }) =>
  STANDARD_TUNING_MIDI[n.string] + n.fret;

describe('triadVoicing', () => {
  it('always has exactly three notes, one per string in the set', () => {
    const v = triadVoicing('C', 'major', STRING_SETS[0], 0)!;
    expect(v.notes).toHaveLength(3);
    expect(new Set(v.notes.map((n) => n.string)).size).toBe(3);
  });

  it('spells the right pitch classes for every quality', () => {
    for (const q of QUALITIES) {
      const v = triadVoicing('C', q, STRING_SETS[0], 0)!;
      const expected = TRIAD_INTERVALS[q].map(
        (s) => PITCH_CLASSES[(PITCH_CLASSES.indexOf('C') + s) % 12],
      );
      expect(new Set(v.notes.map((n) => n.pc))).toEqual(new Set(expected));
    }
  });

  it('is a CLOSED voicing — strictly ascending in pitch', () => {
    for (const q of QUALITIES) {
      for (const set of STRING_SETS) {
        for (const inv of [0, 1, 2] as Inversion[]) {
          const v = triadVoicing('C', q, set, inv);
          if (!v) continue;
          const midis = v.notes.map(midi);
          for (let i = 1; i < midis.length; i += 1) {
            expect(midis[i]).toBeGreaterThan(midis[i - 1]);
          }
        }
      }
    }
  });

  it('puts the named tone lowest in each inversion', () => {
    const roleOfLowest = (root: PitchClass, q: TriadQuality, inv: Inversion) => {
      const v = triadVoicing(root, q, STRING_SETS[1], inv)!;
      return v.notes[0].role;
    };
    expect(roleOfLowest('C', 'major', 0)).toBe('R');
    expect(roleOfLowest('C', 'major', 1)).toBe('3');
    expect(roleOfLowest('C', 'major', 2)).toBe('5');
    expect(roleOfLowest('C', 'minor', 1)).toBe('♭3');
    expect(roleOfLowest('C', 'diminished', 2)).toBe('♭5');
  });

  it('stays a hand-sized shape — closed triads are compact', () => {
    for (const q of QUALITIES) {
      for (const set of STRING_SETS) {
        for (const inv of [0, 1, 2] as Inversion[]) {
          const v = triadVoicing('C', q, set, inv);
          if (!v) continue;
          expect(v.span).toBeLessThanOrEqual(5);
        }
      }
    }
  });

  it('an augmented triad is symmetrical — every inversion spans the same', () => {
    // R-3-#5 stacks two major thirds, so its inversions are the same shape
    // moved. A good check that the generator is not special-casing.
    const spans = ([0, 1, 2] as Inversion[]).map(
      (inv) => triadVoicing('C', 'augmented', STRING_SETS[0], inv)?.span,
    );
    expect(new Set(spans).size).toBe(1);
  });

  it('transposes without changing the shape', () => {
    const shapeOf = (root: PitchClass) => {
      const v = triadVoicing(root, 'major', STRING_SETS[1], 0)!;
      return v.notes.map((n) => n.fret - v.lowestFret).join(',');
    };
    const base = shapeOf('C');
    for (const r of ['D', 'E', 'F', 'G', 'A'] as PitchClass[]) {
      expect(shapeOf(r)).toBe(base);
    }
  });
});

// The two triad cheat-sheet posters (augmented and diminished) lay out the
// same grid, and both state the stacking explicitly:
//
//   AUGMENTED   R-3-#5   ·  3-#5-R   ·  #5-R-3
//   DIMINISHED  R-b3-b5  ·  b3-b5-R  ·  b5-R-b3
//
// plus the shared table: MAJOR R-3-5 · MINOR R-b3-5 · AUGMENTED R-3-#5 ·
// DIMINISHED R-b3-b5. These pin our generator against that.
describe('inversion stacking matches the published cheat sheets', () => {
  const stackOf = (q: TriadQuality, inv: Inversion) =>
    triadVoicing('C', q, STRING_SETS[1], inv)!.notes.map((n) => n.role);

  it('augmented: R-3-♯5 · 3-♯5-R · ♯5-R-3', () => {
    expect(stackOf('augmented', 0)).toEqual(['R', '3', '♯5']);
    expect(stackOf('augmented', 1)).toEqual(['3', '♯5', 'R']);
    expect(stackOf('augmented', 2)).toEqual(['♯5', 'R', '3']);
  });

  it('diminished: R-♭3-♭5 · ♭3-♭5-R · ♭5-R-♭3', () => {
    expect(stackOf('diminished', 0)).toEqual(['R', '♭3', '♭5']);
    expect(stackOf('diminished', 1)).toEqual(['♭3', '♭5', 'R']);
    expect(stackOf('diminished', 2)).toEqual(['♭5', 'R', '♭3']);
  });

  it('major and minor follow the same rotation', () => {
    expect(stackOf('major', 0)).toEqual(['R', '3', '5']);
    expect(stackOf('major', 1)).toEqual(['3', '5', 'R']);
    expect(stackOf('minor', 2)).toEqual(['5', 'R', '♭3']);
  });

  it('the formula table is spelled as the posters state it', () => {
    expect(TRIAD_FORMULA.major).toBe('R - 3 - 5');
    expect(TRIAD_FORMULA.minor).toBe('R - ♭3 - 5');
    expect(TRIAD_FORMULA.augmented).toBe('R - 3 - ♯5');
    expect(TRIAD_FORMULA.diminished).toBe('R - ♭3 - ♭5');
  });
});
