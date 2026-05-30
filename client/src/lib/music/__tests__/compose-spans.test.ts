import { describe, expect, it } from 'vitest';
import {
  addChord,
  addNote,
  freeGapAt,
  moveSpan,
  removeById,
  resizeSpan,
  setChordDegree,
  spanAt,
} from '../compose/spans';
import type { ChordSpan, Degree } from '../compose/types';
import { TOTAL_TICKS } from '../compose/types';

const span = (id: string, degree: number, start: number, length: number): ChordSpan => ({
  id,
  degree: degree as Degree,
  start,
  length,
});

describe('spanAt', () => {
  const spans = [span('a', 1, 0, 4), span('b', 5, 4, 4)];
  it('finds the covering span', () => {
    expect(spanAt(spans, 0)?.id).toBe('a');
    expect(spanAt(spans, 3)?.id).toBe('a');
    expect(spanAt(spans, 4)?.id).toBe('b');
  });
  it('returns null past the end', () => {
    expect(spanAt(spans, 8)).toBeNull();
  });
});

describe('freeGapAt', () => {
  it('returns the whole grid when empty', () => {
    expect(freeGapAt([], 5)).toEqual({ start: 0, length: TOTAL_TICKS });
  });
  it('returns the gap between two spans', () => {
    const spans = [span('a', 1, 0, 4), span('b', 5, 12, 4)];
    expect(freeGapAt(spans, 6)).toEqual({ start: 4, length: 8 });
  });
  it('returns null on an occupied tick', () => {
    expect(freeGapAt([span('a', 1, 0, 4)], 2)).toBeNull();
  });
});

describe('addChord', () => {
  it('drops a chord at the clicked tick, clamped to the gap', () => {
    const out = addChord([], 'x', 1 as Degree, 0, 4);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 0, length: 4, degree: 1 });
  });
  it('shrinks to fit a narrow gap', () => {
    const spans = [span('a', 1, 0, 4), span('b', 5, 6, 4)];
    const out = addChord(spans, 'x', 4 as Degree, 4, 4); // gap [4,6)=2
    const added = out.find((s) => s.id === 'x')!;
    expect(added.length).toBe(2);
    expect(added.start).toBe(4);
  });
  it('is a no-op on an occupied tick', () => {
    const spans = [span('a', 1, 0, 4)];
    expect(addChord(spans, 'x', 5 as Degree, 2, 4)).toBe(spans);
  });
});

describe('addNote', () => {
  it('places a note with degree, octave, and clamped length', () => {
    const out = addNote([], 'n', 3 as Degree, 1, 8, 2);
    expect(out[0]).toMatchObject({ degree: 3, octave: 1, start: 8, length: 2 });
  });
});

describe('moveSpan', () => {
  const spans = [span('a', 1, 0, 2), span('b', 5, 8, 2)];
  it('moves within the free range', () => {
    expect(moveSpan(spans, 'b', 4).find((s) => s.id === 'b')!.start).toBe(4);
  });
  it('clamps against the previous span', () => {
    expect(moveSpan(spans, 'b', 1).find((s) => s.id === 'b')!.start).toBe(2);
  });
  it('clamps against the right edge of the grid', () => {
    expect(moveSpan([span('a', 1, 0, 4)], 'a', 999)[0].start).toBe(TOTAL_TICKS - 4);
  });
});

describe('resizeSpan', () => {
  it('grows up to the next span', () => {
    const spans = [span('a', 1, 0, 2), span('b', 5, 8, 2)];
    expect(resizeSpan(spans, 'a', 99).find((s) => s.id === 'a')!.length).toBe(8);
  });
  it('never shrinks below 1 tick', () => {
    expect(resizeSpan([span('a', 1, 0, 4)], 'a', 0)[0].length).toBe(1);
  });
});

describe('removeById / setChordDegree', () => {
  const spans = [span('a', 1, 0, 4), span('b', 5, 4, 4)];
  it('removes by id', () => {
    expect(removeById(spans, 'a').map((s) => s.id)).toEqual(['b']);
  });
  it('changes a degree in place', () => {
    expect(setChordDegree(spans, 'a', 6 as Degree).find((s) => s.id === 'a')!.degree).toBe(6);
  });
});
