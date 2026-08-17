import { describe, expect, it } from 'vitest';
import { getDiatonicTriads } from '../theory/diatonic';

const names = (sel: Parameters<typeof getDiatonicTriads>[0], flats = false) =>
  getDiatonicTriads(sel, flats).map((t) => t.chordName);

describe('getDiatonicTriads', () => {
  it('spells C major as C Dm Em F G Am Bdim', () => {
    expect(names({ root: 'C', type: 'major' })).toEqual([
      'C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim',
    ]);
  });

  it('uses the key\'s own enharmonic spelling', () => {
    expect(names({ root: 'A#', type: 'major' }, true)).toEqual([
      'Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'Adim',
    ]);
  });

  it('keeps the maj-min-min-maj-maj-min-dim pattern in every major key', () => {
    const roots = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
    for (const root of roots) {
      const qualities = getDiatonicTriads({ root, type: 'major' }).map((t) => t.quality);
      expect(qualities).toEqual([
        'maj', 'min', 'min', 'maj', 'maj', 'min', 'dim',
      ]);
    }
  });

  it('spells natural minor as i ii° III iv v VI VII', () => {
    expect(getDiatonicTriads({ root: 'A', type: 'minor' }).map((t) => t.roman)).toEqual([
      'i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII',
    ]);
  });

  it('derives quality from intervals, so harmonic minor gets its augmented III', () => {
    // Harmonic minor's raised 7th makes III augmented and V major — the
    // major-scale pattern does not apply, which is why quality is computed.
    const triads = getDiatonicTriads({ root: 'A', type: 'harmonicMinor' });
    expect(triads.map((t) => t.quality)).toEqual([
      'min', 'dim', 'aug', 'min', 'maj', 'maj', 'dim',
    ]);
  });

  it('reports the stacked-third half-step counts', () => {
    const [one, two, seven] = [0, 1, 6].map(
      (i) => getDiatonicTriads({ root: 'C', type: 'major' })[i],
    );
    expect(one.stackedThirds).toBe('4 + 3'); // major
    expect(two.stackedThirds).toBe('3 + 4'); // minor
    expect(seven.stackedThirds).toBe('3 + 3'); // diminished
  });

  it('returns nothing for scales that are not 7 notes', () => {
    expect(getDiatonicTriads({ root: 'C', type: 'minorPentatonic' })).toEqual([]);
    expect(getDiatonicTriads({ root: 'C', type: 'blues' })).toEqual([]);
  });
});
