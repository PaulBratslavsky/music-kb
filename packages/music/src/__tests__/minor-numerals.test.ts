// The minor-key numerals the CAGED lesson prints, checked against the engine.
//
// Written when the lesson gained a minor row: the table there is hand-typed
// prose, so it can drift from `getDiatonicTriads` without anything failing.
// Asserting the chord *names* as well as the numerals is the point — a bug
// that spells the ♭VII right but names the chord wrong would slip past a
// numerals-only check.

import { describe, expect, it } from 'vitest';
import { getDiatonicTriads } from '../theory/diatonic';
import type { PitchClass } from '../types';

const MINOR_ROMANS = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'];

// Chord names as the engine spells them: `dim` suffix and ASCII `b`, not the
// `°`/`♭` glyphs the lesson prints. The display layer does that substitution.
const EXPECTED: Record<string, string[]> = {
  A: ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G'],
  E: ['Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D'],
  D: ['Dm', 'Edim', 'F', 'Gm', 'Am', 'Bb', 'C'],
};

describe('minor-key numerals', () => {
  for (const [root, names] of Object.entries(EXPECTED)) {
    it(`${root} minor`, () => {
      const triads = getDiatonicTriads({ root: root as PitchClass, type: 'minor' }, true);
      expect(triads.map((t) => t.roman)).toEqual(MINOR_ROMANS);
      expect(triads.map((t) => t.chordName)).toEqual(names);
    });
  }
});
