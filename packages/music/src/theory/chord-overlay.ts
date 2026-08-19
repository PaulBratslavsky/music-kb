// Chord-tone overlay: which notes of a scale belong to a given chord, and
// what each one is called relative to that chord's root.
//
// This is the bridge between the two halves of the play-along panel. The
// scale says which notes are legal over a section; the chord says which are
// strong. Landing on a chord tone over Cmaj7 sounds resolved; landing on
// the 4th sounds like passing through. Improvisation is largely the skill
// of knowing which is which in real time, so the neck should show it.

import type { ChordQuality, PitchClass } from '../types';
import { PITCH_CLASSES } from '../types';
import { getChordPitchClasses } from './chords';

/**
 * Chord-relative interval names, indexed by semitones above the chord root.
 * These are chord-function labels, not scale degrees — "R 3 5 7" is how a
 * player thinks about an arpeggio, and it's deliberately independent of the
 * key the scale is in.
 *
 * The ambiguous slots use the spelling that is overwhelmingly more common
 * in the chords this app builds: 3 semitones is a minor 3rd (not #2), 6 is
 * a ♭5 (not #4), 10 is a ♭7 (not #6).
 */
const CHORD_INTERVAL_LABELS = [
  'R', 'b9', '9', 'b3', '3', '11', 'b5', '5', '#5', '13', 'b7', '7',
] as const;

export type ChordToneMap = {
  /** Pitch classes sounded by the chord. */
  tones: Set<PitchClass>;
  /** pitch class → chord-relative label ('R', '3', 'b7', …). */
  labelFor: Map<PitchClass, string>;
  /** The chord's root, for accenting. */
  root: PitchClass;
};

/**
 * Build the overlay for one chord. Returns null when the quality yields no
 * tones (tonal can't name it), so callers can fall back to the plain scale
 * view rather than rendering an empty overlay.
 */
export function chordToneMap(
  root: PitchClass,
  quality: ChordQuality,
): ChordToneMap | null {
  const pcs = getChordPitchClasses(root, quality);
  if (pcs.length === 0) return null;

  const rootIdx = PITCH_CLASSES.indexOf(root);
  const labelFor = new Map<PitchClass, string>();
  for (const pc of pcs) {
    const semis = (PITCH_CLASSES.indexOf(pc) - rootIdx + 12) % 12;
    labelFor.set(pc, CHORD_INTERVAL_LABELS[semis]);
  }

  return { tones: new Set(pcs), labelFor, root };
}

/**
 * Notes the chord adds that the scale does not contain.
 *
 * Worth surfacing rather than hiding: a secondary dominant or a borrowed
 * chord will sound notes outside the key, and those are exactly the notes a
 * player gets wrong. Returning them lets the UI mark them instead of
 * silently omitting them from the neck.
 */
export function outsideScaleTones(
  map: ChordToneMap,
  scalePcs: readonly PitchClass[],
): PitchClass[] {
  return [...map.tones].filter((pc) => !scalePcs.includes(pc));
}
