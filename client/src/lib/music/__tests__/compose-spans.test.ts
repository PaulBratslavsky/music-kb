import { describe, expect, it } from 'vitest';
import {
  addChord,
  freeGapAt,
  moveChord,
  removeChord,
  resizeChord,
  setChordDegree,
  spanAtBeat,
} from '../compose/spans';
import type { ChordSpan, Degree } from '../compose/types';

const span = (id: string, degree: number, start: number, length: number): ChordSpan => ({
  id,
  degree: degree as Degree,
  start,
  length,
});

describe('spanAtBeat', () => {
  const spans = [span('a', 1, 0, 4), span('b', 5, 4, 4)];
  it('finds the covering span', () => {
    expect(spanAtBeat(spans, 0)?.id).toBe('a');
    expect(spanAtBeat(spans, 3)?.id).toBe('a');
    expect(spanAtBeat(spans, 4)?.id).toBe('b');
  });
  it('returns null past the end', () => {
    expect(spanAtBeat(spans, 8)).toBeNull();
  });
});

describe('freeGapAt', () => {
  it('returns the whole grid when empty', () => {
    expect(freeGapAt([], 5)).toEqual({ start: 0, length: 32 });
  });
  it('returns the gap between two spans', () => {
    const spans = [span('a', 1, 0, 4), span('b', 5, 12, 4)];
    expect(freeGapAt(spans, 6)).toEqual({ start: 4, length: 8 });
  });
  it('returns null on an occupied beat', () => {
    expect(freeGapAt([span('a', 1, 0, 4)], 2)).toBeNull();
  });
});

describe('addChord', () => {
  it('drops a chord at the clicked beat, clamped to the gap', () => {
    const out = addChord([], 'x', 1 as Degree, 0, 4);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 0, length: 4, degree: 1 });
  });
  it('shrinks to fit a narrow gap', () => {
    const spans = [span('a', 1, 0, 4), span('b', 5, 6, 4)];
    const out = addChord(spans, 'x', 4 as Degree, 4, 4); // gap is [4,6)=2 beats
    const added = out.find((s) => s.id === 'x')!;
    expect(added.length).toBe(2);
    expect(added.start).toBe(4);
  });
  it('is a no-op on an occupied beat', () => {
    const spans = [span('a', 1, 0, 4)];
    expect(addChord(spans, 'x', 5 as Degree, 2)).toBe(spans);
  });
});

describe('moveChord', () => {
  const spans = [span('a', 1, 0, 2), span('b', 5, 8, 2)];
  it('moves within the free range', () => {
    const out = moveChord(spans, 'b', 4);
    expect(out.find((s) => s.id === 'b')!.start).toBe(4);
  });
  it('clamps against the previous span', () => {
    const out = moveChord(spans, 'b', 1); // would overlap a (ends at 2)
    expect(out.find((s) => s.id === 'b')!.start).toBe(2);
  });
  it('clamps against the right edge of the grid', () => {
    const out = moveChord([span('a', 1, 0, 4)], 'a', 99);
    expect(out[0].start).toBe(28); // 32 - 4
  });
});

describe('resizeChord', () => {
  it('grows up to the next span', () => {
    const spans = [span('a', 1, 0, 2), span('b', 5, 8, 2)];
    const out = resizeChord(spans, 'a', 99);
    expect(out.find((s) => s.id === 'a')!.length).toBe(8); // up to b.start
  });
  it('never shrinks below 1 beat', () => {
    const out = resizeChord([span('a', 1, 0, 4)], 'a', 0);
    expect(out[0].length).toBe(1);
  });
});

describe('removeChord / setChordDegree', () => {
  const spans = [span('a', 1, 0, 4), span('b', 5, 4, 4)];
  it('removes by id', () => {
    expect(removeChord(spans, 'a').map((s) => s.id)).toEqual(['b']);
  });
  it('changes a degree in place', () => {
    expect(setChordDegree(spans, 'a', 6 as Degree).find((s) => s.id === 'a')!.degree).toBe(6);
  });
});
