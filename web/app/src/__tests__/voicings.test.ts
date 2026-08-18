import { describe, expect, it } from 'vitest';
import {
  guitarVoicing,
  firstBarreVoicingIndex,
  qualityHasAnyShape,
} from '../theory/voicings/guitar';
import { getChordPitchClasses } from '../theory/chords';
import type { ChordQuality, ChordSelection, PitchClass } from '../types';

const sel = (
  root: PitchClass,
  quality: ChordQuality,
  voicingIndex = 0,
): ChordSelection => ({ root, quality, inversion: 0, voicingIndex });

// ---------------------------------------------------------------------------
// Power chord ('5') voicings
// ---------------------------------------------------------------------------

describe('power chord voicings', () => {
  const checkPowerChord = (root: PitchClass, expectedFifth: PitchClass) => {
    let v = guitarVoicing(sel(root, '5', 0));
    let i = 0;
    const seen = new Set<string>();
    while (!seen.has(v.shapeName ?? '')) {
      seen.add(v.shapeName ?? '');
      expect(v.notes.length).toBe(3);
      const pcs = v.notes.map((n) => n.pitchClass);
      for (const pc of pcs) {
        expect([root, expectedFifth]).toContain(pc);
      }
      expect(pcs).toContain(root);
      expect(pcs).toContain(expectedFifth);
      const rootCount = pcs.filter((p) => p === root).length;
      const fifthCount = pcs.filter((p) => p === expectedFifth).length;
      expect(rootCount).toBe(2);
      expect(fifthCount).toBe(1);
      i++;
      v = guitarVoicing(sel(root, '5', i));
    }
    expect(seen.size).toBe(3);
  };

  it('C5 produces 3 shapes, each root + 5th + octave (C + G)', () => {
    checkPowerChord('C', 'G');
  });

  it('F#5 produces 3 shapes (covers a sharp-side root)', () => {
    checkPowerChord('F#', 'C#');
  });
});

// ---------------------------------------------------------------------------
// Barre realization
// ---------------------------------------------------------------------------

describe('barre voicings', () => {
  it('F major (E-shape barre) puts the barre at fret 1 across all 6 strings', () => {
    const v = guitarVoicing(sel('F', 'maj', 0));
    expect(v.shapeName).toBe('E-shape barre');
    expect(v.barre).toEqual({ fret: 1, fromString: 0, toString: 5 });
  });

  it('B major (E-shape barre default) puts the barre at fret 7', () => {
    const v = guitarVoicing(sel('B', 'maj', 0));
    expect(v.shapeName).toBe('E-shape barre');
    expect(v.barre).toEqual({ fret: 7, fromString: 0, toString: 5 });
  });

  it('E major barre at the nut suppresses the bar', () => {
    const v = guitarVoicing(sel('E', 'maj', 1));
    expect(v.shapeName).toBe('E-shape barre');
    expect(v.barre).toBeNull();
  });

  it('every barre fret lands within the visible fretboard for major roots', () => {
    const PCS: PitchClass[] = [
      'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
    ];
    for (const root of PCS) {
      for (let i = 0; i < 6; i++) {
        const v = guitarVoicing(sel(root, 'maj', i));
        if (v.barre) {
          expect(v.barre.fret).toBeGreaterThan(0);
          expect(v.barre.fret).toBeLessThanOrEqual(15);
          expect(v.barre.fromString).toBeGreaterThanOrEqual(0);
          expect(v.barre.toString).toBeLessThanOrEqual(5);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// firstBarreVoicingIndex
// ---------------------------------------------------------------------------

describe('firstBarreVoicingIndex', () => {
  it('returns -1 for qualities with no barre voicings', () => {
    expect(firstBarreVoicingIndex(sel('C', '5'))).toBe(-1);
    expect(firstBarreVoicingIndex(sel('C', 'dim'))).toBe(-1);
    expect(firstBarreVoicingIndex(sel('C', 'aug'))).toBe(-1);
    expect(firstBarreVoicingIndex(sel('C', 'sus2'))).toBe(-1);
  });

  it('returns 0 for major when no open shape exists (F major)', () => {
    expect(firstBarreVoicingIndex(sel('F', 'maj'))).toBe(0);
  });

  it('returns 1 for major when an open shape exists (C major)', () => {
    expect(firstBarreVoicingIndex(sel('C', 'maj'))).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// qualityHasAnyShape
// ---------------------------------------------------------------------------

describe('qualityHasAnyShape', () => {
  it('true for qualities with movable shapes', () => {
    expect(qualityHasAnyShape('5')).toBe(true);
    expect(qualityHasAnyShape('maj')).toBe(true);
    expect(qualityHasAnyShape('m7b5')).toBe(true);
    expect(qualityHasAnyShape('6')).toBe(true);
  });

  it('false for exotic qualities without any shape data', () => {
    expect(qualityHasAnyShape('alt')).toBe(false);
    expect(qualityHasAnyShape('7b9')).toBe(false);
    expect(qualityHasAnyShape('maj9')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sanity: voicing notes match the chord's pitch-class set
// ---------------------------------------------------------------------------

describe('voicing pitch-class coverage', () => {
  it('every guitar voicing note is a member of the chord pcs', () => {
    const cases: [PitchClass, ChordQuality][] = [
      ['C', 'maj'], ['F', 'maj'], ['G', 'dom7'], ['A', 'min'],
      ['D', 'maj7'], ['B', 'm7b5'], ['E', '6'], ['F#', '5'],
    ];
    for (const [root, q] of cases) {
      const pcs = new Set(getChordPitchClasses(root, q));
      for (let i = 0; i < 2; i++) {
        const v = guitarVoicing(sel(root, q, i));
        for (const n of v.notes) {
          expect(pcs.has(n.pitchClass)).toBe(true);
        }
      }
    }
  });
});
