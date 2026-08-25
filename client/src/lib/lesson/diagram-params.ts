// Translates a stored `diagram` block into the explicit dots MiniNeck wants.
//
// Blocks store musical *parameters* (root/quality/string-set) rather than
// rendered dots, so a diagram stays correct if the theory layer changes and
// so phase-2 AI generation can emit something small and typed. MiniNeck is a
// dumb renderer that takes NeckDot[] — this module is the single place that
// bridges the two, which also makes it the single place a wrong diagram can
// come from. Hence the tests.

import {
  STRING_SETS,
  triadVoicing,
  type Inversion,
  type TriadQuality,
} from '@music-kb/music/theory/triad-shapes';
import { PITCH_CLASSES, type PitchClass } from '@music-kb/music/types';

// Structurally a subset of MiniNeck's own `NeckDot` — every field here
// exists there with the same meaning, so a resolved dot can be handed
// straight to the renderer. The four style flags (dim/hollow/ringed/light)
// are what let ONE diagram carry two layers of meaning: scale tones under
// chord tones, or "where your hand is" against "where else that note
// lives". MiniNeck.tsx's doc comment on each is the authority on what they
// look like; the lesson.neck-dot schema and docs/lesson-authoring.md
// mirror them.
export type NeckDotInput = {
  string: number;
  fret: number;
  label?: string;
  root?: boolean;
  dim?: boolean;
  hollow?: boolean;
  ringed?: boolean;
  light?: boolean;
};

export type DiagramBlock = {
  instrument: string;
  mode: 'theory' | 'explicit';
  root?: string | null;
  quality?: string | null;
  /** One of the STRING_SETS names, e.g. "e–B–G". */
  stringSet?: string | null;
  inversion?: number | null;
  useParam?: boolean | null;
  dots?: NeckDotInput[] | null;
};

const TRIAD_QUALITIES = new Set([
  'major',
  'minor',
  'augmented',
  'diminished',
]);

/**
 * Resolve a diagram block to dots.
 *
 * `paramValue` is the lesson-level parameter's current value; it wins over
 * the block's own `root` when the block sets `useParam`.
 *
 * Returns `[]` rather than throwing when a shape can't be realised — an
 * unrenderable diagram should leave a gap, not take down the lesson.
 */
export function resolveDiagramDots(
  block: DiagramBlock,
  paramValue?: string,
): NeckDotInput[] {
  if (block.mode === 'explicit') return block.dots ?? [];

  const root = (block.useParam && paramValue ? paramValue : block.root) as
    | PitchClass
    | undefined;
  if (!root || !block.quality) {
    console.warn(
      `[resolveDiagramDots] mode=theory needs root+quality; got root=${JSON.stringify(root)} quality=${JSON.stringify(block.quality)}`,
    );
    return [];
  }
  if (!PITCH_CLASSES.includes(root)) {
    console.warn(`[resolveDiagramDots] root "${root}" is not a valid pitch class`);
    return [];
  }
  if (!TRIAD_QUALITIES.has(block.quality)) {
    console.warn(`[resolveDiagramDots] quality "${block.quality}" is not a renderable triad quality`);
    return [];
  }

  // stringSet arrives as one of the four names in STRING_SETS ("e–B–G",
  // "B–G–D", "G–D–A", "D–A–E") rather than a raw [0,1,2] array — a closed
  // enum an LLM cannot get wrong, and a name a guitarist already knows.
  // Conditionally required: mode=theory needs it to voice a triad, but it
  // cannot be marked `required` in the schema because mode=explicit never
  // uses it — so a missing/invalid value fails closed here, silently but
  // for this warning.
  const set = STRING_SETS.find((s) => s.name === block.stringSet);
  if (!set) {
    console.warn(
      `[resolveDiagramDots] mode=theory needs a valid stringSet; got ${JSON.stringify(block.stringSet)}`,
    );
    return [];
  }

  const voicing = triadVoicing(
    root,
    block.quality as TriadQuality,
    set,
    (block.inversion ?? 0) as Inversion,
  );
  if (!voicing) {
    console.warn(
      `[resolveDiagramDots] triadVoicing() could not resolve root=${root} quality=${block.quality} stringSet=${block.stringSet}`,
    );
    return [];
  }

  // triadVoicing() returns `notes: { string, fret, pc, role }[]` — there is
  // no `label`/`isRoot` field. `role` is one of 'R' / '3' / '5' (with
  // quality-specific accidentals, e.g. '♭3'), matching the existing usage
  // in the hand-written triads lesson (now web/src/lessons/triads.tsx): the
  // role string doubles as the dot label,
  // and the root dot is the one whose role is literally 'R'.
  return voicing.notes.map((n) => ({
    string: n.string,
    fret: n.fret,
    label: n.role,
    root: n.role === 'R',
  }));
}

// -----------------------------------------------------------------------------
// What the renderer will actually DRAW
// -----------------------------------------------------------------------------
//
// Resolving a diagram is only half of "does this draw something". MiniNeck
// then picks a fret WINDOW and clips to it — and when the block carries an
// explicit `fromFret`/`toFret`, that window always wins over the dots. A
// triad that resolves at frets 7–9 inside a block that says `fromFret=0
// toFret=5` resolves fine and renders a completely empty fretboard.
//
// So the geometry below mirrors MiniNeck's own `resolveWindow` + `visible`
// filter, exactly, and the parse-time check in markdown-blocks.ts runs it.
// A mirror is a drift risk, so `diagram-params.test.ts` renders the REAL
// MiniNeck into jsdom and asserts this module predicts exactly the dots it
// draws: change either side alone and the suite fails. (The honest fix is
// for MiniNeck to import `resolveNeckWindow` from here — it cannot happen
// in this commit because that file is being edited elsewhere.)

/** MiniNeck's `MAX_FRET`. Higher than a real board so a 14th-fret shape isn't clipped. */
export const NECK_MAX_FRET = { guitar: 22, bass: 20 } as const;
/** MiniNeck's `GUITAR_STRINGS` / `BASS_STRINGS` lengths. */
export const NECK_STRING_COUNT = { guitar: 6, bass: 4 } as const;
/** MiniNeck's `minSpan` default — no caller passes another value. */
export const NECK_MIN_SPAN = 5;

export type NeckInstrument = keyof typeof NECK_MAX_FRET;

/** The renderer's own narrowing: anything that isn't 'bass' draws a guitar. */
export function asNeckInstrument(value: unknown): NeckInstrument {
  return value === 'bass' ? 'bass' : 'guitar';
}

/** Mirrors `resolveWindow` in MiniNeck.tsx. Keep the two identical. */
export function resolveNeckWindow(
  dots: readonly { fret: number }[],
  instrument: NeckInstrument,
  fromFret?: number,
  toFret?: number,
  minSpan: number = NECK_MIN_SPAN,
): { lo: number; hi: number } {
  const maxFret = NECK_MAX_FRET[instrument];
  if (fromFret != null && toFret != null) {
    return { lo: Math.max(0, fromFret), hi: Math.min(maxFret, toFret) };
  }
  if (dots.length === 0) return { lo: 0, hi: minSpan };

  const frets = dots.map((d) => d.fret);
  let lo = Math.max(0, Math.min(...frets) - 1);
  let hi = Math.min(maxFret, Math.max(...frets) + 1);
  if (frets.includes(0)) lo = 0;
  while (hi - lo < minSpan && hi < maxFret) hi += 1;
  while (hi - lo < minSpan && lo > 0) lo -= 1;
  return { lo, hi };
}

/**
 * Is there a position on this board for the dot at all?
 *
 * MiniNeck indexes strings by array position and does NOT bounds-check
 * them: `string=5` on a bass is drawn at a y outside the svg's own
 * viewBox, so it vanishes without clipping anything else. A fret past the
 * last one is clipped by the window instead. Both are invisible dots that
 * validate, which is why this is a separate predicate from the window —
 * a window repair cannot rescue them.
 */
export function isOnNeck(
  dot: { string: number; fret: number },
  instrument: NeckInstrument,
): boolean {
  return (
    Number.isInteger(dot.string) &&
    dot.string >= 0 &&
    dot.string < NECK_STRING_COUNT[instrument] &&
    Number.isInteger(dot.fret) &&
    dot.fret >= 0 &&
    dot.fret <= NECK_MAX_FRET[instrument]
  );
}

/**
 * The dots a reader will actually see: on the board AND inside the window
 * MiniNeck picks for this `fromFret`/`toFret` pair. Returning fewer than
 * it was given is the whole signal — see `markdown-blocks.ts`.
 */
export function visibleNeckDots<T extends { string: number; fret: number }>(
  dots: readonly T[],
  instrument: NeckInstrument,
  fromFret?: number,
  toFret?: number,
  minSpan: number = NECK_MIN_SPAN,
): T[] {
  const { lo, hi } = resolveNeckWindow(dots, instrument, fromFret, toFret, minSpan);
  return dots.filter((d) => isOnNeck(d, instrument) && d.fret >= lo && d.fret <= hi);
}

/**
 * The window that shows every one of `dots` — the author's own window
 * WIDENED to fit rather than replaced, so a deliberately wide framing
 * survives the repair. Padded one fret either side and pinned to the nut
 * by an open string, the same two rules MiniNeck's auto-fit uses, because
 * a dot sitting exactly on `lo` is drawn in the open-string gutter to the
 * left of the nut instead of on the board.
 */
export function widenNeckWindow(
  dots: readonly { fret: number }[],
  instrument: NeckInstrument,
  fromFret: number,
  toFret: number,
): { fromFret: number; toFret: number } {
  const maxFret = NECK_MAX_FRET[instrument];
  const frets = dots.map((d) => d.fret).filter((f) => f >= 0 && f <= maxFret);
  if (frets.length === 0) return { fromFret, toFret };
  const needLo = frets.includes(0) ? 0 : Math.max(0, Math.min(...frets) - 1);
  const needHi = Math.min(maxFret, Math.max(...frets) + 1);
  return {
    fromFret: Math.max(0, Math.min(fromFret, needLo)),
    toFret: Math.min(maxFret, Math.max(toFret, needHi)),
  };
}

export type KeyMarkInput = {
  pc: PitchClass;
  label?: string;
  root?: boolean;
  flag?: boolean;
};

export type KeyboardDiagramBlock = {
  mode: 'theory' | 'explicit';
  root?: string | null;
  quality?: string | null;
  useParam?: boolean | null;
  octaves?: number | null;
  marks?: KeyMarkInput[] | null;
};

/**
 * Resolve a keyboard-diagram block to marks for MiniKeyboard.
 *
 * Same rules as resolveDiagramDots: explicit mode passes marks through
 * unchanged, theory mode derives them from root/quality via triadVoicing().
 * A keyboard has no strings, but triadVoicing() needs a string set to
 * compute fret positions — it's only used here to get at
 * `TriadVoicing.notes[].pc`, and pc is derived purely from root/quality/
 * inversion (PITCH_CLASSES[(rootIdx + intervals[which]) % 12]), never from
 * which string set was passed in. So any entry in STRING_SETS produces the
 * same pitch classes; STRING_SETS[0] is used because it's the first one.
 */
export function resolveDiagramMarks(
  block: KeyboardDiagramBlock,
  paramValue?: string,
): KeyMarkInput[] {
  if (block.mode === 'explicit') return block.marks ?? [];

  const root = (block.useParam && paramValue ? paramValue : block.root) as
    | PitchClass
    | undefined;
  if (!root || !block.quality) {
    console.warn(
      `[resolveDiagramMarks] mode=theory needs root+quality; got root=${JSON.stringify(root)} quality=${JSON.stringify(block.quality)}`,
    );
    return [];
  }
  if (!PITCH_CLASSES.includes(root)) {
    console.warn(`[resolveDiagramMarks] root "${root}" is not a valid pitch class`);
    return [];
  }
  if (!TRIAD_QUALITIES.has(block.quality)) {
    console.warn(`[resolveDiagramMarks] quality "${block.quality}" is not a renderable triad quality`);
    return [];
  }

  const voicing = triadVoicing(
    root,
    block.quality as TriadQuality,
    STRING_SETS[0],
    0,
  );
  if (!voicing) {
    console.warn(
      `[resolveDiagramMarks] triadVoicing() could not resolve root=${root} quality=${block.quality}`,
    );
    return [];
  }

  return voicing.notes.map((n) => ({
    pc: n.pc,
    label: n.role,
    root: n.role === 'R',
  }));
}
