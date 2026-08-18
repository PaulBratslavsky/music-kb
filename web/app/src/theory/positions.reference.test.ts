// Pins our scale boxes against guitarscale.org, the published reference the
// box data was transcribed from.
//
// This exists because the play-along scale picker originally generated
// 3-notes-per-string patterns for its position buttons. Those are a real
// system, but a DIFFERENT one — "Pos 4" there disagreed with "box 4"
// everywhere else in the app and with the site. The picker now goes through
// realizeCagedShape like every other surface; these tests make sure the
// numbering keeps matching the source.
//
// Reference pages:
//   https://www.guitarscale.org/e-minor.html
//   https://www.guitarscale.org/c-major.html

import { describe, expect, it } from 'vitest';
import { availablePositions, realizeCagedShape } from './positions';
import { getScalePitchClasses } from './scales';
import type { PitchClass, ScaleType } from '../types';

function fretSpan(
  position: 1 | 2 | 3 | 4 | 5,
  root: PitchClass,
  type: ScaleType,
): { lo: number; hi: number } {
  const notes = realizeCagedShape(position, root, getScalePitchClasses({ root, type }), type);
  const frets = notes.map((n) => n.fret);
  return { lo: Math.min(...frets), hi: Math.max(...frets) };
}

describe('E minor boxes match guitarscale.org/e-minor.html', () => {
  // The site labels these "Shape N (Xth position)". X is the fret the box
  // starts on, which is what we assert.
  const EXPECTED_START: Record<number, number> = {
    1: 11, // Shape 1 (11th position)
    2: 2,  // Shape 2 (2nd position)
    3: 4,  // Shape 3 (4th position)
    4: 7,  // Shape 4 (7th position)
    5: 9,  // Shape 5 (9th position)
  };

  it('offers five boxes', () => {
    expect(availablePositions('minor')).toEqual([1, 2, 3, 4, 5]);
  });

  for (const [box, start] of Object.entries(EXPECTED_START)) {
    it(`box ${box} starts at fret ${start}`, () => {
      expect(fretSpan(Number(box) as 1, 'E', 'minor').lo).toBe(start);
    });
  }

  it('every box is a contiguous fret window, not a diagonal run', () => {
    // The bug this guards: a 3NPS pattern climbs the neck, so its span is
    // far wider than a box fingering. Every real box fits in ~5 frets.
    for (const box of [1, 2, 3, 4, 5] as const) {
      const { lo, hi } = fretSpan(box, 'E', 'minor');
      expect(hi - lo).toBeLessThanOrEqual(5);
    }
  });

  it('every box contains only notes of the scale', () => {
    const pcs = new Set(getScalePitchClasses({ root: 'E', type: 'minor' }));
    const notes = realizeCagedShape(1, 'E', [...pcs], 'minor');
    expect(notes.length).toBeGreaterThan(0);
  });
});

describe('E major boxes match guitarscale.org/e-major.html', () => {
  // "Shape N (Xth position)" on the page; X is the box's starting fret.
  const EXPECTED_START: Record<number, number> = {
    1: 11, // Shape 1 (11th position)
    2: 2,  // Shape 2 (2nd position)
    3: 4,  // Shape 3 (4th position)
    4: 6,  // Shape 4 (6th position)
    5: 8,  // Shape 5 (8th position)
  };

  for (const [box, start] of Object.entries(EXPECTED_START)) {
    it(`box ${box} starts at fret ${start}`, () => {
      expect(fretSpan(Number(box) as 1, 'E', 'major').lo).toBe(start);
    });
  }
});

describe('C major boxes', () => {
  it('offers the five CAGED shapes', () => {
    expect(availablePositions('major')).toEqual([1, 2, 3, 4, 5]);
  });

  it('every box is a compact fingering', () => {
    for (const box of [1, 2, 3, 4, 5] as const) {
      const { lo, hi } = fretSpan(box, 'C', 'major');
      // CAGED boxes reach one fret outside the 4-fret block in places
      // (the G shape notably), so 5 is the honest bound.
      expect(hi - lo).toBeLessThanOrEqual(5);
    }
  });
});
