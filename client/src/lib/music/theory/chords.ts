import { Chord } from 'tonal';
import type { ChordQuality, ChordSelection, Note, PitchClass } from '../types';
import { midiFromPitchOctave, noteFromMidi, pitchClassFromName, spelledRoot } from './notes';

const QUALITY_TO_TONAL_SUFFIX: Record<ChordQuality, string> = {
  // Power chord (root + 5th — tonal returns [root, fifth] for "C5")
  '5': '5',
  // Triads
  maj: 'M',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  // Sixths
  '6': '6',
  m6: 'm6',
  // Sevenths
  maj7: 'maj7',
  min7: 'm7',
  dom7: '7',
  m7b5: 'm7b5',
  dim7: 'dim7',
  mMaj7: 'mMaj7',
  '7sus4': '7sus4',
  // Add
  add9: 'add9',
  madd9: 'madd9',
  // Ninths
  '9': '9',
  maj9: 'maj9',
  m9: 'm9',
  // Extensions
  '11': '11',
  m11: 'm11',
  '13': '13',
  m13: 'm13',
  // Altered dominants
  '7b5': '7b5',
  '7#5': '7#5',
  '7b9': '7b9',
  '7#9': '7#9',
  alt: '7alt',
};

export function chordSymbol(
  root: PitchClass,
  quality: ChordQuality,
  preferFlats = false,
): string {
  return `${spelledRoot(root, preferFlats)}${QUALITY_TO_TONAL_SUFFIX[quality]}`;
}

/**
 * Returns the chord's pitch classes in root order (root first), e.g. Cmaj7 → [C, E, G, B].
 */
export function getChordPitchClasses(root: PitchClass, quality: ChordQuality): PitchClass[] {
  const c = Chord.get(chordSymbol(root, quality));
  if (c.empty) return [];
  const result: PitchClass[] = [];
  for (const noteName of c.notes) {
    const pc = pitchClassFromName(noteName);
    if (pc) result.push(pc);
  }
  return result;
}

/**
 * Apply an inversion to a chord's pitch classes by rotating notes off the bottom.
 * 0 = root position, 1 = 1st inversion, etc. (mod chord size)
 */
export function applyInversion(pcs: PitchClass[], inversion: number): PitchClass[] {
  if (pcs.length === 0) return pcs;
  const k = ((inversion % pcs.length) + pcs.length) % pcs.length;
  return [...pcs.slice(k), ...pcs.slice(0, k)];
}

/**
 * Stack pitch classes upward starting from a root octave. Each next note is the lowest
 * octave that is strictly higher (in midi) than the previous — gives a closed voicing.
 */
export function stackAscending(pcs: PitchClass[], startOctave: number): Note[] {
  if (pcs.length === 0) return [];
  const out: Note[] = [];
  let prevMidi = -Infinity;
  let octave = startOctave;
  for (let i = 0; i < pcs.length; i++) {
    let midi = midiFromPitchOctave(pcs[i], octave);
    while (midi <= prevMidi) {
      octave += 1;
      midi = midiFromPitchOctave(pcs[i], octave);
    }
    out.push(noteFromMidi(midi));
    prevMidi = midi;
  }
  return out;
}

/**
 * Resolve a chord selection to its notes in root position (closed) — useful as
 * the default voicing-agnostic representation. Returns notes stacked from C4ish.
 */
export function getChordNotes(selection: ChordSelection): Note[] {
  const pcs = getChordPitchClasses(selection.root, selection.quality);
  if (pcs.length === 0) return [];
  const inverted = applyInversion(pcs, selection.inversion);
  return stackAscending(inverted, 4);
}

/**
 * Number of inversions available for a given quality (= number of notes in the chord).
 */
export function chordSize(quality: ChordQuality, root: PitchClass = 'C'): number {
  return getChordPitchClasses(root, quality).length;
}

/** Raw tonal note names for the chord (e.g. ['F','A','C','Eb'] for Fmin7). */
export function getChordNoteNames(
  root: PitchClass,
  quality: ChordQuality,
  preferFlats = false,
): string[] {
  const c = Chord.get(chordSymbol(root, quality, preferFlats));
  return c.empty ? [] : c.notes;
}
