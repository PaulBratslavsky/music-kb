// Progression Composer — chord-span manipulation. Pure, side-effect-free
// helpers that keep the chord list sorted and non-overlapping while the
// user drags blocks around, resizes them, and drops new ones in. All
// clamping lives here so the UI never has to reason about neighbours.

import type { ChordSpan, Degree } from './types';
import { TOTAL_STEPS } from './types';

export function sortSpans(spans: ChordSpan[]): ChordSpan[] {
  return [...spans].sort((a, b) => a.start - b.start);
}

/** The span covering `beat`, or null if the beat is empty. */
export function spanAtBeat(spans: ChordSpan[], beat: number): ChordSpan | null {
  return (
    spans.find((s) => beat >= s.start && beat < s.start + s.length) ?? null
  );
}

/**
 * The largest free run [start, start+length) that contains `beat` and
 * doesn't collide with any existing span. Returns null if `beat` is
 * already occupied. Used to size a freshly-dropped chord.
 */
export function freeGapAt(
  spans: ChordSpan[],
  beat: number,
): { start: number; length: number } | null {
  if (beat < 0 || beat >= TOTAL_STEPS) return null;
  if (spanAtBeat(spans, beat)) return null;
  const sorted = sortSpans(spans);
  // Nearest occupied beat to the left (exclusive) and right.
  let lo = 0;
  let hi = TOTAL_STEPS;
  for (const s of sorted) {
    const end = s.start + s.length;
    if (end <= beat) lo = Math.max(lo, end);
    if (s.start > beat) {
      hi = Math.min(hi, s.start);
      break;
    }
  }
  return { start: lo, length: hi - lo };
}

/**
 * Insert a chord covering `beat` with up to `desiredLength` beats,
 * clamped to the free gap. No-op (returns the same list) if the beat is
 * occupied or out of range.
 */
export function addChord(
  spans: ChordSpan[],
  id: string,
  degree: Degree,
  beat: number,
  desiredLength = 4,
): ChordSpan[] {
  const gap = freeGapAt(spans, beat);
  if (!gap) return spans;
  const length = Math.max(1, Math.min(desiredLength, gap.length));
  // Place the new chord at the clicked beat (not the gap start) so it
  // lands where the user pointed, but never past the gap's right edge.
  const start = Math.min(beat, gap.start + gap.length - length);
  return sortSpans([...spans, { id, degree, start, length }]);
}

export function removeChord(spans: ChordSpan[], id: string): ChordSpan[] {
  return spans.filter((s) => s.id !== id);
}

export function setChordDegree(
  spans: ChordSpan[],
  id: string,
  degree: Degree,
): ChordSpan[] {
  return spans.map((s) => (s.id === id ? { ...s, degree } : s));
}

/** Neighbours of `id` in sorted order: the spans immediately before/after. */
function neighbours(
  spans: ChordSpan[],
  id: string,
): { prevEnd: number; nextStart: number; self: ChordSpan | null } {
  const sorted = sortSpans(spans);
  const idx = sorted.findIndex((s) => s.id === id);
  if (idx === -1) return { prevEnd: 0, nextStart: TOTAL_STEPS, self: null };
  const prevEnd = idx > 0 ? sorted[idx - 1].start + sorted[idx - 1].length : 0;
  const nextStart =
    idx < sorted.length - 1 ? sorted[idx + 1].start : TOTAL_STEPS;
  return { prevEnd, nextStart, self: sorted[idx] };
}

/**
 * Move a span to `newStart`, clamped so it stays within the grid and
 * doesn't overlap its neighbours. Length is preserved.
 */
export function moveChord(
  spans: ChordSpan[],
  id: string,
  newStart: number,
): ChordSpan[] {
  const { prevEnd, nextStart, self } = neighbours(spans, id);
  if (!self) return spans;
  const maxStart = nextStart - self.length;
  const start = Math.max(prevEnd, Math.min(newStart, maxStart));
  return sortSpans(
    spans.map((s) => (s.id === id ? { ...s, start } : s)),
  );
}

/**
 * Resize a span to `newLength` beats, clamped to >= 1 and to the start
 * of the next span (or the end of the grid). Anchored at `start`.
 */
export function resizeChord(
  spans: ChordSpan[],
  id: string,
  newLength: number,
): ChordSpan[] {
  const { nextStart, self } = neighbours(spans, id);
  if (!self) return spans;
  const maxLength = nextStart - self.start;
  const length = Math.max(1, Math.min(newLength, maxLength));
  return spans.map((s) => (s.id === id ? { ...s, length } : s));
}
