// Reachability guard for the lesson block vocabulary.
//
// This branch has shipped four fields that were declared in the Strapi
// schema, written by something, and rendered by nothing: `caption`,
// `lesson.interactive`, `source`, `Lesson.instrument`. Every one was
// silent — no error, no failing test, just a gap where a picture or a
// citation should have been. Item 9 of docs/lesson-generation-audit.md
// ("a render-reachability test") is this file.
//
// It reads the real Strapi schema files from disk and greps the real
// client render path, the same stance as authoring-guide.test.ts: never
// through an abstraction that would only prove the code agrees with
// itself. Three connections are checked, because a block type has to
// survive all three to actually reach a reader:
//
//   schema → renderer   a dynamic-zone component with no `case` in
//                       LessonBody.tsx draws nothing, silently
//   schema → MCP        a component the MCP write tools' union doesn't
//                       list can't be authored over MCP at all
//   fields → readers    a declared attribute no client file so much as
//                       names is a field nothing can be reading
//
// The third is deliberately a coarse check — "does any file in the render
// path mention this name" — so it catches the class that actually bit us
// (a field added to the schema and forgotten everywhere else) without
// pretending to prove the value is used correctly. That part is what the
// render assertions in LessonBody.test.tsx are for.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Same cwd-relative resolution as authoring-guide.test.ts — this suite runs
// under `yarn --cwd client test`, so process.cwd() is the `client/` package
// root, one level below the repo root that `server/` and `docs/` live in.
const REPO_ROOT = resolve(process.cwd(), '..');
const LESSON_SCHEMA_PATH = resolve(
  REPO_ROOT,
  'server/src/api/lesson/content-types/lesson/schema.json',
);
const COMPONENTS_DIR = resolve(REPO_ROOT, 'server/src/components/lesson');
const MCP_BLOCKS_PATH = resolve(REPO_ROOT, 'server/src/mcp/tools/lesson-blocks.ts');
const LESSON_COMPONENTS_DIR = resolve(process.cwd(), 'src/components/lesson');
const DIAGRAM_PARAMS_PATH = resolve(process.cwd(), 'src/lib/lesson/diagram-params.ts');

const lessonSchema = JSON.parse(readFileSync(LESSON_SCHEMA_PATH, 'utf8'));
const dynamicZone: string[] = lessonSchema.attributes.body.components;

const lessonBodySource = readFileSync(resolve(LESSON_COMPONENTS_DIR, 'LessonBody.tsx'), 'utf8');

// server/src/mcp/tools/lesson-blocks.ts is read as TEXT, not imported.
// CLAUDE.md's rule is that `client` never imports from `server/` (they are
// separate installs with separate zod instances); reading the file as data
// respects that while still checking the real thing.
const mcpBlocksSource = readFileSync(MCP_BLOCKS_PATH, 'utf8');

/** Every client file that participates in rendering a lesson block. */
const renderPathSource = [
  ...readdirSync(LESSON_COMPONENTS_DIR)
    .filter((f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('.test.'))
    .map((f) => readFileSync(resolve(LESSON_COMPONENTS_DIR, f), 'utf8')),
  readFileSync(DIAGRAM_PARAMS_PATH, 'utf8'),
].join('\n');

type ComponentFile = {
  fileName: string;
  componentName: string;
  attributes: Record<string, { type: string; component?: string }>;
};

function loadComponents(): ComponentFile[] {
  return readdirSync(COMPONENTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((fileName) => {
      const json = JSON.parse(readFileSync(resolve(COMPONENTS_DIR, fileName), 'utf8'));
      return {
        fileName,
        componentName: `lesson.${fileName.replace(/\.json$/, '')}`,
        attributes: json.attributes ?? {},
      };
    });
}

const components = loadComponents();

// -----------------------------------------------------------------------------
// 1. schema → renderer
// -----------------------------------------------------------------------------
describe('lesson blocks — every dynamic-zone component has a renderer', () => {
  it('found the dynamic zone (sanity check on the schema read itself)', () => {
    expect(dynamicZone.length).toBeGreaterThan(5);
  });

  it.each(dynamicZone)('LessonBody.tsx has a `case` for %s', (component) => {
    expect(
      lessonBodySource.includes(`case '${component}'`),
      `${component} is in the lesson body dynamic zone but LessonBody.tsx has no "case '${component}':" — ` +
        'it would fall through to the default branch and render NOTHING, with no error. Add the case, or ' +
        'remove the component from the dynamic zone.',
    ).toBe(true);
  });

  it('does not render a case for a component that is not in the dynamic zone', () => {
    const cased = [...lessonBodySource.matchAll(/case '(lesson\.[a-z-]+)'/g)].map((m) => m[1]);
    const orphans = cased.filter((c) => !dynamicZone.includes(c));
    expect(
      orphans,
      `LessonBody.tsx renders ${orphans.join(', ')}, which the lesson dynamic zone does not allow — ` +
        'dead code at best, a block nobody can author at worst.',
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 2. schema → MCP write tools
// -----------------------------------------------------------------------------
describe('lesson blocks — the MCP write tools accept exactly the dynamic zone', () => {
  const mcpComponents = [...mcpBlocksSource.matchAll(/z\.literal\('(lesson\.[a-z-]+)'\)/g)].map(
    (m) => m[1],
  );

  it('found the MCP block union (sanity check on the source read itself)', () => {
    expect(mcpComponents.length).toBeGreaterThan(5);
  });

  it.each(dynamicZone)('createLesson/updateLesson accept %s', (component) => {
    expect(
      mcpComponents.includes(component),
      `${component} is in the lesson dynamic zone but server/src/mcp/tools/lesson-blocks.ts has no ` +
        `z.literal('${component}') branch — Claude authoring over MCP cannot emit it at all.`,
    ).toBe(true);
  });

  it('does not advertise a block the dynamic zone would reject', () => {
    const extra = mcpComponents.filter((c) => !dynamicZone.includes(c));
    expect(
      extra,
      `lesson-blocks.ts accepts ${extra.join(', ')}, which is not in the lesson body dynamic zone — ` +
        'Strapi would reject the write, or silently drop the block.',
    ).toEqual([]);
  });
});

// -----------------------------------------------------------------------------
// 3. fields → readers
// -----------------------------------------------------------------------------
describe('lesson blocks — every declared field is named somewhere in the render path', () => {
  // Fields that are genuinely declared-but-unread, each with the reason it
  // is allowed to be. Keep this list SHORT and keep the reasons honest: an
  // entry added here to make the suite green is the exact failure this file
  // exists to catch.
  const KNOWN_UNREAD = new Set([
    // The renderer reads `parameter.label` and `parameter.default` but never
    // `name` — it has one legal value ('key') and the picker is hardcoded to
    // a key selector, so there is nothing to branch on. It becomes readable
    // the day a second parameter kind exists.
    'lesson.parameter.name',
  ]);

  type FieldFact = { component: string; field: string };

  const fieldFacts: FieldFact[] = components.flatMap(({ componentName, attributes }) =>
    Object.keys(attributes).map((field) => ({ component: componentName, field })),
  );

  it('found a non-trivial number of fields to check (sanity check on the walker itself)', () => {
    expect(fieldFacts.length).toBeGreaterThan(40);
  });

  it.each(fieldFacts.map((f): [string, FieldFact] => [`${f.component}.${f.field}`, f]))(
    '%s is named in the client render path',
    (label, fact) => {
      if (KNOWN_UNREAD.has(label)) return;
      const named = new RegExp(`\\b${fact.field}\\b`).test(renderPathSource);
      expect(
        named,
        `"${fact.field}" is declared on ${fact.component} but the string never appears in ` +
          'client/src/components/lesson/** or client/src/lib/lesson/diagram-params.ts. ' +
          'Nothing can be reading it — that is the silent-field failure this repo has already ' +
          'shipped four times. Render it, or take it out of the schema.',
      ).toBe(true);
    },
  );
});
