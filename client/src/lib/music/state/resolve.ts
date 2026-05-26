import type {
  AppState,
  ChordSelection,
  Note,
  PitchClass,
  ResolvedSelection,
  ScaleSelection,
} from '../types';
import { PITCH_CLASSES } from '../types';
import { getChordNoteNames, getChordPitchClasses } from '../theory/chords';
import { getScaleNoteNames, getScalePitchClasses, SCALE_TYPE_LABELS } from '../theory/scales';
import { buildDisplayMap, notesAscending, spelledRoot } from '../theory/notes';
import { pianoVoicing } from '../theory/voicings/piano';
import { guitarVoicing, guitarHasShape, guitarVoicingCount } from '../theory/voicings/guitar';
import { pushVoicing } from '../theory/voicings/push';
import { degreesForSelection } from '../theory/degrees';
import {
  realizeCagedShape,
  shapeName,
  supportsCaged,
} from '../theory/positions';
import { getDiatonicChords } from '../theory/diatonic';
import { QUALITY_LABELS } from '../theory/quality-labels';

function ordinal(n: number): string {
  if (n === 0) return 'root position';
  if (n === 1) return '1st inversion';
  if (n === 2) return '2nd inversion';
  if (n === 3) return '3rd inversion';
  return `${n}th inversion`;
}

function notesFromPitchClasses(pcs: PitchClass[]): Note[] {
  return pcs.map((pc) => ({ pitchClass: pc, octave: 4 }));
}


export type ResolvedExtras = ResolvedSelection & {
  pianoMatchByPitchClass: boolean;
  guitarMatchByPitchClass: boolean;
  pcDegrees: Partial<Record<PitchClass, string>>;
  /** PC → enharmonic display name in the current key (e.g. "A#" → "Bb" in F major). */
  pcDisplay: Partial<Record<PitchClass, string>>;
  /**
   * When a 3NPS scale shape is active, this is the exact set of (string, fret)
   * pairs the GuitarView should highlight. Encoded as `${string}-${fret}`.
   * `null` means show all matching positions (no shape filter).
   */
  guitarShapePositions: Set<string> | null;
  /**
   * (music-kb fork) Resolved barre for the current chord-mode voicing.
   * null in scale/note/all modes, and null for chord voicings without a
   * barre (open chords, two-finger power chord, etc.). See
   * voicings/guitar.ts:GuitarVoicing.barre.
   */
  guitarBarre: { fret: number; fromString: number; toString: number } | null;
  /**
   * Pitch classes that belong to the previewed diatonic chord (scale mode only).
   * When set, views render scale notes that aren't in this set as dimmed, and
   * the chord's root takes over from the scale's root for color emphasis.
   */
  previewedChordPCs: Set<PitchClass> | null;
  previewedChordRoot: PitchClass | null;
};

export function resolveSelection(
  state: AppState,
  previewedChordDegree: number | null = null,
): ResolvedExtras {
  const pcDegrees = degreesForSelection(state.mode, state.chord, state.scale, state.singleNote);
  if (state.mode === 'chord') {
    const piano = pianoVoicing(state.chord);
    const { notes: guitar, shapeName, positions, barre } = guitarVoicing(state.chord);
    const push = pushVoicing(state.chord);

    const pcs = getChordPitchClasses(state.chord.root, state.chord.quality);
    const safeInv = pcs.length === 0 ? 0 : ((state.chord.inversion % pcs.length) + pcs.length) % pcs.length;

    const rootLabel = spelledRoot(state.chord.root, state.preferFlats);
    const labelBase = `${rootLabel}${QUALITY_LABELS[state.chord.quality]}`;
    const shapeStr = shapeName ? `, ${shapeName}` : ', all positions';
    const label = `${labelBase} — ${ordinal(safeInv)}${shapeStr}`;

    return {
      piano,
      guitar,
      // Bass uses pitch-class matching, so just reuse the guitar notes —
      // their PCs are what BassView reads.
      bass: guitar,
      push,
      rootPitchClass: state.chord.root,
      label,
      pianoMatchByPitchClass: false,
      guitarMatchByPitchClass: !guitarHasShape(state.chord.quality),
      pcDegrees,
      pcDisplay: buildDisplayMap(
        getChordNoteNames(state.chord.root, state.chord.quality, state.preferFlats),
      ),
      // (music-kb fork) Pin chord highlights to the exact voicing's (string,fret)
      // tuples — without this, the same MIDI gets lit at every fretboard position
      // it can be played on, scattering 18+ markers across the neck for a 6-note
      // open chord. See voicings/guitar.ts:GuitarVoicing.positions.
      guitarShapePositions: positions,
      guitarBarre: barre,
      previewedChordPCs: null,
      previewedChordRoot: null,
    };
  }
  if (state.mode === 'scale') {
    const pcs = getScalePitchClasses(state.scale);
    // Generate notes in true ascending order from the scale root (so E minor
    // gives E4, F#4, G4, A4, B4, C5, D5 — not midi-sorted starting from C4).
    const notes = notesAscending(pcs, 4);
    const pcDisplay = buildDisplayMap(getScaleNoteNames(state.scale, state.preferFlats));
    const label = `${spelledRoot(state.scale.root, state.preferFlats)} ${SCALE_TYPE_LABELS[state.scale.type]}`;

    // CAGED position selector — only affects the guitar view. Piano + Push
    // always show the full scale (mirroring guitar fingering on piano is
    // confusing because piano has no "positions").
    let shapePositions: Set<string> | null = null;
    let positionLabel = '';
    const posActive =
      state.scalePosition === '2oct' ||
      (state.scalePosition !== 'all' && supportsCaged(state.scale.type));
    if (posActive && state.scalePosition !== 'all') {
      const realized = realizeCagedShape(
        state.scalePosition,
        state.scale.root,
        pcs,
        state.scale.type,
      );
      if (realized.length > 0) {
        shapePositions = new Set(realized.map((p) => `${p.string}-${p.fret}`));
        positionLabel =
          state.scalePosition === '2oct'
            ? ' — 2 octaves'
            : ` — Shape ${state.scalePosition} (${shapeName(state.scalePosition, state.scale.type)})`;
      }
    }

    // Diatonic-chord preview: when set, we compute the chord's PCs and let the
    // views light those notes "extra" while keeping the rest of the scale visible.
    let previewedChordPCs: Set<PitchClass> | null = null;
    let previewedChordRoot: PitchClass | null = null;
    let previewLabel = '';
    if (previewedChordDegree != null) {
      const chords = getDiatonicChords(state.scale, state.preferFlats);
      const chord = chords.find((c) => c.degree === previewedChordDegree);
      if (chord) {
        // Highlight just the triad (root, 3rd, 5th) for clarity — the 7th would
        // light another scale note that often looks like noise. The chip name
        // still shows the full 7th-chord (Am7, Cmaj7, etc.).
        previewedChordPCs = new Set(chord.pitchClasses.slice(0, 3));
        previewedChordRoot = chord.root;
        previewLabel = `   →   ${chord.roman} ${chord.chordName}`;
      }
    }

    return {
      piano: notes,
      guitar: notes,
      bass: notes,
      push: notes,
      rootPitchClass: previewedChordRoot ?? state.scale.root,
      label: label + positionLabel + previewLabel,
      pianoMatchByPitchClass: true,
      guitarMatchByPitchClass: true,
      pcDegrees,
      pcDisplay,
      guitarShapePositions: shapePositions,
      guitarBarre: null,
      previewedChordPCs,
      previewedChordRoot,
    };
  }
  if (state.mode === 'note') {
    const pc = state.singleNote;
    const notes = notesFromPitchClasses([pc]);
    const noteName = spelledRoot(pc, state.preferFlats);
    return {
      piano: notes,
      guitar: notes,
      bass: notes,
      push: notes,
      rootPitchClass: pc,
      label: `Note — ${noteName}`,
      pianoMatchByPitchClass: true,
      guitarMatchByPitchClass: true,
      pcDegrees,
      pcDisplay: noteName === pc ? {} : { [pc]: noteName },
      guitarShapePositions: null,
      guitarBarre: null,
      previewedChordPCs: null,
      previewedChordRoot: null,
    };
  }
  // mode === 'all' — every position lights up with its note name.
  const allNotes = notesFromPitchClasses([...PITCH_CLASSES]);
  return {
    piano: allNotes,
    guitar: allNotes,
    bass: allNotes,
    push: allNotes,
    rootPitchClass: null,
    label: 'All notes',
    pianoMatchByPitchClass: true,
    guitarMatchByPitchClass: true,
    pcDegrees: {},
    pcDisplay: {},
    guitarShapePositions: null,
    guitarBarre: null,
    previewedChordPCs: null,
    previewedChordRoot: null,
  };
}

export function chordInversionCount(selection: ChordSelection): number {
  return getChordPitchClasses(selection.root, selection.quality).length;
}

/** Number of voicing options for current chord (for the SelectionBar stepper). */
export function chordVoicingCount(selection: ChordSelection): number {
  // Piano always has 3 voicings; guitar varies by quality (and root, when an
  // open-position shape exists). Use the larger so the user can dial through
  // both — out-of-range guitar voicings wrap inside guitarVoicing.
  return Math.max(3, guitarVoicingCount(selection));
}

export function scaleLabel(sel: ScaleSelection): string {
  return `${sel.root} ${SCALE_TYPE_LABELS[sel.type]}`;
}
