import { Scale } from 'tonal';
import type { PitchClass, ScaleSelection, ScaleType } from '../types';
import { pitchClassFromName, spelledRoot } from './notes';

const SCALE_TYPE_TO_TONAL_NAME: Record<ScaleType, string> = {
  major: 'major',
  minor: 'minor',
  harmonicMinor: 'harmonic minor',
  melodicMinor: 'melodic minor',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  locrian: 'locrian',
  majorPentatonic: 'major pentatonic',
  minorPentatonic: 'minor pentatonic',
  blues: 'blues',
};

export const SCALE_TYPE_LABELS: Record<ScaleType, string> = {
  major: 'Major',
  minor: 'Minor',
  harmonicMinor: 'Harm. Minor',
  melodicMinor: 'Mel. Minor',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  locrian: 'Locrian',
  majorPentatonic: 'Maj. Pent.',
  minorPentatonic: 'Min. Pent.',
  blues: 'Blues',
};

export function scaleTonalName(
  root: PitchClass,
  type: ScaleType,
  preferFlats = false,
): string {
  return `${spelledRoot(root, preferFlats)} ${SCALE_TYPE_TO_TONAL_NAME[type]}`;
}

// guitarscale.org URL slug per scale type (verified live: pentatonics are
// "pentatonic-major" / "pentatonic-minor", not "major-pentatonic").
const SCALE_TYPE_TO_SLUG: Record<ScaleType, string> = {
  major: 'major',
  minor: 'minor',
  harmonicMinor: 'harmonic-minor',
  melodicMinor: 'melodic-minor',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  locrian: 'locrian',
  majorPentatonic: 'pentatonic-major',
  minorPentatonic: 'pentatonic-minor',
  blues: 'blues',
};

/**
 * The guitarscale.org page for this scale, e.g. C# Dorian →
 * https://www.guitarscale.org/c-sharp-dorian.html . Honors the chosen flat/sharp
 * spelling (the site hosts both enharmonic pages).
 */
export function guitarScaleOrgUrl(
  root: PitchClass,
  type: ScaleType,
  preferFlats = false,
): string {
  const name = spelledRoot(root, preferFlats); // "C#", "Bb", "F"
  const letter = name[0].toLowerCase();
  const acc = name.length > 1 ? (name[1] === '#' ? '-sharp' : '-flat') : '';
  return `https://www.guitarscale.org/${letter}${acc}-${SCALE_TYPE_TO_SLUG[type]}.html`;
}

export function getScalePitchClasses(selection: ScaleSelection): PitchClass[] {
  const s = Scale.get(scaleTonalName(selection.root, selection.type));
  if (s.empty) return [];
  const result: PitchClass[] = [];
  for (const noteName of s.notes) {
    const pc = pitchClassFromName(noteName);
    if (pc) result.push(pc);
  }
  return result;
}

/** Raw tonal-style note names for the scale (e.g. ['F','G','A','Bb','C','D','E']). */
export function getScaleNoteNames(
  selection: ScaleSelection,
  preferFlats = false,
): string[] {
  const s = Scale.get(scaleTonalName(selection.root, selection.type, preferFlats));
  return s.empty ? [] : s.notes;
}
