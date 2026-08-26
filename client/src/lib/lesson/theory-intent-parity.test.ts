// Parity guard for the theory-intent tables the MCP write tools duplicate
// from @music-kb/music — and for the Strapi enums that have to agree with
// both.
//
// A theory-mode `lesson.diagram` names WHAT to show and the theory layer
// decides where the dots go. That only works if all three places agree on
// which combinations exist:
//
//   packages/music         the truth — arpeggioPositions(), scalePositions(),
//                          getScalePitchClasses()
//   server/src/mcp/tools/  hand-copied tables (it cannot import the package:
//     lesson-blocks.ts     server/tsconfig.json is CommonJS + Node10
//                          resolution and the package's subpath exports need
//                          bundler/node16 — adding the dependency fails
//                          TS2307, see that file's own comment and
//                          pitch-label-parity.test.ts, which set this
//                          precedent)
//   server/src/components/ the Strapi enums, which decide what can be
//     lesson/diagram.json  STORED at all
//
// Drift between them is silent in the worst direction: the MCP tool would
// accept a combination the realizer draws nothing for, which is the blank-
// fretboard failure this whole change exists to end. So the server file is
// read as TEXT (client never imports server/, per CLAUDE.md) and every
// table is compared against what the real functions answer.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arpeggioPositions, supportsArpeggio } from '@music-kb/music/theory/arpeggios';
import { scalePositions } from '@music-kb/music/theory/positions';
import { getScalePitchClasses } from '@music-kb/music/theory/scales';
import { CHORD_QUALITIES, SCALE_TYPES, type ChordQuality } from '@music-kb/music/types';
import {
  CHORD_INTENT_QUALITIES,
  DIAGRAM_INTENTS,
  DIAGRAM_POSITIONS,
  DIAGRAM_QUALITIES,
  DIAGRAM_SCALE_TYPES,
  toChordQuality,
} from './diagram-params';

const REPO_ROOT = resolve(process.cwd(), '..');
const MCP_BLOCKS_PATH = resolve(REPO_ROOT, 'server/src/mcp/tools/lesson-blocks.ts');
const DIAGRAM_SCHEMA_PATH = resolve(REPO_ROOT, 'server/src/components/lesson/diagram.json');

const mcpBlocksSource = readFileSync(MCP_BLOCKS_PATH, 'utf8');
const diagramSchema = JSON.parse(readFileSync(DIAGRAM_SCHEMA_PATH, 'utf8')) as {
  attributes: Record<
    string,
    { type: string; enum?: string[]; min?: number; max?: number; default?: string }
  >;
};

/**
 * Pull one `const NAME … = [ … ]` literal out of the server source and
 * parse it as JSON.
 *
 * Bracket-matched rather than regexed to the first `]`, because these
 * tables NEST (`[['maj', ['1', '2']], …]`) and a lazy regex would stop at
 * the first inner close and silently compare half a table.
 */
function extractLiteral<T>(name: string): T {
  const declaration = mcpBlocksSource.indexOf(`const ${name}`);
  if (declaration === -1) {
    throw new Error(`${MCP_BLOCKS_PATH} has no "const ${name}" — did it get renamed? This guard is now checking nothing.`);
  }
  // Scan from the `=`, not from `const NAME`: these tables carry a type
  // annotation (`ReadonlyArray<readonly [string, string]>`) whose own
  // brackets come first and would be matched instead of the value.
  const assignment = mcpBlocksSource.indexOf(' = ', declaration);
  const open = mcpBlocksSource.indexOf('[', assignment);
  let depth = 0;
  let close = -1;
  for (let i = open; i < mcpBlocksSource.length; i += 1) {
    if (mcpBlocksSource[i] === '[') depth += 1;
    else if (mcpBlocksSource[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error(`unbalanced brackets in "const ${name}"`);
  const literal = mcpBlocksSource
    .slice(open, close + 1)
    .replace(/'/g, '"')
    .replace(/,(\s*[\]}])/g, '$1');
  return JSON.parse(literal) as T;
}

const serverIntents = extractLiteral<string[]>('DIAGRAM_INTENTS');
const serverPositions = extractLiteral<string[]>('DIAGRAM_POSITIONS');
const serverLegacySpellings = extractLiteral<[string, string][]>('LEGACY_TRIAD_SPELLINGS');
const serverArpeggioPositions = extractLiteral<[string, string[]][]>('ARPEGGIO_POSITIONS');
const serverScalePositions = extractLiteral<[string, string[]][]>('SCALE_POSITIONS');
const serverScaleNoteCounts = extractLiteral<[string, number][]>('SCALE_NOTE_COUNTS');

/** The theory layer's own answer, in the string form the schemas store. */
const asStrings = (positions: readonly (number | string)[]): string[] => positions.map(String);

describe('extractLiteral (sanity check on the reader itself)', () => {
  it('read tables of the sizes the source actually declares', () => {
    // If any of these ever comes back empty, every assertion below passes
    // vacuously — which is exactly the silent-green failure this file is
    // about.
    expect(serverIntents.length).toBe(4);
    expect(serverPositions.length).toBe(6);
    expect(serverLegacySpellings.length).toBe(4);
    expect(serverArpeggioPositions.length).toBeGreaterThan(10);
    expect(serverScalePositions.length).toBe(SCALE_TYPES.length);
    expect(serverScaleNoteCounts.length).toBe(SCALE_TYPES.length);
  });
});

describe('MCP lesson-blocks.ts theory tables stay in sync with @music-kb/music', () => {
  it('DIAGRAM_INTENTS matches the client vocabulary', () => {
    expect(serverIntents).toEqual([...DIAGRAM_INTENTS]);
  });

  it('DIAGRAM_POSITIONS matches the client vocabulary', () => {
    expect(serverPositions).toEqual([...DIAGRAM_POSITIONS]);
  });

  it('the legacy triad spellings really are aliases of the canonical qualities', () => {
    for (const [spelling, canonical] of serverLegacySpellings) {
      expect(
        toChordQuality(spelling),
        `the server calls "${spelling}" an alias of "${canonical}", but the client resolves it differently`,
      ).toBe(canonical);
      expect(CHORD_QUALITIES).toContain(canonical as ChordQuality);
    }
  });

  it('ARPEGGIO_POSITIONS lists exactly the qualities that HAVE an arpeggio', () => {
    const listed = serverArpeggioPositions.map(([quality]) => quality);
    const real = CHORD_QUALITIES.filter((q) => supportsArpeggio(q));
    expect(
      listed,
      'the MCP tool would accept (or refuse) an arpeggio quality the theory layer disagrees about',
    ).toEqual(real);
  });

  it('ARPEGGIO_POSITIONS lists the right positions for every quality', () => {
    for (const [quality, positions] of serverArpeggioPositions) {
      expect(positions, `arpeggio positions for ${quality}`).toEqual(
        asStrings(arpeggioPositions(quality as ChordQuality)),
      );
    }
  });

  it('SCALE_POSITIONS lists the right positions for every scale type', () => {
    expect(serverScalePositions.map(([type]) => type)).toEqual([...SCALE_TYPES]);
    for (const [type, positions] of serverScalePositions) {
      expect(positions, `scale positions for ${type}`).toEqual(
        asStrings(scalePositions(type as (typeof SCALE_TYPES)[number])),
      );
    }
  });

  it('SCALE_NOTE_COUNTS matches how many notes each scale actually has', () => {
    for (const [type, count] of serverScaleNoteCounts) {
      expect(
        getScalePitchClasses({ root: 'C', type: type as (typeof SCALE_TYPES)[number] }).length,
        `${type} note count — this is the number of 3NPS patterns patternIndex may name`,
      ).toBe(count);
    }
  });
});

describe('the Strapi diagram schema stores exactly what both paths accept', () => {
  const attr = (name: string) => diagramSchema.attributes[name];

  it('intent', () => {
    expect(attr('intent').enum).toEqual([...DIAGRAM_INTENTS]);
    // Absent means chord — every diagram stored before intents existed.
    expect(attr('intent').default).toBe('chord');
  });

  it('quality', () => {
    expect(attr('quality').enum).toEqual([...DIAGRAM_QUALITIES]);
  });

  it('scaleType', () => {
    expect(attr('scaleType').enum).toEqual([...DIAGRAM_SCALE_TYPES]);
  });

  it('position', () => {
    expect(attr('position').enum).toEqual([...DIAGRAM_POSITIONS]);
  });

  it('patternIndex spans the longest scale, and no further', () => {
    const longest = Math.max(
      ...SCALE_TYPES.map((type) => getScalePitchClasses({ root: 'C', type }).length),
    );
    expect(attr('patternIndex').min).toBe(1);
    expect(attr('patternIndex').max).toBe(longest);
  });

  it('every chord-intent quality is one the wider quality enum also allows', () => {
    // The chord intent's list is a SUBSET, not a second vocabulary. If it
    // ever names something the enum can't store, the block validates on
    // both authoring paths and then fails at the Strapi write.
    for (const quality of CHORD_INTENT_QUALITIES) {
      expect(DIAGRAM_QUALITIES, `chord-intent quality "${quality}"`).toContain(quality);
    }
  });
});
