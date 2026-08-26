// The first executable test in server/. Everything else that pins a
// server-side guarantee lives in the CLIENT suite and reads server files off
// disk as TEXT (pitch-label-parity, theory-intent-parity, block-vocabulary,
// mcp-tool-permissions, embeddings.parity) — that stance is deliberate and
// stays, but it can only check STATIC agreement between two tables. This file
// checks what the validator actually DOES.
//
// It imports only `./lesson-blocks` and vitest, mirroring its target's own
// single-dependency property (zod and nothing else). No `strapi` mock, no
// bootstrap. Adding the second server test file should stay this cheap.
//
// Note the honest cost, recorded here rather than in a doc nobody reads:
// server/tsconfig.json excludes `**/*.test.*`, and vitest strips types without
// checking them, so THIS FILE IS TYPECHECKED BY NOTHING. Every import below
// fails loudly at runtime if an export is renamed, which is the trade.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LESSON_BLOCK_COMPONENTS,
  correctPitchLabels,
  lessonBlockSchema,
  lessonBodySchema,
  lessonParameterSchema,
} from './lesson-blocks';

/**
 * The tool-call error the model actually receives: the MCP SDK's
 * `validateToolInput` reports every issue's `message` plus its dot-path. So
 * flattening to `path: message` is the shape under test, not a convenience.
 */
const messages = (result: { success: boolean; error?: any }): string =>
  result.success ? '' : result.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('\n');

const parseBlock = (block: unknown) => lessonBlockSchema.safeParse(block);
const parseBody = (body: unknown) => lessonBodySchema.safeParse(body);

/** Parse a body or throw with the real messages — fixture setup, not an assertion. */
const parsedBody = (body: unknown): any => {
  const result = parseBody(body);
  if (!result.success) throw new Error(`fixture does not parse:\n${messages(result)}`);
  return result.data;
};

const sixOpenStrings = () => [0, 1, 2, 3, 4, 5].map((string) => ({ string, state: 'open' }));

/**
 * One MINIMAL VALID instance per block type. Used by the two loops that have
 * to cover all 13 (strict-key rejection, `__component`-first). Keep this in
 * step with the union: a new block type with no row here will surface as a
 * missing case in both loops rather than as silence.
 */
const MINIMAL_BLOCKS: Record<string, Record<string, unknown>> = {
  'lesson.prose': { body: 'x' },
  'lesson.heading': { text: 'x' },
  'lesson.callout': { body: 'x' },
  'lesson.step': { number: 1, title: 'x' },
  'lesson.diagram': { mode: 'theory', intent: 'chord', root: 'C', quality: 'maj', stringSet: 'e–B–G' },
  'lesson.keyboard-diagram': { mode: 'theory', root: 'C', quality: 'major' },
  'lesson.chord-diagram': { strings: sixOpenStrings() },
  'lesson.neck-pattern': {
    patterns: [
      { label: 'a', dots: [{ string: 0, fret: 1 }] },
      { label: 'b', dots: [{ string: 0, fret: 2 }] },
    ],
  },
  'lesson.natural-notes': {},
  'lesson.degree-chips': { degrees: ['1'] },
  'lesson.table': { headers: ['h'], rows: [['c']] },
  'lesson.param-picker': {},
  'lesson.video-ref': { videoId: 'abc' },
};

const MINIMAL_ENTRIES = Object.entries(MINIMAL_BLOCKS);

// -----------------------------------------------------------------------------

describe('block vocabulary', () => {
  // LESSON_BLOCK_COMPONENTS is derived from the union's own `__component`
  // literals, so asserting it against the union (or against zod's own
  // discriminator message, which is generated from that same union) is a
  // tautology — both sides move together and nothing can be detected.
  // Strapi's dynamic zone is an INDEPENDENT source, on disk, in this package:
  // it is the list of components the database will actually accept. A block
  // added to one and not the other is the drift that matters.
  it('matches the Strapi dynamic zone exactly', () => {
    const schemaPath = new URL('../../api/lesson/content-types/lesson/schema.json', import.meta.url);
    const zone: string[] = JSON.parse(readFileSync(schemaPath, 'utf8')).attributes.body.components;
    expect([...LESSON_BLOCK_COMPONENTS].sort()).toEqual([...zone].sort());
  });
});

describe('unknown keys are rejected, never silently dropped', () => {
  // The file's stated motivation: zod's DEFAULT behaviour strips an unknown
  // key, so `boxy` instead of `body` would save a lesson that renders with a
  // gap and no error anywhere. Every object schema is `.strict()` on purpose;
  // this loop is what makes dropping one of those calls visible.
  it.each(MINIMAL_ENTRIES)('%s rejects a misspelled field', (component, fields) => {
    const result = parseBlock({ __component: component, ...fields, boxy: 'oops' });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Unrecognized key');
  });

  // The block-level loop cannot reach the nested schemas, which are where the
  // detail lives — a dropped `.strict()` there is just as silent.
  it('lesson.neck-dot rejects a misspelled field', () => {
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'explicit',
      dots: [{ string: 0, fret: 1, frets: 2 }],
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Unrecognized key');
  });

  it('lesson.chord-string rejects a misspelled field', () => {
    const strings = sixOpenStrings();
    (strings[0] as Record<string, unknown>).fingr = 1;
    const result = parseBlock({ __component: 'lesson.chord-diagram', strings });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Unrecognized key');
  });

  it('a neck-pattern item rejects a misspelled field', () => {
    const result = parseBlock({
      __component: 'lesson.neck-pattern',
      patterns: [
        { label: 'a', dots: [{ string: 0, fret: 1 }], subtitle: 'oops' },
        { label: 'b', dots: [{ string: 0, fret: 2 }] },
      ],
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Unrecognized key');
  });

  it('a keyboard mark rejects a misspelled field', () => {
    const result = parseBlock({
      __component: 'lesson.keyboard-diagram',
      mode: 'explicit',
      marks: [{ pc: 'C', rooot: true }],
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Unrecognized key');
  });

  it('a block source rejects a misspelled field', () => {
    const result = parseBlock({
      __component: 'lesson.prose',
      body: 'x',
      source: { videoId: 'abc', tSec: 12 },
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Unrecognized key');
  });
});

describe('every block schema declares __component first', () => {
  // zod emits parsed object keys in SCHEMA-DECLARATION order, not input order
  // (verified: `{ body, __component }` in parses out as `['__component',
  // 'body']`). The write tools hand zod's parsed output straight on as the
  // dynamic zone — `create-lesson.ts` does `body: args.body` — and CLAUDE.md's
  // gotcha is that `__component` must be the FIRST key when a dynamic zone
  // goes over Strapi's REST API, which rejects it with `Invalid key
  // __component at body` and says nothing about ordering. Declaring a field
  // above `__component` in any block below is therefore a real hazard with a
  // uniquely unhelpful error, and it is invisible to every other test.
  it.each(MINIMAL_ENTRIES)('%s emits __component first', (component, fields) => {
    // __component deliberately LAST in the input, so passing means the schema
    // reordered it rather than the fixture happening to be in the right order.
    const result = parseBlock({ ...fields, __component: component });
    expect(result.success).toBe(true);
    expect(Object.keys((result as any).data)[0]).toBe('__component');
  });
});

describe('theory diagrams: the COMBINATION is validated, not just the enums', () => {
  const scaleDiagram = (scaleType: string, position: string) => ({
    __component: 'lesson.diagram',
    mode: 'theory',
    intent: 'scale',
    root: 'A',
    scaleType,
    position,
  });

  // The highest-value group. The source's own comment records that "four blank
  // fretboards reached published lessons" through exactly this hole: four legal
  // enum values naming a box the scale does not ship, realized as an empty
  // array. The client's theory-intent-parity.test.ts compares the TABLE to the
  // real theory functions; this asserts the VALIDATOR'S VERDICT, which is the
  // thing that actually failed. A refactor that stops consulting
  // SCALE_POSITION_MAP passes that test and fails this one.
  it.each([
    ['majorPentatonic', '1', true],
    ['majorPentatonic', '5', true],
    ['majorPentatonic', '2', false],
    ['majorPentatonic', '3', false],
    ['dorian', '2oct', true],
    ['dorian', '1', false],
    ['mixolydian', '4', false],
    ['major', '3', true],
    ['blues', '5', true],
  ])('scaleType=%s position=%s is accepted=%s', (scaleType, position, accepted) => {
    expect(parseBlock(scaleDiagram(scaleType as string, position as string)).success).toBe(accepted);
  });

  it('quotes the legal boxes back when a scale position does not exist', () => {
    // A refusal that stops naming the legal set leaves the model to guess.
    const result = parseBlock(scaleDiagram('majorPentatonic', '2'));
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Legal values: 1, 5, 2oct');
  });

  it('says a modal scale ships no numbered boxes at all', () => {
    const result = parseBlock(scaleDiagram('dorian', '1'));
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('ships no numbered CAGED boxes');
  });

  it('refuses a non-triad quality for intent="chord"', () => {
    // triadVoicing() does triads and nothing else, so `quality: "maj7"` here
    // returns [] and renders as a blank fretboard — the named failure class
    // this whole file exists to stop. Nothing else in the repo covers it.
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'theory',
      intent: 'chord',
      root: 'C',
      quality: 'maj7',
      stringSet: 'e–B–G',
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('voices a TRIAD');
    expect(messages(result)).toContain('intent="arpeggio"');
    // The refusal has to name the legal set, not just say no: this message is
    // read by a model that then has to pick a different quality, and "maj7 is
    // not a triad" without the list leaves it guessing which ones are.
    expect(messages(result)).toContain('Legal values: major, minor, augmented, diminished, maj, min, aug, dim');
  });

  it('accepts every legacy triad spelling for intent="chord"', () => {
    for (const quality of ['major', 'minor', 'augmented', 'diminished', 'maj', 'min', 'aug', 'dim']) {
      const result = parseBlock({
        __component: 'lesson.diagram',
        mode: 'theory',
        intent: 'chord',
        root: 'C',
        quality,
        stringSet: 'e–B–G',
      });
      expect(result.success, `quality=${quality} should be a legal triad: ${messages(result)}`).toBe(true);
    }
  });

  it('requires stringSet for intent="chord" and names the legal sets', () => {
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'theory',
      intent: 'chord',
      root: 'C',
      quality: 'maj',
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('stringSet is required for intent="chord"');
  });

  it('requires position for intent="arpeggio" and quotes the legal set', () => {
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'theory',
      intent: 'arpeggio',
      root: 'A',
      quality: 'maj7',
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('position is required for intent="arpeggio"');
    expect(messages(result)).toContain('1, 2, 3, 4, 5, 2oct');
  });

  // SCALE_NOTE_COUNTS is the other non-uniform table (5 / 6 / 7) and it gates a
  // different silent failure: pattern N starts on scale degree N, so pattern 6
  // of a five-note scale realizes nothing.
  it.each([
    ['majorPentatonic', 5, true],
    ['majorPentatonic', 6, false],
    ['blues', 6, true],
    ['blues', 7, false],
    ['major', 7, true],
  ])('scaleType=%s patternIndex=%s is accepted=%s', (scaleType, patternIndex, accepted) => {
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'theory',
      intent: 'pattern',
      root: 'A',
      scaleType,
      patternIndex,
    });
    expect(result.success).toBe(accepted);
  });

  it('names the real pattern count when patternIndex is past it', () => {
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'theory',
      intent: 'pattern',
      root: 'A',
      scaleType: 'majorPentatonic',
      patternIndex: 6,
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Legal values: 1–5');
  });

  it('refuses mode="theory" on a bass', () => {
    // The only refusal anywhere: validateTheoryDiagram never reads
    // block.instrument, and LessonBody.tsx still hands guitar dots to a bass
    // MiniNeck. Single point of failure for the whole bass/theory hazard.
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'theory',
      instrument: 'bass',
      intent: 'chord',
      root: 'C',
      quality: 'major',
      stringSet: 'e–B–G',
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('guitar tuning');
  });

  it('requires root when mode="theory" and useParam is absent', () => {
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'theory',
      intent: 'chord',
      quality: 'maj',
      stringSet: 'e–B–G',
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('root is required when mode="theory"');
  });

  it('accepts a theory diagram with no root when useParam is true', () => {
    // The reader-controlled key supplies root at render time; demanding one
    // here would make every parameterised lesson unauthorable.
    const result = parseBlock({
      __component: 'lesson.diagram',
      mode: 'theory',
      intent: 'chord',
      useParam: true,
      quality: 'maj',
      stringSet: 'e–B–G',
    });
    expect(result.success, messages(result)).toBe(true);
  });
});

describe('the en-dash trap', () => {
  const chordWith = (stringSet: string) => ({
    __component: 'lesson.diagram',
    mode: 'theory',
    intent: 'chord',
    root: 'C',
    quality: 'maj',
    stringSet,
  });

  it('names the exact replacement when a stringSet uses ASCII hyphens', () => {
    // Asserting on "EN DASH" alone does NOT distinguish this branch from the
    // generic fallback below — the fallback contains that phrase and the legal
    // set too. `Use "…" instead` is what only the hyphen branch says, and the
    // whole point of that branch is telling the model the fix rather than
    // re-listing an enum it already read.
    const result = parseBlock(chordWith('e-B-G'));
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Use "e–B–G" instead');
  });

  it('falls back to listing the legal sets for an unrecognisable stringSet', () => {
    const result = parseBlock(chordWith('x–y–z'));
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('stringSet must be one of');
    expect(messages(result)).toContain('EN DASH U+2013');
  });
});

describe('refusals whose alternative is a silent gap', () => {
  it('rejects mode="explicit" with no dots', () => {
    const result = parseBlock({ __component: 'lesson.diagram', mode: 'explicit', dots: [] });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('at least one entry in `dots`');
  });

  it('rejects a keyboard diagram in mode="explicit" with no marks', () => {
    const result = parseBlock({ __component: 'lesson.keyboard-diagram', mode: 'explicit', marks: [] });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('at least one entry in `marks`');
  });

  it('rejects a chord diagram missing a string, naming the index', () => {
    // A missing string renders MUTED, which is a different chord, silently.
    const result = parseBlock({
      __component: 'lesson.chord-diagram',
      strings: sixOpenStrings().filter((s) => s.string !== 3),
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('missing an entry for string index 3');
  });

  it('rejects a chord diagram that lists one string twice', () => {
    const strings = sixOpenStrings();
    strings[5].string = 4;
    const result = parseBlock({ __component: 'lesson.chord-diagram', strings });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('must appear exactly once');
  });

  it('rejects a partial barre', () => {
    const result = parseBlock({
      __component: 'lesson.chord-diagram',
      strings: sixOpenStrings(),
      barreFret: 3,
      barreFromString: 0,
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('all three of barreFret, barreFromString and barreToString');
  });

  it('rejects state="fretted" with no fret', () => {
    const strings = sixOpenStrings();
    (strings[0] as Record<string, unknown>).state = 'fretted';
    const result = parseBlock({ __component: 'lesson.chord-diagram', strings });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('state="fretted" requires `fret`');
  });

  it('rejects a table row whose cell count does not match the headers', () => {
    const result = parseBlock({
      __component: 'lesson.table',
      headers: ['a', 'b'],
      rows: [['1', '2'], ['1']],
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('rows[1] has 1 cell(s) but headers has 2 column(s)');
  });

  it('rejects a neck-pattern with only one pattern', () => {
    const result = parseBlock({
      __component: 'lesson.neck-pattern',
      patterns: [{ label: 'only', dots: [{ string: 0, fret: 1 }] }],
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('at least 2 patterns');
  });

  it('rejects a neck-pattern entry with no dots, naming the pill', () => {
    const result = parseBlock({
      __component: 'lesson.neck-pattern',
      patterns: [
        { label: 'Box 1', dots: [{ string: 0, fret: 1 }] },
        { label: 'Box 2', dots: [] },
      ],
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('Pattern "Box 2" has no dots');
  });

  it('rejects a half-set fret window on a neck-pattern', () => {
    // NOTE: lesson.diagram carries the same two fields twelve lines away and
    // does NOT check this — `{ fromFret: 5 }` alone, and even an inverted
    // window like 12→3, parse clean there. That asymmetry is a real gap in
    // lesson.diagram, deliberately left as a gap rather than fixed inside a
    // task about adding a test runner; fixing it changes what the write tools
    // accept for already-stored lessons and wants its own blast-radius call.
    const result = parseBlock({
      __component: 'lesson.neck-pattern',
      fromFret: 5,
      patterns: [
        { label: 'a', dots: [{ string: 0, fret: 1 }] },
        { label: 'b', dots: [{ string: 0, fret: 2 }] },
      ],
    });
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('must be set together');
  });

  it('rejects an empty body', () => {
    const result = parseBody([]);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('body must contain at least one block');
  });
});

describe('bounds: the value ONE STEP past legal is the one that gets tried', () => {
  // Every bound below is the only thing between a plausible-looking value and
  // a diagram that draws the wrong thing (or a Strapi write that overflows a
  // column). Each case asserts BOTH sides of the edge on purpose: a bound
  // that is merely LOOSENED — .max(5) to .max(11), .min(1) to .min(0) — still
  // accepts every legal value, so a test that only tries a wildly illegal
  // number never notices.
  const dotDiagram = (dot: Record<string, unknown>) => ({
    __component: 'lesson.diagram',
    mode: 'explicit',
    dots: [dot],
  });

  const theoryChord = (fields: Record<string, unknown>) => ({
    __component: 'lesson.diagram',
    mode: 'theory',
    intent: 'chord',
    root: 'C',
    quality: 'maj',
    stringSet: 'e–B–G',
    ...fields,
  });

  const chordDiagramWithFirstString = (first: Record<string, unknown>) => {
    const strings = sixOpenStrings();
    strings[0] = first as any;
    return { __component: 'lesson.chord-diagram', strings };
  };

  it('neck dot string: 5 is the low E, 6 is off a six-string board', () => {
    const legal = parseBlock(dotDiagram({ string: 5, fret: 1 }));
    expect(legal.success, messages(legal)).toBe(true);
    expect(
      parseBlock(dotDiagram({ string: 6, fret: 1 })).success,
      'string 6 does not exist — a wider max silently turns the neck into a 12-string',
    ).toBe(false);
  });

  it('neck dot fret: 0 is the open string, -1 is not a position', () => {
    const legal = parseBlock(dotDiagram({ string: 0, fret: 0 }));
    expect(legal.success, messages(legal)).toBe(true);
    expect(parseBlock(dotDiagram({ string: 0, fret: -1 })).success, 'there is no fret behind the nut').toBe(false);
  });

  it('chord string fret: 1 is the first fret, 0 contradicts state="open"', () => {
    const fretted = (fret: number) => parseBlock(chordDiagramWithFirstString({ string: 0, state: 'fretted', fret }));
    expect(fretted(1).success, messages(fretted(1))).toBe(true);
    expect(
      fretted(0).success,
      'fret 0 IS the open string, which the field\'s own describe() spells state="open"',
    ).toBe(false);
  });

  it('diagram inversion: 2 is the second inversion, 3 is not one a triad has', () => {
    const legal = parseBlock(theoryChord({ inversion: 2 }));
    expect(legal.success, messages(legal)).toBe(true);
    expect(
      parseBlock(theoryChord({ inversion: 3 })).success,
      'a three-note chord has three inversions, 0-2 — nothing rejects a 5th one further down',
    ).toBe(false);
  });

  it('diagram patternIndex: 1 is the first pattern, 0 is not a scale degree', () => {
    // The superRefine below only guards the UPPER bound (patternIndex >
    // noteCount), so `.min(1)` is the entire lower guard — nothing downstream
    // would refuse pattern 0.
    const pattern = (patternIndex: number) =>
      parseBlock({
        __component: 'lesson.diagram',
        mode: 'theory',
        intent: 'pattern',
        root: 'A',
        scaleType: 'major',
        patternIndex,
      });
    expect(pattern(1).success, messages(pattern(1))).toBe(true);
    expect(pattern(0).success, 'pattern N starts on scale degree N, and there is no degree 0').toBe(false);
  });

  it('caption: 255 characters fit the Strapi column, 256 do not', () => {
    // Not a rendering concern — `caption` is a Strapi `string` column, so an
    // over-length one is accepted here and then fails at write time, far from
    // the block that caused it.
    const caption = (n: number) => parseBlock({ __component: 'lesson.natural-notes', caption: 'x'.repeat(n) });
    expect(caption(255).success, messages(caption(255))).toBe(true);
    const over = caption(256);
    expect(over.success).toBe(false);
    expect(messages(over)).toContain('max 255 characters');
  });

  it('prose body: an empty string is exactly the silent gap this block refuses', () => {
    expect(parseBlock({ __component: 'lesson.prose', body: 'x' }).success).toBe(true);
    expect(
      parseBlock({ __component: 'lesson.prose', body: '' }).success,
      'an empty prose block renders as nothing at all, with no error anywhere',
    ).toBe(false);
  });

  it('video-ref videoId: 32 characters pass, 33 do not', () => {
    const ref = (n: number) => parseBlock({ __component: 'lesson.video-ref', videoId: 'a'.repeat(n) });
    expect(ref(32).success, messages(ref(32))).toBe(true);
    expect(ref(33).success, 'a youtubeVideoId is 11 characters; 33 is a documentId or a URL').toBe(false);
  });

  it('degree-chips degrees: one chip is a row, zero chips is a blank strip', () => {
    expect(parseBlock({ __component: 'lesson.degree-chips', degrees: ['1'] }).success).toBe(true);
    const empty = parseBlock({ __component: 'lesson.degree-chips', degrees: [] });
    expect(empty.success).toBe(false);
    expect(messages(empty)).toContain('degrees must contain at least one entry.');
  });

  it('table headers: one column is a table, zero columns is not', () => {
    expect(parseBlock({ __component: 'lesson.table', headers: ['h'], rows: [['c']] }).success).toBe(true);
    // `rows: [[]]` rather than `[['c']]` deliberately: a zero-column header
    // with a one-cell row is ALSO caught by the row-width superRefine, which
    // would make this test pass for a reason that has nothing to do with the
    // bound it is here to pin. A zero-cell row matches a zero-column header,
    // so `.min(1)` on `headers` is the only check left standing.
    const headerless = parseBlock({ __component: 'lesson.table', headers: [], rows: [[]] });
    expect(headerless.success).toBe(false);
    expect(messages(headerless)).toContain('headers must contain at least one column.');
  });

  it('step title: a step must be titled', () => {
    expect(parseBlock({ __component: 'lesson.step', number: 1, title: 'x' }).success).toBe(true);
    const untitled = parseBlock({ __component: 'lesson.step', number: 1 });
    expect(untitled.success, 'an untitled step renders as a bare number with a body under it').toBe(false);
    expect(messages(untitled)).toContain('title:');
  });
});

describe('keyboard diagrams in theory mode need BOTH halves of the chord', () => {
  // resolveDiagramMarks() returns [] without either one, which renders as an
  // empty gap and not an error. These are two INDEPENDENT superRefine
  // branches — deleting either leaves the other passing — so they need a test
  // each rather than one fixture missing both.
  const keyboard = (fields: Record<string, unknown>) => ({ __component: 'lesson.keyboard-diagram', mode: 'theory', ...fields });

  it('requires root', () => {
    const result = parseBlock(keyboard({ quality: 'major' }));
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('root is required when mode="theory"');
  });

  it('requires quality', () => {
    const result = parseBlock(keyboard({ root: 'C' }));
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('quality is required when mode="theory"');
  });

  it('lets useParam stand in for root, but never for quality', () => {
    // The reader-controlled key supplies a root at render time and supplies
    // nothing else, so `useParam` is not a way out of the quality branch.
    const withParam = parseBlock(keyboard({ useParam: true, quality: 'major' }));
    expect(withParam.success, messages(withParam)).toBe(true);
    expect(parseBlock(keyboard({ useParam: true })).success, 'no quality means no marks to draw').toBe(false);
  });
});

describe('enums refuse the plausible near-miss, not just the absurd value', () => {
  // An enum widened to z.string() keeps accepting every legal value, so these
  // all turn on a WRONG-BUT-BELIEVABLE input: a fourth instrument, a German
  // note name, a typo'd state, a third orientation.
  it.each([
    [
      'lesson.diagram',
      { __component: 'lesson.diagram', mode: 'explicit', instrument: 'ukulele', dots: [{ string: 0, fret: 1 }] },
    ],
    [
      'lesson.neck-pattern',
      {
        __component: 'lesson.neck-pattern',
        instrument: 'ukulele',
        patterns: [
          { label: 'a', dots: [{ string: 0, fret: 1 }] },
          { label: 'b', dots: [{ string: 0, fret: 2 }] },
        ],
      },
    ],
  ])('%s rejects instrument="ukulele"', (_component, block) => {
    expect(
      parseBlock(block).success,
      'instrument is the key correctPitchLabels indexes TUNING_MIDI with — see the KNOWN GAPS test',
    ).toBe(false);
  });

  /** Every field typed by pitchClass(), each reached through its real block. */
  const PITCH_SITES: Array<[string, (pc: string) => { success: boolean; error?: any }]> = [
    [
      'lesson.diagram root',
      (pc) => parseBlock({ __component: 'lesson.diagram', mode: 'theory', intent: 'chord', root: pc, quality: 'maj', stringSet: 'e–B–G' }),
    ],
    [
      'lesson.keyboard-diagram root',
      (pc) => parseBlock({ __component: 'lesson.keyboard-diagram', mode: 'theory', root: pc, quality: 'major' }),
    ],
    [
      'a keyboard mark pc',
      (pc) => parseBlock({ __component: 'lesson.keyboard-diagram', mode: 'explicit', marks: [{ pc }] }),
    ],
    ['the lesson parameter default', (pc) => lessonParameterSchema.safeParse({ name: 'key', default: pc })],
  ];

  // pitchClass() is one factory shared by four fields, so widening it once
  // opens all four at the same time — hence one case per site rather than one
  // representative.
  it.each(PITCH_SITES)('%s takes C# and refuses H', (_site, parse) => {
    const legal = parse('C#');
    expect(legal.success, messages(legal)).toBe(true);
    expect(parse('H').success, '"H" is B in German notation and is not a pitch class here').toBe(false);
  });

  it('chord string state: "muted" is a state, "freted" is a typo', () => {
    const withState = (state: string) => {
      const strings = sixOpenStrings();
      strings[0] = { string: 0, state } as any;
      return parseBlock({ __component: 'lesson.chord-diagram', strings });
    };
    expect(withState('muted').success, messages(withState('muted'))).toBe(true);
    expect(
      withState('freted').success,
      'a typo\'d state draws neither a dot nor an ×, and the superRefine only looks for "fretted"',
    ).toBe(false);
  });

  it('chord diagram orientation: "horizontal" is one, "diagonal" is not', () => {
    const oriented = (orientation: string) =>
      parseBlock({ __component: 'lesson.chord-diagram', strings: sixOpenStrings(), orientation });
    expect(oriented('horizontal').success, messages(oriented('horizontal'))).toBe(true);
    expect(oriented('diagonal').success, 'a chord box runs one of two ways').toBe(false);
  });
});

describe('correctPitchLabels', () => {
  // Pure arithmetic, run before every lesson write, and it already caught a
  // real 13% wrong-note rate on live diagrams. The client's
  // pitch-label-parity.test.ts checks only that the two TUNING ARRAYS are
  // right — never that this function uses them correctly.
  const explicitDiagram = (fields: Record<string, unknown>) => ({
    __component: 'lesson.diagram',
    mode: 'explicit',
    instrument: 'guitar',
    ...fields,
  });

  it('renames a wrong note and reports the change', () => {
    const body = parsedBody([explicitDiagram({ dots: [{ string: 0, fret: 2, label: 'G' }] })]);
    const corrections = correctPitchLabels(body);
    expect(body[0].dots[0].label).toBe('F#');
    expect(corrections).toEqual([
      { blockIndex: 0, component: 'lesson.diagram', string: 0, fret: 2, from: 'G', to: 'F#' },
    ]);
  });

  it('preserves a correct enharmonic spelling', () => {
    // Gb IS F#. A naive "rewrite every label to the canonical name" would
    // vandalise deliberate flat spelling across every flat-key lesson, and
    // would do it while reporting a "correction".
    const body = parsedBody([explicitDiagram({ dots: [{ string: 0, fret: 2, label: 'Gb' }] })]);
    expect(correctPitchLabels(body)).toEqual([]);
    expect(body[0].dots[0].label).toBe('Gb');
  });

  it('leaves degree and interval labels alone', () => {
    // "R" and "♭7" are not pitch claims, so there is nothing to verify. A
    // greedier parsePitchLabel would overwrite them with note names.
    const body = parsedBody([
      explicitDiagram({
        dots: [
          { string: 0, fret: 2, label: 'R' },
          { string: 1, fret: 3, label: '♭7' },
          { string: 2, fret: 4, label: '3' },
        ],
      }),
    ]);
    expect(correctPitchLabels(body)).toEqual([]);
    expect(body[0].dots.map((d: any) => d.label)).toEqual(['R', '♭7', '3']);
  });

  it('does not touch theory-mode diagrams', () => {
    // Theory mode computes its own DEGREE labels at render; rewriting them to
    // note names would be silent and would hit every theory diagram at once.
    const body = parsedBody([
      {
        __component: 'lesson.diagram',
        mode: 'theory',
        intent: 'chord',
        root: 'C',
        quality: 'major',
        stringSet: 'e–B–G',
        dots: [{ string: 0, fret: 2, label: 'G' }],
      },
    ]);
    expect(correctPitchLabels(body)).toEqual([]);
    expect(body[0].dots[0].label).toBe('G');
  });

  it('uses the bass tuning for a bass diagram', () => {
    // string 0 fret 2 is F# on a guitar (high e) and A on a bass (high G), so
    // a TUNING_MIDI lookup that defaulted to guitar gives a different answer
    // here rather than the same one.
    const body = parsedBody([
      explicitDiagram({ instrument: 'bass', dots: [{ string: 0, fret: 2, label: 'G' }] }),
    ]);
    expect(correctPitchLabels(body)).toEqual([
      { blockIndex: 0, component: 'lesson.diagram', string: 0, fret: 2, from: 'G', to: 'A' },
    ]);
  });

  it('corrects neck-pattern dots too, tagging the pill they came from', () => {
    // The neck-pattern branch is roughly 40% of the function and is the only
    // one that emits `patternLabel`. Deleting it entirely, or hardcoding
    // guitar tuning inside it, is otherwise undetectable.
    const body = parsedBody([
      {
        __component: 'lesson.neck-pattern',
        instrument: 'bass',
        patterns: [
          { label: 'Box 1', dots: [{ string: 0, fret: 2, label: 'G' }] },
          { label: 'Box 2', dots: [{ string: 0, fret: 0, label: 'G' }] },
        ],
      },
    ]);
    expect(correctPitchLabels(body)).toEqual([
      {
        blockIndex: 0,
        component: 'lesson.neck-pattern',
        patternLabel: 'Box 1',
        string: 0,
        fret: 2,
        from: 'G',
        to: 'A',
      },
    ]);
    expect(body[0].patterns[1].dots[0].label).toBe('G');
  });
});

describe('KNOWN GAPS — these pin CURRENT behaviour, not desired behaviour', () => {
  it('needs a get_lesson body scrubbed of ids and nulls before update_lesson accepts it', () => {
    // What Strapi HANDS BACK is not what it will TAKE BACK: it echoes the
    // component `id`s that belong to the entity and spells an empty component
    // array as `null`. Feeding a get_lesson body straight to update_lesson
    // therefore fails, and none of the messages says "strip the ids and drop
    // the nulls" — the same trap CLAUDE.md documents for REST dynamic zones
    // and that server/scripts/repair-diagram-windows.mjs works around.
    //
    // The second half is the load-bearing assertion: it pins that the
    // documented workaround KEEPS working, so it fails either if the schema
    // drifts or if a preprocess step lands that makes the scrub unnecessary.
    const fromStrapi = [
      { id: 11, __component: 'lesson.prose', body: 'hello' },
      {
        id: 12,
        __component: 'lesson.diagram',
        mode: 'theory',
        intent: 'chord',
        root: 'C',
        quality: 'major',
        stringSet: 'e–B–G',
        dots: null,
        caption: null,
        source: null,
      },
    ];

    const asIs = parseBody(fromStrapi);
    expect(asIs.success).toBe(false);
    expect(messages(asIs)).toContain('Unrecognized key: "id"');
    expect(messages(asIs)).toContain('expected array, received null');

    const scrubbed = fromStrapi.map(({ id, ...block }) =>
      Object.fromEntries(Object.entries(block).filter(([, v]) => v !== null)),
    );
    expect(parseBody(scrubbed).success, messages(parseBody(scrubbed))).toBe(true);
  });

  it('leaves correctPitchLabels no defence of its own beyond the instrument enum', () => {
    // TUNING_MIDI has a guitar key and a bass key, and pitchClassAt reads
    // `TUNING_MIDI[instrument].length` with no guard at all. So a third
    // instrument reaching the write path is not a wrong diagram, it is a
    // TypeError thrown out of a tool's execute() — and the enum on
    // `instrument` is the ENTIRE thing preventing it.
    //
    // Both halves are load-bearing: the first pins that the schema refuses a
    // fourth instrument, the second pins what is waiting downstream if that
    // ever stops being true. Fix the runtime path and this test should be
    // updated, not deleted.
    const ukulele = (label: string) => ({
      __component: 'lesson.diagram',
      mode: 'explicit',
      instrument: 'ukulele',
      dots: [{ string: 0, fret: 1, label }],
    });

    expect(parseBlock(ukulele('C')).success).toBe(false);
    expect(() => correctPitchLabels([ukulele('C')] as any)).toThrow(TypeError);
    // Only a dot making a PITCH claim gets that far — a degree label never
    // reaches the tuning lookup, which is why the crash is intermittent
    // rather than immediate.
    expect(() => correctPitchLabels([ukulele('R')] as any)).not.toThrow();
  });

  it('blames intent="chord" when intent was omitted on an obviously-scale diagram', () => {
    // `intent` defaults to 'chord', so a diagram carrying scaleType+position
    // and no intent is refused for missing a quality and a stringSet — two
    // messages about triads, neither of which suggests intent="scale". This
    // asserts the default is 'chord' AND that the refusal stays unhelpful, so
    // it turns red both if the default changes and if the message improves.
    const result = parseBody([
      { __component: 'lesson.diagram', mode: 'theory', root: 'A', scaleType: 'majorPentatonic', position: '1' },
    ]);
    expect(result.success).toBe(false);
    expect(messages(result)).toContain('intent="chord"');
    expect(messages(result)).not.toContain('intent="scale"');
  });
});
