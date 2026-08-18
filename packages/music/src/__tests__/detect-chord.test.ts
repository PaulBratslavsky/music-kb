import { describe, expect, it } from 'vitest';
import { detectFromFrets } from '../theory/detect-chord';

// string index 0 = high E … 5 = low E; value = fret (0 = open).
const frets = (entries: Array<[number, number]>) => new Map(entries);

describe('detectFromFrets', () => {
  it('returns null for an empty shape', () => {
    expect(detectFromFrets(new Map())).toBeNull();
  });

  it('detects open C major (x32010) as C major', () => {
    // A=3rd(C), D=2nd(E), G open, B=1st(C), high e open
    const d = detectFromFrets(frets([[4, 3], [3, 2], [2, 0], [1, 1], [0, 0]]))!;
    expect(d.notes).toEqual(['C', 'E', 'G']);
    expect(d.selection).toEqual({ root: 'C', quality: 'maj' });
    expect(d.candidates.length).toBeGreaterThan(0);
  });

  it('detects open G7 (320001) as a dominant seventh', () => {
    const d = detectFromFrets(
      frets([[5, 3], [4, 2], [3, 0], [2, 0], [1, 0], [0, 1]]),
    )!;
    expect(new Set(d.notes)).toEqual(new Set(['G', 'B', 'D', 'F']));
    expect(d.selection).toEqual({ root: 'G', quality: 'dom7' });
  });

  it('orders notes low→high so the lowest string is the bass', () => {
    // C-triad tones with a G in the bass (low E, 3rd fret).
    const d = detectFromFrets(frets([[5, 3], [4, 3], [3, 2], [1, 1], [0, 0]]))!;
    expect(d.notes[0]).toBe('G');
  });
});
