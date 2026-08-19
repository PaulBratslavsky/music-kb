// Where a progression chord is actually fretted.
//
// Two surfaces need this and must agree: the chord box in the strip and the
// halo on the scale neck below it. If they disagreed, the neck would tell
// you to put a finger somewhere the diagram above doesn't — so the lookup
// lives here once rather than being reimplemented per component.
//
// Precedence matches ChordMini: a chord captured from the detect fretboard
// carries its exact tapped `positions` and those win verbatim; otherwise the
// shape is recomputed from root + quality + voicingIndex.

import type { ChordSelection } from '../types';
import { guitarVoicing } from './voicings/guitar';

/** A chord as the progression stores it. */
export type VoicedChord = ChordSelection & { positions?: string[] };

/**
 * Parse the `"${string}-${fret}"` keys the builder stores into a
 * string-index → fret map. String 0 is the high E, matching every other
 * fretboard surface in the app.
 */
function parsePositions(positions: readonly string[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const key of positions) {
    const [s, f] = key.split('-').map(Number);
    if (Number.isFinite(s) && Number.isFinite(f)) m.set(s, f);
  }
  return m;
}

/**
 * The fretted positions for a chord, as a set of `"${string}:${fret}"` keys
 * — the same key shape the scale neck uses to look dots up.
 *
 * Open strings (fret 0) are included: they sound, and on the neck diagram
 * they are drawn in the nut gutter, so they should be haloed like any other
 * note of the shape.
 *
 * Returns an empty set when the chord has no concrete shape (the pitch-class
 * fallback voicing), which reads naturally as "nothing to halo".
 */
export function voicingPositionKeys(chord: VoicedChord): Set<string> {
  const map =
    chord.positions && chord.positions.length > 0
      ? parsePositions(chord.positions)
      : parsePositions([...(guitarVoicing(chord).positions ?? [])]);

  return new Set([...map.entries()].map(([s, f]) => `${s}:${f}`));
}
