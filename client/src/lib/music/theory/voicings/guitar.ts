import type { ChordSelection, Note, PitchClass } from '../../types';
import {
  GUITAR_SHAPES,
  OPEN_CHORD_SHAPES,
  type GuitarShape,
  type OpenChordShape,
} from './guitar-shapes';
import { STANDARD_TUNING_MIDI, FRET_COUNT } from '../../instruments/guitar/layout';
import { midiFromPitchOctave, noteFromMidi } from '../notes';
import { PITCH_CLASSES } from '../../types';
import { getChordPitchClasses } from '../chords';

export type GuitarVoicing = {
  notes: Note[];
  shapeName: string | null;
  /**
   * (music-kb fork) Exact (string, fret) positions of the voicing, encoded as
   * `${string}-${fret}` keys to match GuitarView's `shapePositions` filter.
   * Without this, the GuitarView highlights every fretboard position whose
   * MIDI matches the voicing's notes — but the same MIDI can sit at multiple
   * (string, fret) pairs (E4 = string-1 fret-0 = string-2 fret-5 = …), so the
   * "Open Em" voicing visually scattered 18+ markers across the neck. The
   * positions set pins highlights to the actual fingering.
   *
   * null = no specific positions (the pitch-class-fallback path, when the
   * quality has no shape definition); GuitarView falls back to "every
   * position" matching, which is appropriate for that case.
   */
  positions: Set<string> | null;
};

/** Lowest fret (>=0) on `stringIdx` whose note has the given pitch class. */
function lowestFretForPC(stringIdx: number, pc: PitchClass): number {
  const openMidi = STANDARD_TUNING_MIDI[stringIdx];
  const openPcIdx = ((openMidi % 12) + 12) % 12;
  const targetIdx = PITCH_CLASSES.indexOf(pc);
  return ((targetIdx - openPcIdx) % 12 + 12) % 12;
}

/**
 * Realize a shape for a given root pitch class. Returns a list of `Note`s, one per
 * played string. If a fingering would fall off the visible fretboard (fret > FRET_COUNT
 * or fret < 0), shifts the offending position by 12 frets to bring it in range; if
 * still off, drops it. Returns null if no notes survive.
 */
function realizeShape(
  shape: GuitarShape,
  root: PitchClass,
): { notes: Note[]; positions: Set<string> } | null {
  const rootFret = lowestFretForPC(shape.rootString, root);
  const notes: Note[] = [];
  const positions = new Set<string>();
  for (let s = 0; s < shape.frets.length; s++) {
    const offset = shape.frets[s];
    if (offset == null) continue;
    let fret = rootFret + offset;
    while (fret < 0) fret += 12;
    while (fret > FRET_COUNT) fret -= 12;
    if (fret < 0 || fret > FRET_COUNT) continue;
    const midi = STANDARD_TUNING_MIDI[s] + fret;
    notes.push(noteFromMidi(midi));
    positions.add(`${s}-${fret}`);
  }
  return notes.length > 0 ? { notes, positions } : null;
}

/**
 * Realize an open-position shape: its frets are absolute (0 = open string),
 * so we just add each played string's fret to that string's open MIDI.
 */
function realizeOpenShape(shape: OpenChordShape): {
  notes: Note[];
  positions: Set<string>;
} {
  const notes: Note[] = [];
  const positions = new Set<string>();
  for (let s = 0; s < shape.frets.length; s++) {
    const fret = shape.frets[s];
    if (fret == null) continue;
    notes.push(noteFromMidi(STANDARD_TUNING_MIDI[s] + fret));
    positions.add(`${s}-${fret}`);
  }
  return { notes, positions };
}

/** Open-position shape for this exact root+quality, or null if there isn't one. */
function openShapeFor(sel: ChordSelection): OpenChordShape | null {
  return OPEN_CHORD_SHAPES[sel.quality]?.[sel.root] ?? null;
}

/**
 * Fallback when no shape is available for a quality (or all shapes fail to realize):
 * return one Note per pitch class at the lowest fretboard position. The GuitarView
 * will end up flooding all positions because we'll pass matchByPitchClass=true at
 * the call site, but for type-correctness we still return concrete notes here.
 */
function pitchClassFallback(pcs: PitchClass[]): Note[] {
  return pcs.map((pc) => noteFromMidi(midiFromPitchOctave(pc, 3)));
}

export function guitarVoicing(sel: ChordSelection): GuitarVoicing {
  const pcs = getChordPitchClasses(sel.root, sel.quality);

  // Ordered voicing list: the open-position fingering (when this exact
  // root+quality has one) comes first so it's the default, followed by the
  // movable barre shapes for the quality. `voicingIndex` selects among them.
  const voicings: GuitarVoicing[] = [];

  const open = openShapeFor(sel);
  if (open) {
    const { notes, positions } = realizeOpenShape(open);
    voicings.push({ notes, shapeName: open.name, positions });
  }

  for (const shape of GUITAR_SHAPES[sel.quality] ?? []) {
    const realized = realizeShape(shape, sel.root);
    if (realized)
      voicings.push({
        notes: realized.notes,
        shapeName: shape.name,
        positions: realized.positions,
      });
  }

  if (voicings.length === 0) {
    // No shape data → fall back to pitch-class flood (positions: null). The
    // resolve.ts caller sees positions == null and leaves guitarShapePositions
    // null too, which GuitarView's inShape treats as "anywhere goes."
    return { notes: pitchClassFallback(pcs), shapeName: null, positions: null };
  }

  const v = ((sel.voicingIndex % voicings.length) + voicings.length) % voicings.length;
  return voicings[v];
}

export function guitarVoicingCount(sel: ChordSelection): number {
  let n = (GUITAR_SHAPES[sel.quality] ?? []).length;
  if (openShapeFor(sel)) n += 1;
  return Math.max(1, n);
}

export function guitarHasShape(quality: ChordSelection['quality']): boolean {
  return (GUITAR_SHAPES[quality] ?? []).length > 0;
}
