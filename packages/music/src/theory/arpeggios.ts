// Arpeggios as positions on the neck: the chord's own tones, filtered to
// one hand position, labelled by what each one does in the chord.
//
// Why this exists rather than a diagram author typing frets: an arpeggio
// shape is arithmetic. Which notes are in the chord is arithmetic
// (`getChordPitchClasses`), what each is called is arithmetic
// (`chordDegrees`), and where they fall inside a hand position is
// arithmetic (`realizeFretWindow`). Nothing in that chain is a judgement
// call, so nothing in it should be a stored guess — the same rule this
// project already applies to timecodes (BM25-grounded rather than trusted)
// and to pitch labels (computed from the tuning, see instruments/neck.ts).
// A caller says WHAT to show; this file decides WHERE the dots go.
//
// ── Growing this ────────────────────────────────────────────────────────
// The realization is a list of SOURCES (`ARPEGGIO_SHAPE_SOURCES`), tried in
// order, each claiming the (quality, position) pairs it can draw. Today
// there is one: chord tones flooded into the CAGED window for that
// position. Richer fingerings — drop-2 voicings, wider two-octave
// stretches, sweep-picking shapes — arrive by adding a source ABOVE it that
// claims the pairs it covers.
//
// That is the point of the indirection: the parameters a caller passes
// (`root`, `quality`, `position`) do not change when the fingerings get
// better, so a richer arpeggio is a theory change here and never a schema
// change anywhere downstream. Labels are applied by `realizeArpeggio` after
// a source returns, so a new source cannot mislabel a dot, and every dot it
// returns is re-checked against the chord's tones before it escapes — a
// buggy source can draw nothing, never something wrong.

import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { pitchClassAt } from '../instruments/neck';
import { PITCH_CLASSES } from '../types';
import type { ChordQuality, PitchClass, ScalePosition } from '../types';
import { getChordPitchClasses } from './chords';
import { chordDegrees } from './degrees';
import {
  CAGED_POSITION_WINDOWS,
  TWO_OCTAVE_BOX,
  realizeFretWindow,
  shapeName,
  type FretWindowBox,
  type RealizedPosition,
} from './positions';

/**
 * Same position vocabulary the scale boxes use — deliberately not a new
 * enum. `'all'` is excluded because an arpeggio without a position is just
 * a pitch-class flood, which the instrument views already do.
 */
export type ArpeggioPosition = Exclude<ScalePosition, 'all'>;

export type ArpeggioNote = {
  /** 0 = high E … 5 = low E, this package's convention everywhere. */
  string: number;
  fret: number;
  /** Recomputed from the tuning at this position — never carried along. */
  pc: PitchClass;
  /**
   * What this tone does in the chord: 'R', '3', 'b3', '5', 'b5', 'b7',
   * 'bb7', '4', '6', '9', … The root reads 'R' rather than '1' because
   * that is how a player names it, and it is what the diagram accents.
   */
  degree: string;
  /** True for the chord root. Exactly the notes whose `pc` is the root. */
  root: boolean;
};

/**
 * Past four distinct tones a chord stops producing an arpeggio SHAPE.
 *
 * Any 4-fret window on six strings contains all twelve pitch classes, so a
 * five- or six-note chord lights up half of it — a picture indistinguishable
 * from a scale box, which is exactly the kind of plausible-looking-but-wrong
 * output this module exists to refuse. C13 has six tones; there is no
 * "C13 arpeggio position 2" to draw, and saying so is more useful than
 * drawing something.
 */
export const MAX_ARPEGGIO_TONES = 4;

/**
 * A way of turning (root, quality, position) into bare board positions.
 *
 * `positions()` is the source's claim: the positions it can draw for this
 * quality, empty when it has nothing for it. `realize()` is only ever
 * called for a position the source claimed.
 *
 * Deliberately returns `RealizedPosition[]` — string and fret, no labels.
 * Labelling belongs to `realizeArpeggio` so that every source is labelled
 * the same way and none of them can get it wrong.
 */
export type ArpeggioShapeSource = {
  readonly id: string;
  positions(quality: ChordQuality): ArpeggioPosition[];
  realize(
    root: PitchClass,
    quality: ChordQuality,
    position: ArpeggioPosition,
  ): RealizedPosition[];
};

/** The numbered CAGED positions, in the order a player works through them. */
const CAGED_POSITIONS: ArpeggioPosition[] = [1, 2, 3, 4, 5, '2oct'];

/** The window a position occupies, as offsets from the root's low-E fret. */
export function arpeggioWindow(position: ArpeggioPosition): FretWindowBox | null {
  if (position === '2oct') return TWO_OCTAVE_BOX;
  return CAGED_POSITION_WINDOWS[position] ?? null;
}

/**
 * The baseline source: every chord tone inside the position's window.
 *
 * This is the honest floor of what "the arpeggio in position N" means —
 * every note of the chord your hand can reach without moving. It is not a
 * picked fingering, and a source that offers one should sit above it.
 */
const CAGED_WINDOW_SOURCE: ArpeggioShapeSource = {
  id: 'caged-window',
  positions(quality) {
    const tones = getChordPitchClasses('C', quality);
    if (tones.length === 0 || tones.length > MAX_ARPEGGIO_TONES) return [];
    return [...CAGED_POSITIONS];
  },
  realize(root, quality, position) {
    const box = arpeggioWindow(position);
    if (!box) return [];
    return realizeFretWindow(box, root, getChordPitchClasses(root, quality));
  },
};

/**
 * The registry, in priority order — first source that claims a
 * (quality, position) pair realizes it.
 *
 * Exported read-only so tests can hold EVERY source to the same contract
 * rather than only the ones that existed when they were written; a source
 * added later is covered the day it lands. Adding one means editing this
 * array, which is the intent: the extension point is here in the theory
 * layer, not injectable from an app.
 */
export const ARPEGGIO_SHAPE_SOURCES: readonly ArpeggioShapeSource[] = [
  CAGED_WINDOW_SOURCE,
];

function sourceFor(
  quality: ChordQuality,
  position: ArpeggioPosition,
): ArpeggioShapeSource | null {
  for (const source of ARPEGGIO_SHAPE_SOURCES) {
    if (source.positions(quality).includes(position)) return source;
  }
  return null;
}

/** Numbered boxes first, then the universal two-octave window. */
function comparePositions(a: ArpeggioPosition, b: ArpeggioPosition): number {
  if (a === b) return 0;
  if (a === '2oct') return 1;
  if (b === '2oct') return -1;
  return a - b;
}

/**
 * Every position this quality can be drawn in, across all sources.
 *
 * Empty means the quality has no arpeggio shape at all — which is the
 * answer a validator should quote back, the same way `availablePositions`
 * is quoted for a scale.
 */
export function arpeggioPositions(quality: ChordQuality): ArpeggioPosition[] {
  const seen = new Set<ArpeggioPosition>();
  for (const source of ARPEGGIO_SHAPE_SOURCES) {
    for (const position of source.positions(quality)) seen.add(position);
  }
  return [...seen].sort(comparePositions);
}

/** Is there any position at all for this quality? */
export function supportsArpeggio(quality: ChordQuality): boolean {
  return arpeggioPositions(quality).length > 0;
}

/**
 * "E-shape", "A-shape", "2 octaves" — the CAGED name for the position.
 *
 * Reuses the scale-box names because they name the same hand position:
 * CAGED numbers where on the neck you are relative to the root, not what
 * chord you are playing there.
 */
export function arpeggioShapeName(position: ArpeggioPosition): string {
  return shapeName(position, 'major');
}

const midiAt = (n: { string: number; fret: number }): number =>
  STANDARD_TUNING_MIDI[n.string] + n.fret;

/**
 * The arpeggio for `root`/`quality` in one position, as labelled dots.
 *
 * Returns `[]` — never a partial or approximate shape — when the
 * combination is not one a source claims: an unsupported quality, a
 * position outside `arpeggioPositions(quality)`, a root that is not a pitch
 * class. Callers that need to explain the refusal ask
 * `arpeggioPositions()` for the legal values.
 *
 * Ordered as you would play it: ascending in pitch, lower string first
 * where two positions sound the same note.
 */
export function realizeArpeggio(
  root: PitchClass,
  quality: ChordQuality,
  position: ArpeggioPosition,
): ArpeggioNote[] {
  if (!PITCH_CLASSES.includes(root)) return [];

  const source = sourceFor(quality, position);
  if (!source) return [];

  const tones = new Set(getChordPitchClasses(root, quality));
  if (tones.size === 0) return [];
  const degrees = chordDegrees(root, quality);

  const out: ArpeggioNote[] = [];
  const seen = new Set<string>();

  for (const p of source.realize(root, quality, position)) {
    // The pitch class is recomputed here rather than taken from the source.
    // pitchClassAt() also rejects a string or fret the board does not have,
    // so an off-board position cannot reach a renderer as an invisible dot.
    const pc = pitchClassAt(p.string, p.fret, 'guitar');
    if (pc == null || !tones.has(pc)) continue;

    const degree = pc === root ? 'R' : degrees[pc];
    // Unreachable with the current labeller — chordDegrees() is built from
    // the same chord as `tones` — but an unlabelled dot is a dot whose
    // meaning the reader has to guess, so it is dropped rather than shown.
    if (!degree) continue;

    const key = `${p.string}:${p.fret}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ string: p.string, fret: p.fret, pc, degree, root: pc === root });
  }

  return out.sort((a, b) => midiAt(a) - midiAt(b) || b.string - a.string);
}
