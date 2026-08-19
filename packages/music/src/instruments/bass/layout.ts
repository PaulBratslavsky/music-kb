// 4-string bass layout — standard tuning is the bottom 4 strings of a
// guitar, one octave lower: E1, A1, D2, G2 (low to high). String index
// follows the same convention as guitar — 0 = highest pitch (G2),
// 3 = lowest pitch (E1).

import type { GuitarPosition } from '../../types';
import { midiFromPitchOctave, noteFromMidi } from '../../theory/notes';

/** Standard 4-string bass tuning, indexed [highG, D, A, lowE]. */
export const STANDARD_BASS_TUNING_MIDI: number[] = [
  midiFromPitchOctave('G', 2), // string 0 — high G  (G2)
  midiFromPitchOctave('D', 2), // string 1 — D       (D2)
  midiFromPitchOctave('A', 1), // string 2 — A       (A1)
  midiFromPitchOctave('E', 1), // string 3 — low E   (E1)
];

/** Most basses have 20–24 frets; 20 is the most common minimum and keeps
 *  the diagram a manageable width next to the guitar view. */
export const BASS_FRET_COUNT = 20;

export function buildBassLayout(): GuitarPosition[][] {
  const grid: GuitarPosition[][] = [];
  for (let s = 0; s < STANDARD_BASS_TUNING_MIDI.length; s++) {
    const stringRow: GuitarPosition[] = [];
    for (let f = 0; f <= BASS_FRET_COUNT; f++) {
      const midi = STANDARD_BASS_TUNING_MIDI[s] + f;
      stringRow.push({ string: s, fret: f, note: noteFromMidi(midi) });
    }
    grid.push(stringRow);
  }
  return grid;
}
