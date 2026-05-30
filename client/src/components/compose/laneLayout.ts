// Shared geometry for the composer lanes so the beat ruler, melody grid,
// chord lane, and bass grid all line their columns up. Every lane is a
// flex row of [fixed-width label gutter][flex-1 track]; the track is a
// 32-column grid (8 bars × 4 beats).

import { TOTAL_STEPS, BEATS_PER_BAR } from '#/lib/music/compose/types';

/** Width of the left label gutter, shared by every lane. */
export const LABEL_W = '2.75rem';

/** CSS grid-template-columns for a lane track: TOTAL_STEPS equal columns. */
export const TRACK_COLS = `repeat(${TOTAL_STEPS}, minmax(0, 1fr))`;

/** True when a beat index is the downbeat of a bar (thicker gridline). */
export function isBarStart(step: number): boolean {
  return step % BEATS_PER_BAR === 0;
}
