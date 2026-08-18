// Guess the key a set of chords is in.
//
// Used by the play-along scale picker under the player: a section's saved
// progression already tells you almost everything about which scale to
// practice over it, so the picker should open on that scale rather than
// making the user find it by hand.
//
// The method is deliberately simple — score all 24 major/minor keys by how
// much of the progression is diatonic to each, then break ties on cadential
// evidence. This is not a full key-finding algorithm (no Krumhansl
// profiles, no modulation tracking); a loop section is 2–8 chords and the
// answer is usually obvious. When it isn't, `confidence` says so and the
// caller can fall back to the video's extracted key.

import type { ChordQuality, PitchClass, ScaleType } from '../types';
import { getDiatonicTriads } from './diatonic';

/** The subset of a chord this module needs. */
export type ChordLike = { root: PitchClass; quality: ChordQuality };

const ROOTS: PitchClass[] = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

export type KeyGuess = {
  root: PitchClass;
  /** Only major/minor are inferred — modes are a manual choice. */
  type: Extract<ScaleType, 'major' | 'minor'>;
  /** Diatonic chords ÷ total chords, 0–1. */
  confidence: number;
  /** How many of the input chords were diatonic to this key. */
  matched: number;
  total: number;
};

/**
 * Collapse a chord quality onto the triad quality that decides diatonic
 * membership. Sevenths and extensions inherit their parent triad; sus,
 * power and altered chords are quality-ambiguous and return null so they
 * count toward neither evidence nor contradiction.
 */
function triadFamily(q: ChordQuality): 'maj' | 'min' | 'dim' | 'aug' | null {
  switch (q) {
    case 'maj': case 'maj7': case '6': case 'add9': case 'maj9':
    case 'dom7': case '9': case '11': case '13': case '7b9': case '7#9':
    case '7b5': case '7#5': case 'alt':
      return 'maj';
    case 'min': case 'min7': case 'm6': case 'madd9': case 'm9':
    case 'm11': case 'm13': case 'mMaj7':
      return 'min';
    case 'dim': case 'dim7': case 'm7b5':
      return 'dim';
    case 'aug':
      return 'aug';
    // '5', 'sus2', 'sus4', '7sus4' — no third, so no quality evidence.
    default:
      return null;
  }
}

const CANDIDATE_TYPES = ['major', 'minor'] as const;

/**
 * Infer the most likely key for a chord sequence.
 *
 * Returns null for an empty input. Otherwise always returns a best guess —
 * check `confidence` (1 = every chord is diatonic) before trusting it.
 *
 * Scoring, in priority order:
 *   1. diatonic chord count — the dominant signal
 *   2. tonic chord present  — a key with no I/i is a weak claim
 *   3. last chord is the tonic — progressions tend to resolve home
 *   4. first chord is the tonic
 * Dominant-quality chords on the 5th degree also earn a small bonus: a
 * plain V7 is the single strongest key marker in tonal music, and it is
 * what separates e.g. C major from A minor when both fit the notes.
 */
export function inferKeyFromChords(chords: readonly ChordLike[]): KeyGuess | null {
  if (chords.length === 0) return null;

  let best: (KeyGuess & { score: number }) | null = null;

  for (const type of CANDIDATE_TYPES) {
    for (const root of ROOTS) {
      const triads = getDiatonicTriads({ root, type });
      if (triads.length !== 7) continue;

      const byRoot = new Map(triads.map((t) => [t.root, t]));
      let matched = 0;
      let dominantBonus = 0;

      for (const chord of chords) {
        const triad = byRoot.get(chord.root);
        if (!triad) continue;
        const family = triadFamily(chord.quality);
        // A quality-ambiguous chord (sus/power) still counts as diatonic on
        // root alone — it genuinely does not contradict the key.
        if (family === null || family === triad.quality) matched += 1;
        // V7 in major, or V7 in minor (harmonic-minor borrowing), is the
        // clearest possible signal of where home is.
        if (triad.degree === 5 && chord.quality === 'dom7') dominantBonus += 1;
      }

      const tonicPresent = chords.some((c) => c.root === root) ? 1 : 0;
      const endsOnTonic = chords[chords.length - 1].root === root ? 1 : 0;
      const startsOnTonic = chords[0].root === root ? 1 : 0;

      const score =
        matched * 10 +
        dominantBonus * 4 +
        tonicPresent * 3 +
        endsOnTonic * 2 +
        startsOnTonic * 1;

      if (!best || score > best.score) {
        best = {
          root,
          type,
          matched,
          total: chords.length,
          confidence: matched / chords.length,
          score,
        };
      }
    }
  }

  if (!best) return null;
  const { score: _score, ...guess } = best;
  return guess;
}

/**
 * Parse the `key` string stored on Video.musicExtraction (e.g. "E minor",
 * "F# major") back into a scale selection. Returns null for anything that
 * isn't a plain major/minor key — modal and ambiguous extractions are left
 * for the user to pick manually.
 */
export function parseExtractedKey(
  key: string | null | undefined,
): { root: PitchClass; type: Extract<ScaleType, 'major' | 'minor'> } | null {
  if (!key) return null;
  const m = /^\s*([A-G][#b]?)\s+(major|minor)\s*$/i.exec(key);
  if (!m) return null;

  // Normalize flats to the sharp spelling PitchClass uses.
  const FLAT_TO_SHARP: Record<string, PitchClass> = {
    Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#',
  };
  const raw = m[1][0].toUpperCase() + m[1].slice(1);
  const root = (FLAT_TO_SHARP[raw] ?? raw) as PitchClass;
  if (!ROOTS.includes(root)) return null;

  return { root, type: m[2].toLowerCase() as 'major' | 'minor' };
}
