import type { GuitarPosition } from '../../types';
import { midiFromPitchOctave, noteFromMidi } from '../../theory/notes';

/**
 * Standard tuning, indexed from highest pitch (string 0 = high E) to lowest (string 5 = low E).
 * Spec calls these:
 *   string 0 = high E (E4)
 *   string 5 = low E  (E2)
 */
export const STANDARD_TUNING_MIDI: number[] = [
  midiFromPitchOctave('E', 4), // string 0 — high E
  midiFromPitchOctave('B', 3), // string 1
  midiFromPitchOctave('G', 3), // string 2
  midiFromPitchOctave('D', 3), // string 3
  midiFromPitchOctave('A', 2), // string 4
  midiFromPitchOctave('E', 2), // string 5 — low E
];

export const FRET_COUNT = 15; // visible frets beyond the nut. Total positions per string = 16.

export function buildGuitarLayout(): GuitarPosition[][] {
  const grid: GuitarPosition[][] = [];
  for (let s = 0; s < STANDARD_TUNING_MIDI.length; s++) {
    const stringRow: GuitarPosition[] = [];
    for (let f = 0; f <= FRET_COUNT; f++) {
      const midi = STANDARD_TUNING_MIDI[s] + f;
      stringRow.push({ string: s, fret: f, note: noteFromMidi(midi) });
    }
    grid.push(stringRow);
  }
  return grid;
}
