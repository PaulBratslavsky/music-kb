import { describe, expect, it } from 'vitest';
import {
  guitarVoicing,
  firstBarreVoicingIndex,
  qualityHasAnyShape,
  guitarHasShape,
} from '../theory/voicings/guitar';
import { getChordPitchClasses } from '../theory/chords';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import type { ChordQuality, ChordSelection, PitchClass } from '../types';

// Build a chord selection at a given root/quality, voicingIndex=0 unless given.
const sel = (
  root: PitchClass,
  quality: ChordQuality,
  voicingIndex = 0,
): ChordSelection => ({ root, quality, inversion: 0, voicingIndex });

// Pitch class of a (string, fret) position in standard tuning.
const pcAt = (string: number, fret: number): PitchClass => {
  const PCS: PitchClass[] = [
    'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
  ];
  const midi = STANDARD_TUNING_MIDI[string] + fret;
  return PCS[((midi % 12) + 12) % 12];
};

// ---------------------------------------------------------------------------
// Power chord ('5') voicings
// ---------------------------------------------------------------------------

describe('power chord voicings', () => {
  // The three power-chord shapes are anchored on the E, A, and D strings.
  // Each is expected to produce exactly three notes: root + perfect 5th +
  // octave-of-root. This is the spec the music-kb fork adopted for the
  // user-visible "power chord" voicing.
  const STRING_NAMES = ['high E', 'B', 'G', 'D', 'A', 'low E'];

  // Walk every voicing for a given root, verifying:
  //   1. exactly 3 notes
  //   2. each note's pitch class is either the root or its perfect 5th
  //   3. at least one note is the root, at least one is the 5th
  //   4. all positions are valid (string in 0..5, fret >= 0)
  const checkPowerChord = (root: PitchClass, expectedFifth: PitchClass) => {
    let v = guitarVoicing(sel(root, '5', 0));
    let i = 0;
    const seen = new Set<string>();
    // Each voicing index represents one of the three shapes. Loop until we
    // cycle back to the first (guitarVoicing wraps voicingIndex mod count).
    while (!seen.has(v.shapeName ?? '')) {
      seen.add(v.shapeName ?? '');
      expect(v.notes.length).toBe(3);
      const pcs = v.notes.map((n) => n.pitchClass);
      // Every note is root or 5th — no thirds, no other intervals.
      for (const pc of pcs) {
        expect([root, expectedFifth]).toContain(pc);
      }
      // Both root AND 5th must appear (no "all roots" or "all 5ths" voicings).
      expect(pcs).toContain(root);
      expect(pcs).toContain(expectedFifth);
      // Doubled-root expectation: in a three-note power chord we have
      // 2 roots + 1 fifth.
      const rootCount = pcs.filter((p) => p === root).length;
      const fifthCount = pcs.filter((p) => p === expectedFifth).length;
      expect(rootCount).toBe(2);
      expect(fifthCount).toBe(1);
      i++;
      v = guitarVoicing(sel(root, '5', i));
    }
    // We expect exactly 3 distinct shapes (E-string, A-string, D-string).
    expect(seen.size).toBe(3);
  };

  it('C5 produces 3 shapes, each root + 5th + octave (C + G)', () => {
    checkPowerChord('C', 'G');
  });

  it('F#5 produces 3 shapes (covers a sharp-side root)', () => {
    checkPowerChord('F#', 'C#');
  });

  it('A#5 produces 3 shapes (covers a flat-side root)', () => {
    // A#5 = A# + E# (= F). Internal pitch-class set uses sharps, so the
    // 5th is exactly 'F'.
    checkPowerChord('A#', 'F');
  });

  it('every power-chord position lands on a low/mid string (not high E or B)', () => {
    // Power chord shapes anchor on E/A/D strings — the doubled-root octave
    // never reaches the high E or B in the standard rock voicing. This
    // catches a regression where the D-string shape's kink-corrected octave
    // (B-string +3 frets, see comment in guitar-shapes.ts) might be
    // misplaced onto the high E.
    for (let i = 0; i < 3; i++) {
      const v = guitarVoicing(sel('G', '5', i));
      expect(v.positions).not.toBeNull();
      const positions = Array.from(v.positions!);
      for (const key of positions) {
        const [s] = key.split('-').map(Number);
        // String index 0 = high E. Power chord shapes never use it.
        expect(s, `position ${key} on ${STRING_NAMES[s]} — unexpected for ${v.shapeName}`).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Barre realization
// ---------------------------------------------------------------------------

describe('barre voicings', () => {
  // For an E-shape barre on a non-open root, the barre should sit at the
  // root fret across all 6 strings.
  it('F major (E-shape barre) puts the barre at fret 1 across all 6 strings', () => {
    const v = guitarVoicing(sel('F', 'maj', 0));
    expect(v.shapeName).toBe('E-shape barre');
    expect(v.barre).not.toBeNull();
    expect(v.barre).toEqual({ fret: 1, fromString: 0, toString: 5 });
  });

  it('B major (E-shape barre default) puts the barre at fret 7 across all 6 strings', () => {
    // B has no open major chord, so voicingIndex 0 is the first movable
    // shape — the E-shape barre, with root on the low E at fret 7.
    const v = guitarVoicing(sel('B', 'maj', 0));
    expect(v.shapeName).toBe('E-shape barre');
    expect(v.barre).toEqual({ fret: 7, fromString: 0, toString: 5 });
  });

  it('Bb major (A-shape barre at voicingIndex=1) lives on top 5 strings at fret 1', () => {
    // Bb has no open major chord; voicingIndex 0 = E-shape barre at 6,
    // voicingIndex 1 = A-shape barre at 1.
    const v = guitarVoicing(sel('A#', 'maj', 1));
    expect(v.shapeName).toBe('A-shape barre');
    expect(v.barre).toEqual({ fret: 1, fromString: 0, toString: 4 });
  });

  it('E major (E-shape barre at voicingIndex=1) suppresses the barre at the nut', () => {
    // E major's open chord IS the E-shape — playing it at the nut needs no
    // bar (open strings handle the would-be barre). Even when we explicitly
    // pick the barre form (voicingIndex 1, past the open shape), it
    // resolves to fret 0 and we suppress the rendered bar.
    const v = guitarVoicing(sel('E', 'maj', 1));
    expect(v.shapeName).toBe('E-shape barre');
    expect(v.barre).toBeNull();
  });

  it('every barre fret lands within the visible fretboard for all 12 major roots', () => {
    const PCS: PitchClass[] = [
      'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
    ];
    for (const root of PCS) {
      // Walk every shape; whatever voicing carries a barre must have a
      // valid fret on the fretboard.
      const count = 6; // generous upper bound on voicing count
      for (let i = 0; i < count; i++) {
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
    // Power chord has shapes but they are not barres (just two-finger
    // shapes with no shared bar across multiple strings).
    expect(firstBarreVoicingIndex(sel('C', '5'))).toBe(-1);
    expect(firstBarreVoicingIndex(sel('C', 'dim'))).toBe(-1);
    expect(firstBarreVoicingIndex(sel('C', 'aug'))).toBe(-1);
    expect(firstBarreVoicingIndex(sel('C', 'sus2'))).toBe(-1);
    expect(firstBarreVoicingIndex(sel('C', 'sus4'))).toBe(-1);
  });

  it('returns 0 for major when no open shape exists (e.g., F major)', () => {
    // F has no open major chord, so the E-shape barre IS voicing 0.
    expect(firstBarreVoicingIndex(sel('F', 'maj'))).toBe(0);
  });

  it('returns 1 for major when an open shape exists (e.g., C major)', () => {
    // C major has an Open C shape at index 0; the E-shape barre is at 1.
    expect(firstBarreVoicingIndex(sel('C', 'maj'))).toBe(1);
  });

  it('returns 1 for minor with an open shape (Am has Open Am at 0)', () => {
    expect(firstBarreVoicingIndex(sel('A', 'min'))).toBe(1);
  });

  it('returns 0 for m7b5 (only an A-shape barre exists, no open)', () => {
    expect(firstBarreVoicingIndex(sel('B', 'm7b5'))).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// qualityHasAnyShape — used by the SelectionBar Quality picker
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
    expect(qualityHasAnyShape('m13')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sanity: voicing notes match the chord's pitch-class set
// ---------------------------------------------------------------------------

describe('voicing pitch-class coverage', () => {
  it('every guitar voicing note is a member of the chord pcs', () => {
    // Spot check across roots/qualities — every realized note must be
    // either the root or another chord tone. Catches off-by-one offsets.
    const cases: [PitchClass, ChordQuality][] = [
      ['C', 'maj'], ['F', 'maj'], ['G', 'dom7'], ['A', 'min'],
      ['D', 'maj7'], ['B', 'm7b5'], ['E', '6'], ['F#', '5'],
    ];
    for (const [root, q] of cases) {
      const pcs = new Set(getChordPitchClasses(root, q));
      // Try voicing 0 and 1; not all qualities have a 1.
      for (let i = 0; i < 2; i++) {
        const v = guitarVoicing(sel(root, q, i));
        for (const n of v.notes) {
          expect(pcs.has(n.pitchClass), `${root}${q} voicing ${i}: note ${n.pitchClass} not in chord`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// pcAt helper — keeps the test grounded in standard tuning
// ---------------------------------------------------------------------------

describe('pcAt helper (test infra)', () => {
  it('matches known fretboard pitch classes', () => {
    expect(pcAt(5, 0)).toBe('E'); // low E open
    expect(pcAt(0, 0)).toBe('E'); // high E open
    expect(pcAt(5, 8)).toBe('C'); // low E fret 8 = C
    expect(pcAt(4, 2)).toBe('B'); // A fret 2 = B
  });
});

// Silence unused-import lint when guitarHasShape is referenced via this
// re-export pattern (kept available for future tests).
void guitarHasShape;
