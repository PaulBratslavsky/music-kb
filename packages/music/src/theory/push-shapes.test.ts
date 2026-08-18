import { describe, expect, it } from 'vitest';
import { pushChordShape } from './push-shapes';
import { PUSH_BASE_MIDI } from '../instruments/push/layout';

// Push chromatic: midi = base + row*5 + col.
const midiAt = (row: number, col: number) => PUSH_BASE_MIDI + row * 5 + col;

describe('pushChordShape', () => {
  it('returns one pad per chord note, not every occurrence', () => {
    // C major triad from the base pad: C, E, G.
    const shape = pushChordShape([PUSH_BASE_MIDI, PUSH_BASE_MIDI + 4, PUSH_BASE_MIDI + 7]);
    expect(shape).toHaveLength(3);
  });

  it('places the root on its lowest available pad', () => {
    const shape = pushChordShape([PUSH_BASE_MIDI, PUSH_BASE_MIDI + 4, PUSH_BASE_MIDI + 7]);
    expect(shape[0]).toEqual({ row: 0, col: 0 });
  });

  it('keeps the shape compact — every note near the root', () => {
    const shape = pushChordShape([PUSH_BASE_MIDI, PUSH_BASE_MIDI + 4, PUSH_BASE_MIDI + 7]);
    const root = shape[0];
    for (const p of shape) {
      expect(Math.abs(p.row - root.row)).toBeLessThanOrEqual(2);
      expect(Math.abs(p.col - root.col)).toBeLessThanOrEqual(4);
    }
  });

  it('every returned pad really sounds one of the notes', () => {
    const notes = [PUSH_BASE_MIDI, PUSH_BASE_MIDI + 4, PUSH_BASE_MIDI + 7, PUSH_BASE_MIDI + 11];
    const pcs = new Set(notes.map((n) => n % 12));
    for (const p of pushChordShape(notes)) {
      expect(pcs.has(midiAt(p.row, p.col) % 12)).toBe(true);
    }
  });

  it('handles a seventh chord (four pads)', () => {
    const shape = pushChordShape([
      PUSH_BASE_MIDI, PUSH_BASE_MIDI + 4, PUSH_BASE_MIDI + 7, PUSH_BASE_MIDI + 11,
    ]);
    expect(shape).toHaveLength(4);
  });

  it('transposes a voicing above the window back into it', () => {
    // Voiced three octaves up — still has to land on the visible grid.
    const high = [PUSH_BASE_MIDI + 36, PUSH_BASE_MIDI + 40, PUSH_BASE_MIDI + 43];
    const shape = pushChordShape(high, 4, 5);
    expect(shape.length).toBeGreaterThan(0);
    for (const p of shape) {
      expect(p.row).toBeGreaterThanOrEqual(0);
      expect(p.row).toBeLessThan(4);
      expect(p.col).toBeGreaterThanOrEqual(0);
      expect(p.col).toBeLessThan(5);
    }
  });

  it('returns nothing for no notes', () => {
    expect(pushChordShape([])).toEqual([]);
  });

  it('drops notes with no pad in a small window rather than misplacing them', () => {
    const shape = pushChordShape([PUSH_BASE_MIDI, PUSH_BASE_MIDI + 4], 1, 2);
    // Only the root fits in a 1x2 window; E (+4) has no pad there.
    expect(shape).toEqual([{ row: 0, col: 0 }]);
  });
});
