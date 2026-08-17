// Reverse chord detection — name a chord from a set of tapped fretboard
// positions. Built on tonal's Chord.detect (the inverse of Chord.get, which
// the rest of the app uses to go name → notes).
//
// The lowest sounding note is passed first so tonal can surface slash chords
// (e.g. a C major triad over a G bass → "C/G"). Pitch classes are sharp-
// spelled (pitchClassFromMidi), which tonal accepts.

import { Chord } from 'tonal';
import type { ChordQuality, PitchClass } from '../types';
import { pitchClassFromMidi } from './notes';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { parseChordSymbol } from './parse-chord';

export type DetectedChord = {
  /** Ranked candidate chord symbols from tonal, best first (may be empty). */
  candidates: string[];
  /** Best candidate mapped to our root+quality, when it parses to a known
   *  quality. null for shapes tonal names but our enum doesn't cover, or
   *  shapes tonal can't name at all. */
  selection: { root: PitchClass; quality: ChordQuality } | null;
  /** Distinct pitch-class names actually played, lowest-sounding first. */
  notes: PitchClass[];
};

/**
 * Detect the chord for a per-string fret map (string index 0 = high E …
 * 5 = low E; value is the fret, 0 = open). Strings absent from the map are
 * muted. Returns null when nothing is played.
 */
export function detectFromFrets(
  playedFrets: Map<number, number>,
): DetectedChord | null {
  if (playedFrets.size === 0) return null;

  // Order by absolute pitch so the lowest note is the bass (drives slash
  // detection), then dedup pitch classes preserving that order.
  const midis = [...playedFrets.entries()]
    .map(([string, fret]) => STANDARD_TUNING_MIDI[string] + fret)
    .sort((a, b) => a - b);
  const seen = new Set<PitchClass>();
  const notes: PitchClass[] = [];
  for (const midi of midis) {
    const pc = pitchClassFromMidi(midi);
    if (!seen.has(pc)) {
      seen.add(pc);
      notes.push(pc);
    }
  }

  const candidates = Chord.detect(notes);
  const best = candidates[0];
  const parsed = best ? parseChordSymbol(best) : null;
  return {
    candidates,
    selection: parsed ? { root: parsed.root, quality: parsed.quality } : null,
    notes,
  };
}
