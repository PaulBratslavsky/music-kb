// Markdown → LessonBlock[]. The AUTHORING format for a lesson body is
// markdown with inline component directives; the STORAGE format stays the
// existing Strapi dynamic zone of typed blocks. This module is the parse
// step between the two, and the only one — both in-app generation passes
// go through it.
//
// -----------------------------------------------------------------------------
// Why markdown instead of structured JSON output
// -----------------------------------------------------------------------------
//
// Six Anthropic structured-output restrictions were found on this branch,
// every one by a live 400 rather than a test: `temperature` rejected,
// array `minItems > 1`, array `maxItems`, integer `minimum`/`maximum`,
// `oneOf`, and — the expensive one — a hard cap of 16 union-typed
// parameters per request. Every optional field counts as a union, so the
// block schema sat pinned at the ceiling, and staying under it meant
// cutting `param-picker`, `video-ref`, explicit `dots`/`marks`,
// `inversion`, `fromFret`/`toFret`, and locking diagrams to theory mode.
// The in-app generator could reach 5 of 13 block types; Claude authoring
// over MCP reached all 13. That gap was caused entirely by the output
// format.
//
// None of those restrictions apply to a text response. The trade is that
// the guarantees a schema gave for free now have to be earned here:
// validation MOVES to parse time, it does not disappear. Every rule the
// old `LessonBlockOutputSchema` + `toLessonBlock` pair enforced is
// enforced below, and every failure names the LINE it happened on, so a
// model can be told exactly what to fix.
//
// -----------------------------------------------------------------------------
// The syntax
// -----------------------------------------------------------------------------
//
// A container directive, the convention remark-directive / MDC use and
// therefore the one a model has actually seen:
//
//     ::keyboard-diagram{root=C quality=major octaves=1}
//     E–F and B–C are the two white pairs with no black key between them.
//     ::
//
// Ordinary prose is ordinary markdown — no directive needed. Rules that
// make the format hard to half-write:
//
//   * Every directive CLOSES with a line containing only `::`. There is no
//     self-closing form: a leaf-looking directive with no body still ends
//     with `::`. A directive whose close is missing never swallows the
//     rest — its body stops at the next directive, and that is reported.
//     Whether the block survives depends on WHY the body ended: at the
//     next directive it is recovered with a warning (the author plainly
//     finished and moved on), at end-of-answer it is dropped as an error
//     (the response may have been truncated mid-thought).
//   * A directive's NAME is its Strapi component name minus the `lesson.`
//     prefix — `::prose` is `lesson.prose`. No aliases, no second
//     vocabulary to keep in sync.
//   * A directive's ATTRIBUTE names are that component's own field names,
//     verbatim (`stringSet`, `fromFret`, `barreFromString`). Exactly two
//     attributes are not fields: `src` (shorthand for `source.videoId`,
//     because a nested object in an attribute list would be miserable) and
//     `after` (the illustrate pass's placement anchor, which is not stored
//     at all). `markdown-blocks.test.ts` asserts that correspondence
//     against the real component JSON in both directions, so a field added
//     to the schema and never given a directive attribute fails the suite.
//   * Unknown directive, unknown attribute, illegal enum value → an error
//     that names the line, the offending token, and the legal set. An
//     unknown attribute is NOT silently dropped: a misspelled `boxy` for
//     `body` has to fail here or it becomes a lesson with a gap in it and
//     no error anywhere.
//
// Inside the body of a VISUAL directive (diagram, keyboard-diagram,
// chord-diagram, neck-pattern), a line starting with `-` is a structured
// entry — one dot, one mark, one string, one pattern — written with the
// same `key=value`/bare-flag syntax as the attribute list. Every other
// non-empty line is the caption. That one rule is what lets a body carry
// both a list and a sentence without a second nested syntax.
//
// -----------------------------------------------------------------------------
// What this module does NOT do
// -----------------------------------------------------------------------------
//
// No grounding, no network, no BM25, no id assignment. `src` is returned
// as metadata alongside each block rather than written into it, because
// deciding WHICH video a citation is allowed to name (and WHEN in it) is
// the generator's job — see `groundParsedBlocks` in lesson-generation.ts.
// Keeping this module pure is what lets it be tested exhaustively without
// a stack, and what would let a future shared package hand the same parser
// to the MCP write tools.

import { PITCH_CLASSES } from '@music-kb/music/types';
import { STRING_SETS } from '@music-kb/music/theory/triad-shapes';
import {
  asNeckInstrument,
  isOnNeck,
  resolveDiagramDots,
  resolveDiagramMarks,
  visibleNeckDots,
  widenNeckWindow,
  NECK_MAX_FRET,
  NECK_STRING_COUNT,
  type DiagramBlock,
  type KeyboardDiagramBlock,
  type KeyMarkInput,
  type NeckDotInput,
  type NeckInstrument,
} from './diagram-params';
import type { JsonValue, LessonBlock } from '#/lib/services/lessons';

// -----------------------------------------------------------------------------
// Public shapes
// -----------------------------------------------------------------------------

export type ParseSeverity = 'error' | 'warning';

/**
 * One thing that went wrong, and where. `line` is 1-based against the
 * markdown as handed to `parseLessonMarkdown` (after code-fence
 * unwrapping, which never changes line numbering — the fence lines are
 * blanked, not removed, exactly so this stays true).
 *
 * `error` means the block was DROPPED. `warning` means it was kept after a
 * repair (a truncated caption, a capped table) — a repair is still worth
 * announcing, because the silent repair is how three fields on this branch
 * reached production unread.
 */
export type ParseIssue = {
  line: number;
  severity: ParseSeverity;
  message: string;
};

/**
 * A parsed block plus the metadata the generator needs and the block
 * itself must not carry.
 */
export type ParsedBlock = {
  /** The block, with `id: 0` — real ids are assigned at assembly. */
  block: LessonBlock;
  /** 1-based line the directive (or prose run) started on. */
  line: number;
  /** The `src` attribute: which video this block claims to come from. */
  src?: string;
  /**
   * video-ref only. The body text — a description of the moment being
   * pointed at, used to BM25-derive the timecode and never rendered.
   */
  moment?: string;
  /**
   * Illustrate pass only. The requested placement: a block index to follow,
   * -1 for "before everything", undefined for "end of section".
   */
  after?: number;
};

export type ParseResult = {
  blocks: ParsedBlock[];
  issues: ParseIssue[];
};

export type BareTextPolicy = 'prose' | 'ignore';

export type ParseOptions = {
  /**
   * Directive names this pass may emit. A directive outside the set is an
   * error naming the legal ones — the write pass must not draw and the
   * illustrate pass must not write, and that has to be enforced somewhere
   * now that no schema does it.
   */
  allowed?: readonly LessonDirectiveName[];
  /**
   * What to do with markdown that is not inside a directive. `prose` (the
   * write pass) turns each paragraph run into a `lesson.prose` block;
   * `ignore` (the illustrate pass) drops it with a warning rather than
   * silently, so a model that narrates its answer is visible.
   */
  bareText?: BareTextPolicy;
  /** Accept the `after` placement attribute (illustrate pass only). */
  allowAfter?: boolean;
  /**
   * Accept an authored `timeSec`. False everywhere in generation:
   * CLAUDE.md's rule is that no code path trusts a timecode the model
   * produced, so an authored one is dropped with a warning rather than
   * ignored in silence.
   */
  trustTimeSec?: boolean;
};

// -----------------------------------------------------------------------------
// The directive vocabulary
// -----------------------------------------------------------------------------

/**
 * Directive name → Strapi component. Derived by dropping the `lesson.`
 * prefix, which is the whole mapping rule: there is no alias table to
 * drift.
 */
export const LESSON_DIRECTIVES = {
  prose: 'lesson.prose',
  heading: 'lesson.heading',
  callout: 'lesson.callout',
  step: 'lesson.step',
  diagram: 'lesson.diagram',
  'keyboard-diagram': 'lesson.keyboard-diagram',
  'chord-diagram': 'lesson.chord-diagram',
  'neck-pattern': 'lesson.neck-pattern',
  'natural-notes': 'lesson.natural-notes',
  'degree-chips': 'lesson.degree-chips',
  table: 'lesson.table',
  'param-picker': 'lesson.param-picker',
  'video-ref': 'lesson.video-ref',
} as const;

export type LessonDirectiveName = keyof typeof LESSON_DIRECTIVES;

export const DIRECTIVE_NAMES = Object.keys(LESSON_DIRECTIVES) as LessonDirectiveName[];

/**
 * Every attribute each directive accepts. `src` and `after` aside (see the
 * header), each name is the component's own field name — the test asserts
 * that, in both directions, against `server/src/components/lesson/*.json`.
 *
 * Fields NOT listed are the repeatable sub-components and json arrays that
 * arrive as body entries instead (`dots`, `marks`, `strings`, `patterns`,
 * `headers`, `rows`, `degrees`, `body`, `text`, `caption`-when-free-text)
 * — the test knows about that exemption explicitly rather than by
 * accident.
 */
export const DIRECTIVE_ATTRIBUTES: Record<LessonDirectiveName, readonly string[]> = {
  prose: ['src'],
  heading: ['level'],
  callout: ['tone', 'src'],
  step: ['number', 'title', 'lede', 'src'],
  diagram: [
    'instrument',
    'mode',
    'root',
    'quality',
    'stringSet',
    'inversion',
    'useParam',
    'fromFret',
    'toFret',
    'caption',
    'src',
  ],
  'keyboard-diagram': ['mode', 'root', 'quality', 'useParam', 'octaves', 'caption', 'src'],
  'chord-diagram': [
    'barreFret',
    'barreFromString',
    'barreToString',
    'fretCount',
    'startFret',
    'orientation',
    'caption',
    'src',
  ],
  'neck-pattern': ['instrument', 'fromFret', 'toFret', 'caption', 'src'],
  'natural-notes': ['caption', 'src'],
  'degree-chips': ['label', 'caption', 'size'],
  table: ['caption'],
  'param-picker': ['label'],
  'video-ref': ['videoId', 'label', 'timeSec'],
};

/** Directives whose body is prose/markdown, not structured entries. */
export const TEXT_DIRECTIVES = [
  'prose',
  'heading',
  'callout',
  'step',
  'table',
  'degree-chips',
  'param-picker',
  'video-ref',
] as const;

/** Directives that draw something. */
export const VISUAL_DIRECTIVES = [
  'diagram',
  'keyboard-diagram',
  'chord-diagram',
  'neck-pattern',
  'natural-notes',
] as const;

// -----------------------------------------------------------------------------
// Limits. Every one of these used to live in the output schema, in code, or
// in both; none can live in a schema any more, so they all live here.
// -----------------------------------------------------------------------------

/** Strapi `string` column. Over-length captions are truncated + warned. */
export const CAPTION_MAX = 255;
// Runaway backstops, not shaping caps. These were 6 and 12 when the block
// schema could not express `maxItems` and the numbers had to double as a
// hint to a model that might ignore the prompt. A markdown table is
// explicit authoring, and a live run hit the 6-column cap twice on tables
// that meant all 8 columns — silently losing two columns of real content
// is a worse failure than a wide table. Raised to genuine runaway levels;
// the row/column consistency check below is what actually guards
// correctness.
const TABLE_HEADERS_MAX = 12;
const TABLE_ROWS_MAX = 24;
const DEGREE_CHIPS_MAX = 12;
const DOT_LABEL_MAX = 8;
/**
 * Runaway backstops for the two dot lists, and the same story as the table
 * caps above: 6 was "a triad plus a doubled note", which is a shaping
 * constraint wearing a limit's clothes. A two-octave scale shape is 14–16
 * dots and a whole-neck overlay more, so every scale diagram the model drew
 * was silently becoming a 6-dot one that looked deliberate.
 *
 * Now set to what the boards can physically hold — 6 strings × frets 0–22,
 * and one mark per pitch class, since `lesson.key-mark` addresses keys by pc
 * — so nothing an author could mean can hit them. Going over means repeats
 * or a runaway, and is an ERROR that DROPS the block rather than a warning
 * that truncates: truncation is invisible (a `warning` is not counted in the
 * `dropped` figure the SSE stream and /lessons show), and a diagram quietly
 * missing half its notes is worse than a diagram that is missing.
 */
const MAX_DIAGRAM_DOTS = NECK_STRING_COUNT.guitar * (NECK_MAX_FRET.guitar + 1);
const MAX_KEYBOARD_MARKS = PITCH_CLASSES.length;
const VIDEO_REF_LABEL_MAX = 120;
const PARAM_PICKER_LABEL_MAX = 40;
const PATTERN_LABEL_MAX = 40;
const PATTERN_SUB_MAX = 160;

const TRIAD_QUALITIES = ['major', 'minor', 'augmented', 'diminished'] as const;
const STRING_SET_NAMES = STRING_SETS.map((s) => s.name);

// -----------------------------------------------------------------------------
// Attribute tokenizing
// -----------------------------------------------------------------------------

type AttrValue = string | true;
type Attrs = Map<string, AttrValue>;

/**
 * `key=value key="quoted value" bareFlag` → a map. A bare token is `true`,
 * which is how boolean fields (`useParam`, `root`, `hollow`) are written.
 *
 * Unquoted values run to the next whitespace, so an en-dash string set
 * (`stringSet=e–B–G`) needs no quoting — worth having, since quoting is
 * exactly where a model tends to reach for the ASCII hyphen.
 */
function tokenizeAttrs(raw: string, line: number, issues: ParseIssue[]): Attrs {
  const attrs: Attrs = new Map();
  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i])) {
      i += 1;
      continue;
    }
    const keyStart = i;
    while (i < raw.length && !/[\s=]/.test(raw[i])) i += 1;
    const key = raw.slice(keyStart, i);
    if (!key) {
      i += 1;
      continue;
    }
    if (raw[i] !== '=') {
      attrs.set(key, true);
      continue;
    }
    i += 1; // consume '='
    const quote = raw[i];
    if (quote === '"' || quote === "'") {
      i += 1;
      const valStart = i;
      while (i < raw.length && raw[i] !== quote) i += 1;
      if (i >= raw.length) {
        issues.push({
          line,
          severity: 'error',
          message: `attribute \`${key}\` opens a ${quote === '"' ? 'double' : 'single'} quote that is never closed.`,
        });
        attrs.set(key, raw.slice(valStart));
        return attrs;
      }
      attrs.set(key, raw.slice(valStart, i));
      i += 1; // consume closing quote
    } else {
      const valStart = i;
      while (i < raw.length && !/\s/.test(raw[i])) i += 1;
      attrs.set(key, raw.slice(valStart, i));
    }
  }
  return attrs;
}

/**
 * Typed reads off an attribute map, each recording its own issue. Every
 * read is recorded in `used` so `rejectUnknown` can name what was left
 * over — the `.strict()` behaviour the MCP zod schemas rely on, which a
 * text format otherwise loses.
 */
function attrReader(attrs: Attrs, line: number, issues: ParseIssue[], where: string) {
  const used = new Set<string>();
  const err = (message: string) => issues.push({ line, severity: 'error', message: `${where}: ${message}` });
  const warn = (message: string) => issues.push({ line, severity: 'warning', message: `${where}: ${message}` });

  return {
    has(name: string): boolean {
      return attrs.has(name);
    },
    /** A string value. A bare flag where a string was wanted is an error. */
    str(name: string): string | undefined {
      used.add(name);
      const v = attrs.get(name);
      if (v === undefined) return undefined;
      if (v === true) {
        err(`\`${name}\` needs a value (write ${name}="…"), not a bare flag.`);
        return undefined;
      }
      const trimmed = v.trim();
      return trimmed || undefined;
    },
    enumOf<T extends string>(name: string, values: readonly T[]): T | undefined {
      const v = this.str(name);
      if (v === undefined) return undefined;
      if ((values as readonly string[]).includes(v)) return v as T;
      // The single most dangerous value in this schema: a hyphenated
      // string-set lookalike is a different string that renders an empty
      // diagram. Name the exact fix rather than the legal set.
      const enDashed = v.replace(/-/g, '–');
      if (enDashed !== v && (values as readonly string[]).includes(enDashed)) {
        err(
          `\`${name}="${v}"\` uses a hyphen (U+002D) where an EN DASH (U+2013) is required — write ${name}="${enDashed}".`,
        );
        return undefined;
      }
      err(`\`${name}="${v}"\` is not a legal value. Legal values: ${values.join(', ')}.`);
      return undefined;
    },
    int(name: string, opts: { min?: number; max?: number } = {}): number | undefined {
      const v = this.str(name);
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        err(`\`${name}="${v}"\` is not a number.`);
        return undefined;
      }
      const int = Math.trunc(n);
      if (opts.min !== undefined && int < opts.min) {
        err(`\`${name}=${int}\` is below the minimum of ${opts.min}.`);
        return undefined;
      }
      if (opts.max !== undefined && int > opts.max) {
        err(`\`${name}=${int}\` is above the maximum of ${opts.max}.`);
        return undefined;
      }
      return int;
    },
    bool(name: string): boolean {
      used.add(name);
      const v = attrs.get(name);
      if (v === undefined) return false;
      if (v === true || v === 'true') return true;
      if (v === 'false') return false;
      err(`\`${name}="${v}"\` is not a boolean — write \`${name}\` for true, or omit it for false.`);
      return false;
    },
    /**
     * Anything declared but not read. Not a silent strip: a misspelled
     * attribute has to fail here or it becomes an invisible gap later.
     */
    rejectUnknown(legal: readonly string[]) {
      for (const key of attrs.keys()) {
        if (used.has(key) || legal.includes(key)) continue;
        err(`unknown attribute \`${key}\`. Legal attributes: ${legal.join(', ') || '(none)'}.`);
      }
    },
    warn,
    err,
  };
}

type AttrReader = ReturnType<typeof attrReader>;

// -----------------------------------------------------------------------------
// Body shapes
// -----------------------------------------------------------------------------

type SourceLine = { line: number; text: string };

/** One `- key=value` entry inside a visual directive's body. */
type BodyEntry = { line: number; indent: number; attrs: Attrs };

type SplitBody = {
  /** Non-entry lines, joined — the caption / free text. */
  text: string;
  /** Line of the first free-text line, for issue reporting. */
  textLine: number;
  entries: BodyEntry[];
};

const ENTRY_RE = /^(\s*)-\s+(.*)$/;

function splitBody(body: SourceLine[], issues: ParseIssue[]): SplitBody {
  const entries: BodyEntry[] = [];
  const textLines: SourceLine[] = [];
  for (const l of body) {
    const m = ENTRY_RE.exec(l.text);
    if (m) {
      entries.push({ line: l.line, indent: m[1].length, attrs: tokenizeAttrs(m[2], l.line, issues) });
    } else if (l.text.trim()) {
      textLines.push(l);
    }
  }
  return {
    text: textLines.map((l) => l.text.trim()).join(' ').trim(),
    textLine: textLines[0]?.line ?? body[0]?.line ?? 0,
    entries,
  };
}

// -----------------------------------------------------------------------------
// Shared field builders
// -----------------------------------------------------------------------------

/**
 * Caption from the attribute, or — for a visual directive whose body is
 * not otherwise structured — the body's free text. Truncated rather than
 * rejected at CAPTION_MAX: dropping a whole diagram over 20 surplus
 * characters loses real content, so this repairs and announces instead.
 */
function readCaption(a: AttrReader, freeText: string, line: number, issues: ParseIssue[]): string | undefined {
  const attr = a.str('caption');
  if (attr && freeText) {
    a.warn('caption given both as an attribute and as body text — using the attribute.');
  }
  const raw = (attr ?? freeText).trim();
  if (!raw) return undefined;
  if (raw.length > CAPTION_MAX) {
    issues.push({
      line,
      severity: 'warning',
      message: `caption is ${raw.length} characters; the Strapi column caps at ${CAPTION_MAX}. Truncated — shorten it at the source.`,
    });
    return raw.slice(0, CAPTION_MAX).trimEnd();
  }
  return raw;
}

function readNeckDot(entry: BodyEntry, issues: ParseIssue[]): NeckDotInput | null {
  const a = attrReader(entry.attrs, entry.line, issues, 'dot');
  const string = a.int('string', { min: 0, max: 5 });
  const fret = a.int('fret', { min: 0 });
  const label = a.str('label');
  const root = a.bool('root');
  const dim = a.bool('dim');
  const hollow = a.bool('hollow');
  const ringed = a.bool('ringed');
  const light = a.bool('light');
  a.rejectUnknown(['string', 'fret', 'label', 'root', 'dim', 'hollow', 'ringed', 'light']);
  if (string === undefined || fret === undefined) {
    issues.push({
      line: entry.line,
      severity: 'error',
      message: 'dot needs both `string` (0 = high e … 5 = low E) and `fret` (0 = open). Dropped.',
    });
    return null;
  }
  const dot: NeckDotInput = { string, fret };
  if (label) {
    if (label.length > DOT_LABEL_MAX) {
      issues.push({
        line: entry.line,
        severity: 'warning',
        message: `dot label "${label}" is longer than ${DOT_LABEL_MAX} characters — truncated.`,
      });
    }
    dot.label = label.slice(0, DOT_LABEL_MAX);
  }
  if (root) dot.root = true;
  if (dim) dot.dim = true;
  if (hollow) dot.hollow = true;
  if (ringed) dot.ringed = true;
  if (light) dot.light = true;
  return dot;
}

function readKeyMark(entry: BodyEntry, issues: ParseIssue[]): KeyMarkInput | null {
  const a = attrReader(entry.attrs, entry.line, issues, 'mark');
  const pc = a.enumOf('pc', PITCH_CLASSES);
  const label = a.str('label');
  const root = a.bool('root');
  const flag = a.bool('flag');
  a.rejectUnknown(['pc', 'label', 'root', 'flag']);
  if (!pc) {
    issues.push({
      line: entry.line,
      severity: 'error',
      message: 'mark needs a `pc` (one of the 12 sharps-only pitch classes). Dropped.',
    });
    return null;
  }
  const mark: KeyMarkInput = { pc };
  if (label) mark.label = label.slice(0, DOT_LABEL_MAX);
  if (root) mark.root = true;
  if (flag) mark.flag = true;
  return mark;
}

// -----------------------------------------------------------------------------
// Per-directive builders
// -----------------------------------------------------------------------------

type BuildContext = {
  name: LessonDirectiveName;
  line: number;
  attrs: Attrs;
  body: SourceLine[];
  issues: ParseIssue[];
  options: Required<Pick<ParseOptions, 'trustTimeSec'>>;
  /** Running step counter, so `number` can default to sequence. */
  stepSeq: () => number;
};

type Built = { block: LessonBlock; src?: string; moment?: string } | null;

function bodyText(body: SourceLine[]): string {
  // Trailing/leading blank lines trimmed; interior structure (lists, blank
  // lines between paragraphs, fenced code) preserved — prose and step
  // bodies are rendered through ReactMarkdown and that structure is the
  // content.
  const lines = [...body];
  while (lines.length && !lines[0].text.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].text.trim()) lines.pop();
  return lines.map((l) => l.text).join('\n').trim();
}

function build(ctx: BuildContext): Built {
  const { name, line, attrs, body, issues } = ctx;
  const legal = DIRECTIVE_ATTRIBUTES[name];
  const a = attrReader(attrs, line, issues, `::${name}`);
  const err = (message: string) => issues.push({ line, severity: 'error', message: `::${name}: ${message}` });

  switch (name) {
    case 'prose': {
      const text = bodyText(body);
      a.rejectUnknown(legal);
      if (!text) {
        err('has an empty body. A prose block with no text renders as nothing.');
        return null;
      }
      const src = a.str('src');
      return { block: { __component: 'lesson.prose', id: 0, body: text }, src };
    }

    case 'heading': {
      const level = a.enumOf('level', ['h2', 'h3'] as const) ?? 'h2';
      a.rejectUnknown(legal);
      const text = bodyText(body).replace(/\s+/g, ' ').trim();
      if (!text) {
        err('has no heading text in its body.');
        return null;
      }
      return { block: { __component: 'lesson.heading', id: 0, text, level } };
    }

    case 'callout': {
      const tone = a.enumOf('tone', ['note', 'tip', 'warning'] as const) ?? 'note';
      const src = a.str('src');
      a.rejectUnknown(legal);
      const text = bodyText(body).replace(/\s*\n\s*/g, ' ').trim();
      if (!text) {
        err('has an empty body.');
        return null;
      }
      return { block: { __component: 'lesson.callout', id: 0, tone, body: text }, src };
    }

    case 'step': {
      const title = a.str('title');
      const lede = a.str('lede');
      const src = a.str('src');
      // Optional on purpose, unlike the Strapi field: the generator
      // renumbers the whole body after assembly anyway, so making a model
      // track a running counter across independently-written sections buys
      // nothing but a chance to get it wrong.
      const number = a.int('number', { min: 1 }) ?? ctx.stepSeq();
      a.rejectUnknown(legal);
      if (!title) {
        err('needs a `title` attribute — a step with no title renders as a bare number.');
        return null;
      }
      const block: LessonBlock = {
        __component: 'lesson.step',
        id: 0,
        number,
        // Trailing colons are a persistent model tic ("Identify the Root:").
        title: title.replace(/[\s:]+$/, ''),
      };
      if (lede) block.lede = lede;
      const text = bodyText(body);
      if (text) block.body = text;
      return { block, src };
    }

    case 'table': {
      const caption = readCaption(a, '', line, issues);
      a.rejectUnknown(legal);
      const parsed = parseGfmTable(body, issues);
      if (!parsed) return null;
      const block: LessonBlock = {
        __component: 'lesson.table',
        id: 0,
        headers: parsed.headers,
        rows: parsed.rows as unknown as JsonValue,
      };
      if (caption) block.caption = caption;
      return { block };
    }

    case 'degree-chips': {
      const size = a.enumOf('size', ['sm', 'md'] as const) ?? 'md';
      a.rejectUnknown(legal);
      const tokens = bodyText(body)
        .split(/[\s,]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      if (tokens.length === 0) {
        err('has no chips in its body. Write them on one line, e.g. `I ii IV V7`.');
        return null;
      }
      if (tokens.length > DEGREE_CHIPS_MAX) {
        issues.push({
          line,
          severity: 'warning',
          message: `::degree-chips: ${tokens.length} chips is over the ${DEGREE_CHIPS_MAX}-chip cap — extra chips dropped.`,
        });
      }
      return {
        block: {
          __component: 'lesson.degree-chips',
          id: 0,
          degrees: tokens.slice(0, DEGREE_CHIPS_MAX),
          size,
        },
      };
    }

    case 'param-picker': {
      const label = a.str('label');
      a.rejectUnknown(legal);
      if (bodyText(body)) {
        a.warn('takes no body text — the picker renders the lesson parameter\'s own control. Ignored.');
      }
      const block: LessonBlock = { __component: 'lesson.param-picker', id: 0 };
      if (label) block.label = label.slice(0, PARAM_PICKER_LABEL_MAX);
      return { block };
    }

    case 'video-ref': {
      const videoId = a.str('videoId');
      const label = a.str('label');
      const timeSec = a.int('timeSec', { min: 0 });
      a.rejectUnknown(legal);
      if (!videoId) {
        err('needs a `videoId` attribute — without one the link renders as nothing.');
        return null;
      }
      if (timeSec !== undefined && !ctx.options.trustTimeSec) {
        a.warn(
          'an authored `timeSec` is not trusted — timecodes are derived from the transcript. Ignored; describe the moment in the body instead.',
        );
      }
      const block: LessonBlock = {
        __component: 'lesson.video-ref',
        id: 0,
        videoId,
        label: label ? label.slice(0, VIDEO_REF_LABEL_MAX) : 'Watch this moment',
      };
      if (timeSec !== undefined && ctx.options.trustTimeSec) block.timeSec = timeSec;
      return { block, src: videoId, moment: bodyText(body).replace(/\s+/g, ' ').trim() || undefined };
    }

    case 'natural-notes': {
      const split = splitBody(body, issues);
      for (const entry of split.entries) {
        issues.push({
          line: entry.line,
          severity: 'warning',
          message: '::natural-notes takes no entries — it is the same fixed diagram every time. Ignored.',
        });
      }
      const caption = readCaption(a, split.text, line, issues);
      const src = a.str('src');
      a.rejectUnknown(legal);
      const block: LessonBlock = { __component: 'lesson.natural-notes', id: 0 };
      if (caption) block.caption = caption;
      return { block, src };
    }

    case 'diagram':
      return buildDiagram(ctx, a);

    case 'keyboard-diagram':
      return buildKeyboardDiagram(ctx, a);

    case 'chord-diagram':
      return buildChordDiagram(ctx, a);

    case 'neck-pattern':
      return buildNeckPattern(ctx, a);

    default:
      return null;
  }
}

function buildDiagram(ctx: BuildContext, a: AttrReader): Built {
  const { line, body, issues } = ctx;
  const legal = DIRECTIVE_ATTRIBUTES.diagram;
  const err = (message: string) => issues.push({ line, severity: 'error', message: `::diagram: ${message}` });

  const instrument = a.enumOf('instrument', ['guitar', 'bass'] as const) ?? 'guitar';
  const mode = a.enumOf('mode', ['theory', 'explicit'] as const) ?? 'theory';
  const root = a.enumOf('root', PITCH_CLASSES);
  const quality = a.enumOf('quality', TRIAD_QUALITIES);
  const stringSet = a.enumOf('stringSet', STRING_SET_NAMES);
  const inversion = a.int('inversion', { min: 0, max: 2 });
  const useParam = a.bool('useParam');
  const fromFret = a.int('fromFret', { min: 0 });
  const toFret = a.int('toFret', { min: 0 });
  const split = splitBody(body, issues);
  const caption = readCaption(a, split.text, line, issues);
  const src = a.str('src');
  a.rejectUnknown(legal);

  const block: LessonBlock = { __component: 'lesson.diagram', id: 0, instrument, mode };
  if (root) block.root = root;
  if (quality) block.quality = quality;
  if (stringSet) block.stringSet = stringSet;
  if (inversion !== undefined) block.inversion = inversion;
  if (useParam) block.useParam = true;
  if (fromFret !== undefined) block.fromFret = fromFret;
  if (toFret !== undefined) block.toFret = toFret;
  if (caption) block.caption = caption;

  const neck = asNeckInstrument(instrument);

  if (mode === 'explicit') {
    const dots = split.entries
      .map((e) => readNeckDot(e, issues))
      .filter((d): d is NeckDotInput => d !== null)
      .filter((d) => keepOnBoard(d, neck, '::diagram', line, issues));
    if (dots.length > MAX_DIAGRAM_DOTS) {
      err(
        `${dots.length} dots is past the ${MAX_DIAGRAM_DOTS}-dot runaway backstop — a ${neck} neck only has ${MAX_DIAGRAM_DOTS} positions, so the extras are repeats. Dropped.`,
      );
      return null;
    }
    if (dots.length) block.dots = dots as unknown as JsonValue;
  } else if (split.entries.length > 0) {
    a.warn('mode="theory" ignores hand-placed dots — set mode="explicit" to use them. Entries ignored.');
  }

  // triadVoicing() computes frets from STANDARD_TUNING_MIDI — guitar, always.
  // On a bass the same string indices are a different tuning AND a shorter
  // board, so a theory-mode bass diagram is not "a bit off", it names the
  // wrong notes (and half of them fall off a 4-string neck entirely). It
  // schema-validates, so nothing else catches it.
  if (mode === 'theory' && neck === 'bass') {
    err(
      'mode="theory" voices triads with guitar tuning, so on a bass it draws the wrong notes on strings that may not exist. Use mode="explicit" with hand-placed dots for a bass. Dropped.',
    );
    return null;
  }

  // THE resolve check. Kept from the schema era on purpose: it runs the
  // renderer's OWN resolver, so it catches the failures schema validity
  // never could — a theory-mode diagram missing one of root/quality/
  // stringSet renders as a completely empty gap with no error anywhere.
  const resolved = resolveDiagramDots(block as unknown as DiagramBlock);
  if (resolved.length === 0) {
    err(
      mode === 'explicit'
        ? 'mode="explicit" resolved to zero dots — an explicit diagram needs at least one `- string=… fret=…` entry. Dropped.'
        : `mode="theory" resolved to zero dots (root=${JSON.stringify(block.root ?? null)}, quality=${JSON.stringify(block.quality ?? null)}, stringSet=${JSON.stringify(block.stringSet ?? null)}). All three are required in theory mode. Dropped.`,
    );
    return null;
  }

  // ...and THE VISIBILITY CHECK, which is the other half of it. Resolving is
  // not drawing: MiniNeck clips every dot to a fret window, and an explicit
  // `fromFret`/`toFret` beats the dots ("an explicit from/to always wins",
  // MiniNeck.tsx:102). A C major first inversion sits at frets 8–9 — inside
  // `fromFret=3 toFret=8` two of its three dots resolve, pass the check above,
  // and are then clipped away. The window is a CROP HINT and the dots are the
  // content, so a hint that hides content loses: it is widened to fit, the way
  // barreFret=0 is repaired rather than taking the chord box down with it.
  applyWindowRepair({
    block,
    line,
    issues,
    where: '::diagram',
    instrument: neck,
    fromFret,
    toFret,
    // `useParam` swaps the root at RENDER time, so the shape moves: C major
    // on e–B–G is frets 3–5 and F major is 8–10. One fixed window cannot
    // follow it, and only the values the parameter can actually take reveal
    // that — hence resolving all twelve.
    dotSets: useParam
      ? PITCH_CLASSES.map((pc) => resolveDiagramDots(block as unknown as DiagramBlock, pc))
      : [resolved],
  });
  return { block, src };
}

/**
 * Report a dot the board has no position for. MiniNeck draws a string index
 * the instrument doesn't have outside its own viewBox and clips a fret past
 * the last one, so the dot is simply gone — not misplaced, invisible.
 *
 * Reported as an `error`, which by this file's contract takes the whole
 * block with it (see the dispatcher's "an error means the block is not
 * trustworthy" note): a dot addressed to a string that does not exist means
 * the author had the wrong instrument or the wrong numbers in mind, and a
 * shape silently missing a note is the failure this check exists to stop.
 */
function keepOnBoard(
  dot: NeckDotInput,
  instrument: NeckInstrument,
  where: string,
  line: number,
  issues: ParseIssue[],
): boolean {
  if (isOnNeck(dot, instrument)) return true;
  issues.push({
    line,
    severity: 'error',
    message: `${where}: dot string=${dot.string} fret=${dot.fret} is off a ${instrument} neck (strings 0–${NECK_STRING_COUNT[instrument] - 1}, frets 0–${NECK_MAX_FRET[instrument]}) — the renderer draws it outside the board, where nobody sees it. Block dropped.`,
  });
  return false;
}

/**
 * The shared window repair for the two blocks that carry `fromFret`/
 * `toFret`. Mutates `block` — widening the window so every dot survives
 * the clip, or dropping it where no fixed window can be right — and says
 * so. A `warning`, not an `error`, because the block is KEPT: this file's
 * contract is that `error` means dropped, and `dropped` is the count the
 * SSE stream and /lessons show.
 */
function applyWindowRepair(args: {
  block: LessonBlock;
  line: number;
  issues: ParseIssue[];
  where: string;
  instrument: NeckInstrument;
  fromFret?: number;
  toFret?: number;
  /**
   * Every set of dots this one window has to hold. More than one means the
   * shape MOVES (a `useParam` diagram redraws in the reader's chosen key),
   * and a moving shape has no fixed crop — that case drops the window
   * instead of widening it to the union, which would be a whole-neck board
   * with three dots on it at every value.
   */
  dotSets: readonly (readonly { string: number; fret: number }[])[];
}): void {
  const { block, line, issues, where, instrument, fromFret, toFret, dotSets } = args;

  // MiniNeck only honours the window when BOTH ends are set; with one it
  // auto-fits and the authored value is read by nothing. Stored, it is a
  // number that lies about what the diagram does.
  if ((fromFret === undefined) !== (toFret === undefined)) {
    delete block.fromFret;
    delete block.toFret;
    issues.push({
      line,
      severity: 'warning',
      message: `${where}: ${fromFret === undefined ? 'toFret' : 'fromFret'} was set without the other — the renderer ignores a half-set window and auto-fits around the dots. Dropped the stray value.`,
    });
    return;
  }
  if (fromFret === undefined || toFret === undefined) return;

  let from = fromFret;
  let to = toFret;
  let worstHidden = 0;
  let worstTotal = 0;
  for (const dots of dotSets) {
    if (dots.length === 0) continue;
    const hidden = dots.length - visibleNeckDots(dots, instrument, from, to).length;
    if (hidden > worstHidden) {
      worstHidden = hidden;
      worstTotal = dots.length;
    }
    if (hidden > 0) ({ fromFret: from, toFret: to } = widenNeckWindow(dots, instrument, from, to));
  }
  if (worstHidden === 0) return;

  const blank = worstHidden === worstTotal ? 'completely blank' : 'incomplete';
  const moving = dotSets.length > 1;
  if (moving) {
    delete block.fromFret;
    delete block.toFret;
  } else {
    block.fromFret = from;
    block.toFret = to;
  }
  issues.push({
    line,
    severity: 'warning',
    message: moving
      ? `${where}: fromFret=${fromFret} toFret=${toFret} clips ${worstHidden} of ${worstTotal} dots at some values of the lesson parameter, so the diagram would have rendered ${blank} in those keys. A parameterised shape moves with the key and cannot have a fixed window — dropped it so the neck auto-fits whatever the reader picks.`
      : `${where}: fromFret=${fromFret} toFret=${toFret} clips ${worstHidden} of ${worstTotal} dots, so the diagram would have rendered ${blank}. Widened the window to ${from}–${to} so the whole shape is visible.`,
  });
}

function buildKeyboardDiagram(ctx: BuildContext, a: AttrReader): Built {
  const { line, body, issues } = ctx;
  const legal = DIRECTIVE_ATTRIBUTES['keyboard-diagram'];
  const err = (message: string) =>
    issues.push({ line, severity: 'error', message: `::keyboard-diagram: ${message}` });

  const mode = a.enumOf('mode', ['theory', 'explicit'] as const) ?? 'theory';
  const root = a.enumOf('root', PITCH_CLASSES);
  const quality = a.enumOf('quality', TRIAD_QUALITIES);
  const useParam = a.bool('useParam');
  const octaves = a.int('octaves', { min: 1, max: 3 });
  const split = splitBody(body, issues);
  const caption = readCaption(a, split.text, line, issues);
  const src = a.str('src');
  a.rejectUnknown(legal);

  const block: LessonBlock = { __component: 'lesson.keyboard-diagram', id: 0, mode };
  if (root) block.root = root;
  if (quality) block.quality = quality;
  if (useParam) block.useParam = true;
  if (octaves !== undefined) block.octaves = octaves;
  if (caption) block.caption = caption;

  if (mode === 'explicit') {
    const marks = split.entries
      .map((e) => readKeyMark(e, issues))
      .filter((m): m is KeyMarkInput => m !== null);
    if (marks.length > MAX_KEYBOARD_MARKS) {
      err(
        `${marks.length} marks is past the ${MAX_KEYBOARD_MARKS}-mark runaway backstop — marks are addressed by pitch class, so there are only ${MAX_KEYBOARD_MARKS} distinct keys to light and the extras are repeats. Dropped.`,
      );
      return null;
    }
    if (marks.length) block.marks = marks as unknown as JsonValue;
  } else if (split.entries.length > 0) {
    a.warn('mode="theory" ignores hand-placed marks — set mode="explicit" to use them. Entries ignored.');
  }

  if (resolveDiagramMarks(block as unknown as KeyboardDiagramBlock).length === 0) {
    err(
      mode === 'explicit'
        ? 'mode="explicit" resolved to zero marks — needs at least one `- pc=…` entry. Dropped.'
        : `mode="theory" resolved to zero marks (root=${JSON.stringify(block.root ?? null)}, quality=${JSON.stringify(block.quality ?? null)}). Both are required in theory mode. Dropped.`,
    );
    return null;
  }
  return { block, src };
}

function buildChordDiagram(ctx: BuildContext, a: AttrReader): Built {
  const { line, body, issues } = ctx;
  const legal = DIRECTIVE_ATTRIBUTES['chord-diagram'];
  const err = (message: string) =>
    issues.push({ line, severity: 'error', message: `::chord-diagram: ${message}` });

  // Read without the min-1 bound so `barreFret=0` can be REPAIRED rather
  // than rejected. A live run lost two whole chord boxes to it: the model
  // reads fret 0 as "at the nut", which is not a barre, it is an open
  // chord. Dropping the barre keeps a correct diagram; dropping the block
  // loses the chord entirely.
  let barreFret = a.int('barreFret', { min: 0 });
  let barreDroppedAtNut = false;
  if (barreFret === 0) {
    issues.push({
      line,
      severity: 'warning',
      message:
        '::chord-diagram: `barreFret=0` is the nut, not a barre — the barre is dropped and the chord drawn without one. Omit the barre fields for an open chord.',
    });
    barreFret = undefined;
    barreDroppedAtNut = true;
  }
  const barreFromString = a.int('barreFromString', { min: 0, max: 5 });
  const barreToString = a.int('barreToString', { min: 0, max: 5 });
  const fretCount = a.int('fretCount', { min: 3, max: 6 });
  const startFret = a.int('startFret', { min: 1 });
  const orientation = a.enumOf('orientation', ['vertical', 'horizontal'] as const) ?? 'vertical';
  const split = splitBody(body, issues);
  const caption = readCaption(a, split.text, line, issues);
  const src = a.str('src');
  a.rejectUnknown(legal);

  const strings: Array<Record<string, JsonValue>> = [];
  const seen = new Map<number, number>();
  for (const entry of split.entries) {
    const ea = attrReader(entry.attrs, entry.line, issues, 'string');
    const index = ea.int('string', { min: 0, max: 5 });
    const state = ea.enumOf('state', ['fretted', 'open', 'muted'] as const);
    const fret = ea.int('fret', { min: 1 });
    const rootFlag = ea.bool('root');
    ea.rejectUnknown(['string', 'state', 'fret', 'root']);
    if (index === undefined) {
      issues.push({
        line: entry.line,
        severity: 'error',
        message: 'string entry needs a `string` index (0 = high e … 5 = low E). Dropped.',
      });
      continue;
    }
    if (!state) {
      issues.push({
        line: entry.line,
        severity: 'error',
        message: `string=${index} needs an explicit \`state\` (fretted, open or muted). A string with no state renders MUTED — a different chord, silently. Dropped.`,
      });
      continue;
    }
    if (state === 'fretted' && fret === undefined) {
      issues.push({
        line: entry.line,
        severity: 'error',
        message: `string=${index} is state="fretted" with no \`fret\`. Without it the string renders muted — a wrong chord with no error. For an unfretted string use state="open".`,
      });
      continue;
    }
    const first = seen.get(index);
    if (first !== undefined) {
      issues.push({
        line: entry.line,
        severity: 'error',
        message: `string=${index} was already given on line ${first}. Each of the six strings appears exactly once.`,
      });
      continue;
    }
    seen.set(index, entry.line);
    const rec: Record<string, JsonValue> = { string: index, state };
    if (state === 'fretted' && fret !== undefined) rec.fret = fret;
    if (rootFlag) rec.root = true;
    strings.push(rec);
  }

  const missing = [0, 1, 2, 3, 4, 5].filter((s) => !seen.has(s));
  if (missing.length > 0) {
    err(
      `no entry for string ${missing.join(', ')} (0 = high e … 5 = low E). A missing string renders MUTED — a different chord, with no error — so list all six, including the open ones. Dropped.`,
    );
    return null;
  }

  const barreGiven = [barreFret, barreFromString, barreToString].filter((v) => v !== undefined).length;
  // A partial barre is an error because the author MEANT a barre and left
  // it half-written. A barre repaired away at the nut is not partial — the
  // whole barre is gone on purpose, and the string indices with it.
  if (barreGiven > 0 && barreGiven < 3 && !barreDroppedAtNut) {
    err(
      'a barre needs all three of barreFret, barreFromString and barreToString. A partial barre draws no bar and raises no error. Dropped.',
    );
    return null;
  }

  if (strings.every((s) => s.state === 'muted')) {
    err('every string is muted — the renderer draws nothing at all. Dropped.');
    return null;
  }

  const block: LessonBlock = {
    __component: 'lesson.chord-diagram',
    id: 0,
    strings: strings as unknown as JsonValue,
    orientation,
  };
  if (barreGiven === 3 && !barreDroppedAtNut) {
    block.barreFret = barreFret as number;
    block.barreFromString = barreFromString as number;
    block.barreToString = barreToString as number;
  }
  if (fretCount !== undefined) block.fretCount = fretCount;
  if (startFret !== undefined) block.startFret = startFret;
  if (caption) block.caption = caption;
  return { block, src };
}

function buildNeckPattern(ctx: BuildContext, a: AttrReader): Built {
  const { line, body, issues } = ctx;
  const legal = DIRECTIVE_ATTRIBUTES['neck-pattern'];
  const err = (message: string) =>
    issues.push({ line, severity: 'error', message: `::neck-pattern: ${message}` });

  const instrument = a.enumOf('instrument', ['guitar', 'bass'] as const) ?? 'guitar';
  const fromFret = a.int('fromFret', { min: 0 });
  const toFret = a.int('toFret', { min: 0 });
  const split = splitBody(body, issues);
  const caption = readCaption(a, split.text, line, issues);
  const src = a.str('src');
  a.rejectUnknown(legal);

  // A pattern's own entry is a top-level `-`; its dots are INDENTED `-`
  // lines under it. That nesting is the only place this format needs two
  // levels, and indentation is how markdown already expresses it.
  const baseIndent = split.entries.length ? Math.min(...split.entries.map((e) => e.indent)) : 0;
  type Pattern = { label: string; sub?: string; dots: NeckDotInput[] };
  const patterns: Pattern[] = [];
  for (const entry of split.entries) {
    if (entry.indent > baseIndent) {
      const current = patterns[patterns.length - 1];
      if (!current) {
        issues.push({
          line: entry.line,
          severity: 'error',
          message: 'a dot appears before any `- label="…"` pattern line. Dropped.',
        });
        continue;
      }
      const dot = readNeckDot(entry, issues);
      if (dot && keepOnBoard(dot, asNeckInstrument(instrument), '::neck-pattern', entry.line, issues))
        current.dots.push(dot);
      continue;
    }
    const pa = attrReader(entry.attrs, entry.line, issues, 'pattern');
    const label = pa.str('label');
    const sub = pa.str('sub');
    pa.rejectUnknown(['label', 'sub']);
    if (!label) {
      issues.push({
        line: entry.line,
        severity: 'error',
        message: 'pattern needs a `label` — it is the pill text. Dropped.',
      });
      continue;
    }
    const pattern: Pattern = { label: label.slice(0, PATTERN_LABEL_MAX), dots: [] };
    if (sub) pattern.sub = sub.slice(0, PATTERN_SUB_MAX);
    patterns.push(pattern);
  }

  const usable = patterns.filter((p) => {
    if (p.dots.length > 0) return true;
    issues.push({
      line,
      severity: 'warning',
      message: `::neck-pattern: pattern "${p.label}" has no dots — a pill over an empty neck. Dropped.`,
    });
    return false;
  });

  if (usable.length < 2) {
    err(
      `needs at least 2 patterns with dots (got ${usable.length}). A picker with one pill is a control that does nothing, and the renderer draws nothing at all — use ::diagram for a single shape. Dropped.`,
    );
    return null;
  }
  if ((fromFret === undefined) !== (toFret === undefined)) {
    err(
      'fromFret and toFret must be set together — with only one the renderer auto-fits each pattern separately, which is the re-cropping this block exists to avoid. Dropped.',
    );
    return null;
  }

  const block: LessonBlock = {
    __component: 'lesson.neck-pattern',
    id: 0,
    instrument,
    patterns: usable as unknown as JsonValue,
  };
  if (fromFret !== undefined) block.fromFret = fromFret;
  if (toFret !== undefined) block.toFret = toFret;
  if (caption) block.caption = caption;

  // The shared window is this block's whole reason to exist, and it is also
  // the one place it can hide a pattern completely: NeckPatternPicker hands
  // MiniNeck the ACTIVE pattern's dots against the SHARED window, so a set
  // cropped to frets 0–5 with a fifth box at 12–15 draws an empty neck the
  // moment the reader clicks that pill. Every pattern is passed in, so the
  // widened window holds all of them and the boxes still climb the neck.
  applyWindowRepair({
    block,
    line,
    issues,
    where: '::neck-pattern',
    instrument: asNeckInstrument(instrument),
    fromFret,
    toFret,
    dotSets: [usable.flatMap((p) => p.dots)],
  });
  return { block, src };
}

// -----------------------------------------------------------------------------
// GFM table body
// -----------------------------------------------------------------------------

const SEPARATOR_CELL_RE = /^:?-{1,}:?$/;

function splitRow(text: string): string[] {
  let t = text.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map((c) => c.trim());
}

function parseGfmTable(
  body: SourceLine[],
  issues: ParseIssue[],
): { headers: string[]; rows: string[][] } | null {
  const lines = body.filter((l) => l.text.trim());
  if (lines.length === 0) {
    issues.push({
      line: body[0]?.line ?? 0,
      severity: 'error',
      message: '::table has an empty body — write a markdown table (header row, `|---|` separator, then rows).',
    });
    return null;
  }
  const headerLine = lines[0];
  if (!headerLine.text.includes('|')) {
    issues.push({
      line: headerLine.line,
      severity: 'error',
      message: '::table body must start with a markdown header row using `|` separators.',
    });
    return null;
  }
  const headers = splitRow(headerLine.text).slice(0, TABLE_HEADERS_MAX);
  const allHeaders = splitRow(headerLine.text);
  if (allHeaders.length > TABLE_HEADERS_MAX) {
    issues.push({
      line: headerLine.line,
      severity: 'warning',
      message: `::table has ${allHeaders.length} columns; capped at ${TABLE_HEADERS_MAX}. Extra columns dropped.`,
    });
  }
  if (headers.length === 0 || headers.every((h) => !h)) {
    issues.push({
      line: headerLine.line,
      severity: 'error',
      message: '::table header row has no column names.',
    });
    return null;
  }

  const rest = lines.slice(1);
  const rows: string[][] = [];
  let capWarned = false;
  for (const l of rest) {
    const cells = splitRow(l.text);
    if (cells.every((c) => SEPARATOR_CELL_RE.test(c))) continue; // the |---| rule
    if (cells.length !== allHeaders.length) {
      issues.push({
        line: l.line,
        severity: 'error',
        message: `::table row has ${cells.length} cell(s) but the header row has ${allHeaders.length} column(s) — every row must match the header count exactly. Block dropped.`,
      });
      return null;
    }
    if (rows.length >= TABLE_ROWS_MAX) {
      if (!capWarned) {
        issues.push({
          line: l.line,
          severity: 'warning',
          message: `::table is over the ${TABLE_ROWS_MAX}-row cap — extra rows dropped.`,
        });
        capWarned = true;
      }
      continue;
    }
    rows.push(cells.slice(0, TABLE_HEADERS_MAX));
  }

  if (rows.length === 0) {
    issues.push({
      line: headerLine.line,
      severity: 'error',
      message: '::table has a header row but no data rows.',
    });
    return null;
  }
  return { headers, rows };
}

// -----------------------------------------------------------------------------
// Bare markdown → prose blocks
// -----------------------------------------------------------------------------

const CONTINUATION_RE = /^(\s{2,}|[-*+>|]|\d+[.)]\s)/;

/**
 * Splits a run of non-directive markdown into paragraph-sized chunks, one
 * `lesson.prose` block each.
 *
 * Split at blank lines — EXCEPT where the next line continues the same
 * construct (a loose list item, a blockquote, a table row, an indented
 * continuation) or where we are inside a fenced code block. Splitting a
 * loose list into one block per item would turn a list into a run of
 * orphaned bullets, which is exactly the sort of quiet degradation this
 * whole branch is about.
 */
function splitProseChunks(run: SourceLine[]): SourceLine[][] {
  const chunks: SourceLine[][] = [];
  let current: SourceLine[] = [];
  let inFence = false;

  const flush = () => {
    while (current.length && !current[current.length - 1].text.trim()) current.pop();
    if (current.length) chunks.push(current);
    current = [];
  };

  for (let i = 0; i < run.length; i += 1) {
    const l = run[i];
    if (/^\s*(```|~~~)/.test(l.text)) inFence = !inFence;
    if (!l.text.trim() && !inFence) {
      // Look ahead: does the next non-blank line start a NEW paragraph?
      let j = i + 1;
      while (j < run.length && !run[j].text.trim()) j += 1;
      if (j >= run.length) break;
      if (!CONTINUATION_RE.test(run[j].text)) {
        flush();
        i = j - 1;
        continue;
      }
    }
    if (current.length === 0 && !l.text.trim()) continue;
    current.push(l);
  }
  flush();
  return chunks;
}

// -----------------------------------------------------------------------------
// The parser
// -----------------------------------------------------------------------------

// Two colons is the MDC/remark-directive block form; three is the
// remark-directive container form. Both are accepted for the open, and a
// close is any line of two-or-more colons and nothing else — being lenient
// about the count costs nothing (the close carries no name, so there is no
// ambiguity) and a model that reaches for `:::` should not lose a lesson
// over it.
const OPEN_RE = /^\s*:{2,}([a-zA-Z][a-zA-Z0-9-]*)\s*(?:\{([^}]*)\})?\s*$/;
const CLOSE_RE = /^\s*:{2,}\s*$/;

/**
 * Models wrap a whole answer in a code fence more often than not. The
 * fence lines are BLANKED rather than removed so every reported line
 * number still matches the text the caller (and the log) has.
 */
function unwrapOuterFence(lines: string[]): string[] {
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx === -1) return lines;
  if (!/^\s*(```|~~~)/.test(lines[firstIdx])) return lines;
  let lastIdx = -1;
  for (let i = lines.length - 1; i > firstIdx; i -= 1) {
    if (lines[i].trim()) {
      lastIdx = i;
      break;
    }
  }
  if (lastIdx === -1 || !/^\s*(```|~~~)\s*$/.test(lines[lastIdx])) return lines;
  const out = [...lines];
  out[firstIdx] = '';
  out[lastIdx] = '';
  return out;
}

/**
 * Parses a markdown lesson body into typed blocks.
 *
 * Never throws. Everything that goes wrong is a `ParseIssue` naming the
 * line: `error` means the block was dropped, `warning` means it was
 * repaired. The caller decides what a set of issues means — the write pass
 * logs them and retries a section that produced no blocks at all.
 */
export function parseLessonMarkdown(markdown: string, options: ParseOptions = {}): ParseResult {
  const allowed = options.allowed ?? DIRECTIVE_NAMES;
  const bareText = options.bareText ?? 'prose';
  const allowAfter = options.allowAfter ?? false;
  const trustTimeSec = options.trustTimeSec ?? false;

  const issues: ParseIssue[] = [];
  const blocks: ParsedBlock[] = [];
  const rawLines = unwrapOuterFence((markdown ?? '').split(/\r?\n/));
  const lines: SourceLine[] = rawLines.map((text, i) => ({ line: i + 1, text }));

  let stepCounter = 0;
  const stepSeq = () => {
    stepCounter += 1;
    return stepCounter;
  };

  let pending: SourceLine[] = [];
  const flushPending = () => {
    if (pending.length === 0) return;
    const run = pending;
    pending = [];
    if (!run.some((l) => l.text.trim())) return;
    if (bareText === 'ignore') {
      const first = run.find((l) => l.text.trim());
      issues.push({
        line: first?.line ?? run[0].line,
        severity: 'warning',
        message: `text outside a directive is ignored in this pass: "${(first?.text ?? '').trim().slice(0, 80)}"`,
      });
      return;
    }
    if (!allowed.includes('prose')) {
      const first = run.find((l) => l.text.trim());
      issues.push({
        line: first?.line ?? run[0].line,
        severity: 'error',
        message: 'plain markdown would become a prose block, which this pass may not emit.',
      });
      return;
    }
    for (const chunk of splitProseChunks(run)) {
      const text = chunk.map((l) => l.text).join('\n').trim();
      if (!text) continue;
      blocks.push({ block: { __component: 'lesson.prose', id: 0, body: text }, line: chunk[0].line });
    }
  };

  let i = 0;
  while (i < lines.length) {
    const current = lines[i];
    const open = OPEN_RE.exec(current.text);
    if (!open) {
      if (CLOSE_RE.test(current.text)) {
        issues.push({
          line: current.line,
          severity: 'warning',
          message: 'a stray `::` closes nothing here — ignored.',
        });
        i += 1;
        continue;
      }
      pending.push(current);
      i += 1;
      continue;
    }

    flushPending();
    // Snapshotted BEFORE the attribute list is tokenized, so a malformed
    // one (an unterminated quote) counts against this block the same way a
    // bad enum does.
    const errorsBefore = issues.filter((x) => x.severity === 'error').length;
    const name = open[1];
    const attrsRaw = open[2] ?? '';

    // Collect the body up to the close, stopping early at the NEXT open
    // directive so an unclosed one loses only itself rather than the whole
    // rest of the section.
    const body: SourceLine[] = [];
    let j = i + 1;
    let closed = false;
    for (; j < lines.length; j += 1) {
      if (CLOSE_RE.test(lines[j].text)) {
        closed = true;
        break;
      }
      if (OPEN_RE.test(lines[j].text)) break;
      body.push(lines[j]);
    }

    // An unclosed directive, split by WHY the body ended.
    //
    // Ended at the next directive: the author finished this block and moved
    // on, they just left off the `::`. The body is complete, so the block is
    // RECOVERED with a warning — a live run lost two whole paragraphs this
    // way, and dropping content that is demonstrably intact is the wrong
    // trade. Nothing is swallowed either way: the body still ends exactly
    // where the next directive begins.
    //
    // Ended at EOF: the answer may have been truncated mid-thought, and a
    // half-sentence is not content. That stays an error, and the block is
    // dropped.
    if (!closed) {
      const atEof = j >= lines.length;
      issues.push({
        line: current.line,
        severity: atEof ? 'error' : 'warning',
        message: atEof
          ? `::${name} opened here was never closed and the answer ends — every directive ends with a line containing only \`::\`. Block dropped, since a truncated body cannot be trusted.`
          : `::${name} opened here was never closed — every directive ends with a line containing only \`::\`. Recovered: the body ends where the next directive begins.`,
      });
      if (atEof) {
        i = j;
        continue;
      }
    }

    const directive = name as LessonDirectiveName;
    if (!(directive in LESSON_DIRECTIVES)) {
      issues.push({
        line: current.line,
        severity: 'error',
        message: `unknown directive \`::${name}\`. Legal directives: ${DIRECTIVE_NAMES.map((n) => `::${n}`).join(', ')}.`,
      });
      i = closed ? j + 1 : j;
      continue;
    }
    if (!allowed.includes(directive)) {
      issues.push({
        line: current.line,
        severity: 'error',
        message: `\`::${name}\` is not available in this pass. Available here: ${allowed.map((n) => `::${n}`).join(', ')}.`,
      });
      i = closed ? j + 1 : j;
      continue;
    }

    const attrs = tokenizeAttrs(attrsRaw, current.line, issues);
    let after: number | undefined;
    if (attrs.has('after')) {
      if (!allowAfter) {
        issues.push({
          line: current.line,
          severity: 'error',
          message: `\`after\` is not an attribute of ::${name} in this pass.`,
        });
      } else {
        const raw = attrs.get('after');
        const n = typeof raw === 'string' ? Number(raw) : NaN;
        if (!Number.isFinite(n)) {
          issues.push({
            line: current.line,
            severity: 'warning',
            message: `\`after="${String(raw)}"\` is not a number — placing at the end of the section instead.`,
          });
        } else {
          after = Math.trunc(n);
        }
      }
      attrs.delete('after');
    }

    const built = build({
      name: directive,
      line: current.line,
      attrs,
      body,
      issues,
      options: { trustTimeSec },
      stepSeq,
    });
    const errorsAfter = issues.filter((x) => x.severity === 'error').length;

    // A builder can return a block AND have logged an error (an unknown
    // attribute, a bad enum on an optional field). An error means the
    // block is not trustworthy, so it is dropped — the whole point of
    // moving validation here is that it stays as strict as the `.strict()`
    // zod schemas it replaces.
    if (built && errorsAfter === errorsBefore) {
      blocks.push({ ...built, line: current.line, after });
    }
    i = closed ? j + 1 : j;
  }
  flushPending();

  return { blocks, issues };
}

/** Convenience: the errors only, formatted one per line for a log. */
export function formatIssues(issues: ParseIssue[], max = 8): string {
  return issues
    .slice(0, max)
    .map((x) => `line ${x.line} [${x.severity}] ${x.message}`)
    .join('; ');
}
