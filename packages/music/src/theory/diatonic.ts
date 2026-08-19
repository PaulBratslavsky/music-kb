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

export type DiatonicTriad = {
  /** 1-based scale degree the triad is built on. */
  degree: number;
  root: PitchClass;
  /** Display name for the root, using the scale's enharmonic spelling. */
  rootDisplay: string;
  quality: 'maj' | 'min' | 'dim' | 'aug';
  /** Short suffix after the root ("", "m", "dim", "aug"). */
  qualitySuffix: string;
  /** Roman numeral — case carries the quality, ° marks diminished. */
  roman: string;
  /** Full display name, e.g. "C", "Dm", "Bdim". */
  chordName: string;
  /** Root, 3rd and 5th. */
  pitchClasses: PitchClass[];
  /** Half steps root→3rd and 3rd→5th, e.g. "4 + 3". */
  stackedThirds: string;
};

const TRIAD_META: Record<
  DiatonicTriad['quality'],
  { suffix: string; case: 'upper' | 'lower'; ornament: string }
> = {
  maj: { suffix: '', case: 'upper', ornament: '' },
  min: { suffix: 'm', case: 'lower', ornament: '' },
  dim: { suffix: 'dim', case: 'lower', ornament: '°' },
  aug: { suffix: 'aug', case: 'upper', ornament: '+' },
};

function classifyTriad(third: number, fifth: number): DiatonicTriad['quality'] {
  if (third === 4 && fifth === 7) return 'maj';
  if (third === 3 && fifth === 7) return 'min';
  if (third === 3 && fifth === 6) return 'dim';
  return 'aug';
}

/**
 * The diatonic TRIADS of a scale — the same every-other-note stacking as
 * getDiatonicChords, stopped at three notes instead of four.
 *
 * The quality is derived from the interval sizes rather than looked up, so
 * it stays correct for the modes and for harmonic/melodic minor (where the
 * major-scale "maj min min maj maj min dim" pattern does not hold). Returns
 * [] for scales that aren't 7 notes, matching getDiatonicChords.
 */
export function getDiatonicTriads(
  selection: ScaleSelection,
  preferFlats = false,
): DiatonicTriad[] {
  const pcs = getScalePitchClasses(selection);
  if (pcs.length !== 7) return [];

  const noteNames = getScaleNoteNames(selection, preferFlats);
  const display: Partial<Record<PitchClass, string>> = {};
  noteNames.forEach((name, idx) => {
    if (idx < pcs.length) display[pcs[idx]] = name.replace(/[0-9]/g, '');
  });

  return pcs.map((root, i) => {
    const thirdPc = pcs[(i + 2) % 7];
    const fifthPc = pcs[(i + 4) % 7];
    const third = semitonesBetween(root, thirdPc);
    const fifth = semitonesBetween(root, fifthPc);
    const quality = classifyTriad(third, fifth);
    const meta = TRIAD_META[quality];
    const rootDisplay = display[root] ?? root;

    return {
      degree: i + 1,
      root,
      rootDisplay,
      quality,
      qualitySuffix: meta.suffix,
      roman:
        (meta.case === 'upper' ? ROMAN_UPPER[i] : ROMAN_LOWER[i]) + meta.ornament,
      chordName: `${rootDisplay}${meta.suffix}`,
      pitchClasses: [root, thirdPc, fifthPc],
      stackedThirds: `${third} + ${fifth - third}`,
    };
  });
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
