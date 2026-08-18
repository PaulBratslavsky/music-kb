// Progression Composer — pure resolution of scale degrees to MIDI notes
// plus schedule construction. Deterministic and side-effect-free so it
// can be unit-tested without audio; the hook (useCompositionPlayback) is
// the only piece that touches the synth and timers.

import type { Note, PitchClass, ScaleSelection, ScaleType } from '@music-kb/music/types';
import { midiFromNote, notesAscending } from '@music-kb/music/theory/notes';
import { getScalePitchClasses } from '@music-kb/music/theory/scales';
import { getDiatonicChords } from '@music-kb/music/theory/diatonic';
import type { Composition, Degree, KeyMode } from './types';
import { TICKS_PER_BEAT, TOTAL_TICKS } from './types';

// Octave bands per track. Chords in the middle, melody on top, bass
// underneath, so the three layers don't collide.
const CHORD_OCTAVE = 3;
const MELODY_OCTAVE = 4;
const BASS_OCTAVE = 2;

function modeToScaleType(mode: KeyMode): ScaleType {
  return mode === 'major' ? 'major' : 'minor';
}

export function keyToScaleSelection(comp: Composition): ScaleSelection {
  return { root: comp.key.root, type: modeToScaleType(comp.key.mode) };
}

/**
 * The seven scale degrees as ascending Notes from `startOctave`. Uses
 * notesAscending so a degree's pitch always rises with its number even
 * when the key wraps the octave (A-minor: degree 3 = C an octave up).
 */
function ascendingDegreeNotes(
  selection: ScaleSelection,
  startOctave: number,
): Note[] {
  return notesAscending(getScalePitchClasses(selection), startOctave);
}

type DegreeRef = { degree: Degree; octave: 0 | 1 };

function degreeToMidi(
  selection: ScaleSelection,
  ref: DegreeRef,
  baseOctave: number,
): number | null {
  const notes = ascendingDegreeNotes(selection, baseOctave);
  const base = notes[ref.degree - 1];
  if (!base) return null;
  return midiFromNote(base) + 12 * ref.octave;
}

export function resolveMelodyMidi(
  comp: Composition,
  ref: DegreeRef,
): number | null {
  return degreeToMidi(keyToScaleSelection(comp), ref, MELODY_OCTAVE);
}

export function resolveBassMidi(
  comp: Composition,
  ref: DegreeRef,
): number | null {
  // Bass is single-band: ignore the octave offset.
  return degreeToMidi(
    keyToScaleSelection(comp),
    { degree: ref.degree, octave: 0 },
    BASS_OCTAVE,
  );
}

/**
 * Chord MIDI for the chord on `degree`, voiced close from CHORD_OCTAVE.
 * Triad (root/3rd/5th) by default; the four-note seventh (root/3rd/5th/7th)
 * when `seventh` is set. getDiatonicChords already supplies all four tones.
 */
export function resolveChordMidis(
  comp: Composition,
  degree: Degree,
  seventh = false,
): number[] {
  const selection = keyToScaleSelection(comp);
  const chord = getDiatonicChords(selection).find((c) => c.degree === degree);
  if (!chord) return [];
  const pcs: PitchClass[] = chord.pitchClasses.slice(0, seventh ? 4 : 3);
  return notesAscending(pcs, CHORD_OCTAVE).map(midiFromNote);
}

/** One tick's worth of notes to fire, with each layer's sustain in ticks. */
export type StepEvent = {
  step: number;
  chord?: number[];
  chordTicks?: number;
  melody?: number;
  melodyTicks?: number;
  bass?: number;
  bassTicks?: number;
};

/**
 * Flatten a composition into a per-tick event list. Each span (chord,
 * melody, bass) fires once on its start tick and carries its length so
 * playback can sustain it. Ticks with nothing to play are omitted; the
 * result is sorted by tick.
 */
export function buildSchedule(comp: Composition): StepEvent[] {
  const byStep = new Map<number, StepEvent>();
  const ensure = (step: number): StepEvent => {
    let e = byStep.get(step);
    if (!e) {
      e = { step };
      byStep.set(step, e);
    }
    return e;
  };

  for (const span of comp.chords) {
    const midis = resolveChordMidis(comp, span.degree, span.seventh);
    if (midis.length) {
      const e = ensure(span.start);
      e.chord = midis;
      e.chordTicks = span.length;
    }
  }
  for (const note of comp.melody) {
    const midi = resolveMelodyMidi(comp, note);
    if (midi != null) {
      const e = ensure(note.start);
      e.melody = midi;
      e.melodyTicks = note.length;
    }
  }
  for (const note of comp.bass) {
    const midi = resolveBassMidi(comp, note);
    if (midi != null) {
      const e = ensure(note.start);
      e.bass = midi;
      e.bassTicks = note.length;
    }
  }

  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

/** Milliseconds per beat at the composition's tempo. */
export function msPerBeat(bpm: number): number {
  return 60_000 / bpm;
}

/** Milliseconds per tick (sixteenth) at the composition's tempo. */
export function msPerTick(bpm: number): number {
  return msPerBeat(bpm) / TICKS_PER_BEAT;
}

export { TOTAL_TICKS };
