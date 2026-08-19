import type { PianoKey, PitchClass } from '../../types';
import { PITCH_CLASSES } from '../../types';
import { midiFromPitchOctave, noteFromMidi } from '../../theory/notes';

const BLACK_KEYS: Set<PitchClass> = new Set(['C#', 'D#', 'F#', 'G#', 'A#']);

/**
 * Build a piano key list from `startMidi` (inclusive) to `endMidi` (inclusive).
 * `index` is the white-key index from the left for white keys, and the index of
 * the white key it sits between for black keys (used for X positioning).
 */
export function buildPianoLayout(startMidi: number, endMidi: number): PianoKey[] {
  const keys: PianoKey[] = [];
  let whiteIndex = 0;
  for (let m = startMidi; m <= endMidi; m++) {
    const note = noteFromMidi(m);
    const isBlack = BLACK_KEYS.has(note.pitchClass);
    keys.push({
      note,
      isBlack,
      index: whiteIndex,
    });
    if (!isBlack) whiteIndex += 1;
  }
  return keys;
}

export const DEFAULT_PIANO_RANGE = {
  start: midiFromPitchOctave('C', 3),
  end: midiFromPitchOctave('C', 6),
};

export function defaultPianoLayout(): PianoKey[] {
  return buildPianoLayout(DEFAULT_PIANO_RANGE.start, DEFAULT_PIANO_RANGE.end);
}

export function isPitchClass(p: string): p is PitchClass {
  return (PITCH_CLASSES as readonly string[]).includes(p);
}
