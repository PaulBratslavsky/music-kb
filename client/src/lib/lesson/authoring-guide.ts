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

// The block types the in-app section-generation step (SECTION_SYSTEM in
// lesson-generation.ts) is allowed to emit. Deliberately a SUBSET of the
// ten dynamic-zone components — no diagram/keyboard-diagram (enabling
// those is a separate task), no heading (injected deterministically from
// the outline, never model-emitted), no param-picker/video-ref (not part
// of this pipeline's output today).
const SECTION_BLOCK_TYPES = [
  'lesson.prose',
  'lesson.callout',
  'lesson.step',
  'lesson.table',
  'lesson.degree-chips',
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
 * Excerpt for the per-section block-generation call: the block reference
 * entries for exactly the five block types that call is allowed to emit,
 * plus the judgment sections most directly about what those blocks should
 * contain (not the title/disagreement guidance, which don't apply to a
 * single section call).
 */
export function getSectionBlockGuideExcerpt(): string {
  const guide = loadAuthoringGuide();
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
  return [...blockReference, ...judgment].join('\n\n');
}
