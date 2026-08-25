// Contract tests for the markdown → LessonBlock[] parser.
//
// This is where the guarantees a structured output schema used to give for
// free now have to be earned. Anthropic's structured-output mode enforced
// enums, required fields and `.strict()` unknown-key rejection before the
// response ever reached us; a text response enforces none of that. So the
// suite below is deliberately weighted toward FAILURE cases: every one of
// them was a 400 or a silent gap under the old design.
//
// Two things it checks that a normal parser test would not:
//   * The directive vocabulary against the REAL Strapi component JSON, in
//     both directions — a field added to the schema with no directive
//     attribute fails here, and so does an attribute naming a field that
//     does not exist. That is the drift guard the brief asks for, moved
//     from JSON field names onto directives.
//   * The resolve check — `resolveDiagramDots`/`resolveDiagramMarks`, the
//     renderer's own resolver, run against every parsed diagram. Schema
//     validity was never the bar: a theory-mode diagram missing `stringSet`
//     validates fine and draws nothing.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PITCH_CLASSES as PITCH_CLASS_NAMES } from '@music-kb/music/types';
import {
  DIRECTIVE_ATTRIBUTES,
  DIRECTIVE_NAMES,
  LESSON_DIRECTIVES,
  parseLessonMarkdown,
  type LessonDirectiveName,
  type ParseIssue,
} from './markdown-blocks';

function errorsOf(issues: ParseIssue[]): ParseIssue[] {
  return issues.filter((i) => i.severity === 'error');
}

function warningsOf(issues: ParseIssue[]): ParseIssue[] {
  return issues.filter((i) => i.severity === 'warning');
}

function componentsOf(blocks: ReturnType<typeof parseLessonMarkdown>['blocks']): string[] {
  return blocks.map((b) => b.block.__component);
}

// =============================================================================
// Plain markdown
// =============================================================================

describe('plain markdown with no directives', () => {
  it('parses into prose blocks, one per paragraph', () => {
    const { blocks, issues } = parseLessonMarkdown(
      'The first paragraph explains the idea.\n\nThe second names the fret.',
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(componentsOf(blocks)).toEqual(['lesson.prose', 'lesson.prose']);
    expect(blocks[0].block.body).toBe('The first paragraph explains the idea.');
    expect(blocks[1].block.body).toBe('The second names the fret.');
  });

  it('keeps a loose list in one prose block instead of splitting it into orphaned bullets', () => {
    const { blocks } = parseLessonMarkdown(
      'Three things to notice:\n\n- fret 5 on the low E is A\n\n- fret 7 is B\n\n- fret 8 is C',
    );
    expect(componentsOf(blocks)).toEqual(['lesson.prose']);
    expect(String(blocks[0].block.body)).toContain('fret 8 is C');
  });

  it('does not split inside a fenced code block', () => {
    const { blocks } = parseLessonMarkdown('Intro.\n\n```\ne|--5--\n\nB|--5--\n```');
    expect(componentsOf(blocks)).toEqual(['lesson.prose', 'lesson.prose']);
    expect(String(blocks[1].block.body)).toContain('B|--5--');
  });

  it('unwraps a whole-answer code fence without shifting reported line numbers', () => {
    const { blocks, issues } = parseLessonMarkdown('```markdown\nJust prose.\n\n::nope{}\n::\n```');
    expect(componentsOf(blocks)).toEqual(['lesson.prose']);
    expect(errorsOf(issues)[0].line).toBe(4);
  });

  it('reports bare text rather than swallowing it when the pass may not emit prose', () => {
    const { blocks, issues } = parseLessonMarkdown('Here are the illustrations you asked for:', {
      allowed: ['diagram'],
      bareText: 'ignore',
    });
    expect(blocks).toHaveLength(0);
    expect(issues[0].severity).toBe('warning');
    expect(issues[0].message).toContain('ignored in this pass');
  });
});

// =============================================================================
// One test per directive: it parses to the right block
// =============================================================================

describe('every directive parses to its block', () => {
  it('::prose carries a src', () => {
    const { blocks, issues } = parseLessonMarkdown('::prose{src=abc123}\nA turnaround loops the form.\n::');
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block).toMatchObject({ __component: 'lesson.prose', body: 'A turnaround loops the form.' });
    expect(blocks[0].src).toBe('abc123');
  });

  it('::heading', () => {
    const { blocks } = parseLessonMarkdown('::heading{level=h3}\nWhere the root lives\n::');
    expect(blocks[0].block).toMatchObject({ __component: 'lesson.heading', text: 'Where the root lives', level: 'h3' });
  });

  it('::callout', () => {
    const { blocks } = parseLessonMarkdown('::callout{tone=warning src=v1}\nThe third is at fret 4, not 3.\n::');
    expect(blocks[0].block).toMatchObject({
      __component: 'lesson.callout',
      tone: 'warning',
      body: 'The third is at fret 4, not 3.',
    });
    expect(blocks[0].src).toBe('v1');
  });

  it('::step numbers itself in sequence when `number` is omitted', () => {
    const { blocks } = parseLessonMarkdown(
      '::step{title="Fret the root:"}\nPut finger one at fret 5.\n::\n\n::step{title="Add the fifth"}\n::',
    );
    expect(blocks[0].block).toMatchObject({ __component: 'lesson.step', number: 1, title: 'Fret the root' });
    expect(blocks[1].block).toMatchObject({ number: 2, title: 'Add the fifth' });
  });

  it('::table parses a GFM table and its caption attribute', () => {
    const { blocks, issues } = parseLessonMarkdown(
      '::table{caption="Counting up from an open low E"}\n| Interval | Half steps | Fret |\n|---|---|---|\n| Minor 3rd | 3 | 3 |\n| Major 3rd | 4 | 4 |\n::',
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block).toMatchObject({
      __component: 'lesson.table',
      headers: ['Interval', 'Half steps', 'Fret'],
      caption: 'Counting up from an open low E',
    });
    expect(blocks[0].block.rows).toEqual([
      ['Minor 3rd', '3', '3'],
      ['Major 3rd', '4', '4'],
    ]);
  });

  it('::degree-chips', () => {
    const { blocks } = parseLessonMarkdown('::degree-chips{size=sm}\nI ii IV V7\n::');
    expect(blocks[0].block).toMatchObject({
      __component: 'lesson.degree-chips',
      degrees: ['I', 'ii', 'IV', 'V7'],
      size: 'sm',
    });
  });

  it('::param-picker', () => {
    const { blocks } = parseLessonMarkdown('::param-picker{label="Try another key"}\n::');
    expect(blocks[0].block).toMatchObject({ __component: 'lesson.param-picker', label: 'Try another key' });
  });

  it('::video-ref keeps the body as a grounding-only moment description', () => {
    const { blocks } = parseLessonMarkdown(
      '::video-ref{videoId=yt-A label="Watch the barre demo"}\nHe barres the first fret and rolls the finger back.\n::',
    );
    expect(blocks[0].block).toMatchObject({
      __component: 'lesson.video-ref',
      videoId: 'yt-A',
      label: 'Watch the barre demo',
    });
    expect(blocks[0].block.timeSec).toBeUndefined();
    expect(blocks[0].moment).toContain('rolls the finger back');
  });

  // The window here is 3–10, not the 3–8 this test carried until the
  // visibility check went in: C major first inversion on e–B–G is frets
  // 8/8/9, so 3–8 clipped the third off and this suite's own showcase
  // example was a two-dot triad. See "the visibility check" below.
  it('::diagram in theory mode, with the body as the caption', () => {
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{root=C quality=major stringSet=e–B–G inversion=1 fromFret=3 toFret=10}\nThe third sits two frets above the root here.\n::',
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(issues).toEqual([]);
    expect(blocks[0].block).toMatchObject({
      __component: 'lesson.diagram',
      instrument: 'guitar',
      mode: 'theory',
      root: 'C',
      quality: 'major',
      stringSet: 'e–B–G',
      inversion: 1,
      fromFret: 3,
      toFret: 10,
      caption: 'The third sits two frets above the root here.',
    });
  });

  it('::diagram in explicit mode, with all four dot styles', () => {
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::diagram{mode=explicit fromFret=5 toFret=8}',
        'Chord tones inside the scale shape.',
        '- string=5 fret=5 label=A root ringed',
        '- string=5 fret=8 light',
        '- string=4 fret=5 hollow',
        '- string=4 fret=7 dim',
        '::',
      ].join('\n'),
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block.dots).toEqual([
      { string: 5, fret: 5, label: 'A', root: true, ringed: true },
      { string: 5, fret: 8, light: true },
      { string: 4, fret: 5, hollow: true },
      { string: 4, fret: 7, dim: true },
    ]);
  });

  it('::keyboard-diagram in explicit mode', () => {
    const { blocks, issues } = parseLessonMarkdown(
      '::keyboard-diagram{mode=explicit octaves=1}\nE–F and B–C have no black key between them.\n- pc=E label=E flag\n- pc=F label=F flag\n::',
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block).toMatchObject({ __component: 'lesson.keyboard-diagram', mode: 'explicit', octaves: 1 });
    expect(blocks[0].block.marks).toEqual([
      { pc: 'E', label: 'E', flag: true },
      { pc: 'F', label: 'F', flag: true },
    ]);
  });

  it('::chord-diagram with all six strings and a barre', () => {
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::chord-diagram{barreFret=1 barreFromString=0 barreToString=5 fretCount=5}',
        'F major, barred at the first fret.',
        '- string=0 state=fretted fret=1',
        '- string=1 state=fretted fret=1',
        '- string=2 state=fretted fret=2',
        '- string=3 state=fretted fret=3',
        '- string=4 state=fretted fret=3',
        '- string=5 state=fretted fret=1 root',
        '::',
      ].join('\n'),
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block).toMatchObject({
      __component: 'lesson.chord-diagram',
      barreFret: 1,
      barreFromString: 0,
      barreToString: 5,
      fretCount: 5,
      orientation: 'vertical',
      caption: 'F major, barred at the first fret.',
    });
    expect((blocks[0].block.strings as unknown[]).length).toBe(6);
  });

  it('::neck-pattern nests dots under each pattern by indentation', () => {
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::neck-pattern{fromFret=0 toFret=15}',
        'The five pentatonic boxes climbing the neck.',
        '- label="Box 1" sub="E minor pentatonic · frets 0–3"',
        '  - string=5 fret=0 label=E root',
        '  - string=5 fret=3 label=G',
        '- label="Box 2"',
        '  - string=5 fret=3 label=G',
        '  - string=5 fret=5 label=A',
        '::',
      ].join('\n'),
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block).toMatchObject({ __component: 'lesson.neck-pattern', fromFret: 0, toFret: 15 });
    expect(blocks[0].block.patterns).toEqual([
      {
        label: 'Box 1',
        sub: 'E minor pentatonic · frets 0–3',
        dots: [
          { string: 5, fret: 0, label: 'E', root: true },
          { string: 5, fret: 3, label: 'G' },
        ],
      },
      {
        label: 'Box 2',
        dots: [
          { string: 5, fret: 3, label: 'G' },
          { string: 5, fret: 5, label: 'A' },
        ],
      },
    ]);
  });

  it('::natural-notes takes only a caption', () => {
    const { blocks } = parseLessonMarkdown('::natural-notes{src=v2}\nEvery sharp is one fret from one of these.\n::');
    expect(blocks[0].block).toMatchObject({
      __component: 'lesson.natural-notes',
      caption: 'Every sharp is one fret from one of these.',
    });
    expect(blocks[0].src).toBe('v2');
  });

  it('covers every directive in the vocabulary (sanity check on this describe block)', () => {
    // Each `it` above names exactly one directive; if a new one is added to
    // LESSON_DIRECTIVES without a case here, this fails.
    const covered = new Set<string>([
      'prose',
      'heading',
      'callout',
      'step',
      'table',
      'degree-chips',
      'param-picker',
      'video-ref',
      'diagram',
      'keyboard-diagram',
      'chord-diagram',
      'neck-pattern',
      'natural-notes',
    ]);
    const missing = DIRECTIVE_NAMES.filter((n) => !covered.has(n));
    expect(missing, `directives with no parse test: ${missing.join(', ')}`).toEqual([]);
  });
});

// =============================================================================
// Failures — every one names the line
// =============================================================================

describe('validation failures name the offending line', () => {
  it('unknown directive, listing the legal ones', () => {
    const { blocks, issues } = parseLessonMarkdown('Intro.\n\n::interactive{}\nsomething\n::');
    expect(componentsOf(blocks)).toEqual(['lesson.prose']);
    const err = errorsOf(issues)[0];
    expect(err.line).toBe(3);
    expect(err.message).toContain('unknown directive `::interactive`');
    expect(err.message).toContain('::keyboard-diagram');
  });

  it('a directive the pass may not emit', () => {
    const { blocks, issues } = parseLessonMarkdown('::diagram{root=C quality=major stringSet=e–B–G}\n::', {
      allowed: ['prose', 'callout'],
    });
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('not available in this pass');
  });

  it('illegal enum value, naming the legal set', () => {
    const { blocks, issues } = parseLessonMarkdown('::callout{tone=urgent}\nDo the thing.\n::');
    expect(blocks).toHaveLength(0);
    const err = errorsOf(issues)[0];
    expect(err.line).toBe(1);
    expect(err.message).toContain('tone="urgent"');
    expect(err.message).toContain('note, tip, warning');
  });

  it('a hyphenated string-set lookalike, naming the en-dash fix', () => {
    const { blocks, issues } = parseLessonMarkdown('::diagram{root=C quality=major stringSet=e-B-G}\n::');
    expect(blocks).toHaveLength(0);
    const messages = errorsOf(issues).map((i) => i.message);
    expect(messages.some((m) => m.includes('EN DASH') && m.includes('e–B–G'))).toBe(true);
  });

  it('an unknown attribute, rather than silently dropping a misspelling', () => {
    const { blocks, issues } = parseLessonMarkdown('::prose{boxy="the body"}\nreal body\n::');
    expect(blocks).toHaveLength(0);
    const err = errorsOf(issues)[0];
    expect(err.line).toBe(1);
    expect(err.message).toContain('unknown attribute `boxy`');
  });

  it('an over-length caption is truncated, with a warning naming the line', () => {
    const long = 'x'.repeat(300);
    const { blocks, issues } = parseLessonMarkdown(
      `::diagram{root=C quality=major stringSet=e–B–G caption="${long}"}\n::`,
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(String(blocks[0].block.caption)).toHaveLength(255);
    const warn = issues.find((i) => i.severity === 'warning');
    expect(warn?.line).toBe(1);
    expect(warn?.message).toContain('255');
  });

  it('a malformed table row, naming the row and dropping only that block', () => {
    const { blocks, issues } = parseLessonMarkdown(
      ['Before.', '', '::table{}', '| A | B |', '|---|---|', '| 1 | 2 |', '| 3 |', '::', '', 'After.'].join('\n'),
    );
    expect(componentsOf(blocks)).toEqual(['lesson.prose', 'lesson.prose']);
    const err = errorsOf(issues)[0];
    expect(err.line).toBe(7);
    expect(err.message).toContain('1 cell(s)');
    expect(err.message).toContain('2 column(s)');
  });

  it('an empty degree-chips body', () => {
    const { blocks, issues } = parseLessonMarkdown('::degree-chips{}\n::');
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('no chips');
  });

  // Two live sections lost a whole paragraph each to a missing `::`, so
  // the two cases are split by what the missing close actually means.
  it('recovers an unclosed directive whose body plainly ended at the next one, with a warning', () => {
    const { blocks, issues } = parseLessonMarkdown(
      ['::callout{tone=tip}', 'A tip with no close.', '', '::prose{}', 'This still survives.', '::'].join('\n'),
    );
    expect(componentsOf(blocks)).toEqual(['lesson.callout', 'lesson.prose']);
    expect(String(blocks[0].block.body)).toBe('A tip with no close.');
    expect(String(blocks[1].block.body)).toBe('This still survives.');
    expect(errorsOf(issues)).toEqual([]);
    const warn = issues.find((i) => i.severity === 'warning');
    expect(warn?.line).toBe(1);
    expect(warn?.message).toContain('Recovered');
  });

  it('drops an unclosed directive that runs to the end of the answer — it may be truncated', () => {
    const { blocks, issues } = parseLessonMarkdown(
      ['::prose{}', 'Real content.', '::', '', '::callout{tone=tip}', 'A tip that never end'].join('\n'),
    );
    expect(componentsOf(blocks)).toEqual(['lesson.prose']);
    const err = errorsOf(issues)[0];
    expect(err.line).toBe(5);
    expect(err.message).toContain('never closed and the answer ends');
  });

  it('an unterminated attribute quote', () => {
    const { blocks, issues } = parseLessonMarkdown('::step{title="Fret the root}\nbody\n::');
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('never closed');
  });

  it('a chord-diagram missing a string, naming which', () => {
    const { blocks, issues } = parseLessonMarkdown(
      ['::chord-diagram{}', '- string=0 state=open', '- string=1 state=open', '- string=2 state=open', '::'].join('\n'),
    );
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('no entry for string 3, 4, 5');
  });

  it('a chord-diagram string that is fretted with no fret', () => {
    const lines = ['::chord-diagram{}'];
    for (let s = 0; s < 6; s += 1) lines.push(`- string=${s} state=${s === 2 ? 'fretted' : 'open'}`);
    lines.push('::');
    const { blocks, issues } = parseLessonMarkdown(lines.join('\n'));
    expect(blocks).toHaveLength(0);
    const err = errorsOf(issues)[0];
    expect(err.line).toBe(4);
    expect(err.message).toContain('state="fretted" with no `fret`');
  });

  it('a partial barre', () => {
    const lines = ['::chord-diagram{barreFret=3}'];
    for (let s = 0; s < 6; s += 1) lines.push(`- string=${s} state=fretted fret=3`);
    lines.push('::');
    const { blocks, issues } = parseLessonMarkdown(lines.join('\n'));
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('all three of barreFret');
  });

  it('a single-pattern picker', () => {
    const { blocks, issues } = parseLessonMarkdown(
      ['::neck-pattern{}', '- label="Box 1"', '  - string=5 fret=0', '::'].join('\n'),
    );
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('at least 2 patterns');
  });

  it('a half-set neck-pattern fret window', () => {
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::neck-pattern{fromFret=5}',
        '- label="Box 1"',
        '  - string=5 fret=5',
        '- label="Box 2"',
        '  - string=5 fret=8',
        '::',
      ].join('\n'),
    );
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('must be set together');
  });

  it('an authored timeSec is refused, not quietly honoured', () => {
    const { blocks, issues } = parseLessonMarkdown('::video-ref{videoId=yt-A timeSec=125}\nthe moment\n::');
    expect(blocks[0].block.timeSec).toBeUndefined();
    expect(issues.find((i) => i.severity === 'warning')?.message).toContain('not trusted');
  });
});

// =============================================================================
// The resolve check — the renderer's own resolver, not schema validity
// =============================================================================

describe('the resolve check drops diagrams that would draw nothing', () => {
  it('a theory diagram missing stringSet is dropped, and the rest of the lesson survives', () => {
    const { blocks, issues } = parseLessonMarkdown(
      ['Some prose.', '', '::diagram{root=C quality=major}', 'A caption.', '::', '', 'More prose.'].join('\n'),
    );
    expect(componentsOf(blocks)).toEqual(['lesson.prose', 'lesson.prose']);
    const err = errorsOf(issues)[0];
    expect(err.line).toBe(3);
    expect(err.message).toContain('resolved to zero dots');
    expect(err.message).toContain('stringSet');
  });

  it('an explicit diagram with no dots is dropped', () => {
    const { blocks, issues } = parseLessonMarkdown('::diagram{mode=explicit}\nA caption.\n::');
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('zero dots');
  });

  it('a theory keyboard-diagram missing quality is dropped', () => {
    const { blocks, issues } = parseLessonMarkdown('::keyboard-diagram{root=C}\nA caption.\n::');
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('zero marks');
  });

  it('an all-muted chord box is dropped', () => {
    const lines = ['::chord-diagram{}'];
    for (let s = 0; s < 6; s += 1) lines.push(`- string=${s} state=muted`);
    lines.push('::');
    const { blocks, issues } = parseLessonMarkdown(lines.join('\n'));
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('every string is muted');
  });

  it('keeps a theory diagram that DOES resolve', () => {
    const { blocks, issues } = parseLessonMarkdown('::diagram{root=A quality=minor stringSet=D–A–E}\n::');
    expect(errorsOf(issues)).toEqual([]);
    expect(componentsOf(blocks)).toEqual(['lesson.diagram']);
  });
});

// =============================================================================
// The visibility check — resolving is not drawing
// =============================================================================
//
// The resolve check above asks "does this produce dots?". MiniNeck then
// clips those dots to a fret window, and an explicit fromFret/toFret beats
// the dots ("an explicit from/to always wins", MiniNeck.tsx:102). So a
// diagram can resolve, pass every check, and render a blank fretboard.
// These cases are the window logic the renderer applies, applied here.

describe('the visibility check, on what the renderer will actually draw', () => {
  it('widens a window that would clip part of a theory triad', () => {
    // C major, first inversion, on e–B–G is frets 9/8/8. This exact
    // directive — 3–8 — was the suite's own example of a good diagram, and
    // it hid the third.
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{root=C quality=major stringSet=e–B–G inversion=1 fromFret=3 toFret=8}\n::',
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(componentsOf(blocks)).toEqual(['lesson.diagram']);
    expect(blocks[0].block).toMatchObject({ fromFret: 3, toFret: 10 });
    const warn = warningsOf(issues)[0];
    expect(warn.message).toContain('clips 1 of 3 dots');
    expect(warn.message).toContain('Widened the window to 3–10');
  });

  it('widens a window that would have rendered completely blank', () => {
    // The reported failure: a shape at 7–9 inside a window of 0–5.
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::diagram{mode=explicit fromFret=0 toFret=5}',
        '- string=0 fret=7',
        '- string=1 fret=8',
        '- string=2 fret=9',
        '::',
      ].join('\n'),
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(componentsOf(blocks)).toEqual(['lesson.diagram']);
    expect(blocks[0].block).toMatchObject({ fromFret: 0, toFret: 10 });
    expect(warningsOf(issues)[0].message).toContain('completely blank');
  });

  it('leaves a window that already holds every dot alone', () => {
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{root=C quality=major stringSet=e–B–G fromFret=1 toFret=7}\n::',
    );
    expect(issues).toEqual([]);
    expect(blocks[0].block).toMatchObject({ fromFret: 1, toFret: 7 });
  });

  it('drops a fixed window on a useParam diagram, whose shape moves with the key', () => {
    // Root position on e–B–G runs from A at frets 0–2 to G at 10–12: no one
    // window is right for all twelve, so the renderer's auto-fit has to take
    // over. Without this the diagram is blank in most keys.
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{useParam root=C quality=major stringSet=e–B–G fromFret=3 toFret=8}\n::',
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block.fromFret).toBeUndefined();
    expect(blocks[0].block.toFret).toBeUndefined();
    expect(warningsOf(issues)[0].message).toContain('cannot have a fixed window');
  });

  it('strips a half-set window the renderer would ignore', () => {
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{root=C quality=major stringSet=e–B–G fromFret=3}\n::',
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block.fromFret).toBeUndefined();
    expect(warningsOf(issues)[0].message).toContain('half-set window');
  });

  it('rejects a dot placed on a string the instrument does not have', () => {
    // MiniNeck indexes strings by array position without bounds-checking,
    // so string=5 on a 4-string bass is drawn outside its own viewBox — the
    // dot does not move, it disappears. An error, so the whole block goes
    // with it (this file's rule) rather than a shape quietly short a note.
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::diagram{mode=explicit instrument=bass}',
        '- string=0 fret=5',
        '- string=5 fret=5',
        '::',
      ].join('\n'),
    );
    expect(blocks).toHaveLength(0);
    const err = errorsOf(issues)[0];
    expect(err.message).toContain('off a bass neck');
    expect(err.message).toContain('strings 0–3');
  });

  it('keeps a bass diagram whose dots are all on the 4-string board', () => {
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{mode=explicit instrument=bass}\n- string=3 fret=5\n- string=2 fret=7\n::',
    );
    expect(issues).toEqual([]);
    expect(componentsOf(blocks)).toEqual(['lesson.diagram']);
  });

  it('drops a diagram whose only dot is past the last fret', () => {
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{mode=explicit}\n- string=0 fret=30\n::',
    );
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('frets 0–22');
    expect(errorsOf(issues)[1].message).toContain('zero dots');
  });

  it('refuses a theory diagram on a bass, which would draw guitar frets', () => {
    // triadVoicing() computes from STANDARD_TUNING_MIDI. On a bass, string
    // set e–B–G lands on G/D/A with guitar fret maths: a "C major" that
    // reads D-G-B♭. Nothing else in the pipeline can see that.
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{instrument=bass root=C quality=major stringSet=e–B–G}\n::',
    );
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('guitar tuning');
  });

  it('widens a neck-pattern window that hides a later box behind its pill', () => {
    // NeckPatternPicker draws the ACTIVE pattern against the SHARED window,
    // so this is invisible until the reader clicks the second pill.
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::neck-pattern{fromFret=0 toFret=5}',
        '- label="Box 1"',
        '  - string=5 fret=0',
        '  - string=5 fret=3',
        '- label="Box 5"',
        '  - string=5 fret=12',
        '  - string=5 fret=15',
        '::',
      ].join('\n'),
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block).toMatchObject({ fromFret: 0, toFret: 16 });
    expect(warningsOf(issues)[0].message).toContain('clips 2 of 4 dots');
  });
});

// =============================================================================
// Runaway backstops — a cap that shapes content is a cap that lies
// =============================================================================

describe('the dot and mark backstops', () => {
  it('keeps every dot of a two-octave scale shape', () => {
    // 14 dots. Under the old 6-dot cap this became a 6-dot diagram with a
    // `warning` — and `warning` is not counted in the `dropped` figure the
    // SSE stream and /lessons show, so it became a 6-dot diagram silently.
    const shape = [
      [5, 5],
      [5, 7],
      [5, 8],
      [4, 5],
      [4, 7],
      [3, 5],
      [3, 7],
      [2, 4],
      [2, 5],
      [2, 7],
      [1, 5],
      [1, 6],
      [0, 5],
      [0, 7],
    ];
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::diagram{mode=explicit}',
        ...shape.map(([s, f]) => `- string=${s} fret=${f}`),
        '::',
      ].join('\n'),
    );
    expect(issues).toEqual([]);
    expect(blocks[0].block.dots).toHaveLength(14);
  });

  it('keeps every mark of a seven-note scale on the keyboard', () => {
    const scale = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::keyboard-diagram{mode=explicit octaves=2}',
        ...scale.map((pc) => `- pc=${pc} label=${pc}`),
        '::',
      ].join('\n'),
    );
    expect(issues).toEqual([]);
    expect(blocks[0].block.marks).toHaveLength(7);
  });

  it('DROPS a diagram past the backstop instead of truncating it in silence', () => {
    const dots: string[] = [];
    for (let s = 0; s < 6; s += 1)
      for (let f = 0; f <= 22; f += 1) dots.push(`- string=${s} fret=${f}`);
    dots.push('- string=0 fret=0');
    const { blocks, issues } = parseLessonMarkdown(
      ['::diagram{mode=explicit}', ...dots, '::'].join('\n'),
    );
    expect(blocks).toHaveLength(0);
    // `error`, so it reaches the dropped count the user is shown.
    expect(errorsOf(issues)).toHaveLength(1);
    expect(errorsOf(issues)[0].message).toContain('runaway backstop');
    expect(warningsOf(issues)).toEqual([]);
  });

  it('DROPS a keyboard diagram past the backstop instead of truncating it', () => {
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::keyboard-diagram{mode=explicit}',
        ...PITCH_CLASS_NAMES.map((pc) => `- pc=${pc}`),
        '- pc=C',
        '::',
      ].join('\n'),
    );
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)).toHaveLength(1);
    expect(errorsOf(issues)[0].message).toContain('runaway backstop');
  });
});

// =============================================================================
// Placement (illustrate pass)
// =============================================================================

describe('the `after` placement attribute', () => {
  it('is read when the pass allows it', () => {
    const { blocks, issues } = parseLessonMarkdown(
      '::diagram{after=2 root=C quality=major stringSet=e–B–G}\n::',
      { allowed: ['diagram'], bareText: 'ignore', allowAfter: true },
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].after).toBe(2);
  });

  it('accepts -1 for "before everything"', () => {
    const { blocks } = parseLessonMarkdown('::diagram{after=-1 root=C quality=major stringSet=e–B–G}\n::', {
      allowed: ['diagram'],
      allowAfter: true,
    });
    expect(blocks[0].after).toBe(-1);
  });

  it('is undefined when omitted (end of section)', () => {
    const { blocks } = parseLessonMarkdown('::diagram{root=C quality=major stringSet=e–B–G}\n::', {
      allowed: ['diagram'],
      allowAfter: true,
    });
    expect(blocks[0].after).toBeUndefined();
  });

  it('is rejected in a pass that does not place blocks', () => {
    const { blocks, issues } = parseLessonMarkdown('::prose{after=1}\nbody\n::');
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('`after` is not an attribute');
  });
});

// =============================================================================
// Round trip: parse → blocks → render
// =============================================================================

describe('round trip', () => {
  it('a whole mixed section parses to the blocks the markdown described, in order', () => {
    const markdown = [
      'A turnaround signals the loop back to the top of the form.',
      '',
      '::callout{tone=tip src=yt-A}',
      'The V-IV-I walkdown lands on fret 3 of the low E.',
      '::',
      '',
      '::step{title="Play the V chord"}',
      'Start at fret 7.',
      '::',
      '',
      '::degree-chips{}',
      'V IV I',
      '::',
      '',
      '::diagram{root=G quality=major stringSet=D–A–E}',
      'The V chord, root on the A string.',
      '::',
      '',
      'That is the whole shape.',
    ].join('\n');
    const { blocks, issues } = parseLessonMarkdown(markdown);
    expect(errorsOf(issues)).toEqual([]);
    expect(componentsOf(blocks)).toEqual([
      'lesson.prose',
      'lesson.callout',
      'lesson.step',
      'lesson.degree-chips',
      'lesson.diagram',
      'lesson.prose',
    ]);
  });
});

// =============================================================================
// Drift guard: directives against the real Strapi schema, both directions
// =============================================================================
//
// Reads server/src/components/lesson/*.json and the lesson content type
// directly from disk — never through anything that would only prove this
// module agrees with itself.

const REPO_ROOT = resolve(process.cwd(), '..');
const COMPONENTS_DIR = resolve(REPO_ROOT, 'server/src/components/lesson');
const LESSON_SCHEMA_PATH = resolve(REPO_ROOT, 'server/src/api/lesson/content-types/lesson/schema.json');

type StrapiAttribute = { type: string; enum?: string[]; component?: string; repeatable?: boolean };

function componentAttributes(component: string): Record<string, StrapiAttribute> {
  const fileName = `${component.replace(/^lesson\./, '')}.json`;
  const json = JSON.parse(readFileSync(resolve(COMPONENTS_DIR, fileName), 'utf8'));
  return json.attributes ?? {};
}

// Fields that deliberately arrive as something other than an attribute.
// Named individually — a blanket "skip anything complicated" exemption
// would let a real omission through.
const NOT_AN_ATTRIBUTE: Record<string, readonly string[]> = {
  // Body text.
  'lesson.prose': ['body', 'source'],
  'lesson.heading': ['text'],
  'lesson.callout': ['body', 'source'],
  'lesson.step': ['body', 'source'],
  // Body entries / body table / body chips.
  'lesson.diagram': ['dots', 'source'],
  'lesson.keyboard-diagram': ['marks', 'source'],
  'lesson.chord-diagram': ['strings', 'source'],
  'lesson.neck-pattern': ['patterns', 'source'],
  'lesson.natural-notes': ['source'],
  'lesson.table': ['headers', 'rows'],
  'lesson.degree-chips': ['degrees'],
  'lesson.param-picker': [],
  'lesson.video-ref': [],
};

describe('directive vocabulary ↔ Strapi schema', () => {
  it('every dynamic-zone component has a directive', () => {
    const schema = JSON.parse(readFileSync(LESSON_SCHEMA_PATH, 'utf8'));
    const zone: string[] = schema.attributes.body.components;
    expect(zone.length).toBeGreaterThan(0);
    const mapped = new Set(Object.values(LESSON_DIRECTIVES));
    const missing = zone.filter((c) => !mapped.has(c as never));
    expect(missing, `dynamic-zone components with no directive: ${missing.join(', ')}`).toEqual([]);
  });

  it('every directive names a component that is actually in the dynamic zone', () => {
    const schema = JSON.parse(readFileSync(LESSON_SCHEMA_PATH, 'utf8'));
    const zone: string[] = schema.attributes.body.components;
    const extra = Object.values(LESSON_DIRECTIVES).filter((c) => !zone.includes(c));
    expect(extra, `directives naming a component outside the dynamic zone: ${extra.join(', ')}`).toEqual([]);
  });

  it.each(DIRECTIVE_NAMES.map((n): [string, LessonDirectiveName] => [n, n]))(
    '::%s declares no attribute that is not a real field',
    (_label, name) => {
      const component = LESSON_DIRECTIVES[name];
      const fields = new Set(Object.keys(componentAttributes(component)));
      // `src` is the one shorthand: it fills source.videoId, which is a
      // nested component and cannot be written as a flat attribute.
      const invented = DIRECTIVE_ATTRIBUTES[name].filter((a) => a !== 'src' && !fields.has(a));
      expect(
        invented,
        `::${name} accepts ${invented.join(', ')}, which ${component} does not declare`,
      ).toEqual([]);
    },
  );

  it.each(DIRECTIVE_NAMES.map((n): [string, LessonDirectiveName] => [n, n]))(
    '::%s reaches every field of its component',
    (_label, name) => {
      const component = LESSON_DIRECTIVES[name];
      const exempt = new Set(NOT_AN_ATTRIBUTE[component] ?? []);
      const attrs = new Set(DIRECTIVE_ATTRIBUTES[name]);
      const unreachable = Object.keys(componentAttributes(component)).filter(
        (f) => !attrs.has(f) && !exempt.has(f),
      );
      expect(
        unreachable,
        `${component}.${unreachable.join('/')} can be stored but no ::${name} attribute sets it — either add the attribute or add it to NOT_AN_ATTRIBUTE with a reason`,
      ).toEqual([]);
    },
  );

  it('`src` on a directive whose component has no source field would be caught', () => {
    // table/degree-chips/param-picker carry no `lesson.source`, so `src`
    // must not be accepted there — the first assertion above enforces it,
    // this pins the intent.
    for (const name of ['table', 'degree-chips', 'param-picker'] as const) {
      expect(DIRECTIVE_ATTRIBUTES[name]).not.toContain('src');
    }
  });

  it('every enum value in every lesson component is reachable through some directive', () => {
    // A closed enum the parser refuses is worse than no validation at all —
    // it drops a legal block with an error naming a legal value.
    const files = readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith('.json'));
    const unreachable: string[] = [];
    for (const file of files) {
      const component = `lesson.${file.replace(/\.json$/, '')}`;
      if (component === 'lesson.parameter' || component === 'lesson.source') continue;
      const attributes = componentAttributes(component);
      for (const [field, attr] of Object.entries(attributes)) {
        if (attr.type !== 'enumeration' || !Array.isArray(attr.enum)) continue;
        for (const value of attr.enum) {
          const md = probeEnum(component, field, value);
          if (md === null) continue; // sub-components are probed via their parent
          const { blocks, issues } = parseLessonMarkdown(md);
          const rejected = issues.some(
            (i) => i.severity === 'error' && i.message.includes(`"${value}"`) && i.message.includes(field),
          );
          if (rejected || blocks.length === 0) unreachable.push(`${component}.${field} = "${value}"`);
        }
      }
    }
    expect(unreachable, `enum values no directive can express: ${unreachable.join(', ')}`).toEqual([]);
  });
});

/**
 * The smallest markdown that exercises one enum value, or null when the
 * value belongs to a sub-component reached through its parent (checked
 * there instead).
 */
function probeEnum(component: string, field: string, value: string): string | null {
  switch (`${component}.${field}`) {
    case 'lesson.heading.level':
      return `::heading{level=${value}}\nText\n::`;
    case 'lesson.callout.tone':
      return `::callout{tone=${value}}\nBody\n::`;
    case 'lesson.degree-chips.size':
      return `::degree-chips{size=${value}}\nI IV V\n::`;
    case 'lesson.chord-diagram.orientation':
      return [
        `::chord-diagram{orientation=${value}}`,
        ...Array.from({ length: 6 }, (_, s) => `- string=${s} state=open`),
        '::',
      ].join('\n');
    case 'lesson.diagram.instrument':
      // Probed in EXPLICIT mode, because theory mode is guitar-only by
      // construction — triadVoicing() computes frets from the guitar's
      // STANDARD_TUNING_MIDI, so `instrument=bass mode=theory` names the
      // wrong notes and is refused (see "the visibility check" below).
      // `bass` is still fully expressible, which is what this test is for.
      return `::diagram{instrument=${value} mode=explicit}\n- string=0 fret=3\n::`;
    case 'lesson.diagram.mode':
      return value === 'theory'
        ? '::diagram{mode=theory root=C quality=major stringSet=e–B–G}\n::'
        : '::diagram{mode=explicit}\n- string=0 fret=3\n::';
    case 'lesson.diagram.root':
      return `::diagram{root=${value} quality=major stringSet=e–B–G}\n::`;
    case 'lesson.diagram.quality':
      return `::diagram{root=C quality=${value} stringSet=e–B–G}\n::`;
    case 'lesson.diagram.stringSet':
      return `::diagram{root=C quality=major stringSet=${value}}\n::`;
    case 'lesson.keyboard-diagram.mode':
      return value === 'theory'
        ? '::keyboard-diagram{mode=theory root=C quality=major}\n::'
        : '::keyboard-diagram{mode=explicit}\n- pc=C\n::';
    case 'lesson.keyboard-diagram.root':
      return `::keyboard-diagram{root=${value} quality=major}\n::`;
    case 'lesson.keyboard-diagram.quality':
      return `::keyboard-diagram{root=C quality=${value}}\n::`;
    case 'lesson.neck-pattern.instrument':
      return [
        `::neck-pattern{instrument=${value}}`,
        '- label="A"',
        '  - string=0 fret=1',
        '- label="B"',
        '  - string=0 fret=3',
        '::',
      ].join('\n');
    case 'lesson.chord-string.state':
      return [
        '::chord-diagram{}',
        `- string=0 state=${value}${value === 'fretted' ? ' fret=2' : ''}`,
        ...Array.from({ length: 5 }, (_, s) => `- string=${s + 1} state=open`),
        '::',
      ].join('\n');
    case 'lesson.key-mark.pc':
      return `::keyboard-diagram{mode=explicit}\n- pc=${value}\n::`;
    default:
      return null;
  }
}

// =============================================================================
// Repairs found by running it for real
// =============================================================================

describe('repairs a live run turned up', () => {
  const sixOpen = (extra = '') =>
    [
      `::chord-diagram{${extra}}`,
      ...Array.from({ length: 6 }, (_, s) => `- string=${s} state=${s === 0 ? 'fretted fret=2' : 'open'}`),
      '::',
    ].join('\n');

  // The frontier tier emitted `barreFret=0` twice in one section, reading
  // fret 0 as "at the nut". That is an open chord, not a barre — dropping
  // the barre keeps a correct diagram, where rejecting the block lost the
  // whole chord.
  it('reads barreFret=0 as "no barre" and keeps the chord box', () => {
    const { blocks, issues } = parseLessonMarkdown(
      sixOpen('barreFret=0 barreFromString=0 barreToString=5'),
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(componentsOf(blocks)).toEqual(['lesson.chord-diagram']);
    expect(blocks[0].block.barreFret).toBeUndefined();
    expect(blocks[0].block.barreFromString).toBeUndefined();
    const warn = issues.find((i) => i.severity === 'warning');
    expect(warn?.line).toBe(1);
    expect(warn?.message).toContain('the nut, not a barre');
  });

  it('still rejects a genuinely partial barre', () => {
    const { blocks, issues } = parseLessonMarkdown(sixOpen('barreFret=3'));
    expect(blocks).toHaveLength(0);
    expect(errorsOf(issues)[0].message).toContain('all three of barreFret');
  });

  // Raised from 6/12 once the schema stopped being what enforced them: the
  // model twice wrote an 8-column table that meant all 8 columns.
  it('keeps an 8-column table rather than silently dropping two columns', () => {
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const { blocks, issues } = parseLessonMarkdown(
      [
        '::table{}',
        `| ${cols.join(' | ')} |`,
        `|${cols.map(() => '---').join('|')}|`,
        `| ${cols.map((_, i) => i).join(' | ')} |`,
        '::',
      ].join('\n'),
    );
    expect(errorsOf(issues)).toEqual([]);
    expect(blocks[0].block.headers).toEqual(cols);
    expect((blocks[0].block.rows as string[][])[0]).toHaveLength(8);
  });
});
