// The MCP tools' copy of `widenNeckWindow` behaves exactly like the app's.
//
// Server production code cannot import client code (CLAUDE.md), so the MCP
// write tools keep a hand-copy (lesson-windows.ts). A copy that drifts would
// repair a window differently on the two paths — the same lesson, a different
// board. This compares them by BEHAVIOUR, over every combination that matters.
//
// That is permitted only because client/src/lib/lesson/neck-window.ts has no
// imports (CLAUDE.md: a behavioural cross-package guard may import the other
// package's source "only for dependency-free modules, and the guard must
// assert that dependency-freedom itself"). The last test does.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NECK_MAX_FRET as CLIENT_NECK_MAX_FRET,
  widenNeckWindow as clientWiden,
} from '../../../../client/src/lib/lesson/neck-window';
import { NECK_MAX_FRET } from './lesson-blocks';
import { widenNeckWindow as serverWiden } from './lesson-windows';

const INSTRUMENTS = ['guitar', 'bass'] as const;

/** Dot sets that exercise each branch: open strings, the top fret, off-board frets, empty. */
const DOT_SETS: Array<Array<{ fret: number }>> = [
  [],
  [{ fret: 0 }],
  [{ fret: 3 }],
  [{ fret: 5 }, { fret: 7 }],
  [{ fret: 0 }, { fret: 12 }],
  [{ fret: 20 }],
  [{ fret: 22 }],
  [{ fret: 9 }, { fret: 30 }], // one off the board: ignored by both
  [{ fret: -1 }, { fret: 4 }],
];
const WINDOWS: Array<[number, number]> = [
  [0, 4],
  [2, 6],
  [5, 9],
  [10, 14],
  [18, 22],
  [0, 22],
  [8, 3], // inverted: an author mistake, still mustn't diverge
];

describe('widenNeckWindow: server copy === client original', () => {
  const cases = INSTRUMENTS.flatMap((instrument) =>
    DOT_SETS.flatMap((dots) =>
      WINDOWS.map(([fromFret, toFret]) => ({ instrument, dots, fromFret, toFret })),
    ),
  );

  it(`agrees on all ${cases.length} cases`, () => {
    const disagreements = cases.filter(
      ({ instrument, dots, fromFret, toFret }) =>
        JSON.stringify(serverWiden(dots, instrument, fromFret, toFret)) !==
        JSON.stringify(clientWiden(dots, instrument, fromFret, toFret)),
    );
    expect(disagreements).toEqual([]);
  });

  it('both read the same board size', () => {
    expect({ ...NECK_MAX_FRET }).toEqual({ ...CLIENT_NECK_MAX_FRET });
  });

  it('the client module is still dependency-free — the condition this guard relies on', () => {
    const src = readFileSync(
      new URL('../../../../client/src/lib/lesson/neck-window.ts', import.meta.url),
      'utf8',
    );
    expect(src.match(/^\s*import\b/gm) ?? []).toEqual([]);
    expect(src).not.toMatch(/\brequire\(/);
  });
});
