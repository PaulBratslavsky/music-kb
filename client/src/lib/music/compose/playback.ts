// Progression Composer — pure resolution of scale degrees to concrete
// MIDI notes, plus schedule construction. Everything here is
// deterministic and side-effect-free so it can be unit-tested without
// audio; the React hook (useCompositionPlayback) is the only piece that
// touches the synth and timers.

import type { Note, PitchClass, ScaleSelection, ScaleType } from '../types';
import { midiFromNote, notesAscending } from '../theory/notes';
import { getScalePitchClasses } from '../theory/scales';
import { getDiatonicChords } from '../theory/diatonic';
import type { Composition, Degree, DegreeCell, KeyMode } from './types';
import { TOTAL_STEPS } from './types';

// Octave bands for each track. Chord triads sit in the middle, melody on
// top, bass underneath — chosen so the three layers don't collide when
// played together.
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
 * The seven scale degrees realized as ascending Notes starting at
 * `startOctave`. Uses notesAscending so a degree's pitch always rises
 * with its number even when the key wraps the octave (e.g. A-minor:
 * degree 1 = A, degree 3 = C an octave up, not C below A).
 */
function ascendingDegreeNotes(
  selection: ScaleSelection,
  startOctave: number,
): Note[] {
  const pcs = getScalePitchClasses(selection);
  return notesAscending(pcs, startOctave);
}

/** MIDI for a melody/bass cell. `band` shifts the base octave (melody vs bass). */
function degreeCellToMidi(
  selection: ScaleSelection,
  cell: DegreeCell,
  baseOctave: number,
): number | null {
  const notes = ascendingDegreeNotes(selection, baseOctave);
  const base = notes[cell.degree - 1];
  if (!base) return null;
  return midiFromNote(base) + 12 * cell.octave;
}

export function resolveMelodyMidi(
  comp: Composition,
  cell: DegreeCell,
): number | null {
  return degreeCellToMidi(keyToScaleSelection(comp), cell, MELODY_OCTAVE);
}

export function resolveBassMidi(
  comp: Composition,
  cell: DegreeCell,
): number | null {
  // Bass ignores the octave offset — it's single-band by design.
  return degreeCellToMidi(
    keyToScaleSelection(comp),
    { degree: cell.degree, octave: 0 },
    BASS_OCTAVE,
  );
}

/**
 * The triad MIDI notes for a chord placed on `degree` in this key.
 * Triad only (root/3rd/5th) — the 7th from getDiatonicChords is dropped
 * for now. Realized ascending from CHORD_OCTAVE so the voicing is close.
 */
export function resolveChordMidis(
  comp: Composition,
  degree: Degree,
): number[] {
  const selection = keyToScaleSelection(comp);
  const chords = getDiatonicChords(selection);
  const chord = chords.find((c) => c.degree === degree);
  if (!chord) return [];
  const triadPcs: PitchClass[] = chord.pitchClasses.slice(0, 3);
  return notesAscending(triadPcs, CHORD_OCTAVE).map(midiFromNote);
}

/** One beat's worth of notes to fire. step is 0-based across all 8 bars. */
export type StepEvent = {
  step: number;
  /** Chord triad MIDI notes — present on a chord span's first beat. */
  chord?: number[];
  /** How many beats the chord should sustain (its span length). */
  chordBeats?: number;
  melody?: number;
  bass?: number;
};

/**
 * Flatten a composition into a per-step event list. Each chord span fires
 * once on its start beat and carries its length so playback can sustain
 * it; melody/bass fire on their own step. Steps with nothing to play are
 * omitted, so the schedule is sparse and sorted by step.
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
    const midis = resolveChordMidis(comp, span.degree);
    if (midis.length) {
      const e = ensure(span.start);
      e.chord = midis;
      e.chordBeats = span.length;
    }
  }

  for (let step = 0; step < TOTAL_STEPS; step++) {
    const mel = comp.melody[step];
    if (mel) {
      const midi = resolveMelodyMidi(comp, mel);
      if (midi != null) ensure(step).melody = midi;
    }
    const bass = comp.bass[step];
    if (bass) {
      const midi = resolveBassMidi(comp, bass);
      if (midi != null) ensure(step).bass = midi;
    }
  }

  return [...byStep.values()].sort((a, b) => a.step - b.step);
}

/** Milliseconds per beat at the composition's tempo. */
export function msPerBeat(bpm: number): number {
  return 60_000 / bpm;
}
