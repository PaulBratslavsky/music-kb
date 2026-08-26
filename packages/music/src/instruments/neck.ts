// The pitch class actually sounded at a fretted position — computed from the
// tuning, never taken on the model's word. Same rule this project already
// applies to timecodes (BM25-grounded against the transcript rather than
// trusted from the model): a pitch name at a fret position is arithmetic,
// not a fact that can drift, so nothing should ever store one without
// checking it against this.
//
// `string` follows this package's convention everywhere else — 0 is the
// highest-pitched string (high E on guitar, high G on bass) — documented on
// STANDARD_TUNING_MIDI in guitar/layout.ts and STANDARD_BASS_TUNING_MIDI in
// bass/layout.ts. This is exactly the convention a model keeps getting
// backwards.

import { STANDARD_TUNING_MIDI } from './guitar/layout';
import { STANDARD_BASS_TUNING_MIDI } from './bass/layout';
import { pitchClassFromMidi } from '../theory/notes';
import type { PitchClass } from '../types';

export type NeckInstrument = 'guitar' | 'bass';

const TUNING_MIDI: Record<NeckInstrument, readonly number[]> = {
  guitar: STANDARD_TUNING_MIDI,
  bass: STANDARD_BASS_TUNING_MIDI,
};

/**
 * The pitch class sounded at `string`/`fret` on the given instrument's
 * standard tuning. Returns `null` for a string or (negative) fret the
 * instrument doesn't have — this only refuses to guess, it does not decide
 * whether a position is drawable; callers that need that already have
 * their own on-neck check (`isOnNeck` in the app layer).
 */
export function pitchClassAt(
  string: number,
  fret: number,
  instrument: NeckInstrument = 'guitar',
): PitchClass | null {
  const tuning = TUNING_MIDI[instrument];
  if (!Number.isInteger(string) || string < 0 || string >= tuning.length) return null;
  if (!Number.isInteger(fret) || fret < 0) return null;
  return pitchClassFromMidi(tuning[string] + fret);
}
