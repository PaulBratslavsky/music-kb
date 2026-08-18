// Roman-numeral analysis: given a parsed chord and a key, classify it
// against the diatonic family + a short list of common chromatic
// extensions (secondary dominants, modal interchange). Pure functions
// driving the Roman Numeral Analyzer tool on /theory.
//
// Scope intentionally narrow: we cover the cases a typical pop/rock
// progression hits. Tonicization beyond V/X, modulations, and Neapolitan
// chords are out of scope for v1 — they'd return 'unknown'.

import { getDiatonicChords } from './diatonic';
import type { ChordQuality, PitchClass, ScaleType } from '../types';
import { PITCH_CLASSES } from '../types';
import type { ParsedChord } from './parse-chord';

/** Triad family classification — collapses the long quality enum down
 *  to the four root-level qualities used for diatonic matching. */
type TriadFamily = 'major' | 'minor' | 'dim' | 'aug' | 'other';

function qualityTriadFamily(q: ChordQuality): TriadFamily {
  // Order matters: check dim/aug BEFORE the m-prefix family (m7b5
  // starts with 'm' but is half-diminished, not minor).
  if (q === 'dim' || q === 'dim7' || q === 'm7b5') return 'dim';
  if (q === 'aug' || q === '7#5') return 'aug';
  if (q === '5' || q === 'sus2' || q === 'sus4' || q === '7sus4') return 'other';
  if (q === 'min' || q === 'min7' || q === 'm6' || q === 'm9' || q === 'm11' ||
      q === 'm13' || q === 'mMaj7' || q === 'madd9') return 'minor';
  return 'major';
}

/** Triad family of a diatonic chord's `qualitySuffix` ("", "m", "m7",
 *  "maj7", "7", "m7b5", "dim7"). Same order-of-check rules as above. */
function diatonicSuffixFamily(suffix: string): TriadFamily {
  if (suffix === 'dim7' || suffix === 'm7b5') return 'dim';
  if (suffix.startsWith('m') && !suffix.startsWith('maj')) return 'minor';
  return 'major';
}

/** Functional category — the classic T(onic) / PD(re-dominant) / D(ominant)
 *  trichotomy. Used for color coding the result. */
export type ChordFunction = 'T' | 'PD' | 'D' | 'chromatic' | 'unknown';

export type RomanResult = {
  /** Original chord symbol the user typed. */
  original: string;
  /** Roman-numeral analysis (e.g. "I", "ii", "V7", "V7/V", "bVI"). */
  roman: string;
  /** Functional category for color/group display. */
  func: ChordFunction;
  /** Short explanation of how this chord fits in the key. */
  explain: string;
};

const ROMAN_UPPER = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const ROMAN_LOWER = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'];

// Function classification of diatonic degrees in a major key. The minor
// key flips a couple (i is tonic, etc.) — we recompute per scale below.
const MAJOR_FUNCTION: Record<number, ChordFunction> = {
  1: 'T',
  2: 'PD',
  3: 'T',
  4: 'PD',
  5: 'D',
  6: 'T',
  7: 'D',
};
const MINOR_FUNCTION: Record<number, ChordFunction> = {
  1: 'T',
  2: 'PD',
  3: 'T',
  4: 'PD',
  5: 'D',
  6: 'T',
  7: 'D',
};

function semitonesUp(a: PitchClass, b: PitchClass): number {
  const ai = PITCH_CLASSES.indexOf(a);
  const bi = PITCH_CLASSES.indexOf(b);
  return ((bi - ai) % 12 + 12) % 12;
}

/** Compose the full Roman numeral by combining the diatonic helper's
 *  numeral (e.g. "I", "ii", "viiø") with the user's chord quality. The
 *  helper's romans carry the case + ornament (°, ø, +) for diminished
 *  / augmented but never a seventh suffix. We add the seventh/extension
 *  suffix from the user's typed quality so "Cmaj7" → "Imaj7", "Dm7" → "ii7".
 *
 *  Conventions:
 *  - plain major/minor triads → no suffix (case carries it)
 *  - "ø" already implies m7b5; "°" + "+" stay as they are
 *  - lowercase numerals already imply minor, so "ii7" not "iim7"
 */
function decorateRoman(
  diatonicRoman: string,
  chordQuality: ChordQuality,
): string {
  const ornamentMatch = diatonicRoman.match(/[ø°+]$/);
  const ornament = ornamentMatch?.[0] ?? '';
  const numeral = ornament ? diatonicRoman.slice(0, -ornament.length) : diatonicRoman;

  // Quality → roman suffix. Empty when the ornament + case already convey
  // the quality (plain major/minor/diminished/augmented triads, half-dim 7th).
  const SUFFIX_BY_QUALITY: Record<ChordQuality, string> = {
    maj: '',
    min: '',
    dim: '',     // ornament '°' carries it
    aug: '',     // ornament '+' carries it
    sus2: 'sus2',
    sus4: 'sus4',
    '5': '5',
    '6': '6',
    m6: '6',
    maj7: 'maj7',
    min7: '7',   // case carries the minor; just add the 7
    dom7: '7',
    mMaj7: '(maj7)',
    m7b5: '',    // ornament 'ø' carries it
    dim7: '7',   // combined with the '°' ornament: 'vii°7'
    '7sus4': '7sus4',
    add9: 'add9',
    madd9: 'add9',
    '9': '9',
    maj9: 'maj9',
    m9: '9',
    '11': '11',
    m11: '11',
    '13': '13',
    m13: '13',
    '7b5': '7♭5',
    '7#5': '7♯5',
    '7b9': '7♭9',
    '7#9': '7♯9',
    alt: '7alt',
  };
  return numeral + SUFFIX_BY_QUALITY[chordQuality] + ornament;
}

/**
 * Analyze one parsed chord against a key. Tries in order:
 *   1. Exact diatonic match — easy case.
 *   2. Secondary dominant — a dominant-7 (or major triad) whose root is a
 *      perfect 5th above some non-tonic diatonic chord's root.
 *   3. Modal interchange — chord borrowed from the parallel minor (or
 *      parallel major when key is minor). Common borrowings: bIII, bVI,
 *      bVII, iv (in major); IV, II (in minor).
 *   4. Otherwise: 'unknown'.
 */
export function analyzeChordInKey(
  chord: ParsedChord,
  keyRoot: PitchClass,
  keyMode: 'major' | 'minor',
): RomanResult {
  const scaleType: ScaleType = keyMode;
  const diatonic = getDiatonicChords({ root: keyRoot, type: scaleType });

  // 1. Diatonic match — same root + same triad family (e.g. user types
  //    "C" or "Cmaj7" — both count as I in C major; "Bm7b5" matches viiø).
  const chordFamily = qualityTriadFamily(chord.quality);
  for (const d of diatonic) {
    if (d.root !== chord.root) continue;
    if (diatonicSuffixFamily(d.qualitySuffix) !== chordFamily) continue;
    return {
      original: chord.original,
      roman: decorateRoman(d.roman, chord.quality),
      func: (keyMode === 'major' ? MAJOR_FUNCTION : MINOR_FUNCTION)[d.degree] ?? 'unknown',
      explain: `Diatonic — degree ${d.degree} in ${keyRoot} ${keyMode}.`,
    };
  }

  // 2. Secondary dominant: a major triad or dominant-7 whose root is a
  //    perfect 5th ABOVE some non-tonic diatonic chord's root. Equivalent:
  //    the target's root is a perfect 4th up from chord.root (5 semitones).
  const isDominantQuality =
    chord.quality === 'maj' || chord.quality === 'dom7' ||
    chord.quality === '7b9' || chord.quality === '7#9' || chord.quality === '7b5' ||
    chord.quality === '7#5' || chord.quality === 'alt';
  if (isDominantQuality) {
    for (const target of diatonic) {
      if (target.degree === 1) continue; // V/I is just V, handled above.
      // Skip secondary dominants targeting the diminished vii — you don't
      // tonicize a diminished chord in practice, and the catch-all match
      // makes flat-major-side chords like F# in C major look like V/vii
      // when they're actually chromatic / modulating.
      if (diatonicSuffixFamily(target.qualitySuffix) === 'dim') continue;
      if (semitonesUp(chord.root, target.root) === 5) {
        const targetFamily = diatonicSuffixFamily(target.qualitySuffix);
        const romanArr = targetFamily === 'major' ? ROMAN_UPPER : ROMAN_LOWER;
        const targetRoman = romanArr[target.degree - 1];
        return {
          original: chord.original,
          roman: `V${chord.quality === 'dom7' ? '7' : ''}/${targetRoman}`,
          func: 'D',
          explain: `Secondary dominant — V of ${target.chordName} (the ${targetRoman} chord).`,
        };
      }
    }
  }

  // 3. Modal interchange — chord borrowed from the parallel key.
  //    For a major key, common borrowings come from the parallel minor:
  //    iv, bVI, bVII, bIII, viiø (Picardy/Dorian flavor).
  //    For a minor key, common borrowings come from the parallel major:
  //    IV (Dorian-flavored), I (Picardy third).
  if (keyMode === 'major') {
    const interval = semitonesUp(keyRoot, chord.root);
    const map: Record<number, { roman: string; explain: string }> = {
      3: { roman: '♭III', explain: '♭III (borrowed from parallel minor — Aeolian flavor).' },
      5: { roman: 'iv', explain: 'iv (borrowed from parallel minor — wistful subdominant).' },
      8: { roman: '♭VI', explain: '♭VI (borrowed from parallel minor — classic "moment of doubt").' },
      10: { roman: '♭VII', explain: '♭VII (borrowed from parallel minor — Mixolydian flavor).' },
    };
    const hit = map[interval];
    if (hit) {
      return {
        original: chord.original,
        roman: hit.roman,
        func: 'chromatic',
        explain: hit.explain,
      };
    }
  }

  return {
    original: chord.original,
    roman: '?',
    func: 'unknown',
    explain:
      `Not in the diatonic family or common chromatic extensions of ${keyRoot} ${keyMode}. ` +
      'Could be a modulation, Neapolitan, tritone sub, or just a key mismatch.',
  };
}

/** Analyze a whole progression in one key. Parallel array of results. */
export function analyzeProgression(
  chords: ParsedChord[],
  keyRoot: PitchClass,
  keyMode: 'major' | 'minor',
): RomanResult[] {
  return chords.map((c) => analyzeChordInKey(c, keyRoot, keyMode));
}
