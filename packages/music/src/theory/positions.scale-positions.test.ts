// `scalePositions()` is the answer a validator quotes back when it refuses
// a position, so what it promises has to be true of the realizer: every
// value it lists must DRAW something, and every value it omits must draw
// nothing. A legal-values list that is merely plausible is worse than none
// — it sends an author to a position that renders blank.

import { describe, expect, it } from 'vitest';
import { availablePositions, realizeCagedShape, scalePositions } from './positions';
import { getScalePitchClasses } from './scales';
import { PITCH_CLASSES, SCALE_TYPES, type ScalePosition } from '../types';

const NUMBERED: Exclude<ScalePosition, 'all' | '2oct'>[] = [1, 2, 3, 4, 5];

describe('scalePositions', () => {
  it('always offers at least the universal two-octave window', () => {
    for (const type of SCALE_TYPES) {
      expect(scalePositions(type), type).toContain('2oct');
    }
  });

  it('is availablePositions plus 2oct, in that order', () => {
    for (const type of SCALE_TYPES) {
      expect(scalePositions(type), type).toEqual([...availablePositions(type), '2oct']);
    }
  });

  it('lists 2oct ONLY for the five modes, which ship no numbered box', () => {
    const modeOnly = SCALE_TYPES.filter((t) => scalePositions(t).length === 1);
    expect(modeOnly.sort()).toEqual(
      ['dorian', 'locrian', 'lydian', 'mixolydian', 'phrygian'].sort(),
    );
  });

  // The two directions that matter. Both are checked from all 12 roots
  // because a box that only realizes from C would still pass a single-root
  // spot check and render blank in the key an author actually wanted.
  it('every listed position realizes dots, from every root', () => {
    for (const type of SCALE_TYPES) {
      for (const position of scalePositions(type)) {
        for (const root of PITCH_CLASSES) {
          const pcs = getScalePitchClasses({ root, type });
          const dots = realizeCagedShape(position, root, pcs, type);
          expect(
            dots.length,
            `${root} ${type} position ${position} is listed as legal but realizes nothing`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('every OMITTED numbered position realizes nothing — the list is not merely conservative', () => {
    for (const type of SCALE_TYPES) {
      const legal = scalePositions(type);
      for (const position of NUMBERED) {
        if (legal.includes(position)) continue;
        for (const root of PITCH_CLASSES) {
          const pcs = getScalePitchClasses({ root, type });
          expect(
            realizeCagedShape(position, root, pcs, type),
            `${root} ${type} position ${position} is excluded from scalePositions() but realizes dots anyway`,
          ).toEqual([]);
        }
      }
    }
  });
});
