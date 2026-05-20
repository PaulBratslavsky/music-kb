import type { ChordSelection, ScaleSelection, ScaleType } from '../types';
import { PITCH_CLASSES, SCALE_TYPES } from '../types';
import { getChordPitchClasses } from './chords';
import { getScalePitchClasses, SCALE_TYPE_LABELS } from './scales';

export type ContainingScale = {
  selection: ScaleSelection;
  /** Display label, e.g. "C Major", "G Mixolydian", "F Lydian". */
  label: string;
  /**
   * Smaller score = more "natural" host scale (fewer extra notes outside the chord
   * relative to the scale size). Used to sort the list with the most natural first.
   */
  score: number;
};

/**
 * Returns every (root × scaleType) whose pitch-class set is a superset of the chord's PCs.
 * Sorted by goodness-of-fit (smaller scales preferred), then alphabetically.
 *
 * Scope choice: we limit to non-pentatonic / non-blues scales (i.e. 7-note scales)
 * for clarity. A pentatonic scale "containing" a 4-note chord almost never reads
 * naturally to a learner.
 */
export function findScalesContaining(chord: ChordSelection): ContainingScale[] {
  const chordPcs = new Set(getChordPitchClasses(chord.root, chord.quality));
  if (chordPcs.size === 0) return [];

  const skipScaleTypes: ReadonlySet<ScaleType> = new Set([
    'majorPentatonic',
    'minorPentatonic',
    'blues',
  ]);

  const out: ContainingScale[] = [];
  for (const root of PITCH_CLASSES) {
    for (const type of SCALE_TYPES) {
      if (skipScaleTypes.has(type)) continue;
      const sel: ScaleSelection = { root, type };
      const scalePcs = new Set(getScalePitchClasses(sel));
      if (scalePcs.size === 0) continue;

      // Containment check: every chord pc must be in the scale.
      let contains = true;
      for (const pc of chordPcs) {
        if (!scalePcs.has(pc)) {
          contains = false;
          break;
        }
      }
      if (!contains) continue;

      out.push({
        selection: sel,
        label: `${root} ${SCALE_TYPE_LABELS[type]}`,
        // Score = scale size minus chord size (smaller = chord uses more of the scale).
        // Tie-break by scale-type position so order is stable.
        score: scalePcs.size - chordPcs.size,
      });
    }
  }

  out.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.label.localeCompare(b.label);
  });
  return out;
}
