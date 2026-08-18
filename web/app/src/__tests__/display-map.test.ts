import { describe, expect, it } from 'vitest';
import { buildDisplayMap } from '../theory/notes';

// Regression coverage for the rule: natural-named pitch classes (C, D,
// E, F, G, A, B) never get respelled, even when the surrounding scale
// would technically call for B#, E#, F##, etc. Accidentals stay free
// to swap between sharp and flat per the chosen key.

describe('buildDisplayMap — natural PCs are constant', () => {
  it('C# major (7 sharps with B# and E#) yields no overrides', () => {
    const out = buildDisplayMap(['C#', 'D#', 'E#', 'F#', 'G#', 'A#', 'B#']);
    expect(out).toEqual({});
  });

  it('D# major (with F## and C##) yields no overrides', () => {
    const out = buildDisplayMap(['D#', 'E#', 'F##', 'G#', 'A#', 'B#', 'C##']);
    expect(out).toEqual({});
  });
});

describe('buildDisplayMap — accidentals respell freely', () => {
  it('Bb major spells the accidentals as flats', () => {
    const out = buildDisplayMap(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A']);
    expect(out).toEqual({ 'A#': 'Bb', 'D#': 'Eb' });
  });

  it('Db major spells all 5 accidentals as flats', () => {
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
  it('Gb major skips Cb (would respell natural B)', () => {
    const out = buildDisplayMap(['Gb', 'Ab', 'Bb', 'Cb', 'Db', 'Eb', 'F']);
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
