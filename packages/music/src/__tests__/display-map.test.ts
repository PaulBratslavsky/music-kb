import { describe, expect, it } from 'vitest';
import { buildDisplayMap } from '../theory/notes';

// Regression coverage for the rule: natural-named pitch classes (C, D,
// E, F, G, A, B) never get respelled, even when the surrounding scale
// would technically call for B#, E#, F##, etc. Accidentals stay free
// to swap between sharp and flat per the chosen key.

describe('buildDisplayMap — natural PCs are constant', () => {
  it('C# major (7 sharps with B# and E#) yields no overrides', () => {
    // Tonal returns ['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'B#'].
    // E# would respell F → "E#"; B# would respell C → "B#".
    // Both rejected because F and C are natural PCs.
    const out = buildDisplayMap(['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'B#']);
    expect(out).toEqual({});
  });

  it('D# major (with F## and C##) yields no overrides', () => {
    // Tonal returns ['D#', 'E#', 'F##', 'G#', 'A#', 'B#', 'C##'].
    // F## → G, C## → D, B# → C, E# → F. All four are natural PCs and
    // get rejected.
    const out = buildDisplayMap(['D#', 'E#', 'F##', 'G#', 'A#', 'B#', 'C##']);
    expect(out).toEqual({});
  });
});

describe('buildDisplayMap — accidentals respell freely', () => {
  it('Bb major spells the accidentals as flats', () => {
    // Tonal returns ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'].
    // Bb → A#, Eb → D#. Both are accidental PCs — keep the override.
    // C, D, F, G, A are naturals — no overrides.
    const out = buildDisplayMap(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A']);
    expect(out).toEqual({ 'A#': 'Bb', 'D#': 'Eb' });
  });

  it('Db major spells all 5 accidentals as flats', () => {
    // Tonal returns ['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C'].
    const out = buildDisplayMap(['Db', 'Eb', 'F', 'Gb', 'Ab', 'Bb', 'C']);
    expect(out).toEqual({
      'C#': 'Db',
      'D#': 'Eb',
      'F#': 'Gb',
      'G#': 'Ab',
      'A#': 'Bb',
    });
  });

  it('C major yields no overrides (all naturals)', () => {
    const out = buildDisplayMap(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(out).toEqual({});
  });
});

describe('buildDisplayMap — mixed cases', () => {
  it('skips Cb / Fb (would respell natural B / E)', () => {
    // Gb major: ['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F'].
    // Cb → PC B; Fb (if it appeared) → PC E. Both naturals, rejected.
    const out = buildDisplayMap(['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']);
    // B and E should stay constant (no override). Accidentals respelled.
    expect(out).toEqual({
      'C#': 'Db',
      'D#': 'Eb',
      'F#': 'Gb',
      'G#': 'Ab',
      'A#': 'Bb',
    });
    expect(out).not.toHaveProperty('B');
    expect(out).not.toHaveProperty('E');
  });
});
