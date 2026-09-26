// Fret-window repair on the MCP lesson write path (issue #10).
//
// `fromFret`/`toFret` crop the neck. A crop that misses the dots renders the
// diagram as a blank (or partial) fretboard — not an error, just nothing
// where the lesson promised a shape. The app parser widens such a window to
// fit (`applyWindowRepair` in client/src/lib/lesson/markdown-blocks.ts); the
// MCP tools used to store it exactly as sent. This applies the same repair
// and reports it, the way `correctPitchLabels` reports its corrections.
//
// Scope, deliberately narrower than the app's:
//   - Explicit-mode `lesson.diagram` and `lesson.neck-pattern`, where the dots
//     are in the block. A THEORY-mode diagram's dots are computed by
//     @music-kb/music, which the server cannot import (see
//     pitch-label-parity.test.ts), so its window cannot be checked here.
//   - A HALF-set window is not repaired but rejected by the schema, as
//     neck-pattern already was — see `diagramBlock` in lesson-blocks.ts.

import { NECK_MAX_FRET } from './lesson-blocks';

type NeckInstrument = keyof typeof NECK_MAX_FRET;

/**
 * Hand-copy of `widenNeckWindow` in client/src/lib/lesson/neck-window.ts,
 * kept identical by lesson-windows.parity.test.ts, which runs both over every
 * case that matters. Change one without the other and that test fails.
 *
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

export type WindowRepair = {
  block: number;
  component: string;
  /** Dots the authored window hid, of the block's total. */
  hidden: number;
  of: number;
  from: { fromFret: number; toFret: number };
  to: { fromFret: number; toFret: number };
};

type Block = Record<string, any>;

/** The dots a block's window has to hold, or null when they aren't known here. */
function dotsOf(block: Block): Array<{ fret: number }> | null {
  if (block.__component === 'lesson.diagram') {
    return block.mode === 'explicit' ? (block.dots ?? []) : null;
  }
  if (block.__component === 'lesson.neck-pattern') {
    // One shared window holds every pattern — it is the whole point of the
    // block that the patterns climb the neck inside a fixed frame.
    return (block.patterns ?? []).flatMap((p: Block) => p.dots ?? []);
  }
  return null;
}

/**
 * Widen, IN PLACE, every explicit window that hides any of its own dots, and
 * report each repair. A window that already shows every dot is untouched.
 */
export function repairHiddenWindows(body: Block[]): WindowRepair[] {
  const repairs: WindowRepair[] = [];
  body.forEach((block, i) => {
    if (typeof block.fromFret !== 'number' || typeof block.toFret !== 'number') return;
    const dots = dotsOf(block);
    if (!dots || dots.length === 0) return;

    const instrument: NeckInstrument = block.instrument === 'bass' ? 'bass' : 'guitar';
    // What MiniNeck shows for an explicit window: exactly this range.
    const lo = Math.max(0, block.fromFret);
    const hi = Math.min(NECK_MAX_FRET[instrument], block.toFret);
    const hidden = dots.filter((d) => d.fret < lo || d.fret > hi).length;
    if (hidden === 0) return;

    const from = { fromFret: block.fromFret, toFret: block.toFret };
    const to = widenNeckWindow(dots, instrument, block.fromFret, block.toFret);
    block.fromFret = to.fromFret;
    block.toFret = to.toFret;
    repairs.push({ block: i, component: block.__component, hidden, of: dots.length, from, to });
  });
  return repairs;
}
