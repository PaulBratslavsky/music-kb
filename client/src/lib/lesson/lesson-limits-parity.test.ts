// Parity guard for the lesson limits and neck bounds the MCP write tools
// hand-copy from this parser (issue #10).
//
// A lesson reaches Strapi two ways: this app's markdown parser, and the MCP
// `createLesson` / `updateLesson` tools, validated by
// server/src/mcp/tools/lesson-blocks.ts. The server can't import client code
// (or @music-kb/music — see pitch-label-parity.test.ts), so it keeps its own
// copy of each number. The two used to disagree outright: the server capped
// none of these and let a bass diagram draw on strings 4 and 5.
//
// Drift here is silent in the bad direction — a block one path rejects, the
// other saves and renders off the board. So the server file is read as TEXT
// (client never imports server/, per CLAUDE.md) and every number is compared
// with the constant the parser actually uses.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NECK_MAX_FRET, NECK_STRING_COUNT } from './diagram-params';
import { LESSON_LIMITS } from './markdown-blocks';

const SERVER_BLOCKS = readFileSync(
  resolve(process.cwd(), '..', 'server/src/mcp/tools/lesson-blocks.ts'),
  'utf8',
);

/** The `{ key: value, … }` literal assigned to `export const <name> =`. */
function objectLiteral(name: string): string {
  const m = SERVER_BLOCKS.match(new RegExp(`export const ${name} = \\{([\\s\\S]*?)\\} as const;`));
  if (!m) throw new Error(`server lesson-blocks.ts no longer exports ${name} — update this guard`);
  return m[1];
}

/** Numeric `key: 123` entries of an object literal. Expressions are skipped. */
function numericEntries(literal: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [, key, value] of literal.matchAll(/(\w+):\s*(\d+)\s*,/g)) out[key] = Number(value);
  return out;
}

describe('the MCP write tools use the same neck as the parser', () => {
  it('NECK_MAX_FRET', () => {
    expect(numericEntries(objectLiteral('NECK_MAX_FRET') + ',')).toEqual({ ...NECK_MAX_FRET });
  });

  it('NECK_STRING_COUNT', () => {
    expect(numericEntries(objectLiteral('NECK_STRING_COUNT') + ',')).toEqual({ ...NECK_STRING_COUNT });
  });
});

describe('the MCP write tools use the same runaway limits as the parser', () => {
  const server = objectLiteral('LESSON_LIMITS');

  it('every literal limit matches', () => {
    const literal = numericEntries(server);
    // diagramDots is an expression on the server, checked separately below.
    const { diagramDots: _derived, ...clientLiterals } = LESSON_LIMITS;
    expect(literal).toEqual(clientLiterals);
  });

  it('diagramDots is derived from the neck on both sides, not hard-coded', () => {
    // Both sides compute it as every position on the largest board. Keeping
    // it an expression is what makes the neck parity above cover it too.
    expect(server).toMatch(
      /diagramDots:\s*NECK_STRING_COUNT\.guitar\s*\*\s*\(NECK_MAX_FRET\.guitar\s*\+\s*1\)/,
    );
    expect(LESSON_LIMITS.diagramDots).toBe(NECK_STRING_COUNT.guitar * (NECK_MAX_FRET.guitar + 1));
  });

  it('the guard sees every limit the parser exports', () => {
    // Guards the guard: a limit added to the parser's table but not the
    // server's would otherwise pass the equality above only if both sides
    // happened to omit it.
    expect(Object.keys(numericEntries(server)).sort()).toEqual(
      Object.keys(LESSON_LIMITS)
        .filter((k) => k !== 'diagramDots')
        .sort(),
    );
  });
});
