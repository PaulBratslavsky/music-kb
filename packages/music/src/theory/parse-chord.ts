// Parser for free-form chord symbols (e.g. "Cmaj7", "Am7", "G7", "F#m7b5",
// "Bb", "Db/F"). Built on top of tonal's Chord.get which already handles
// the long tail of alternative spellings (M7 = maj7 = Δ, etc.). We map
// tonal's `type` (a long human label like "minor seventh") down to our
// internal ChordQuality union, since downstream tools (Roman analyzer,
// diatonic matcher) need the structured quality, not a freeform string.
//
// Returns null for slot-empty inputs ("garbage", ""), so callers can
// filter cleanly. Slash chords like "C/E" parse to the tonic chord —
// the bass note is dropped because none of the downstream tools track
// inversion through this path.

import { Chord } from 'tonal';
import type { ChordQuality, PitchClass } from '../types';
import { pitchClassFromName } from './notes';

/** Tonal's `type` string → our internal ChordQuality. Anything not in
 *  the table maps to null — caller decides whether to surface a warning
 *  ("unrecognized quality") or fall back to plain root display. */
const TYPE_TO_QUALITY: Record<string, ChordQuality> = {
  major: 'maj',
  minor: 'min',
  diminished: 'dim',
  augmented: 'aug',
  'suspended second': 'sus2',
  'suspended fourth': 'sus4',
  fifth: '5',
  // Sixths
  'sixth': '6',
  'major sixth': '6',
  'minor sixth': 'm6',
  // Sevenths
  'major seventh': 'maj7',
  'minor seventh': 'min7',
  'dominant seventh': 'dom7',
  'minor major seventh': 'mMaj7',
  'half-diminished': 'm7b5',
  'diminished seventh': 'dim7',
  'dominant seventh suspended': '7sus4',
  // Add chords
  'major add nine': 'add9',
  'minor add nine': 'madd9',
  // Ninths
  'dominant ninth': '9',
  'major ninth': 'maj9',
  'minor ninth': 'm9',
  // Extensions
  'dominant eleventh': '11',
  'minor eleventh': 'm11',
  'dominant thirteenth': '13',
  'minor thirteenth': 'm13',
  // Altered dominants
  'seventh flat five': '7b5',
  'seventh sharp five': '7#5',
  'seventh flat nine': '7b9',
  'seventh sharp nine': '7#9',
  'altered seventh': 'alt',
};

export type ParsedChord = {
  /** The raw input as the user typed it (preserved for display). */
  original: string;
  root: PitchClass;
  quality: ChordQuality;
  /** Pitch-class set of the chord (root + 3rd + 5th + 7th when present). */
  pitchClasses: PitchClass[];
};

/**
 * Parse a single chord symbol. Returns null when tonal can't make sense
 * of the input, or when the quality doesn't map to our enum.
 */
export function parseChordSymbol(symbol: string): ParsedChord | null {
  const trimmed = symbol.trim();
  if (!trimmed) return null;
  const c = Chord.get(trimmed);
  if (c.empty || !c.tonic) return null;
  const root = pitchClassFromName(c.tonic);
  if (!root) return null;
  const quality = TYPE_TO_QUALITY[c.type];
  if (!quality) return null;
  const pcs: PitchClass[] = [];
  for (const n of c.notes) {
    const pc = pitchClassFromName(n);
    if (pc) pcs.push(pc);
  }
  return { original: trimmed, root, quality, pitchClasses: pcs };
}

/**
 * Parse a chord progression — splits on whitespace (newlines, tabs,
 * commas, pipes for chord-chart bars). Returns parallel arrays of
 * parsed and unparsed tokens so the UI can highlight which symbols
 * failed to parse.
 */
export function parseChordProgression(input: string): {
  parsed: Array<ParsedChord | null>;
  tokens: string[];
} {
  const tokens = input.split(/[\s,|]+/).filter((s) => s.length > 0);
  const parsed = tokens.map(parseChordSymbol);
  return { parsed, tokens };
}
