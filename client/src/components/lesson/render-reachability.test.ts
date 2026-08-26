// Render-reachability guard: every field the schema declares must be read
// by something that draws it.
//
// Tier 4, item 9 of docs/lesson-generation-audit.md. This branch shipped
// FOUR fields that were declared in a Strapi schema, written by a
// generator, and rendered by nothing: `caption` (on four block types),
// `lesson.interactive` (a whole block with no renderer), `source` (BM25-
// grounded citations, dropped at render) and `Lesson.instrument`. Every
// one was silent — no error, no type error, no failing test, just a
// missing picture or a missing citation that nobody could see was
// missing. The audit's through-line: "the failure mode of this kind of
// work is silence."
//
// Both sides are derived at test time — the Strapi schema files are read
// off disk, the client render path is parsed with the TypeScript AST. A
// hand-maintained list of "fields that are rendered" would rot into
// exactly the bug being guarded against.
//
// -----------------------------------------------------------------------------
// What "reads it" means here
// -----------------------------------------------------------------------------
//
// A field counts as read when its name appears in a PROPERTY-READ POSITION
// in the render path:
//
//   * a dot access          `block.caption`, `rec.dim`, `keyboardBlock.octaves`
//   * a string-index access  `record['videoId']`
//   * an object destructure  `function ChordDiagram({ fretCount })`
//
// Deliberately NOT counted:
//
//   * the bare word anywhere in the file. A substring/`\bword\b` search
//     passes on a comment, a JSDoc line, a `fields: ['instrument', …]`
//     Strapi projection, or a string in an unrelated prompt. `fields:`
//     lists in particular name every column the read service asks Strapi
//     for, which would have made `Lesson.instrument` pass while nothing
//     drew it — the exact false pass this file exists to prevent.
//   * an assignment target (`x.foo = 1`) or an object-literal shorthand
//     (`{ caption }` as a VALUE). Those are writes. The generator writes
//     every one of these fields; being written is what all four silent
//     fields already had.
//
// -----------------------------------------------------------------------------
// What it CANNOT catch — read this before trusting a green run
// -----------------------------------------------------------------------------
//
// 1. It is NAME-level, not type-level. `s.name` on a STRING_SETS entry in
//    diagram-params.ts is indistinguishable from a read of
//    `lesson.parameter.name`. Type-directed matching would not fix this:
//    LessonBody reads every block field off a single `LessonBlock` with a
//    JSON index signature, so the checker cannot attribute a read to one
//    component either. Scoping (below) narrows it; it does not close it.
// 2. It cannot tell a USED read from a dead one. `const c = block.caption;`
//    with `c` never rendered passes. Only LessonBody.test.tsx's output
//    assertions can see that.
// 3. It says nothing about whether the value is rendered CORRECTLY, or
//    about enum values, defaults, `required`, or min/max bounds.
// 4. The `json` columns (`table.headers`/`rows`, `neck-pattern.patterns`)
//    have an inner shape the schema does not declare, so the fields inside
//    them are invisible here. `patterns[].dots` is checked only by the
//    coercion in LessonBody's `toNeckPatterns` and its own tests.
//
// -----------------------------------------------------------------------------
// Scoping — why the search domain is narrow on purpose
// -----------------------------------------------------------------------------
//
// The domain is the files that DRAW a lesson, never the ones that produce
// one. lesson-generation.ts, api.lesson-*.tsx and markdown-blocks.ts are
// excluded even though they name most of these fields: they are the
// writer, and "something writes it" is the condition all four silent
// fields already satisfied. Including them turns this file into a tautology.
//
// Within the drawing path, block fields are scoped tighter still: a
// dynamic-zone component's fields must be read either inside that
// component's own `case 'lesson.x':` region in LessonBody.tsx, or in one
// of the leaf renderers it delegates to (MiniNeck, ChordDiagram,
// diagram-params, …). So dropping `caption` from ONE case fails here even
// though five other cases still read a field by that name.

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

// Same cwd-relative resolution as block-vocabulary.test.ts and
// authoring-guide.test.ts: this suite runs under `yarn --cwd client test`,
// so process.cwd() is the `client/` package root, one below the repo root
// that `server/` lives in.
const CLIENT_ROOT = process.cwd();
const REPO_ROOT = resolve(CLIENT_ROOT, '..');

const COMPONENTS_DIR = resolve(REPO_ROOT, 'server/src/components/lesson');
const LESSON_SCHEMA_PATH = resolve(
  REPO_ROOT,
  'server/src/api/lesson/content-types/lesson/schema.json',
);

const LESSON_COMPONENTS_DIR = resolve(CLIENT_ROOT, 'src/components/lesson');
const LESSON_BODY_PATH = resolve(LESSON_COMPONENTS_DIR, 'LessonBody.tsx');

/** The files that draw a lesson BODY: the block switch, the leaf
 *  renderers it hands blocks to, and the block→renderer bridge. */
const BLOCK_RENDER_PATH = [
  ...readdirSync(LESSON_COMPONENTS_DIR)
    .filter((f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !f.includes('.test.'))
    .map((f) => resolve(LESSON_COMPONENTS_DIR, f)),
  resolve(CLIENT_ROOT, 'src/lib/lesson/diagram-params.ts'),
];

/** The files that draw a LESSON — its own columns, as opposed to the
 *  blocks in its body. Note lessons.index.tsx also holds the generation
 *  panel, whose reads of the proposed outline (`outline.title`, …) share
 *  names with the stored lesson's columns; see limitation 1 above. */
const LESSON_RENDER_PATH = [
  resolve(CLIENT_ROOT, 'src/routes/lessons.index.tsx'),
  resolve(CLIENT_ROOT, 'src/routes/lessons.$slug.tsx'),
];

// -----------------------------------------------------------------------------
// The extractor
// -----------------------------------------------------------------------------

type ReadSite = {
  /** How the name was reached: a property access (`block.caption`) or an
   *  object destructure (`function ChordDiagram({ fretCount })`). */
  kind: 'access' | 'destructure';
  /** Source text of the read, trimmed — quoted back in failures. */
  text: string;
  file: string;
  line: number;
};
type ReadIndex = Map<string, ReadSite[]>;

function record(index: ReadIndex, name: string, site: ReadSite): void {
  const sites = index.get(name);
  if (sites) sites.push(site);
  else index.set(name, [site]);
}

/** `x.foo = 1` writes; `x.foo` anywhere else reads. Compound assignments
 *  (`+=`, `++`) are read-modify-write and count as reads — none appear in
 *  the render path, and a false "it is read" there would be about as
 *  wrong as a false "it is written". */
function isAssignmentTarget(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

function collectReads(nodes: readonly ts.Node[], sf: ts.SourceFile, into: ReadIndex): void {
  const file = basename(sf.fileName);
  const walk = (node: ts.Node): void => {
    const site = (kind: ReadSite['kind']): ReadSite => ({
      kind,
      text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 48),
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    });

    if (ts.isPropertyAccessExpression(node) && !isAssignmentTarget(node)) {
      record(into, node.name.text, site('access'));
    } else if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      !isAssignmentTarget(node)
    ) {
      record(into, node.argumentExpression.text, site('access'));
    } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      // `{ fretCount }` / `{ fretCount: n }` on the left of `=` or in a
      // parameter list — a read of the property, not of a local.
      const key = node.propertyName ?? node.name;
      if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
        record(into, key.text, site('destructure'));
      }
    }
    ts.forEachChild(node, walk);
  };
  nodes.forEach(walk);
}

function sourceFile(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );
}

function parse(path: string): ts.SourceFile {
  return sourceFile(path, readFileSync(path, 'utf8'));
}

/** The extractor run over a literal snippet — lets the rules above be
 *  pinned directly instead of inferred from the real files. */
function readsInText(text: string): ReadIndex {
  const sf = sourceFile('probe.tsx', text);
  const index: ReadIndex = new Map();
  collectReads([sf], sf, index);
  return index;
}

function readsIn(paths: string[]): ReadIndex {
  const index: ReadIndex = new Map();
  for (const path of paths) {
    const sf = parse(path);
    collectReads([sf], sf, index);
  }
  return index;
}

/** Reads inside each `case 'lesson.x':` region of LessonBody's block
 *  switch, keyed by component name. A case that only delegates (the
 *  `lesson.diagram` case calls resolveDiagramDots) contributes little —
 *  that is why the leaf-renderer fallback exists. */
function readsPerCase(path: string): Map<string, ReadIndex> {
  const sf = parse(path);
  const perCase = new Map<string, ReadIndex>();
  const walk = (node: ts.Node): void => {
    if (
      ts.isCaseClause(node) &&
      ts.isStringLiteralLike(node.expression) &&
      node.expression.text.startsWith('lesson.')
    ) {
      const index: ReadIndex = new Map();
      collectReads(node.statements, sf, index);
      perCase.set(node.expression.text, index);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return perCase;
}

// -----------------------------------------------------------------------------
// Both sides, derived
// -----------------------------------------------------------------------------

const lessonSchema = JSON.parse(readFileSync(LESSON_SCHEMA_PATH, 'utf8'));
const dynamicZone: string[] = lessonSchema.attributes.body.components;

type SchemaField = {
  /** `lesson.chord-diagram` or `Lesson`. */
  owner: string;
  field: string;
  /** Repo-relative schema file, so a failure says where to go. */
  schemaFile: string;
  inDynamicZone: boolean;
};

const componentFields: SchemaField[] = readdirSync(COMPONENTS_DIR)
  .filter((f) => f.endsWith('.json'))
  .flatMap((fileName) => {
    const owner = `lesson.${fileName.replace(/\.json$/, '')}`;
    const json = JSON.parse(readFileSync(resolve(COMPONENTS_DIR, fileName), 'utf8'));
    return Object.keys(json.attributes ?? {}).map((field) => ({
      owner,
      field,
      schemaFile: `server/src/components/lesson/${fileName}`,
      inDynamicZone: dynamicZone.includes(owner),
    }));
  });

const lessonAttributeFields: SchemaField[] = Object.keys(lessonSchema.attributes).map(
  (field) => ({
    owner: 'Lesson',
    field,
    schemaFile: 'server/src/api/lesson/content-types/lesson/schema.json',
    inDynamicZone: false,
  }),
);

// Strapi injects `id` / `documentId` / `__component` rather than declaring
// them, so the structural fields the brief warns about never enter this
// list at all — no allow-list entry needed for them. (Both are in fact
// read: `documentId` keys the index cards, `__component` is the switch
// discriminator.)

const blockRenderReads = readsIn(BLOCK_RENDER_PATH);
const lessonRenderReads = readsIn(LESSON_RENDER_PATH);
const lessonBodyReads = readsIn([LESSON_BODY_PATH]);
const caseReads = readsPerCase(LESSON_BODY_PATH);
/** Everything in the block render path EXCEPT the switch itself — the
 *  leaf renderers and the params bridge. Used as the fallback for a case
 *  that delegates instead of reading fields directly. */
const leafRenderReads = readsIn(BLOCK_RENDER_PATH.filter((p) => p !== LESSON_BODY_PATH));

function sitesFor(field: SchemaField): ReadSite[] {
  if (field.owner === 'Lesson') return lessonRenderReads.get(field.field) ?? [];
  if (field.inDynamicZone) {
    return [
      ...(caseReads.get(field.owner)?.get(field.field) ?? []),
      ...(leafRenderReads.get(field.field) ?? []),
    ];
  }
  // Nested components (lesson.source, lesson.neck-dot, lesson.chord-string,
  // lesson.key-mark) and the lesson-level lesson.parameter belong to no
  // single case — they are read by shared helpers (SourceNote,
  // toNeckDots, toChordStrings) and by the leaf renderers.
  return [
    ...(lessonBodyReads.get(field.field) ?? []),
    ...(leafRenderReads.get(field.field) ?? []),
  ];
}

// -----------------------------------------------------------------------------
// The allow-list — fields that are genuinely declared-but-unread
// -----------------------------------------------------------------------------
//
// Every entry needs a reason that would survive being read out loud. An
// entry added to make the suite green is the exact failure this file
// exists to catch, so the reasons are load-bearing, and a stale entry
// (naming a field the schema no longer has) fails the suite below rather
// than sitting here forever.

const ALLOWED_UNREAD: Record<string, string> = {
  'lesson.parameter.name':
    'Structural discriminator with exactly one legal value ("key"). The picker in ' +
    "LessonBody's lesson.param-picker case is hardcoded to a pitch-class select, so " +
    'there is nothing to branch on; it becomes readable the day a second parameter kind ' +
    'exists. NOTE: the check would not have caught this on its own — `.name` is read on ' +
    'a STRING_SETS entry in diagram-params.ts, which is limitation 1 above in the flesh.',
  'Lesson.order':
    'Read by Strapi, not by the client: it is the sort key in listLessonsWithStatus ' +
    "(`sort: ['order:asc']`), so its effect is visible as the order of the index cards " +
    'and no client code ever needs the value. A property read here would be the surprise.',
};

// -----------------------------------------------------------------------------
// 0. The checker itself
// -----------------------------------------------------------------------------
//
// A reachability test that silently matched everything (or nothing) would
// be the same class of failure it is meant to catch, so it is pinned from
// both ends before it is trusted.
describe('render reachability — the checker itself', () => {
  it('found both sides of the comparison', () => {
    expect(componentFields.length).toBeGreaterThan(40);
    expect(lessonAttributeFields.length).toBeGreaterThan(8);
    expect(dynamicZone.length).toBeGreaterThan(5);
    expect(blockRenderReads.size).toBeGreaterThan(30);
    expect(caseReads.size).toBe(dynamicZone.length);
  });

  it('says NO to a name that is not there (negative control)', () => {
    // If this ever passes, the extractor has started matching on
    // something other than real property reads and every assertion below
    // it is worthless.
    expect(blockRenderReads.has('notAFieldAnywhereInThisRepo')).toBe(false);
    expect(lessonRenderReads.has('notAFieldAnywhereInThisRepo')).toBe(false);
  });

  it('counts reads and only reads', () => {
    // The rule stated at the top of this file, pinned on a snippet rather
    // than inferred from the real files. Writes must NOT appear: every one
    // of the four silent fields was written by something.
    const probe = readsInText(`
      const a = block.readByAccess;
      const b = block['readByIndex'];
      const { readByDestructure } = block;
      const { readByRenamed: local } = block;
      const written = { writtenAsKey: 1, shorthandWrite };
      block.assignedTo = 1;
    `);
    expect([...probe.keys()].sort()).toEqual([
      'readByAccess',
      'readByDestructure',
      'readByIndex',
      'readByRenamed',
    ]);
    expect(probe.get('readByAccess')?.[0].kind).toBe('access');
    expect(probe.get('readByDestructure')?.[0].kind).toBe('destructure');
  });

  it('records every real read site as an access or a destructure', () => {
    // Belt and braces on the walker over the actual files: a site with a
    // kind it never assigns would mean the AST shapes drifted.
    for (const name of ['caption', 'source', 'videoId']) {
      const sites = blockRenderReads.get(name) ?? [];
      expect(sites.length, `no read sites found for "${name}"`).toBeGreaterThan(0);
      for (const site of sites) {
        expect(['access', 'destructure']).toContain(site.kind);
        if (site.kind === 'access') {
          expect(
            site.text.includes('.') || site.text.includes('['),
            `"${name}" was recorded from ${site.file}:${site.line} as \`${site.text}\`, ` +
              'which does not look like a property access',
          ).toBe(true);
        }
      }
    }
  });

  it('scopes block fields to their own case, not the whole switch', () => {
    // The tighter scoping is the difference between "some case renders a
    // caption" and "THIS block renders its caption". Pin it: the natural-
    // notes case reads its own caption, and the heading case — which has
    // no caption field — does not.
    expect(caseReads.get('lesson.natural-notes')?.has('caption')).toBe(true);
    expect(caseReads.get('lesson.heading')?.has('caption')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 1. Component fields
// -----------------------------------------------------------------------------

describe('render reachability — lesson block components', () => {
  it.each(
    componentFields.map((f): [string, SchemaField] => [`${f.owner}.${f.field}`, f]),
  )('%s is read by something that draws it', (label, field) => {
    if (label in ALLOWED_UNREAD) return;
    const sites = sitesFor(field);
    const where = field.inDynamicZone
      ? `the \`case '${field.owner}':\` region of LessonBody.tsx, or any leaf renderer ` +
        '(MiniNeck, MiniKeyboard, ChordDiagram, NeckPatternPicker, NaturalNotesStrings, ' +
        'Step, DegreeChips, LessonSources) or diagram-params.ts'
      : 'LessonBody.tsx or any leaf renderer / diagram-params.ts';
    expect(
      sites.length,
      `"${field.field}" is declared on ${field.owner} (${field.schemaFile}) but nothing in ` +
        `${where} reads it as a property.\n` +
        'Being written is not being rendered — `caption`, `source`, `lesson.interactive` and ' +
        '`Lesson.instrument` were all written and all invisible. Render it, or take it out of ' +
        'the schema, or add it to ALLOWED_UNREAD with a reason that holds up.',
    ).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// 2. Lesson content-type attributes
// -----------------------------------------------------------------------------

describe('render reachability — the Lesson content type', () => {
  it.each(
    lessonAttributeFields.map((f): [string, SchemaField] => [`${f.owner}.${f.field}`, f]),
  )('%s is read by a lesson page', (label, field) => {
    if (label in ALLOWED_UNREAD) return;
    const sites = sitesFor(field);
    expect(
      sites.length,
      `"${field.field}" is declared on the Lesson content type (${field.schemaFile}) but ` +
        'neither lessons.index.tsx nor lessons.$slug.tsx reads it as a property.\n' +
        "Listing it in a Strapi `fields: [...]` projection does not count — that is how " +
        '`Lesson.instrument` spent this whole branch generated, stored and displayed nowhere. ' +
        'Render it, or take it out of the schema, or add it to ALLOWED_UNREAD with a reason.',
    ).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// 3. The allow-list itself
// -----------------------------------------------------------------------------

describe('render reachability — the allow-list', () => {
  const declared = new Set(
    [...componentFields, ...lessonAttributeFields].map((f) => `${f.owner}.${f.field}`),
  );

  it.each(Object.keys(ALLOWED_UNREAD))('%s still exists in the schema', (label) => {
    expect(
      declared.has(label),
      `ALLOWED_UNREAD lists ${label}, which no schema declares any more. Delete the entry — ` +
        'a stale exemption is how a real unrendered field slips back in under cover.',
    ).toBe(true);
  });

  it.each(Object.entries(ALLOWED_UNREAD))('%s carries a real reason', (label, reason) => {
    // Not a style rule: a one-word excuse is indistinguishable from no
    // excuse, and "unexplained allow-list entry" is precisely how this
    // bug comes back.
    expect(reason.length, `${label} needs an actual explanation`).toBeGreaterThan(60);
  });
});
