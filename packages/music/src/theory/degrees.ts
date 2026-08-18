import { Chord, Scale } from 'tonal';
import type { ChordQuality, ChordSelection, PitchClass, ScaleSelection } from '../types';
import { chordSymbol } from './chords';
import { scaleTonalName } from './scales';
import { pitchClassFromName } from './notes';

/**
 * Convert a tonal interval string (e.g. '1P', '3M', '7m', '5d', '5A') to a
 * scale-degree label like '1', '3', 'b7', 'b5', '#5'.
 *
 * Coverage of qualities used by tonal's chord/scale intervals:
 *   P (perfect)    → no accidental
 *   M (major)      → no accidental
 *   m (minor)      → 'b' prefix
 *   d (diminished) → 'b' prefix (one step down from minor; for 7ths used in dim7 ('7d'),
 *                    we render 'bb7' which is the conventional double-flat).
 *   A (augmented)  → '#' prefix
 */
export function intervalToDegree(intervalStr: string): string {
  const m = intervalStr.match(/^(\d+)([PMmdA])$/);
  if (!m) return intervalStr;
  const num = m[1];
  const quality = m[2];
  if (quality === 'P' || quality === 'M') return num;
  if (quality === 'm') return `b${num}`;
  if (quality === 'A') return `#${num}`;
  if (quality === 'd') return num === '5' ? `b${num}` : `bb${num}`;
  return num;
}

/** Map each chord PC → its degree label. */
export function chordDegrees(
  root: PitchClass,
  quality: ChordQuality,
): Partial<Record<PitchClass, string>> {
  const c = Chord.get(chordSymbol(root, quality));
  if (c.empty) return {};
  const out: Partial<Record<PitchClass, string>> = {};
  c.notes.forEach((n, i) => {
    const pc = pitchClassFromName(n);
    if (!pc) return;
    const interval = c.intervals[i];
    if (interval) out[pc] = intervalToDegree(interval);
  });
  return out;
}

/** Map each scale PC → its degree label. */
export function scaleDegrees(
  sel: ScaleSelection,
): Partial<Record<PitchClass, string>> {
  const s = Scale.get(scaleTonalName(sel.root, sel.type));
  if (s.empty) return {};
  const out: Partial<Record<PitchClass, string>> = {};
  s.notes.forEach((n, i) => {
    const pc = pitchClassFromName(n);
    if (!pc) return;
    const interval = s.intervals[i];
    if (interval) out[pc] = intervalToDegree(interval);
  });
  return out;
}

/** Convenience for the resolve layer. */
export function degreesForSelection(
  mode: 'chord' | 'scale' | 'note' | 'all',
  chord: ChordSelection,
  scale: ScaleSelection,
  singleNote: PitchClass,
): Partial<Record<PitchClass, string>> {
  if (mode === 'chord') return chordDegrees(chord.root, chord.quality);
  if (mode === 'scale') return scaleDegrees(scale);
  if (mode === 'note') return { [singleNote]: '1' };
  return {};
}
