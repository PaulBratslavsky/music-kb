// Shared geometry for the composer lanes so the beat ruler, melody
// piano-roll, chord lane, and bass piano-roll all line their columns up.
// Every lane is a flex row of [fixed-width label gutter][flex-1 track];
// the track is a 128-column grid (8 bars × 4 beats × 4 sixteenths).

import { TOTAL_TICKS, TICKS_PER_BEAT, TICKS_PER_BAR } from '#/lib/music/compose/types';

/** Width of the left label gutter, shared by every lane. */
export const LABEL_W = '2.75rem';

/** CSS grid-template-columns for a lane track: one column per tick. */
export const TRACK_COLS = `repeat(${TOTAL_TICKS}, minmax(0, 1fr))`;

/** True on a bar downbeat (heaviest gridline). */
export function isBarStart(tick: number): boolean {
  return tick % TICKS_PER_BAR === 0;
}

/** True on a beat (quarter-note) line. */
export function isBeatStart(tick: number): boolean {
  return tick % TICKS_PER_BEAT === 0;
}
