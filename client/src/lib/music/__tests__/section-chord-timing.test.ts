import { describe, expect, it } from 'vitest';
import { activeIndex } from '#/components/SectionChordStrip';

// A 4-chord progression over a section running 0→32s.
const START = 0;
const END = 32;
const COUNT = 4;

describe('activeIndex — bar-based chord timing', () => {
  it('cycles the progression when the section is longer than it', () => {
    // 8 bars, 4 chords → one chord per bar, progression plays twice.
    const barSec = (END - START) / 8;
    const at = (bar: number) =>
      activeIndex(bar * barSec + 0.01, START, END, COUNT, 8);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(at)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it('plays through once when bars matches the chord count', () => {
    const barSec = (END - START) / 4;
    const at = (bar: number) =>
      activeIndex(bar * barSec + 0.01, START, END, COUNT, 4);
    expect([0, 1, 2, 3].map(at)).toEqual([0, 1, 2, 3]);
  });

  it('handles a section that is three cycles long', () => {
    const barSec = (END - START) / 12;
    const at = (bar: number) =>
      activeIndex(bar * barSec + 0.01, START, END, COUNT, 12);
    expect(Array.from({ length: 12 }, (_, i) => at(i))).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3,
    ]);
  });

  it('falls back to an even split when bars is unset', () => {
    const at = (frac: number) =>
      activeIndex(START + (END - START) * frac, START, END, COUNT, null);
    expect([0.01, 0.26, 0.51, 0.76].map(at)).toEqual([0, 1, 2, 3]);
  });

  it('is silent outside the section', () => {
    expect(activeIndex(START - 1, START, END, COUNT, 8)).toBeNull();
    expect(activeIndex(END + 1, START, END, COUNT, 8)).toBeNull();
    expect(activeIndex(END, START, END, COUNT, 8)).toBeNull();
  });

  it('returns null when there is nothing to show', () => {
    expect(activeIndex(5, START, END, 0, 8)).toBeNull();
    expect(activeIndex(5, 10, 10, COUNT, 8)).toBeNull();
  });

  it('never indexes past the chord list, even on odd bar counts', () => {
    // 7 bars over 4 chords — the last cycle is partial, which is legal.
    for (let bar = 0; bar < 7; bar++) {
      const i = activeIndex((bar + 0.5) * ((END - START) / 7), START, END, COUNT, 7);
      expect(i).not.toBeNull();
      expect(i!).toBeGreaterThanOrEqual(0);
      expect(i!).toBeLessThan(COUNT);
    }
  });
});
