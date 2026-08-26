// Parity guard for the pitch-label correction the MCP write tools duplicate
// from @music-kb/music.
//
// server/src/mcp/tools/lesson-blocks.ts cannot import
// @music-kb/music/instruments/neck directly (confirmed by actually adding
// the dependency and running `tsc --noEmit` under server/'s CommonJS +
// default-resolution tsconfig — it fails TS2307, and the fix requires a
// global, unrelated change to how the whole Strapi server compiles). So it
// carries its own copy of STANDARD_TUNING_MIDI / STANDARD_BASS_TUNING_MIDI
// — two small arrays of MIDI numbers that must never drift from the real
// ones in packages/music, or pitch correction on the MCP path would "fix"
// dots to the WRONG note.
//
// Same stance as block-vocabulary.test.ts: `client` never imports from
// `server/` (CLAUDE.md), so the server file is read as TEXT and its
// duplicated arrays are parsed out and compared against the real constants,
// imported normally here since packages/music is exactly what `client` is
// allowed to depend on.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PITCH_CLASSES } from '@music-kb/music/types';
import { STANDARD_TUNING_MIDI } from '@music-kb/music/instruments/guitar/layout';
import { STANDARD_BASS_TUNING_MIDI } from '@music-kb/music/instruments/bass/layout';

const REPO_ROOT = resolve(process.cwd(), '..');
const MCP_BLOCKS_PATH = resolve(REPO_ROOT, 'server/src/mcp/tools/lesson-blocks.ts');
const mcpBlocksSource = readFileSync(MCP_BLOCKS_PATH, 'utf8');

// Trailing commas (this repo's own style, e.g. `[64, 59, 55, 50, 45, 40,]`
// would be fine but the source doesn't even need one) are stripped so
// JSON.parse doesn't choke on a dangling comma before `]`.
function stripTrailingComma(raw: string): string {
  return raw.replace(/,\s*$/, '');
}

function extractArray(name: string): number[] {
  const match = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(mcpBlocksSource);
  if (!match) throw new Error(`${MCP_BLOCKS_PATH} has no "const ${name} = [...]" — did it get renamed?`);
  return JSON.parse(`[${stripTrailingComma(match[1])}]`) as number[];
}

function extractPitchClasses(): string[] {
  // export const PITCH_CLASSES = [ 'C', 'C#', ... ] as const;
  const match = /export const PITCH_CLASSES = \[([^\]]*)\]/.exec(mcpBlocksSource);
  if (!match) throw new Error(`${MCP_BLOCKS_PATH} has no "export const PITCH_CLASSES = [...]".`);
  return JSON.parse(`[${stripTrailingComma(match[1].replace(/'/g, '"'))}]`) as string[];
}

describe('MCP lesson-blocks.ts duplicated tuning constants stay in sync with @music-kb/music', () => {
  it('STANDARD_TUNING_MIDI (guitar) matches the real one', () => {
    expect(extractArray('STANDARD_TUNING_MIDI')).toEqual(STANDARD_TUNING_MIDI);
  });

  it('STANDARD_BASS_TUNING_MIDI matches the real one', () => {
    expect(extractArray('STANDARD_BASS_TUNING_MIDI')).toEqual(STANDARD_BASS_TUNING_MIDI);
  });

  it('PITCH_CLASSES (the 12-tone sharps-only list) matches the real one', () => {
    expect(extractPitchClasses()).toEqual(PITCH_CLASSES);
  });
});
