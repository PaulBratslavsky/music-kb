import type { PitchClass, ScalePosition, ScaleType } from '../types';
import { PITCH_CLASSES } from '../types';
import { STANDARD_TUNING_MIDI, FRET_COUNT } from '../instruments/guitar/layout';

export type RealizedPosition = { string: number; fret: number };

/* -------------------------------------------------------------------------- */
/*  Scale "box" (position) data — sourced from guitarscale.org                 */
/* -------------------------------------------------------------------------- */

/**
 * guitarscale.org is the source of truth. Each scale page (e.g.
 * https://www.guitarscale.org/c-major.html) ships numbered "box" images; we
 * transcribed them per scale type.
 *
 * Two representations, because the boxes come in two flavors:
 *
 *  - EXPLICIT (per-string fret offsets): the major-scale CAGED boxes are
 *    hand-curated fingerings that are NOT plain fret rectangles — e.g. the
 *    G-shape (box 5) reaches the G string back a fret outside the otherwise
 *    4-fret block. These five were cross-checked dot-for-dot against
 *    c_major_box1-5.png and kept verbatim.
 *
 *  - WINDOW (`{lo,hi}` fret span): for natural minor, the two pentatonics, and
 *    blues, a box is exactly *every scale note inside a fret window* anchored
 *    on the scale tonic — verified dot-for-dot against the site's c_minor /
 *    c_pentatonic_* / c_blues box images. We store just the window and
 *    regenerate the dots by note math (transpose-invariant, zero copy error).
 *    Harmonic & melodic minor use a window too: their augmented 2nd makes the
 *    site's fingerings non-rectangular, so the window yields every in-position
 *    scale note — a complete superset of the site's exact fingering (never a
 *    wrong note, never a missing one).
 *
 * Windows were read off the C-rooted box images (low-E C = fret 8), so
 * `lo/hi = boxFret - 8`.
 *
 * Modes (dorian/phrygian/lydian/mixolydian/locrian) are intentionally absent:
 * guitarscale.org's mode pages have NO box images, only the full-neck scale, so
 * in modes we show the whole scale (which already matches the site exactly).
 */

type ExplicitShape = {
  /** Fret offsets from the tonic's low-E fret, per string (0 = high E … 5 = low E). */
  positions: { string: number; fretOffset: number }[];
};

/**
 * A fret window, expressed as offsets from the tonic's low-E fret — the
 * "box" half of the two representations above.
 *
 * Public because a position is not only a scale idea. An *arpeggio*
 * position is the same hand position with a different note filter applied
 * (see `theory/arpeggios.ts`), so the window model is shared rather than
 * retyped there.
 */
export type FretWindowBox = { lo: number; hi: number };

type WindowBox = FretWindowBox;

/* ---- Major: explicit CAGED shapes, verified vs c_major_box1-5.png ---------- */

const MAJOR_SHAPES: Partial<Record<number, ExplicitShape>> = {
  // E-shape — C major frets 7-10
  1: {
    positions: [
      { string: 5, fretOffset: -1 }, { string: 5, fretOffset: 0 }, { string: 5, fretOffset: 2 },
      { string: 4, fretOffset: -1 }, { string: 4, fretOffset: 0 }, { string: 4, fretOffset: 2 },
      { string: 3, fretOffset: -1 }, { string: 3, fretOffset: 1 }, { string: 3, fretOffset: 2 },
      { string: 2, fretOffset: -1 }, { string: 2, fretOffset: 1 }, { string: 2, fretOffset: 2 },
      { string: 1, fretOffset: 0 }, { string: 1, fretOffset: 2 },
      { string: 0, fretOffset: -1 }, { string: 0, fretOffset: 0 }, { string: 0, fretOffset: 2 },
    ],
  },
  // D-shape — C major frets 10-14
  2: {
    positions: [
      { string: 5, fretOffset: 2 }, { string: 5, fretOffset: 4 }, { string: 5, fretOffset: 5 },
      { string: 4, fretOffset: 2 }, { string: 4, fretOffset: 4 }, { string: 4, fretOffset: 6 },
      { string: 3, fretOffset: 2 }, { string: 3, fretOffset: 4 }, { string: 3, fretOffset: 6 },
      { string: 2, fretOffset: 2 }, { string: 2, fretOffset: 4 },
      { string: 1, fretOffset: 2 }, { string: 1, fretOffset: 4 }, { string: 1, fretOffset: 5 },
      { string: 0, fretOffset: 2 }, { string: 0, fretOffset: 4 }, { string: 0, fretOffset: 5 },
    ],
  },
  // C-shape — C major frets 12-15
  3: {
    positions: [
      { string: 5, fretOffset: 4 }, { string: 5, fretOffset: 5 }, { string: 5, fretOffset: 7 },
      { string: 4, fretOffset: 4 }, { string: 4, fretOffset: 6 }, { string: 4, fretOffset: 7 },
      { string: 3, fretOffset: 4 }, { string: 3, fretOffset: 6 }, { string: 3, fretOffset: 7 },
      { string: 2, fretOffset: 4 }, { string: 2, fretOffset: 6 },
      { string: 1, fretOffset: 4 }, { string: 1, fretOffset: 5 }, { string: 1, fretOffset: 7 },
      { string: 0, fretOffset: 4 }, { string: 0, fretOffset: 5 }, { string: 0, fretOffset: 7 },
    ],
  },
  // A-shape — C major frets 2-6
  4: {
    positions: [
      { string: 5, fretOffset: -5 }, { string: 5, fretOffset: -3 },
      { string: 4, fretOffset: -6 }, { string: 4, fretOffset: -5 }, { string: 4, fretOffset: -3 },
      { string: 3, fretOffset: -6 }, { string: 3, fretOffset: -5 }, { string: 3, fretOffset: -3 },
      { string: 2, fretOffset: -6 }, { string: 2, fretOffset: -4 }, { string: 2, fretOffset: -3 },
      { string: 1, fretOffset: -5 }, { string: 1, fretOffset: -3 }, { string: 1, fretOffset: -2 },
      { string: 0, fretOffset: -5 }, { string: 0, fretOffset: -3 },
    ],
  },
  // G-shape — C major frets 4-8 (note the G-string reach-back to offset -4)
  5: {
    positions: [
      { string: 5, fretOffset: -3 }, { string: 5, fretOffset: -1 }, { string: 5, fretOffset: 0 },
      { string: 4, fretOffset: -3 }, { string: 4, fretOffset: -1 }, { string: 4, fretOffset: 0 },
      { string: 3, fretOffset: -3 }, { string: 3, fretOffset: -1 },
      { string: 2, fretOffset: -4 }, { string: 2, fretOffset: -3 }, { string: 2, fretOffset: -1 },
      { string: 1, fretOffset: -3 }, { string: 1, fretOffset: -2 }, { string: 1, fretOffset: 0 },
      { string: 0, fretOffset: -3 }, { string: 0, fretOffset: -1 }, { string: 0, fretOffset: 0 },
    ],
  },
};

/* ---- Window-based scales -------------------------------------------------- */

const WINDOW_BOXES: Partial<
  Record<ScaleType, Partial<Record<number, WindowBox>>>
> = {
  // C natural minor — verified pure window vs c_minor_box1-5.png
  minor: {
    1: { lo: -1, hi: 3 }, 2: { lo: 2, hi: 5 }, 3: { lo: 4, hi: 8 },
    4: { lo: -5, hi: -2 }, 5: { lo: -3, hi: 1 },
  },
  // C harmonic minor — window superset of the site's curated fingering
  harmonicMinor: {
    1: { lo: -1, hi: 3 }, 2: { lo: 2, hi: 5 }, 3: { lo: 4, hi: 8 },
    4: { lo: -6, hi: -2 }, 5: { lo: -3, hi: 1 },
  },
  // C melodic minor — window superset of the site's curated fingering
  melodicMinor: {
    1: { lo: -1, hi: 3 }, 2: { lo: 2, hi: 6 }, 3: { lo: 4, hi: 8 },
    4: { lo: -6, hi: -2 }, 5: { lo: -3, hi: 0 },
  },
  // C major pentatonic — site only ships boxes 1 and 5
  majorPentatonic: {
    1: { lo: -1, hi: 2 }, 5: { lo: -3, hi: 0 },
  },
  // C minor pentatonic — verified pure window vs c_pentatonic_minor_box1-5.png
  minorPentatonic: {
    1: { lo: 0, hi: 3 }, 2: { lo: 2, hi: 5 }, 3: { lo: 4, hi: 8 },
    4: { lo: -5, hi: -2 }, 5: { lo: -3, hi: 0 },
  },
  // C blues — verified pure window vs c_blues_box1-5.png
  blues: {
    1: { lo: 0, hi: 3 }, 2: { lo: 2, hi: 6 }, 3: { lo: -7, hi: -4 },
    4: { lo: -5, hi: -2 }, 5: { lo: -3, hi: 1 },
  },
};

const MAJOR_SHAPE_NAMES: Record<number, string> = {
  1: 'E-shape', 2: 'D-shape', 3: 'C-shape', 4: 'A-shape', 5: 'G-shape',
};

/**
 * The "2 octaves" position (guitarscale.org's compact view): one ~5-fret box
 * sitting on the 6th-string tonic. Universal — every scale, including modes,
 * gets one. Window read off C# Dorian's "2 octaves" image (tonic low-E f9,
 * box f8-12 → offsets -1..+3 from the tonic's low-E fret).
 */
const TWO_OCTAVE_WINDOW: WindowBox = { lo: -1, hi: 3 };

/** The "2 octaves" window, under a name other modules can import. */
export const TWO_OCTAVE_BOX: FretWindowBox = TWO_OCTAVE_WINDOW;

/**
 * The fret span each numbered CAGED position occupies, as offsets from the
 * root's low-E fret.
 *
 * DERIVED from `MAJOR_SHAPES` rather than typed out a second time: the span
 * of a box is exactly the lowest and highest offset its verified fingering
 * reaches, so correcting a shape moves its window with it and the two can
 * never drift. (That is why box 5 spans -4..0 rather than -3..0 — the
 * G-shape's reach-back on the G string is part of the hand position.)
 *
 * Quality-independent on purpose. CAGED numbers a *hand position relative
 * to the root*, not a chord type: the position an E-shape major lives in is
 * the position an Em shape lives in. Which notes light up inside the window
 * is what the chord decides.
 */
export const CAGED_POSITION_WINDOWS: Readonly<Record<number, FretWindowBox>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(MAJOR_SHAPES).flatMap(([n, shape]) => {
        if (!shape) return [];
        const offsets = shape.positions.map((p) => p.fretOffset);
        return [
          [Number(n), { lo: Math.min(...offsets), hi: Math.max(...offsets) }] as const,
        ];
      }),
    ),
  );

/* -------------------------------------------------------------------------- */
/*  Public API                                                                */
/* -------------------------------------------------------------------------- */

/** Position numbers the given scale type offers a box for (e.g. major → [1..5]). */
export function availablePositions(
  scaleType: ScaleType,
): Exclude<ScalePosition, 'all'>[] {
  if (scaleType === 'major') return [1, 2, 3, 4, 5];
  const boxes = WINDOW_BOXES[scaleType];
  if (!boxes) return [];
  return Object.keys(boxes)
    .map(Number)
    .sort((a, b) => a - b) as Exclude<ScalePosition, 'all'>[];
}

export function supportsCaged(scaleType: ScaleType): boolean {
  return scaleType === 'major' || WINDOW_BOXES[scaleType] != null;
}

export function shapeName(
  position: Exclude<ScalePosition, 'all'>,
  scaleType: ScaleType,
): string {
  if (position === '2oct') return '2 octaves';
  if (scaleType === 'major') return MAJOR_SHAPE_NAMES[position] ?? `Box ${position}`;
  return `Box ${position}`;
}

/** Lowest fret (0..11) on `stringIdx` whose note has pitch class `pc`. */
function lowestFretForPC(stringIdx: number, pc: PitchClass): number {
  const openMidi = STANDARD_TUNING_MIDI[stringIdx];
  const openPcIdx = ((openMidi % 12) + 12) % 12;
  const targetIdx = PITCH_CLASSES.indexOf(pc);
  return ((targetIdx - openPcIdx) % 12 + 12) % 12;
}

function realizeExplicit(
  shape: ExplicitShape,
  scaleRoot: PitchClass,
  scalePcs: PitchClass[],
): RealizedPosition[] {
  const lowE = STANDARD_TUNING_MIDI.length - 1;
  const anchor = lowestFretForPC(lowE, scaleRoot);

  const raw = shape.positions.map((p) => ({ string: p.string, fret: anchor + p.fretOffset }));
  let shifted = raw;
  if (Math.min(...raw.map((p) => p.fret)) <= 0) {
    shifted = raw.map((p) => ({ ...p, fret: p.fret + 12 }));
  }
  if (Math.max(...shifted.map((p) => p.fret)) > FRET_COUNT) {
    shifted = shifted.map((p) => ({ ...p, fret: p.fret - 12 }));
  }

  const scaleSet = new Set(scalePcs);
  return shifted
    .filter((p) => p.fret >= 0 && p.fret <= FRET_COUNT)
    .filter((p) => {
      const pc = PITCH_CLASSES[(((STANDARD_TUNING_MIDI[p.string] + p.fret) % 12) + 12) % 12];
      return scaleSet.has(pc);
    });
}

/**
 * Every position inside `box` — anchored on `root`'s low-E fret — whose
 * pitch class is one of `pcs`.
 *
 * The window slides by an octave when it would fall off either end of the
 * board, which is what makes a box a movable shape rather than a fixed set
 * of frets. Public because the note filter is the caller's business: pass
 * scale tones and you get a scale box, pass chord tones and you get the
 * arpeggio living in the same hand position.
 */
export function realizeFretWindow(
  box: WindowBox,
  scaleRoot: PitchClass,
  scalePcs: PitchClass[],
): RealizedPosition[] {
  const lowE = STANDARD_TUNING_MIDI.length - 1;
  const anchor = lowestFretForPC(lowE, scaleRoot);
  let lo = anchor + box.lo;
  let hi = anchor + box.hi;
  if (lo <= 0) {
    lo += 12;
    hi += 12;
  }
  if (hi > FRET_COUNT) {
    lo -= 12;
    hi -= 12;
  }

  const scaleSet = new Set(scalePcs);
  const out: RealizedPosition[] = [];
  const from = Math.max(0, lo);
  const to = Math.min(FRET_COUNT, hi);
  for (let s = 0; s < STANDARD_TUNING_MIDI.length; s++) {
    for (let f = from; f <= to; f++) {
      const pc = PITCH_CLASSES[(((STANDARD_TUNING_MIDI[s] + f) % 12) + 12) % 12];
      if (scaleSet.has(pc)) out.push({ string: s, fret: f });
    }
  }
  return out;
}

/**
 * Realize a scale position to the exact (string, fret) set the guitar view
 * should highlight. Major uses the verified CAGED fingerings; the other
 * supported scales use the fret-window model. Returns [] when the scale/
 * position has no box (the caller then shows the full scale).
 */
export function realizeCagedShape(
  position: Exclude<ScalePosition, 'all'>,
  scaleRoot: PitchClass,
  scalePcs: PitchClass[],
  scaleType: ScaleType,
): RealizedPosition[] {
  if (position === '2oct') {
    // Universal — applies to every scale, including modes.
    return realizeFretWindow(TWO_OCTAVE_WINDOW, scaleRoot, scalePcs);
  }
  if (typeof position !== 'number') return [];
  if (scaleType === 'major') {
    const shape = MAJOR_SHAPES[position];
    return shape ? realizeExplicit(shape, scaleRoot, scalePcs) : [];
  }
  const box = WINDOW_BOXES[scaleType]?.[position];
  return box ? realizeFretWindow(box, scaleRoot, scalePcs) : [];
}
