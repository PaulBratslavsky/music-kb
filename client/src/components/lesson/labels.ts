// Note-name labelling for lesson diagrams.
//
// The app stores pitch classes in sharp spelling ('A#'), but a lesson
// should print the spelling the key actually uses — B♭ in F major, not
// A♯ — and should use real accidental glyphs rather than ASCII stand-ins.
// buildDisplayMap already solves the enharmonic half; this adds the
// typography and the per-diagram lookup the lesson pages want.

import type { PitchClass, ScaleSelection } from '@music-kb/music/types';
import { buildDisplayMap } from '@music-kb/music/theory/notes';
import { getScaleNoteNames } from '@music-kb/music/theory/scales';

/** "F#" → "F♯", "Bb" → "B♭". Leaves naturals untouched. */
export function prettyAccidentals(name: string): string {
  return name.replace(/#/g, '♯').replace(/b/g, '♭');
}

/**
 * PC → the name this scale spells it with, with proper accidental glyphs.
 * PCs outside the scale fall back to their default sharp name.
 */
export function scaleNoteLabels(
  selection: ScaleSelection,
  preferFlats = false,
): (pc: PitchClass) => string {
  const raw = buildDisplayMap(getScaleNoteNames(selection, preferFlats));
  return (pc) => prettyAccidentals(raw[pc] ?? pc);
}
