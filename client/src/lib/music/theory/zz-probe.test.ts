// Verify the hand-written minor table against the app's own theory engine.
import { describe, expect, it } from 'vitest';
import { getDiatonicTriads } from './diatonic';
import type { PitchClass } from '../types';

const EXPECTED: Record<string, { romans: string[]; names: string[] }> = {
  A: { romans: ['i','ii°','III','iv','v','VI','VII'], names: ['Am','B°','C','Dm','Em','F','G'] },
  E: { romans: ['i','ii°','III','iv','v','VI','VII'], names: ['Em','F#°','G','Am','Bm','C','D'] },
  D: { romans: ['i','ii°','III','iv','v','VI','VII'], names: ['Dm','E°','F','Gm','Am','B♭','C'] },
};

describe('minor numerals table', () => {
  for (const [root, exp] of Object.entries(EXPECTED)) {
    it(`${root} minor`, () => {
      const t = getDiatonicTriads({ root: root as PitchClass, type: 'minor' }, true);
      console.log(`${root}m romans: ${t.map(x=>x.roman).join(' ')}`);
      console.log(`${root}m chords: ${t.map(x=>x.chordName).join(' ')}`);
      expect(t.map((x) => x.roman)).toEqual(exp.romans);
    });
  }
});
