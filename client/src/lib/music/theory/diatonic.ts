import type { ChordQuality, PitchClass, ScaleSelection } from '../types';
import { PITCH_CLASSES } from '../types';
import { getScalePitchClasses, getScaleNoteNames } from './scales';

const ROMAN_UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const ROMAN_LOWER = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

export type DiatonicChord = {
  /** 1-based scale degree the chord is built on. */
  degree: number;
  root: PitchClass;
  /** Display name for the root (uses the scale's enharmonic, e.g. "Bb" not "A#"). */
  rootDisplay: string;
  /**
   * Mapped chord quality if it's one of the qualities the rest of the app
   * supports. null for exotic 7ths like m7b5 or mMaj7 — the chip still renders
   * but the note set is approximate (we still expose pitchClasses for the
   * scale-preview visual).
   */
  quality: ChordQuality | null;
  /** Short suffix shown after the root (e.g. "maj7", "m7", "7", "m7b5"). */
  qualitySuffix: string;
  /** Roman-numeral analysis label (e.g. "Imaj7", "iim7", "V7", "viiø"). */
  roman: string;
  /** Full display name, e.g. "Cmaj7", "Dm7", "G7", "Bm7b5". */
  chordName: string;
  /** Pitch classes of the 4 chord tones (root, 3rd, 5th, 7th). */
  pitchClasses: PitchClass[];
};

function semitonesBetween(a: PitchClass, b: PitchClass): number {
  const ai = PITCH_CLASSES.indexOf(a);
  const bi = PITCH_CLASSES.indexOf(b);
  return ((bi - ai) % 12 + 12) % 12;
}

/**
 * Identify the seventh-chord quality from the third / fifth / seventh interval sizes.
 * Naming follows the "Related chords" convention on guitarscale.org.
 */
function classifySeventh(
  third: number,
  fifth: number,
  seventh: number,
): {
  quality: ChordQuality | null;
  suffix: string;
  romanCase: 'upper' | 'lower';
  ornament: string;
} {
  if (third === 4 && fifth === 7 && seventh === 11)
    return { quality: 'maj7', suffix: 'maj7', romanCase: 'upper', ornament: '' };
  if (third === 4 && fifth === 7 && seventh === 10)
    return { quality: 'dom7', suffix: '7', romanCase: 'upper', ornament: '' };
  if (third === 3 && fifth === 7 && seventh === 10)
    return { quality: 'min7', suffix: 'm7', romanCase: 'lower', ornament: '' };
  if (third === 3 && fifth === 7 && seventh === 11)
    return { quality: null, suffix: 'mMaj7', romanCase: 'lower', ornament: '' };
  if (third === 3 && fifth === 6 && seventh === 10)
    return { quality: null, suffix: 'm7b5', romanCase: 'lower', ornament: 'ø' };
  if (third === 3 && fifth === 6 && seventh === 9)
    return { quality: 'dim', suffix: 'dim7', romanCase: 'lower', ornament: '°' };
  if (third === 4 && fifth === 8 && seventh === 10)
    return { quality: null, suffix: '7#5', romanCase: 'upper', ornament: '+' };
  if (third === 4 && fifth === 8 && seventh === 11)
    return { quality: null, suffix: 'maj7#5', romanCase: 'upper', ornament: '+' };
  return { quality: null, suffix: '?', romanCase: 'upper', ornament: '' };
}

/**
 * Build the diatonic triads of a scale by stacking thirds on each scale degree.
 * Only meaningful for 7-note scales (major, modes, harmonic/melodic minor) —
 * pentatonics and blues don't have a clean diatonic-chord theory, so we return
 * an empty list for those.
 */
export function getDiatonicChords(
  selection: ScaleSelection,
  preferFlats = false,
): DiatonicChord[] {
  const pcs = getScalePitchClasses(selection);
  if (pcs.length !== 7) return [];

  // Map PC → preferred display name (uses the scale's actual enharmonic spelling).
  const noteNames = getScaleNoteNames(selection, preferFlats);
  const display: Partial<Record<PitchClass, string>> = {};
  noteNames.forEach((name, idx) => {
    if (idx < pcs.length) {
      display[pcs[idx]] = name.replace(/[0-9]/g, '');
    }
  });

  const result: DiatonicChord[] = [];
  for (let i = 0; i < pcs.length; i++) {
    const root = pcs[i];
    const thirdPc = pcs[(i + 2) % pcs.length];
    const fifthPc = pcs[(i + 4) % pcs.length];
    const seventhPc = pcs[(i + 6) % pcs.length];
    const third = semitonesBetween(root, thirdPc);
    const fifth = semitonesBetween(root, fifthPc);
    const seventh = semitonesBetween(root, seventhPc);
    const { quality, suffix, romanCase, ornament } = classifySeventh(third, fifth, seventh);

    const baseRoman = romanCase === 'upper' ? ROMAN_UPPER[i] : ROMAN_LOWER[i];
    const roman = baseRoman + ornament;

    const rootDisplay = display[root] ?? root;
    const chordName = `${rootDisplay}${suffix}`;

    result.push({
      degree: i + 1,
      root,
      rootDisplay,
      quality,
      qualitySuffix: suffix,
      roman,
      chordName,
      pitchClasses: [root, thirdPc, fifthPc, seventhPc],
    });
  }
  return result;
}
