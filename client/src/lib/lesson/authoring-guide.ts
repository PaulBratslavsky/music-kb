// Loads docs/lesson-authoring.md — the single source of truth for lesson
// authoring rules, shared by this in-app generator (lesson-generation.ts)
// and the MCP `getLessonAuthoringGuide` read tool
// (server/src/mcp/tools/get-lesson-authoring-guide.ts). See that file for
// what it documents and client/src/lib/lesson/authoring-guide.test.ts,
// which fails loudly, naming the specific value, if the guide drifts from
// the schema it documents.
//
// Read from disk at module scope rather than a Vite `?raw` import: this
// module is also imported directly by authoring-guide.test.ts and by
// lesson-generation.test.ts under vitest, and this repo's
// vitest.config.ts is deliberately plugin-free (see CLAUDE.md's Tests
// section) — it doesn't run the app's Vite plugin pipeline that `?raw`
// suffix imports need, and adding one just for this would reintroduce the
// exact plugin-loading cost that config was written to avoid. A plain
// `readFileSync` needs no transform.
//
// Resolved relative to `process.cwd()`, not to this module's own location
// (`import.meta.url`) — the latter would need a DIFFERENT number of `..`
// segments depending on whether this runs from TypeScript source
// (client/src/lib/lesson/) or a compiled/bundled output whose directory
// depth isn't fixed. `process.cwd()` is stable instead: every entry point
// that loads this module — `yarn client`, `yarn dev` (via `cd client &&
// yarn dev`), and `yarn --cwd client test` — sets the process's cwd to the
// `client/` package root before running anything, per this repo's
// isolated-install convention (see CLAUDE.md's "Install per package").
// `docs/` sits one level up from there, at the repo root.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GUIDE_PATH = resolve(process.cwd(), '..', 'docs', 'lesson-authoring.md');

let cachedGuide: string | null = null;

/** The whole guide, read from disk once and cached for the process lifetime. */
export function loadAuthoringGuide(): string {
  if (cachedGuide === null) {
    cachedGuide = readFileSync(GUIDE_PATH, 'utf8');
  }
  return cachedGuide;
}

// Pulls one heading's content — from the heading line itself up to (but
// not including) the next heading of equal-or-shallower depth. Throws
// rather than returning an empty string on a miss: a heading this module
// depends on going missing means the guide and the prompt-injection code
// have drifted apart, and a silently-empty prompt excerpt is exactly the
// kind of silent gap this whole task exists to stop. Fail at generation
// time, loudly, not by shipping a lesson prompt with a hole in it.
function extractSection(markdown: string, heading: string): string {
  const level = heading.match(/^#+/)?.[0].length ?? 0;
  const lines = markdown.split('\n');
  const startIdx = lines.findIndex((line) => line.trim() === heading);
  if (startIdx === -1) {
    throw new Error(
      `[authoring-guide] Expected heading "${heading}" not found in docs/lesson-authoring.md — ` +
        'the guide and this prompt-injection code have drifted apart. Update whichever one moved.',
    );
  }
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#+)\s/);
    if (match && match[1].length <= level) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n').trim();
}

// The syntax section every generation prompt needs now that both passes
// author in MARKDOWN rather than structured JSON: what a directive looks
// like, that an attribute name IS the component's field name, and what the
// parser refuses. Without it a per-block reference entry is a list of
// fields with no way to write them down.
//
// Injected into BOTH pass excerpts. It is the one part of Half A that is
// not per-block, so it cannot ride along on a `### \`lesson.X\`` heading
// the way the directive examples do.
const DIRECTIVE_SYNTAX_HEADING = '### Writing the body as markdown directives';

// The block types the in-app WRITE pass (SECTION_SYSTEM in
// lesson-generation.ts) is allowed to emit. Deliberately a SUBSET of the
// dynamic-zone components — no heading (injected deterministically from
// the outline, never model-emitted), and — since the write/illustrate
// split — nothing that draws. Those are emitted by the separate
// ILLUSTRATE pass below, given the write pass's finished text, not by this
// one; see docs/lesson-authoring.md's "Generation is two passes" note.
//
// param-picker and video-ref rejoined this list once the write/illustrate
// split freed room under Anthropic's 16-union-typed-parameter cap — a cap
// that no longer applies at all now the pass authors in markdown. Their
// guide entries matter as much as the rest: param-picker's says it renders
// as nothing on a lesson with no `parameter`, and video-ref's says a
// `timeSec` is grounded and never invented — both rules the write pass
// still enforces in code too.
const SECTION_BLOCK_TYPES = [
  'lesson.prose',
  'lesson.callout',
  'lesson.step',
  'lesson.table',
  'lesson.degree-chips',
  'lesson.param-picker',
  'lesson.video-ref',
] as const;

// The block types the in-app ILLUSTRATE pass is allowed to emit — the five
// that draw something, which the write pass above deliberately excludes.
//
// It was two until this branch. chord-diagram, neck-pattern and
// natural-notes existed in the schema and in LessonBody with nothing able
// to reach them from generation: the combined write+illustrate schema sat
// at Anthropic's 16-union-typed-parameter ceiling, so there was no room to
// declare them. Authoring in markdown removes the ceiling, and this list
// is where that unlock actually lands — miss it and the widened vocabulary
// stays theoretical.
const ILLUSTRATION_BLOCK_TYPES = [
  'lesson.diagram',
  'lesson.keyboard-diagram',
  'lesson.chord-diagram',
  'lesson.neck-pattern',
  'lesson.natural-notes',
] as const;

// The entry shapes that live INSIDE an illustration block's body — one
// dot, one keyboard mark, one chord-box string, one pattern. None is a
// top-level dynamic-zone block, so none is in ILLUSTRATION_BLOCK_TYPES
// above; but a model writing `- string=5 fret=5 label=A root ringed` needs
// their field rules (the string-index convention, the required `state`,
// the four style flags) exactly as much as the parent block's. Their
// headings carry a parenthetical suffix in the guide, so they can't reuse
// the `### \`${component}\`` template the block-type loops use; extracted
// by literal heading text instead.
const SUB_COMPONENT_HEADINGS = [
  '### `lesson.neck-dot` (used inside `lesson.diagram.dots`)',
  '### `lesson.key-mark` (used inside `lesson.keyboard-diagram.marks`)',
  '### `lesson.chord-string` (used inside `lesson.chord-diagram.strings`)',
  '#### The pattern shape (entries in `lesson.neck-pattern.patterns`)',
] as const;

/**
 * Excerpt for the outline call: structural judgment only (how a lesson
 * should open, progress, and how big a section should be) — NOT the block
 * reference, which the outline call never needs since it doesn't emit any
 * blocks. Keeps that call's prompt small, same rationale as staging the
 * pipeline into several small calls in the first place (see
 * lesson-generation.ts's own header comment on the local tier).
 */
export function getOutlineGuideExcerpt(): string {
  const guide = loadAuthoringGuide();
  return [
    extractSection(guide, '### Opening and progression'),
    extractSection(guide, '### Lesson length and section sizing'),
  ].join('\n\n');
}

/**
 * Excerpt for the per-section WRITE call: the directive syntax, the block
 * reference entries for exactly the block types that call is allowed to
 * emit, plus the judgment sections most directly about what those blocks
 * should contain. No diagram vocabulary and no "when a diagram earns its
 * place" judgment here — this call never emits a diagram, see
 * ILLUSTRATION_BLOCK_TYPES above.
 */
export function getSectionBlockGuideExcerpt(): string {
  const guide = loadAuthoringGuide();
  const syntax = extractSection(guide, DIRECTIVE_SYNTAX_HEADING);
  const blockReference = SECTION_BLOCK_TYPES.map((component) =>
    // Headings in the guide wrap the component name in backticks, e.g.
    // "### `lesson.prose`" — match that exactly.
    extractSection(guide, `### \`${component}\``),
  );
  const judgment = [
    extractSection(guide, '#### Callouts: carry a fact, not a mood'),
    extractSection(guide, '#### Prose: name the note, not the shape'),
    extractSection(guide, '### Citing sources'),
  ];
  return [syntax, ...blockReference, ...judgment].join('\n\n');
}

/**
 * Excerpt for the per-section ILLUSTRATE call: the directive syntax, the
 * block reference entries for all five drawing blocks (and the four entry
 * shapes that live inside their bodies), plus the judgment on when a
 * diagram earns its place — including the progression guidance — and the
 * citation rule (illustrations carry `source` too, same as write-pass
 * blocks).
 */
export function getIllustrationGuideExcerpt(): string {
  const guide = loadAuthoringGuide();
  const syntax = extractSection(guide, DIRECTIVE_SYNTAX_HEADING);
  const blockReference = ILLUSTRATION_BLOCK_TYPES.map((component) =>
    extractSection(guide, `### \`${component}\``),
  );
  const subComponentReference = SUB_COMPONENT_HEADINGS.map((heading) =>
    extractSection(guide, heading),
  );
  const judgment = [
    extractSection(guide, '### When a diagram earns its place versus when prose is clearer'),
    extractSection(guide, '### Citing sources'),
  ];
  return [syntax, ...blockReference, ...subComponentReference, ...judgment].join('\n\n');
}
