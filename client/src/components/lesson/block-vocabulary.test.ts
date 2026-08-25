// Reachability guard for the lesson block vocabulary — BLOCK TYPES.
//
// This branch has shipped four fields that were declared in the Strapi
// schema, written by something, and rendered by nothing: `caption`,
// `lesson.interactive`, `source`, `Lesson.instrument`. Every one was
// silent — no error, no failing test, just a gap where a picture or a
// citation should have been.
//
// This file guards the whole-block half of that: a component that no
// renderer or MCP write tool knows about. The FIELD half — item 9 of
// docs/lesson-generation-audit.md, every attribute of every component and
// of the Lesson content type — lives in render-reachability.test.ts,
// which parses the render path's AST for real property reads. A third
// section here used to check fields by searching for the bare word, which
// passes on a comment or a `fields: [...]` projection; it was removed
// rather than left to disagree with the stricter check next door.
//
// It reads the real Strapi schema files from disk and greps the real
// client render path, the same stance as authoring-guide.test.ts: never
// through an abstraction that would only prove the code agrees with
// itself. Two connections are checked, because a block type has to
// survive both to reach a reader at all:
//
//   schema → renderer   a dynamic-zone component with no `case` in
//                       LessonBody.tsx draws nothing, silently
//   schema → MCP        a component the MCP write tools' union doesn't
//                       list can't be authored over MCP at all

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Same cwd-relative resolution as authoring-guide.test.ts — this suite runs
// under `yarn --cwd client test`, so process.cwd() is the `client/` package
// root, one level below the repo root that `server/` and `docs/` live in.
const REPO_ROOT = resolve(process.cwd(), '..');
const LESSON_SCHEMA_PATH = resolve(
  REPO_ROOT,
  'server/src/api/lesson/content-types/lesson/schema.json',
);
const MCP_BLOCKS_PATH = resolve(REPO_ROOT, 'server/src/mcp/tools/lesson-blocks.ts');
const LESSON_COMPONENTS_DIR = resolve(process.cwd(), 'src/components/lesson');

const lessonSchema = JSON.parse(readFileSync(LESSON_SCHEMA_PATH, 'utf8'));
const dynamicZone: string[] = lessonSchema.attributes.body.components;

const lessonBodySource = readFileSync(resolve(LESSON_COMPONENTS_DIR, 'LessonBody.tsx'), 'utf8');

// server/src/mcp/tools/lesson-blocks.ts is read as TEXT, not imported.
// CLAUDE.md's rule is that `client` never imports from `server/` (they are
// separate installs with separate zod instances); reading the file as data
// respects that while still checking the real thing.
const mcpBlocksSource = readFileSync(MCP_BLOCKS_PATH, 'utf8');

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

// Section 3 ("fields → readers") moved to render-reachability.test.ts.
