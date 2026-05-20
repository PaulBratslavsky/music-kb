import type { ChordSelection, Note, PitchClass } from '../../types';
import { applyInversion, getChordPitchClasses, stackAscending } from '../chords';
import { midiFromPitchOctave, noteFromMidi } from '../notes';

const BASE_OCTAVE = 4; // closed voicings centered around C4 (middle C)

/**
 * Voicing 0 — closed, root position with inversion applied.
 *   Stack the (possibly inverted) chord notes ascending in the smallest octave space.
 *
 * Voicing 1 — drop-2 style:
 *   Take the closed voicing and drop its second-from-top note down an octave.
 *   For triads this approximates an "open spread" voicing.
 *
 * Voicing 2 — wide spread:
 *   Root in lower octave, the rest of the closed voicing one octave up.
 */
export function pianoVoicing(sel: ChordSelection): Note[] {
  const pcs = getChordPitchClasses(sel.root, sel.quality);
  if (pcs.length === 0) return [];
  const inverted = applyInversion(pcs, sel.inversion);
  const closed = stackAscending(inverted, BASE_OCTAVE);
  const v = ((sel.voicingIndex % 3) + 3) % 3;

  if (v === 0) return closed;

  if (v === 1) {
    // Drop-2: lower the second-highest note by an octave.
    if (closed.length < 2) return closed;
    const dropIdx = closed.length - 2;
    const out = closed.map((n) => ({ ...n }));
    const dropped: Note = { ...out[dropIdx], octave: out[dropIdx].octave - 1 };
    out.splice(dropIdx, 1);
    out.unshift(dropped);
    return sortByMidi(out);
  }

  // v === 2 — wide spread: root one octave below, rest as closed (no inversion).
  const rootPc: PitchClass = sel.root;
  const rest = pcs.filter((p, i) => i !== 0 || p !== rootPc);
  // Build "rest" as a closed stack starting at BASE_OCTAVE
  const restNotes = stackAscending(rest, BASE_OCTAVE);
  const lowRoot = noteFromMidi(midiFromPitchOctave(rootPc, BASE_OCTAVE - 1));
  return sortByMidi([lowRoot, ...restNotes]);
}

function sortByMidi(notes: Note[]): Note[] {
  return [...notes].sort(
    (a, b) => midiFromPitchOctave(a.pitchClass, a.octave) - midiFromPitchOctave(b.pitchClass, b.octave),
  );
}

export const PIANO_VOICING_COUNT = 3;
