import type { ChordSelection, Note } from '../../types';
import { getChordPitchClasses } from '../chords';
import { midiFromPitchOctave, noteFromMidi } from '../notes';

/**
 * Push has no traditional "voicing" — the chromatic-fourths grid repeats the same
 * notes across the whole grid by design, and PushView lights up every pad whose
 * pitch class matches. We just return one representative `Note` per chord pitch
 * class (octave is irrelevant downstream).
 */
export function pushVoicing(sel: ChordSelection): Note[] {
  const pcs = getChordPitchClasses(sel.root, sel.quality);
  return pcs.map((pc) => noteFromMidi(midiFromPitchOctave(pc, 3)));
}
