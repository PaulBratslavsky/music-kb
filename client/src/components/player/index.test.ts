import { describe, expect, it } from 'vitest';
import { findActiveRowIndex } from './index';

// `findActiveRowIndex` is the binary-search helper TranscriptPane uses
// to find the active transcript row given the player's current time.
// Pure; testable without React/react-player.

describe('findActiveRowIndex', () => {
  const rows = [
    { startMs: 0 },
    { startMs: 5_000 },
    { startMs: 12_500 },
    { startMs: 30_000 },
    { startMs: 60_000 },
  ];

  it('returns -1 when rows are empty', () => {
    expect(findActiveRowIndex([], 5)).toBe(-1);
  });

  it('returns -1 when currentSeconds is before the first row', () => {
    expect(findActiveRowIndex([{ startMs: 1_000 }], 0.5)).toBe(-1);
  });

  it('returns the matching row when currentSeconds is exactly at a row boundary', () => {
    expect(findActiveRowIndex(rows, 0)).toBe(0);
    expect(findActiveRowIndex(rows, 5)).toBe(1);
    expect(findActiveRowIndex(rows, 30)).toBe(3);
  });

  it('returns the previous row when currentSeconds falls between two rows', () => {
    // 7s falls between row 1 (5s) and row 2 (12.5s) → row 1
    expect(findActiveRowIndex(rows, 7)).toBe(1);
    // 25s falls between row 2 (12.5s) and row 3 (30s) → row 2
    expect(findActiveRowIndex(rows, 25)).toBe(2);
  });

  it('returns the last row when currentSeconds is past every row', () => {
    expect(findActiveRowIndex(rows, 9999)).toBe(rows.length - 1);
  });

  it('handles a single-row corpus', () => {
    expect(findActiveRowIndex([{ startMs: 1_000 }], 0)).toBe(-1);
    expect(findActiveRowIndex([{ startMs: 1_000 }], 1)).toBe(0);
    expect(findActiveRowIndex([{ startMs: 1_000 }], 100)).toBe(0);
  });

  it('binary search stays correct on a large corpus', () => {
    // 1000 rows, one per second.
    const big = Array.from({ length: 1000 }, (_, i) => ({ startMs: i * 1_000 }));
    expect(findActiveRowIndex(big, 0)).toBe(0);
    expect(findActiveRowIndex(big, 500)).toBe(500);
    expect(findActiveRowIndex(big, 500.5)).toBe(500);
    expect(findActiveRowIndex(big, 999)).toBe(999);
    expect(findActiveRowIndex(big, 10_000)).toBe(999);
  });
});
