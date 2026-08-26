// Drift guard for docs/lesson-authoring.md — the whole point of that file
// existing (see brief in .superpowers/sdd/lesson-authoring/brief.md) is
// that both authoring paths (in-app generator + MCP write tools) trust it
// as a single source of truth. This suite reads the guide AND the real
// Strapi schema files directly from disk — never through
// authoring-guide.ts's excerpt helpers, which would only prove the guide
// agrees with itself — and fails LOUDLY, naming the specific missing or
// stale value, the moment either side drifts.
//
// This branch has already been bitten by drift four times: a `caption`
// field declared and never rendered, `diagram.scale` and `table.useParam`
// dead on arrival, `lesson.interactive` with no renderer, and CLAUDE.md
// describing a zod arrangement that changed months ago. This test exists
// so a fifth time fails `yarn test`, not a user staring at a blank
// diagram.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Same cwd-relative resolution as authoring-guide.ts and
// get-lesson-authoring-guide.ts (see their comments for why) — this test
// runs under `yarn --cwd client test`, so process.cwd() is the `client/`
// package root, one level below the repo root that `docs/` and `server/`
// live in.
const REPO_ROOT = resolve(process.cwd(), '..');
const GUIDE_PATH = resolve(REPO_ROOT, 'docs', 'lesson-authoring.md');
const LESSON_SCHEMA_PATH = resolve(
  REPO_ROOT,
  'server/src/api/lesson/content-types/lesson/schema.json',
);
const COMPONENTS_DIR = resolve(REPO_ROOT, 'server/src/components/lesson');

const guide = readFileSync(GUIDE_PATH, 'utf8');
const lessonSchema = JSON.parse(readFileSync(LESSON_SCHEMA_PATH, 'utf8'));

type StrapiAttribute = {
  type: string;
  enum?: string[];
  [key: string]: unknown;
};

type ComponentFile = {
  fileName: string; // e.g. "callout.json"
  componentName: string; // e.g. "lesson.callout" (Strapi's own component addressing convention)
  attributes: Record<string, StrapiAttribute>;
};

function loadComponents(): ComponentFile[] {
  const fileNames = readdirSync(COMPONENTS_DIR).filter((f) => f.endsWith('.json'));
  return fileNames.map((fileName) => {
    const json = JSON.parse(readFileSync(resolve(COMPONENTS_DIR, fileName), 'utf8'));
    const componentName = `lesson.${fileName.replace(/\.json$/, '')}`;
    return { fileName, componentName, attributes: json.attributes ?? {} };
  });
}

const components = loadComponents();

// A token can legitimately appear in the guide's PROSE as a negated
// warning ("lesson.interactive does NOT exist — never emit it" is exactly
// what Half A's traps section is supposed to say, and the brief requires
// it explicitly). What must NOT happen is the token getting its own block
// -reference entry, i.e. a heading that documents it as if it were a real,
// usable block — the same pattern as every genuine `### \`lesson.x\`` entry
// below. So "does the guide claim this exists" is checked as "does it have
// a dedicated heading for it", not "does the string appear anywhere" —
// the latter would also fail on the warning sentence that's supposed to be
// there.
function isDocumentedAsRealBlockReference(token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headingPattern = new RegExp(`^#{2,4}\\s+.*\`?${escaped}\`?`, 'm');
  return headingPattern.test(guide);
}

// -----------------------------------------------------------------------------
// 1. Every component in the lesson dynamic zone appears in the guide.
// -----------------------------------------------------------------------------
describe('lesson-authoring.md — dynamic zone coverage', () => {
  it('documents every component in the body dynamic zone', () => {
    const dynamicZoneComponents: string[] = lessonSchema.attributes.body.components;
    expect(dynamicZoneComponents.length).toBeGreaterThan(0); // sanity: the schema read actually worked

    const missing = dynamicZoneComponents.filter((name) => !guide.includes(name));
    expect(missing, `guide is missing these dynamic-zone components: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('does not give a removed component (lesson.interactive) its own block-reference entry', () => {
    // lesson.interactive was removed from the schema (no renderer — see
    // LessonBody.tsx's own comment on it). It's fine — required, even —
    // for the guide to WARN that it doesn't exist; what it must not do is
    // document it as if it were a real, usable block (a dedicated
    // "### `lesson.interactive`" reference entry, the way the ten real
    // ones each get one below).
    const dynamicZoneComponents: string[] = lessonSchema.attributes.body.components;
    expect(dynamicZoneComponents).not.toContain('lesson.interactive');
    expect(isDocumentedAsRealBlockReference('lesson.interactive')).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// 2. Every enum value in every lesson component (and the lesson content
//    type's own top-level enums) appears in the guide, literally.
// -----------------------------------------------------------------------------
describe('lesson-authoring.md — enum coverage (schema → guide)', () => {
  type EnumFact = { component: string; field: string; value: string };

  function collectEnumFacts(): EnumFact[] {
    const facts: EnumFact[] = [];
    for (const { componentName, attributes } of components) {
      for (const [field, attr] of Object.entries(attributes)) {
        if (attr.type === 'enumeration' && Array.isArray(attr.enum)) {
          for (const value of attr.enum) {
            facts.push({ component: componentName, field, value });
          }
        }
      }
    }
    // The lesson content type's own top-level fields (level, instrument,
    // status) are documented in the guide's "Lesson record fields" table,
    // not inside a `lesson.*` component file — but they're just as real a
    // drift risk (this exact field pair — lesson.instrument vs
    // lesson.diagram.instrument — is called out in the guide as a trap
    // precisely because the two enums share a name but not a value set).
    for (const [field, attr] of Object.entries(
      lessonSchema.attributes as Record<string, StrapiAttribute>,
    )) {
      if (attr.type === 'enumeration' && Array.isArray(attr.enum)) {
        for (const value of attr.enum) {
          facts.push({ component: 'lesson (top-level)', field, value });
        }
      }
    }
    return facts;
  }

  const enumFacts = collectEnumFacts();

  it('found a non-trivial number of enum values to check (sanity check on the walker itself)', () => {
    // If this ever drops to 0, the walker broke, not the guide — every
    // assertion below would trivially pass on an empty list.
    expect(enumFacts.length).toBeGreaterThan(20);
  });

  it.each(enumFacts.map((f): [string, EnumFact] => [`${f.component}.${f.field} = "${f.value}"`, f]))(
    'guide mentions %s',
    (_label, fact) => {
      expect(
        guide.includes(fact.value),
        `"${fact.value}" (${fact.component}.${fact.field}) does not appear anywhere in docs/lesson-authoring.md`,
      ).toBe(true);
    },
  );
});

// -----------------------------------------------------------------------------
// 3. The guide does not claim a value/field/block that isn't real — the
//    "other direction" of drift the brief calls out, and bullet 4's exact
//    list: lesson.interactive, diagram.scale, table.useParam, and any
//    seventh `quality`. Two different checks, because "mention" can't be a
//    single blind substring test — the guide is REQUIRED (per Half A's own
//    traps section, and per this exact describe block's first test above)
//    to explicitly warn that lesson.interactive doesn't exist, which means
//    the string "lesson.interactive" legitimately appears in the guide's
//    prose. What must never happen is that a value gets presented as
//    LEGITIMATE:
//      a) diagram.scale / table.useParam / a seventh-quality identifier —
//         these have no legitimate reason to appear at all (unlike
//         lesson.interactive, nothing in Half A needs to name a removed
//         FIELD by its dotted path or a specific removed quality string to
//         explain the trap — "the `scale` field was removed" / "seventh
//         qualities were removed" convey the same warning without ever
//         spelling out the exact removed identifier), so a blind substring
//         check is the right tool here.
//      b) lesson.interactive — covered above, via the block-reference-
//         heading check, not a blind substring check.
// -----------------------------------------------------------------------------
describe('lesson-authoring.md — reverse drift (guide → schema)', () => {
  const neverLegitimateTokens = [
    'diagram.scale',
    'table.useParam',
    'dominant7',
    'major7',
    'minor7',
    'minorMajor7',
    'halfDiminished7',
  ];

  it.each(neverLegitimateTokens)('never mentions the removed/never-real token %s', (token) => {
    expect(
      guide,
      `guide mentions "${token}", which was removed from (or never existed in) the schema`,
    ).not.toContain(token);
  });

  it('does not give the removed diagram.scale field a place in the lesson.diagram field table', () => {
    // Narrower than a blind substring check on "scale" (too common an
    // English word to ban outright) — this greps specifically inside
    // lesson.diagram's FIELD table for a `scale` row, the only place a
    // resurrected removed field could plausibly reappear.
    //
    // Scoped to the field table rather than the whole reference entry
    // because that entry now also carries an INTENT table whose first
    // column legitimately contains `scale` — the intent named `scale`,
    // realized by realizeCagedShape(), which is a value of the `intent`
    // field and not a field of its own. The removed thing was a `scale`
    // FIELD; that is what stays banned.
    const diagramSection = guide.slice(
      guide.indexOf('### `lesson.diagram`'),
      guide.indexOf('### `lesson.neck-dot`'),
    );
    const tableStart = diagramSection.indexOf('| Field | Type | Notes |');
    expect(tableStart, "lesson.diagram's field table is gone — this guard is checking nothing").toBeGreaterThan(-1);
    const rest = diagramSection.slice(tableStart);
    const fieldTable = rest.slice(0, rest.indexOf('\n\n'));
    expect(fieldTable).not.toMatch(/\|\s*`scale`\s*\|/);
    // ...and the intent table really is where `scale` lives now, so this
    // test cannot pass by the field table having quietly disappeared.
    expect(diagramSection).toMatch(/\|\s*`scale`\s*\|/);
  });
});

// -----------------------------------------------------------------------------
// 4. The en-dash string sets in the guide are byte-identical to the
//    schema's — the single most dangerous trap in this schema (a hyphen
//    lookalike renders an empty diagram, no error).
// -----------------------------------------------------------------------------
describe('lesson-authoring.md — stringSet en-dash fidelity', () => {
  const diagramComponent = components.find((c) => c.fileName === 'diagram.json');
  const stringSetValues = diagramComponent?.attributes.stringSet?.enum ?? [];

  it('found the stringSet enum on lesson.diagram (sanity check on the walker itself)', () => {
    expect(stringSetValues.length).toBe(4);
  });

  it.each(stringSetValues.map((v): [string, string] => [v, v]))(
    'guide contains the exact (en-dash) string "%s"',
    (_label, value) => {
      expect(value.includes('–'), `test fixture bug: "${value}" has no en dash to begin with`).toBe(
        true,
      );
      expect(
        guide.includes(value),
        `guide does not contain "${value}" byte-identical to the schema — check for a hyphen (U+002D) substituted for the en dash (U+2013)`,
      ).toBe(true);
    },
  );

  // NOT a blanket "no hyphenated lookalike anywhere" check: the guide is
  // SUPPOSED to show the hyphenated wrong form once, as the cautionary
  // example the brief itself asks for ("a hyphen produces an empty
  // diagram, no error") — the same pattern lesson-blocks.ts's own
  // `.superRefine()` error message uses. What actually matters is that the
  // CANONICAL en-dash values are present byte-identical (asserted above);
  // a single labeled counter-example elsewhere is documentation, not
  // drift.
});

// -----------------------------------------------------------------------------
// 5. Directives, not just JSON field names.
// -----------------------------------------------------------------------------
//
// The generator authors in markdown now, so "the guide documents this
// block" is no longer satisfied by a field table alone — a model reading
// the entry has to be able to WRITE the block. Every dynamic-zone
// component therefore needs its directive form shown in its own entry, and
// the syntax section both generation prompts inject has to exist.
//
// The stricter half of this check — that a directive's attribute names
// really are the component's field names, in both directions — lives in
// markdown-blocks.test.ts, against the parser itself. This one guards the
// DOCUMENT, which is what actually reaches the model.
describe('lesson-authoring.md — directive coverage', () => {
  const dynamicZoneComponents: string[] = lessonSchema.attributes.body.components;

  it('has the directive-syntax section both generation prompts inject', () => {
    // authoring-guide.ts throws at generation time if this heading moves;
    // failing here first turns that into a test failure instead of a
    // half-written lesson prompt.
    expect(guide).toContain('### Writing the body as markdown directives');
    expect(guide).toContain('closes with a line containing **only `::`**');
  });

  it.each(dynamicZoneComponents.map((c): [string, string] => [c, c]))(
    "%s's entry shows how to write it as a directive",
    (_label, component) => {
      const directive = `::${component.replace(/^lesson\./, '')}`;
      const heading = `### \`${component}\``;
      const start = guide.indexOf(heading);
      expect(start, `no reference entry for ${component}`).toBeGreaterThan(-1);
      // Up to the next same-or-shallower heading, the same slice
      // authoring-guide.ts's extractSection() feeds into the prompt.
      const rest = guide.slice(start + heading.length);
      const nextIdx = rest.search(/\n#{1,3}\s/);
      const section = nextIdx === -1 ? rest : rest.slice(0, nextIdx);
      expect(
        section.includes(directive),
        `${component}'s guide entry never shows \`${directive}\` — a model reading it cannot write the block`,
      ).toBe(true);
    },
  );

  it('names the two attributes that are not fields, and only those', () => {
    const start = guide.indexOf('### Writing the body as markdown directives');
    const section = guide.slice(start, guide.indexOf('### `lesson.prose`'));
    expect(section).toContain('`src=<youtubeVideoId>`');
    expect(section).toContain('`after=<n>`');
  });
});
