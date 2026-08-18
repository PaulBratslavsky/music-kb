// Does each scale box carry the interval structure that DEFINES its scale?
//
// The note-level test (positions.reference.test.ts) pins where each box
// starts. This pins something stronger and more musical: play a box in
// ascending pitch and the whole/half-step sequence must be a contiguous run
// of the scale's own pattern — 2-2-1-2-2-2-1 for major, 2-1-2-2-1-2-2 for
// minor. A box that merely contained legal notes but skipped or doubled one
// would still "look right" note-by-note while being the wrong shape to
// practise.
//
// It also pins that a box is a MOVABLE shape: the same per-string fret
// offsets from every one of the 12 roots. A shape that changed with the key
// wouldn't be a shape at all.

import { describe, expect, it } from 'vitest';
import { realizeCagedShape } from './positions';
import { getScalePitchClasses } from './scales';
import { PITCH_CLASSES, type PitchClass, type ScaleType } from '../types';

const TUNING = [64, 59, 55, 50, 45, 40]; // high e … low E
const BOXES = [1, 2, 3, 4, 5] as const;
const ROOTS = PITCH_CLASSES;

const PATTERN: Record<'major' | 'minor', number[]> = {
  major: [2, 2, 1, 2, 2, 2, 1],
  minor: [2, 1, 2, 2, 1, 2, 2],
};

/** Is `seq` a contiguous run of the cyclic `pattern`? */
function isRunOf(seq: number[], pattern: number[]): boolean {
  if (seq.length === 0) return true;
  for (let start = 0; start < pattern.length; start += 1) {
    if (seq.every((v, i) => v === pattern[(start + i) % pattern.length])) return true;
  }
  return false;
}

function ascendingSteps(box: (typeof BOXES)[number], root: PitchClass, type: ScaleType) {
  const notes = realizeCagedShape(box, root, getScalePitchClasses({ root, type }), type);
  const midis = [...new Set(notes.map((n) => TUNING[n.string] + n.fret))].sort((a, b) => a - b);
  return midis.slice(1).map((m, i) => m - midis[i]);
}

/** Per-string fret offsets from the box's own lowest fret. */
function shapeKey(box: (typeof BOXES)[number], root: PitchClass, type: ScaleType) {
  const notes = realizeCagedShape(box, root, getScalePitchClasses({ root, type }), type);
  if (notes.length === 0) return 'EMPTY';
  const lo = Math.min(...notes.map((n) => n.fret));
  const byString: Record<number, number[]> = {};
  for (const n of notes) (byString[n.string] ??= []).push(n.fret - lo);
  return [0, 1, 2, 3, 4, 5]
    .map((s) => (byString[s] ?? []).sort((a, b) => a - b).join(','))
    .join('|');
}

describe.each(['major', 'minor'] as const)('%s boxes', (type) => {
  it('every box walks the scale\'s own whole/half-step pattern', () => {
    for (const root of ROOTS) {
      for (const box of BOXES) {
        expect(
          isRunOf(ascendingSteps(box, root, type), PATTERN[type]),
          `${root} ${type} box ${box} breaks the ${PATTERN[type].join('-')} pattern`,
        ).toBe(true);
      }
    }
  });

  it('every box contains only notes of the scale', () => {
    for (const root of ROOTS) {
      const pcs = getScalePitchClasses({ root, type });
      for (const box of BOXES) {
        for (const n of realizeCagedShape(box, root, pcs, type)) {
          expect(pcs).toContain(PITCH_CLASSES[(TUNING[n.string] + n.fret) % 12]);
        }
      }
    }
  });

  it('every box is one movable shape — identical from all 12 roots', () => {
    for (const box of BOXES) {
      const shapes = new Set(ROOTS.map((r) => shapeKey(box, r, type)));
      expect(shapes.size, `${type} box ${box} is not transposition-invariant`).toBe(1);
    }
  });
});
