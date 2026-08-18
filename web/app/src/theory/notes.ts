import { Note as TonalNote } from 'tonal';
import type { Note, PitchClass } from '../types';
import { PITCH_CLASSES } from '../types';

const SHARPS: Record<string, PitchClass> = {
  'C': 'C', 'C#': 'C#', 'Db': 'C#',
  'D': 'D', 'D#': 'D#', 'Eb': 'D#',
  'E': 'E', 'Fb': 'E',
  'E#': 'F', 'F': 'F', 'F#': 'F#', 'Gb': 'F#',
  'G': 'G', 'G#': 'G#', 'Ab': 'G#',
  'A': 'A', 'A#': 'A#', 'Bb': 'A#',
  'B': 'B', 'Cb': 'B',
  'B#': 'C',
};

export function normalizePitchClass(pc: string): PitchClass | null {
  return SHARPS[pc] ?? null;
}

/**
 * Flat-spelling enharmonic for the 5 accidentals. Naturals are unambiguous and
 * keep their name. Used when the user picks a flat key (e.g. "Bb" not "A#") so
 * tonal spells the whole scale/chord with the correct accidentals.
 */
export const FLAT_NAMES: Partial<Record<PitchClass, string>> = {
  'C#': 'Db',
  'D#': 'Eb',
  'F#': 'Gb',
  'G#': 'Ab',
  'A#': 'Bb',
};

/** The tonal-query name for a root: its flat spelling when `preferFlats`, else the sharp PC. */
export function spelledRoot(pc: PitchClass, preferFlats: boolean): string {
  return preferFlats ? FLAT_NAMES[pc] ?? pc : pc;
}

export function pitchClassFromMidi(midi: number): PitchClass {
  return PITCH_CLASSES[((midi % 12) + 12) % 12];
}

export function octaveFromMidi(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function noteFromMidi(midi: number): Note {
  return {
    pitchClass: pitchClassFromMidi(midi),
    octave: octaveFromMidi(midi),
  };
}

export function midiFromNote(note: Note): number {
  const idx = PITCH_CLASSES.indexOf(note.pitchClass);
  return (note.octave + 1) * 12 + idx;
}

export function midiFromPitchOctave(pc: PitchClass, octave: number): number {
  return midiFromNote({ pitchClass: pc, octave });
}

/**
 * Parse a tonal note name like "C4", "F#3", "Bb2" into our Note type.
 */
export function parseTonalNoteName(name: string): Note | null {
  const parsed = TonalNote.get(name);
  if (parsed.empty || parsed.midi == null) return null;
  return noteFromMidi(parsed.midi);
}

/**
 * Get the tonal-style name for a note (e.g. {pitchClass:'C#',octave:4} → "C#4").
 */
export function toTonalName(note: Note): string {
  return `${note.pitchClass}${note.octave}`;
}

/**
 * Strip a tonal note name to just its pitch class.
 */
export function pitchClassFromName(name: string): PitchClass | null {
  const props = TonalNote.get(name);
  if (props.empty) return null;
  const norm = normalizePitchClass(props.pc);
  if (norm) return norm;
  // Fall back to chroma so double-accidental spellings (e.g. "Bbb", "F##" that
  // appear in flat harmonic/melodic-minor keys) still map to a pitch class
  // instead of being silently dropped from the scale.
  if (typeof props.chroma === 'number') return PITCH_CLASSES[props.chroma];
  return null;
}

/**
 * Realize a list of pitch classes as concrete Notes that ascend monotonically
 * from `startOctave`, bumping the octave whenever the next PC would otherwise
 * dip below the previous note. So [E, F#, G, A, B, C, D] starting at octave 4
 * produces [E4, F#4, G4, A4, B4, C5, D5] — the natural ascending scale order.
 */
export function notesAscending(pcs: PitchClass[], startOctave = 4): Note[] {
  if (pcs.length === 0) return [];
  const out: Note[] = [];
  let prevMidi = -Infinity;
  let octave = startOctave;
  for (const pc of pcs) {
    let midi = midiFromPitchOctave(pc, octave);
    while (midi <= prevMidi) {
      octave += 1;
      midi = midiFromPitchOctave(pc, octave);
    }
    out.push(noteFromMidi(midi));
    prevMidi = midi;
  }
  return out;
}

/** Natural-named pitch classes. Their display label stays constant
 *  regardless of the surrounding key — F is always F (never E#), C is
 *  always C (never B#), B is always B (never Cb), etc. This avoids
 *  cluttering sharp-side scales (D# major, A# minor, ...) with the
 *  technically-correct-but-confusing double-sharp / natural-shifted
 *  spellings that tonal generates (F##, B#, etc.). Only accidental
 *  PCs (C#, D#, F#, G#, A#) get respelled between sharp/flat. */
const NATURAL_PCS: ReadonlySet<PitchClass> = new Set<PitchClass>([
  'C', 'D', 'E', 'F', 'G', 'A', 'B',
]);

/**
 * Build a PC → display-name map from a list of tonal note names. Lets the views
 * render the *correct enharmonic* for the current key for ACCIDENTAL PCs
 * (e.g. "Bb" instead of "A#" in F major) while keeping NATURAL PCs constant
 * (F stays F even when tonal would call it "E#" in C# major).
 *
 * Notes whose PC isn't in the input list fall back to the default (sharp)
 * display name.
 */
export function buildDisplayMap(
  noteNames: string[],
): Partial<Record<PitchClass, string>> {
  const out: Partial<Record<PitchClass, string>> = {};
  for (const name of noteNames) {
    const pc = pitchClassFromName(name);
    if (pc == null) continue;
    // Skip respellings of natural-named pitch classes. Tonal returns
    // "musically correct" spellings (B# for the 7th in C# major, F## for
    // the 3rd in D# major), but the resulting fretboard labels are noisy
    // and unfamiliar. Naturals always stay as their letter name.
    if (NATURAL_PCS.has(pc)) continue;
    // Only override the default if the tonal name actually differs from our PC name.
    // Strip any trailing octave digit before storing.
    const displayName = name.replace(/[0-9]/g, '');
    if (displayName !== pc) out[pc] = displayName;
  }
  return out;
}
