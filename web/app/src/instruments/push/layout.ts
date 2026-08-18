import type { PushPad } from '../../types';
import { midiFromPitchOctave, noteFromMidi } from '../../theory/notes';

export const PUSH_ROWS = 8;
export const PUSH_COLS = 8;

/**
 * Push chromatic-mode default: bottom-left is the lowest pitch,
 * +1 semitone per column to the right, +5 semitones (perfect fourth) per row up.
 * Default base pitch: C2, matching Push 2's stock chromatic-mode start note.
 */
export const PUSH_BASE_MIDI = midiFromPitchOctave('C', 2);

export function buildPushLayout(): PushPad[][] {
  const grid: PushPad[][] = [];
  for (let row = 0; row < PUSH_ROWS; row++) {
    const r: PushPad[] = [];
    for (let col = 0; col < PUSH_COLS; col++) {
      const midi = PUSH_BASE_MIDI + row * 5 + col;
      r.push({ row, col, note: noteFromMidi(midi) });
    }
    grid.push(r);
  }
  return grid;
}
