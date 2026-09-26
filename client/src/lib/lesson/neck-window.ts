// The fretboard's size, and the one window repair both lesson paths apply.
//
// This module has ZERO imports, on purpose. The MCP write tools keep a
// hand-copy of `widenNeckWindow` (server/src/mcp/tools/lesson-windows.ts):
// server production code cannot import client code (CLAUDE.md). A module with
// no imports is the one kind the server suite may import in a TEST, to
// compare the two copies by BEHAVIOUR rather than by text — CLAUDE.md: "A
// cross-package guard goes in ... the server suite if it compares BEHAVIOUR
// ... permitted only for dependency-free modules, and the guard must assert
// that dependency-freedom itself." It does: adding an import here fails
// server/src/mcp/tools/lesson-windows.parity.test.ts.

/** MiniNeck's `MAX_FRET`. Higher than a real board so a 14th-fret shape isn't clipped. */
export const NECK_MAX_FRET = { guitar: 22, bass: 20 } as const;
/** MiniNeck's `GUITAR_STRINGS` / `BASS_STRINGS` lengths. */
export const NECK_STRING_COUNT = { guitar: 6, bass: 4 } as const;

export type NeckInstrument = keyof typeof NECK_MAX_FRET;

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
