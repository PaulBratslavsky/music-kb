# Strapi Lessons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the 8 hardcoded lesson routes into a Strapi `api::lesson.lesson` collection rendered from a dynamic zone, so lessons are data rather than code.

**Architecture:** A Strapi collection holds lesson metadata plus a `body` dynamic zone of 10 block components. Two client routes (`/lessons` index, `/lessons/$slug` detail) load from Strapi through the existing server-function → service → `strapiFetch` boundary. A `LessonBody` renderer switches on `block.__component` and maps to the widgets already in `client/src/components/lesson/`. A pure adapter translates stored theory parameters into the explicit `NeckDot[]` that `MiniNeck` consumes.

**Tech Stack:** Strapi 5.52 (SQLite dev), TanStack Start 1.168 + Router 1.170, React 19, vitest, zod 4, `@music-kb/music` (framework-free theory layer).

**Spec:** `docs/superpowers/specs/2026-08-20-strapi-lessons-design.md`

## Global Constraints

- **All Strapi I/O goes through `strapiFetch`** (`client/src/lib/services/strapi-client.ts`). Never inline `fetch()` to Strapi.
- **Server functions validate with zod; services hold business logic.** Server functions live in `client/src/data/server-functions/`, services in `client/src/lib/services/`.
- **Route loaders use `*WithStatus` service helpers + `BackendErrorPanel`** so "not found" and "backend down" render differently.
- **`draftAndPublish: false`** on the content type — house style, matches every existing schema.
- **Timecodes are never model-emitted.** Not exercised in phase 1, but `video-ref` blocks must store a real `timeSec`.
- **Tests are vitest.** App tests in `client/src/`, theory tests in `packages/music/src/`. Run the root `yarn test` (463 tests) — `yarn --cwd client test` silently skips 199.
- **Install per package.** No workspaces; `yarn install:all` from root, or `yarn install` inside one package.
- **Run Strapi and the client from the repo root** with `yarn start` (or `yarn server` / `yarn client`).

---

### Task 1: Archive the 8 lesson routes

Preserves the originals for side-by-side reference during migration. Must land before any route is deleted.

**Files:**
- Create: `docs/lessons-archive/*.tsx` (8 copies)
- Create: `docs/lessons-archive/README.md`

**Interfaces:**
- Consumes: nothing
- Produces: reference copies only; no code imports these

- [ ] **Step 1: Copy the 8 route files**

```bash
cd /Users/paul/projects/music-kb
mkdir -p docs/lessons-archive
cp client/src/routes/lessons.*.tsx docs/lessons-archive/
ls docs/lessons-archive/
```

Expected: 9 files (8 lessons + `lessons.index.tsx`).

- [ ] **Step 2: Write the README explaining why they exist**

Create `docs/lessons-archive/README.md`:

```markdown
# Lesson archive

Verbatim copies of the 8 hardcoded lesson routes as they existed before the
migration to Strapi (`docs/superpowers/specs/2026-08-20-strapi-lessons-design.md`).

They are here to be read side-by-side while authoring the Strapi replacement —
git history preserves them too, but `git show` is a worse reading experience
than an open file.

**Do not import from this folder.** It sits outside `client/` deliberately:
`client/tsconfig.json` includes `**/*.tsx`, so an archive inside `client/`
would still be typechecked and would fail once the components these files
import are deleted. Anything left under `client/src/routes/` would also be
picked up by the file-based router and served as a live route.

Delete this folder once every lesson renders from Strapi and has been
verified against its original.
```

- [ ] **Step 3: Verify the archive is inert**

```bash
cd /Users/paul/projects/music-kb/client && npx tsc --noEmit
```

Expected: 0 errors — the archive is outside `client/`, so tsc never sees it.

- [ ] **Step 4: Commit**

```bash
cd /Users/paul/projects/music-kb
git add docs/lessons-archive
git commit -m "docs: archive the hardcoded lesson routes before migration"
```

---

### Task 2: Strapi block components

The 10 dynamic-zone components. Strapi needs these to exist before the content type can reference them.

**Files:**
- Create: `server/src/components/lesson/{prose,step,diagram,degree-chips,table,callout,interactive,param-picker,video-ref,heading}.json`
- Create: `server/src/components/lesson/{source,parameter,neck-dot}.json`

**Interfaces:**
- Consumes: nothing
- Produces: components `lesson.prose`, `lesson.step`, `lesson.diagram`, `lesson.degree-chips`, `lesson.table`, `lesson.callout`, `lesson.interactive`, `lesson.param-picker`, `lesson.video-ref`, `lesson.heading`, plus the shared `lesson.source`, `lesson.parameter`, `lesson.neck-dot`. Task 3 lists these in the dynamic zone; Task 7 renders them.

- [ ] **Step 1: Create the shared sub-components**

`server/src/components/lesson/source.json`:

```json
{
  "collectionName": "components_lesson_sources",
  "info": {
    "displayName": "Block source",
    "description": "Provenance for a block: which video and moment it came from. Empty for hand-migrated lessons; populated by AI generation in phase 2."
  },
  "options": {},
  "attributes": {
    "videoId": { "type": "string", "maxLength": 32 },
    "timeSec": { "type": "integer", "min": 0 }
  }
}
```

`server/src/components/lesson/parameter.json`:

```json
{
  "collectionName": "components_lesson_parameters",
  "info": {
    "displayName": "Lesson parameter",
    "description": "One reader-controlled variable for the whole lesson. Blocks opt in via useParam. Capped at one per lesson."
  },
  "options": {},
  "attributes": {
    "name": { "type": "enumeration", "enum": ["key"], "default": "key", "required": true },
    "label": { "type": "string", "default": "Key" },
    "default": { "type": "string", "default": "C" }
  }
}
```

`server/src/components/lesson/neck-dot.json`:

```json
{
  "collectionName": "components_lesson_neck_dots",
  "info": {
    "displayName": "Neck dot",
    "description": "One explicit dot on a fretboard/keyboard diagram. Mirrors NeckDot in client/src/components/lesson/MiniNeck.tsx."
  },
  "options": {},
  "attributes": {
    "string": { "type": "integer", "required": true, "min": 0 },
    "fret": { "type": "integer", "required": true, "min": 0 },
    "label": { "type": "string", "maxLength": 8 },
    "root": { "type": "boolean", "default": false },
    "muted": { "type": "boolean", "default": false }
  }
}
```

- [ ] **Step 2: Create the four simple text blocks**

`server/src/components/lesson/prose.json`:

```json
{
  "collectionName": "components_lesson_proses",
  "info": { "displayName": "Prose", "description": "Markdown body. Covers paragraphs, lists and inline headings." },
  "options": {},
  "attributes": {
    "body": { "type": "richtext", "required": true },
    "source": { "type": "component", "repeatable": false, "component": "lesson.source" }
  }
}
```

`server/src/components/lesson/heading.json`:

```json
{
  "collectionName": "components_lesson_headings",
  "info": { "displayName": "Heading", "description": "Standalone heading between blocks. Headings inside a prose body stay in its markdown." },
  "options": {},
  "attributes": {
    "text": { "type": "string", "required": true },
    "level": { "type": "enumeration", "enum": ["h2", "h3"], "default": "h2", "required": true }
  }
}
```

`server/src/components/lesson/callout.json`:

```json
{
  "collectionName": "components_lesson_callouts",
  "info": { "displayName": "Callout", "description": "Aside or warning." },
  "options": {},
  "attributes": {
    "tone": { "type": "enumeration", "enum": ["note", "tip", "warning"], "default": "note", "required": true },
    "body": { "type": "text", "required": true },
    "source": { "type": "component", "repeatable": false, "component": "lesson.source" }
  }
}
```

`server/src/components/lesson/step.json`:

```json
{
  "collectionName": "components_lesson_steps",
  "info": { "displayName": "Step", "description": "Numbered step. Maps to the Step component." },
  "options": {},
  "attributes": {
    "number": { "type": "integer", "required": true, "min": 1 },
    "title": { "type": "string", "required": true },
    "lede": { "type": "text" },
    "body": { "type": "richtext" },
    "source": { "type": "component", "repeatable": false, "component": "lesson.source" }
  }
}
```

- [ ] **Step 3: Create the diagram block (the important one)**

`server/src/components/lesson/diagram.json`:

```json
{
  "collectionName": "components_lesson_diagrams",
  "info": {
    "displayName": "Diagram",
    "description": "A fretboard, keyboard or Push grid. mode=theory stores musical parameters and computes dots at render; mode=explicit stores hand-placed dots. One block for all three instruments — instrument is a field. Every field that can be an enum is one: a closed set is impossible for an LLM to get wrong under JSON-mode decoding, where a freeform array is not."
  },
  "options": {},
  "attributes": {
    "instrument": { "type": "enumeration", "enum": ["guitar", "bass", "piano", "push"], "default": "guitar", "required": true },
    "mode": { "type": "enumeration", "enum": ["theory", "explicit"], "default": "theory", "required": true },
    "root": { "type": "string", "maxLength": 3 },
    "quality": { "type": "enumeration", "enum": ["major", "minor", "augmented", "diminished", "dominant7", "major7", "minor7"] },
    "stringSet": { "type": "enumeration", "enum": ["e–B–G", "B–G–D", "G–D–A", "D–A–E"] },
    "inversion": { "type": "integer", "min": 0, "max": 2 },
    "scale": { "type": "string", "maxLength": 32 },
    "useParam": { "type": "boolean", "default": false },
    "dots": { "type": "component", "repeatable": true, "component": "lesson.neck-dot" },
    "fromFret": { "type": "integer", "min": 0 },
    "toFret": { "type": "integer", "min": 0 },
    "caption": { "type": "string" },
    "source": { "type": "component", "repeatable": false, "component": "lesson.source" }
  }
}
```

- [ ] **Step 4: Create the remaining four blocks**

`server/src/components/lesson/degree-chips.json`:

```json
{
  "collectionName": "components_lesson_degree_chips",
  "info": { "displayName": "Degree chips", "description": "Scale-degree chips. Maps to DegreeChips." },
  "options": {},
  "attributes": {
    "degrees": { "type": "json", "required": true },
    "size": { "type": "enumeration", "enum": ["sm", "md"], "default": "md" }
  }
}
```

`server/src/components/lesson/table.json`:

```json
{
  "collectionName": "components_lesson_tables",
  "info": { "displayName": "Table", "description": "Headers plus rows. useParam recomputes cells from the lesson parameter." },
  "options": {},
  "attributes": {
    "headers": { "type": "json", "required": true },
    "rows": { "type": "json", "required": true },
    "useParam": { "type": "boolean", "default": false },
    "caption": { "type": "string" }
  }
}
```

`server/src/components/lesson/interactive.json`:

```json
{
  "collectionName": "components_lesson_interactives",
  "info": { "displayName": "Interactive", "description": "Configuration for a stateful widget. The React component owns its own state; this block only configures it." },
  "options": {},
  "attributes": {
    "kind": { "type": "enumeration", "enum": ["triad-explorer", "neck-pattern-picker", "guitar-view"], "required": true },
    "config": { "type": "json" },
    "caption": { "type": "string" }
  }
}
```

`server/src/components/lesson/param-picker.json`:

```json
{
  "collectionName": "components_lesson_param_pickers",
  "info": { "displayName": "Parameter picker", "description": "Renders the control for the lesson-level parameter." },
  "options": {},
  "attributes": {
    "label": { "type": "string" }
  }
}
```

`server/src/components/lesson/video-ref.json`:

```json
{
  "collectionName": "components_lesson_video_refs",
  "info": { "displayName": "Video reference", "description": "Link into a library video at a timecode." },
  "options": {},
  "attributes": {
    "videoId": { "type": "string", "required": true, "maxLength": 32 },
    "timeSec": { "type": "integer", "min": 0 },
    "label": { "type": "string" }
  }
}
```

- [ ] **Step 5: Verify Strapi accepts every component**

```bash
cd /Users/paul/projects/music-kb
lsof -ti :1350 | xargs kill -9 2>/dev/null
yarn server 2>&1 | tee /tmp/strapi-lesson.log | grep -iE "error|Registered|started successfully" | head -20
```

Expected: "Strapi started successfully", no schema errors. A malformed component fails the boot loudly.

- [ ] **Step 6: Commit**

```bash
git add server/src/components/lesson
git commit -m "feat(server): add lesson block components for the dynamic zone"
```

---

### Task 3: Lesson content type

**Files:**
- Create: `server/src/api/lesson/content-types/lesson/schema.json`
- Create: `server/src/api/lesson/controllers/lesson.ts`
- Create: `server/src/api/lesson/routes/lesson.ts`
- Create: `server/src/api/lesson/services/lesson.ts`
- Modify: `server/src/index.ts` (public permission actions array)

**Interfaces:**
- Consumes: components from Task 2
- Produces: REST endpoints `GET /api/lessons` and `GET /api/lessons/:documentId`; UID `api::lesson.lesson`

- [ ] **Step 1: Create the schema**

`server/src/api/lesson/content-types/lesson/schema.json`:

```json
{
  "kind": "collectionType",
  "collectionName": "lessons",
  "info": {
    "singularName": "lesson",
    "pluralName": "lessons",
    "displayName": "Lesson",
    "description": "A music lesson composed of blocks. Replaces the hardcoded routes under client/src/routes/lessons.*. See docs/superpowers/specs/2026-08-20-strapi-lessons-design.md."
  },
  "options": { "draftAndPublish": false },
  "pluginOptions": {},
  "attributes": {
    "title": { "type": "string", "required": true, "maxLength": 160 },
    "slug": { "type": "uid", "targetField": "title", "required": true },
    "summary": { "type": "text", "maxLength": 400 },
    "level": { "type": "enumeration", "enum": ["beginner", "intermediate", "advanced"], "default": "beginner" },
    "instrument": { "type": "enumeration", "enum": ["guitar", "piano", "push", "any"], "default": "any" },
    "order": { "type": "integer", "default": 0 },
    "status": { "type": "enumeration", "enum": ["draft", "published", "ai-generated"], "default": "draft", "required": true },
    "parameter": { "type": "component", "repeatable": false, "component": "lesson.parameter" },
    "videos": { "type": "relation", "relation": "manyToMany", "target": "api::video.video" },
    "body": {
      "type": "dynamiczone",
      "components": [
        "lesson.prose",
        "lesson.heading",
        "lesson.callout",
        "lesson.step",
        "lesson.diagram",
        "lesson.degree-chips",
        "lesson.table",
        "lesson.interactive",
        "lesson.param-picker",
        "lesson.video-ref"
      ]
    }
  }
}
```

- [ ] **Step 2: Create controller, routes and service**

`server/src/api/lesson/controllers/lesson.ts`:

```ts
import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::lesson.lesson');
```

`server/src/api/lesson/routes/lesson.ts`:

```ts
import { factories } from '@strapi/strapi';

export default factories.createCoreRouter('api::lesson.lesson');
```

`server/src/api/lesson/services/lesson.ts`:

```ts
import { factories } from '@strapi/strapi';

export default factories.createCoreService('api::lesson.lesson');
```

- [ ] **Step 3: Grant public read permissions**

In `server/src/index.ts`, find the `const actions = [` array and add these two entries alongside the existing `api::video.video.*` lines:

```ts
        'api::lesson.lesson.find',
        'api::lesson.lesson.findOne',
        'api::lesson.lesson.create',
        'api::lesson.lesson.update',
```

`create`/`update` are needed by the seed script in Task 9, which writes over
HTTP with no token — the same public-grant pattern
`server/scripts/seed-music-tags.mjs` already uses for tags. Consistent with
the existing grants for video, tag and note in this file.

- [ ] **Step 4: Boot and verify the endpoint**

```bash
cd /Users/paul/projects/music-kb
lsof -ti :1350 | xargs kill -9 2>/dev/null
yarn server > /tmp/strapi-lesson2.log 2>&1 &
until curl -sf --max-time 2 http://localhost:1350/_health -o /dev/null; do sleep 3; done
curl -s -o /dev/null -w "GET /api/lessons -> %{http_code}\n" http://localhost:1350/api/lessons
```

Expected: `200` (an empty `data: []`). A `403` means the permission step did not take — restart Strapi, since permissions are granted at bootstrap.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/lesson server/src/index.ts
git commit -m "feat(server): add the Lesson collection with a block dynamic zone"
```

---

### Task 4: Diagram parameter adapter

The pure translation layer: stored theory parameters → the explicit `NeckDot[]` that `MiniNeck` consumes. Built before any rendering, because a wrong diagram originates here.

**Files:**
- Create: `client/src/lib/lesson/diagram-params.ts`
- Test: `client/src/lib/lesson/diagram-params.test.ts`

**Interfaces:**
- Consumes: `@music-kb/music/theory/triad-shapes` (`triadVoicing`, `STRING_SETS`), `@music-kb/music/types` (`PitchClass`)
- Produces:
  - `type DiagramBlock = { instrument: string; mode: 'theory' | 'explicit'; root?: string; quality?: string; stringSet?: string; inversion?: number; useParam?: boolean; dots?: NeckDotInput[] }`
  - `resolveDiagramDots(block: DiagramBlock, paramValue?: string): NeckDot[]`
  Task 7's renderer calls `resolveDiagramDots`.

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/lesson/diagram-params.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveDiagramDots, type DiagramBlock } from './diagram-params';

describe('resolveDiagramDots', () => {
  it('returns explicit dots unchanged in explicit mode', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'explicit',
      dots: [{ string: 0, fret: 3, label: 'G', root: true }],
    };
    expect(resolveDiagramDots(block)).toEqual([
      { string: 0, fret: 3, label: 'G', root: true },
    ]);
  });

  it('computes dots from theory parameters in theory mode', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'theory',
      root: 'C',
      quality: 'major',
      stringSet: 'e–B–G',
      inversion: 0,
    };
    const dots = resolveDiagramDots(block);
    expect(dots.length).toBeGreaterThan(0);
    // A triad has exactly one root dot.
    expect(dots.filter((d) => d.root)).toHaveLength(1);
  });

  it('prefers the lesson parameter over the block root when useParam is set', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'theory',
      root: 'C',
      quality: 'major',
      stringSet: 'e–B–G',
      inversion: 0,
      useParam: true,
    };
    const inC = resolveDiagramDots(block, 'C');
    const inD = resolveDiagramDots(block, 'D');
    // Same shape, different position — the whole point of the parameter.
    expect(inD).not.toEqual(inC);
  });

  it('returns an empty array rather than throwing on an unresolvable shape', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'theory',
      root: 'C',
      quality: 'major',
      stringSet: 'not-a-real-set',
      inversion: 0,
    };
    expect(resolveDiagramDots(block)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/paul/projects/music-kb/client
yarn test src/lib/lesson/diagram-params.test.ts
```

Expected: FAIL — `Cannot find module './diagram-params'`.

- [ ] **Step 3: Implement the adapter**

Create `client/src/lib/lesson/diagram-params.ts`:

```ts
// Translates a stored `diagram` block into the explicit dots MiniNeck wants.
//
// Blocks store musical *parameters* (root/quality/string-set) rather than
// rendered dots, so a diagram stays correct if the theory layer changes and
// so phase-2 AI generation can emit something small and typed. MiniNeck is a
// dumb renderer that takes NeckDot[] — this module is the single place that
// bridges the two, which also makes it the single place a wrong diagram can
// come from. Hence the tests.

import {
  STRING_SETS,
  triadVoicing,
  type Inversion,
  type TriadQuality,
} from '@music-kb/music/theory/triad-shapes';
import type { PitchClass } from '@music-kb/music/types';

export type NeckDotInput = {
  string: number;
  fret: number;
  label?: string;
  root?: boolean;
  muted?: boolean;
};

export type DiagramBlock = {
  instrument: string;
  mode: 'theory' | 'explicit';
  root?: string | null;
  quality?: string | null;
  /** One of the STRING_SETS names, e.g. "e–B–G". */
  stringSet?: string | null;
  inversion?: number | null;
  useParam?: boolean | null;
  dots?: NeckDotInput[] | null;
};

const TRIAD_QUALITIES = new Set([
  'major',
  'minor',
  'augmented',
  'diminished',
]);

/**
 * Resolve a diagram block to dots.
 *
 * `paramValue` is the lesson-level parameter's current value; it wins over
 * the block's own `root` when the block sets `useParam`.
 *
 * Returns `[]` rather than throwing when a shape can't be realised — an
 * unrenderable diagram should leave a gap, not take down the lesson.
 */
export function resolveDiagramDots(
  block: DiagramBlock,
  paramValue?: string,
): NeckDotInput[] {
  if (block.mode === 'explicit') return block.dots ?? [];

  const root = (block.useParam && paramValue ? paramValue : block.root) as
    | PitchClass
    | undefined;
  if (!root || !block.quality) return [];
  if (!TRIAD_QUALITIES.has(block.quality)) return [];

  // stringSet arrives as one of the four names in STRING_SETS ("e–B–G",
  // "B–G–D", "G–D–A", "D–A–E") rather than a raw [0,1,2] array — a closed
  // enum an LLM cannot get wrong, and a name a guitarist already knows.
  const set = STRING_SETS.find((s) => s.name === block.stringSet);
  if (!set) return [];

  const voicing = triadVoicing(
    root,
    block.quality as TriadQuality,
    set,
    (block.inversion ?? 0) as Inversion,
  );
  if (!voicing) return [];

  return voicing.notes.map((n) => ({
    string: n.string,
    fret: n.fret,
    label: n.label,
    root: n.isRoot,
  }));
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/paul/projects/music-kb/client
yarn test src/lib/lesson/diagram-params.test.ts
```

Expected: PASS, 4 tests.

If the `STRING_SETS` shape or `triadVoicing`'s return fields differ from what is written above, read
`packages/music/src/theory/triad-shapes.ts` and adjust the mapping — the test assertions (one root dot, non-empty, param changes output) are the contract, not the field names.

- [ ] **Step 5: Commit**

```bash
cd /Users/paul/projects/music-kb
git add client/src/lib/lesson
git commit -m "feat(lessons): add the diagram parameter -> dots adapter"
```

---

### Task 5: Lesson service and server functions

**Files:**
- Create: `client/src/lib/services/lessons.ts`
- Create: `client/src/data/server-functions/lessons.ts`
- Test: `client/src/lib/services/lessons.test.ts`

**Interfaces:**
- Consumes: `strapiFetch` from `client/src/lib/services/strapi-client.ts`
- Produces:
  - `type LessonBlock = { __component: string; id: number; [k: string]: unknown }`
  - `type Lesson = { documentId: string; title: string; slug: string; summary: string | null; level: string; instrument: string; order: number; status: string; parameter: { name: string; label: string; default: string } | null; body: LessonBlock[] }`
  - `type LessonSummary = Omit<Lesson, 'body' | 'parameter'>`
  - `listLessonsService(): Promise<LessonSummary[]>`
  - `getLessonBySlugWithStatus(slug: string): Promise<{ ok: true; lesson: Lesson } | { ok: false; status: number; error: string }>`
  - Server fns `listLessons` and `getLessonBySlug`, consumed by Tasks 6 and 8.

- [ ] **Step 1: Write the failing test**

Create `client/src/lib/services/lessons.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./strapi-client', () => ({ strapiFetch: vi.fn() }));

import { strapiFetch } from './strapi-client';
import { getLessonBySlugWithStatus, listLessonsService } from './lessons';

const mocked = vi.mocked(strapiFetch);

beforeEach(() => mocked.mockReset());

describe('listLessonsService', () => {
  it('returns published lessons ordered by `order`', async () => {
    mocked.mockResolvedValue({
      ok: true,
      data: [
        { documentId: 'b', title: 'B', slug: 'b', order: 2 },
        { documentId: 'a', title: 'A', slug: 'a', order: 1 },
      ],
    } as never);
    const out = await listLessonsService();
    expect(out.map((l) => l.slug)).toEqual(['b', 'a']);
  });

  it('returns [] when the backend is unreachable', async () => {
    mocked.mockResolvedValue({ ok: false, status: 0, error: 'down' } as never);
    expect(await listLessonsService()).toEqual([]);
  });
});

describe('getLessonBySlugWithStatus', () => {
  it('distinguishes a missing lesson from a dead backend', async () => {
    mocked.mockResolvedValue({ ok: true, data: [] } as never);
    const missing = await getLessonBySlugWithStatus('nope');
    expect(missing).toMatchObject({ ok: false, status: 404 });

    mocked.mockResolvedValue({ ok: false, status: 0, error: 'down' } as never);
    const down = await getLessonBySlugWithStatus('nope');
    expect(down).toMatchObject({ ok: false, status: 0 });
  });

  it('returns the lesson when found', async () => {
    mocked.mockResolvedValue({
      ok: true,
      data: [{ documentId: 'x', title: 'T', slug: 't', body: [] }],
    } as never);
    const found = await getLessonBySlugWithStatus('t');
    expect(found).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/paul/projects/music-kb/client
yarn test src/lib/services/lessons.test.ts
```

Expected: FAIL — `Cannot find module './lessons'`.

- [ ] **Step 3: Implement the service**

Create `client/src/lib/services/lessons.ts`:

```ts
// Read-side service for Strapi-backed lessons.
//
// Dynamic zones are NOT populated by default in Strapi 5 — without an
// explicit populate the `body` array comes back empty, which looks exactly
// like an unauthored lesson. That is the single most likely bug in this
// file, so the populate is spelled out rather than relying on a default.

import { strapiFetch } from './strapi-client';

export type LessonBlock = {
  __component: string;
  id: number;
  [key: string]: unknown;
};

export type LessonParameter = {
  name: string;
  label: string;
  default: string;
};

export type Lesson = {
  documentId: string;
  title: string;
  slug: string;
  summary: string | null;
  level: string;
  instrument: string;
  order: number;
  status: string;
  parameter: LessonParameter | null;
  body: LessonBlock[];
};

export type LessonSummary = Omit<Lesson, 'body' | 'parameter'>;

export type LessonResult =
  | { ok: true; lesson: Lesson }
  | { ok: false; status: number; error: string };

/** Index listing. Never throws — an empty list renders an empty page. */
export async function listLessonsService(): Promise<LessonSummary[]> {
  const res = await strapiFetch<LessonSummary[]>('/api/lessons', {
    query: {
      sort: ['order:asc'],
      'pagination[pageSize]': 100,
      fields: ['title', 'slug', 'summary', 'level', 'instrument', 'order', 'status'],
    },
  });
  return res.ok ? (res.data ?? []) : [];
}

/**
 * Detail fetch that distinguishes "no such lesson" (404) from "Strapi is
 * unreachable" (status 0), so the route can render the right thing.
 */
export async function getLessonBySlugWithStatus(
  slug: string,
): Promise<LessonResult> {
  const res = await strapiFetch<Lesson[]>('/api/lessons', {
    query: {
      'filters[slug][$eq]': slug,
      'pagination[pageSize]': 1,
      populate: {
        parameter: true,
        body: { populate: '*' },
      },
    },
  });

  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error };
  }
  const lesson = (res.data ?? [])[0];
  if (!lesson) {
    return { ok: false, status: 404, error: `No lesson with slug "${slug}"` };
  }
  return { ok: true, lesson };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/paul/projects/music-kb/client
yarn test src/lib/services/lessons.test.ts
```

Expected: PASS, 4 tests. If `strapiFetch`'s options shape differs, read
`client/src/lib/services/strapi-client.ts` and match it — the query keys above assume it flattens a `query` object.

- [ ] **Step 5: Add the server functions**

Create `client/src/data/server-functions/lessons.ts`:

```ts
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  getLessonBySlugWithStatus,
  listLessonsService,
  type LessonResult,
  type LessonSummary,
} from '#/lib/services/lessons';

export const listLessons = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LessonSummary[]> => listLessonsService(),
);

export const getLessonBySlug = createServerFn({ method: 'GET' })
  .validator(z.object({ slug: z.string().min(1).max(120) }))
  .handler(async ({ data }): Promise<LessonResult> =>
    getLessonBySlugWithStatus(data.slug),
  );
```

- [ ] **Step 6: Typecheck and commit**

```bash
cd /Users/paul/projects/music-kb/client && npx tsc --noEmit
cd /Users/paul/projects/music-kb
git add client/src/lib/services/lessons.ts client/src/lib/services/lessons.test.ts client/src/data/server-functions/lessons.ts
git commit -m "feat(lessons): add the lesson read service and server functions"
```

Note: `.validator()` not `.inputValidator()` — the latter is deprecated in Start 1.168.

---

### Task 6: LessonBody renderer

**Files:**
- Create: `client/src/components/lesson/LessonBody.tsx`
- Test: `client/src/components/lesson/LessonBody.test.tsx`

**Interfaces:**
- Consumes: `LessonBlock`, `LessonParameter` (Task 5); `resolveDiagramDots` (Task 4); existing `Step`, `MiniNeck`, `MiniKeyboard`, `MiniPush`, `DegreeChips`
- Produces: `<LessonBody blocks={LessonBlock[]} parameter={LessonParameter | null} />`, used by Task 7

- [ ] **Step 1: Write the failing test**

Create `client/src/components/lesson/LessonBody.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LessonBody } from './LessonBody';
import type { LessonBlock } from '#/lib/services/lessons';

const block = (b: Partial<LessonBlock> & { __component: string }): LessonBlock =>
  ({ id: 1, ...b }) as LessonBlock;

describe('LessonBody', () => {
  it('renders a prose block', () => {
    render(
      <LessonBody
        blocks={[block({ __component: 'lesson.prose', body: 'hello world' })]}
        parameter={null}
      />,
    );
    expect(screen.getByText(/hello world/)).toBeTruthy();
  });

  it('renders a heading block at the requested level', () => {
    render(
      <LessonBody
        blocks={[block({ __component: 'lesson.heading', text: 'Part one', level: 'h2' })]}
        parameter={null}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Part one' })).toBeTruthy();
  });

  it('renders a video-ref block as a link into the player', () => {
    render(
      <LessonBody
        blocks={[
          block({
            __component: 'lesson.video-ref',
            videoId: 'abc123',
            timeSec: 90,
            label: 'See it played',
          }),
        ]}
        parameter={null}
      />,
    );
    const link = screen.getByRole('link', { name: 'See it played' });
    expect(link.getAttribute('href')).toBe('/learn/abc123?t=90');
  });

  it('renders nothing for an unknown block instead of throwing', () => {
    const { container } = render(
      <LessonBody
        blocks={[block({ __component: 'lesson.does-not-exist' })]}
        parameter={null}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders the blocks it knows even when an unknown one is present', () => {
    render(
      <LessonBody
        blocks={[
          block({ __component: 'lesson.does-not-exist' }),
          block({ __component: 'lesson.prose', body: 'still here' }),
        ]}
        parameter={null}
      />,
    );
    expect(screen.getByText(/still here/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /Users/paul/projects/music-kb/client
yarn test src/components/lesson/LessonBody.test.tsx
```

Expected: FAIL — `Cannot find module './LessonBody'`.

- [ ] **Step 3: Implement the renderer**

Create `client/src/components/lesson/LessonBody.tsx`:

```tsx
// Renders a lesson's dynamic-zone blocks.
//
// The `default` branch returns null on purpose. An AI-generated lesson (phase
// 2) can name a block that does not exist; degrading to a gap keeps the rest
// of the lesson readable, where throwing would blank the page. Same stance
// chat-stream.ts takes toward unknown SSE events.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Step } from './Step';
import { MiniNeck } from './MiniNeck';
import { MiniKeyboard } from './MiniKeyboard';
import { DegreeChips } from './DegreeChips';
import { resolveDiagramDots, type DiagramBlock } from '#/lib/lesson/diagram-params';
import type { LessonBlock, LessonParameter } from '#/lib/services/lessons';

const PITCH_OPTIONS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

export function LessonBody({
  blocks,
  parameter,
}: Readonly<{ blocks: LessonBlock[]; parameter: LessonParameter | null }>) {
  const [paramValue, setParamValue] = useState(parameter?.default ?? 'C');

  return (
    <div className="flex flex-col gap-6">
      {blocks.map((b) => (
        <Block
          key={`${b.__component}-${b.id}`}
          block={b}
          parameter={parameter}
          paramValue={paramValue}
          onParamChange={setParamValue}
        />
      ))}
    </div>
  );
}

function Block({
  block,
  parameter,
  paramValue,
  onParamChange,
}: Readonly<{
  block: LessonBlock;
  parameter: LessonParameter | null;
  paramValue: string;
  onParamChange: (v: string) => void;
}>) {
  switch (block.__component) {
    case 'lesson.prose':
      return (
        <div className="prose-lesson max-w-none text-sm text-[var(--ink-soft)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {String(block.body ?? '')}
          </ReactMarkdown>
        </div>
      );

    case 'lesson.heading': {
      const text = String(block.text ?? '');
      return block.level === 'h3' ? (
        <h3 className="text-base font-semibold text-[var(--ink)]">{text}</h3>
      ) : (
        <h2 className="text-lg font-semibold text-[var(--ink)]">{text}</h2>
      );
    }

    case 'lesson.callout':
      return (
        <aside className="rounded border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--ink-soft)]">
          {String(block.body ?? '')}
        </aside>
      );

    case 'lesson.step':
      return (
        <Step
          number={Number(block.number ?? 1)}
          title={String(block.title ?? '')}
          lede={String(block.lede ?? '')}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {String(block.body ?? '')}
          </ReactMarkdown>
        </Step>
      );

    case 'lesson.diagram': {
      const dots = resolveDiagramDots(block as unknown as DiagramBlock, paramValue);
      if (dots.length === 0) return null;
      if (block.instrument === 'piano') {
        return <MiniKeyboard dots={dots as never} />;
      }
      return (
        <MiniNeck
          instrument={block.instrument === 'bass' ? 'bass' : 'guitar'}
          dots={dots as never}
          fromFret={block.fromFret as number | undefined}
          toFret={block.toFret as number | undefined}
        />
      );
    }

    case 'lesson.degree-chips':
      return (
        <DegreeChips
          degrees={(block.degrees as string[]) ?? []}
          size={(block.size as 'sm' | 'md') ?? 'md'}
        />
      );

    case 'lesson.table': {
      const headers = (block.headers as string[]) ?? [];
      const rows = (block.rows as string[][]) ?? [];
      return (
        <table className="w-full text-sm">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className="text-left text-[var(--ink-muted)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="text-[var(--ink-soft)]">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case 'lesson.param-picker':
      if (!parameter) return null;
      return (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--ink-muted)]">
            {String(block.label ?? parameter.label)}
          </span>
          <select
            value={paramValue}
            onChange={(e) => onParamChange(e.target.value)}
            className="rounded border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-1"
          >
            {PITCH_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
      );

    case 'lesson.video-ref': {
      const videoId = String(block.videoId ?? '');
      if (!videoId) return null;
      const t = Number(block.timeSec ?? 0);
      return (
        <a
          href={`/learn/${videoId}${t > 0 ? `?t=${t}` : ''}`}
          className="text-sm text-[var(--ink)] underline"
        >
          {String(block.label ?? 'Watch this moment')}
        </a>
      );
    }

    // lesson.interactive lands in Task 9 Step 7, with the triad grid it
    // configures. Until then it falls through to the safe default.
    default:
      if (import.meta.env.DEV) {
        console.warn(`[LessonBody] unknown block: ${block.__component}`);
      }
      return null;
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /Users/paul/projects/music-kb/client
yarn test src/components/lesson/LessonBody.test.tsx
```

Expected: PASS, 4 tests. If `Step` or `DegreeChips` prop names differ, read those files and correct the call — their signatures are in `client/src/components/lesson/`.

- [ ] **Step 5: Commit**

```bash
cd /Users/paul/projects/music-kb
git add client/src/components/lesson/LessonBody.tsx client/src/components/lesson/LessonBody.test.tsx
git commit -m "feat(lessons): add the block renderer"
```

---

### Task 7: The `/lessons/$slug` route

**Files:**
- Create: `client/src/routes/lessons.$slug.tsx`
- Modify: `client/src/routeTree.gen.ts` (generated — do not hand-edit)

**Interfaces:**
- Consumes: `getLessonBySlug` (Task 5), `LessonBody` (Task 6), existing `BackendErrorPanel`
- Produces: the route `/lessons/$slug`

- [ ] **Step 1: Create the route**

Create `client/src/routes/lessons.$slug.tsx`:

```tsx
import { createFileRoute } from '@tanstack/react-router';
import { BackendErrorPanel } from '#/components/BackendErrorPanel';
import { LessonBody } from '#/components/lesson/LessonBody';
import { getLessonBySlug } from '#/data/server-functions/lessons';
import type { LessonResult } from '#/lib/services/lessons';

export const Route = createFileRoute('/lessons/$slug')({
  component: LessonPage,
  loader: async ({ params }): Promise<LessonResult> =>
    getLessonBySlug({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.ok
          ? `${loaderData.lesson.title} · Music KB`
          : 'Lesson · Music KB',
      },
    ],
  }),
});

function LessonPage() {
  const data = Route.useLoaderData();

  // status 0 means the network never answered — Strapi is down, which is a
  // different problem from a slug that does not exist.
  if (!data.ok) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
        {data.status === 404 ? (
          <p className="text-sm text-[var(--ink-soft)]">
            No lesson found at this address.
          </p>
        ) : (
          <BackendErrorPanel message={data.error} />
        )}
      </main>
    );
  }

  const { lesson } = data;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · {lesson.level}
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          {lesson.title}
        </h1>
        {lesson.summary ? (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">{lesson.summary}</p>
        ) : null}
      </header>
      <LessonBody blocks={lesson.body} parameter={lesson.parameter} />
    </main>
  );
}
```

- [ ] **Step 2: Author one lesson in Strapi to test against**

```bash
cd /Users/paul/projects/music-kb && yarn start
```

In the admin at `http://localhost:1350/admin` → Content Manager → Lesson → Create:
`title` "Smoke test", `slug` `smoke-test`, `status` `published`, and one `prose` block with body `Hello from Strapi`. Save.

- [ ] **Step 3: Verify it renders**

Visit `http://localhost:3015/lessons/smoke-test`.

Expected: the title and "Hello from Strapi".

**If the body is empty but the title renders**, the dynamic-zone populate is not taking effect — check the `populate` in `getLessonBySlugWithStatus`. This is the failure this design predicted, and it looks exactly like an unauthored lesson.

- [ ] **Step 4: Verify both error paths**

```bash
# 404 path
curl -s -o /dev/null -w "missing slug -> %{http_code}\n" http://localhost:3015/lessons/definitely-not-a-lesson
# backend-down path
lsof -ti :1350 | xargs kill -9
```

Reload `/lessons/smoke-test`: expected the `BackendErrorPanel`, **not** "No lesson found". Then restart Strapi with `yarn server`.

- [ ] **Step 5: Commit**

```bash
cd /Users/paul/projects/music-kb
git add client/src/routes/lessons.\$slug.tsx client/src/routeTree.gen.ts
git commit -m "feat(lessons): add the /lessons/\$slug route backed by Strapi"
```

---

### Task 8: Convert the index to Strapi

**Files:**
- Modify: `client/src/routes/lessons.index.tsx` (replace the `LESSONS[]` constant)

**Interfaces:**
- Consumes: `listLessons` (Task 5)
- Produces: an index driven by Strapi

- [ ] **Step 1: Replace the hardcoded array with a loader**

In `client/src/routes/lessons.index.tsx`, delete the `LessonEntry` type and the `LESSONS: LessonEntry[]` constant, then add to the route definition:

```tsx
import { listLessons } from '#/data/server-functions/lessons';
import type { LessonSummary } from '#/lib/services/lessons';

export const Route = createFileRoute('/lessons/')({
  component: LessonsIndex,
  loader: async (): Promise<LessonSummary[]> => listLessons(),
  head: () => ({ meta: [{ title: 'Lessons · Music KB' }] }),
});
```

In the component, replace `LESSONS.map(...)` with:

```tsx
const lessons = Route.useLoaderData();
```

and map over `lessons`, linking with `to="/lessons/$slug"` and `params={{ slug: l.slug }}`.

- [ ] **Step 2: Verify**

Visit `http://localhost:3015/lessons`.

Expected: "Smoke test" listed, linking to the working detail page. The 8 original lessons will **not** appear until migrated — that is correct at this point.

- [ ] **Step 3: Run the full suite and typecheck**

```bash
cd /Users/paul/projects/music-kb
yarn test
cd client && npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
cd /Users/paul/projects/music-kb
git add client/src/routes/lessons.index.tsx
git commit -m "feat(lessons): drive the index from Strapi"
```

---

### Task 9: Seed the lessons

The 8 lessons become **version-controlled data plus a seed script**, not
hand-clicking in the admin. Each lesson is a JSON file translated from its
archived route; the script upserts them by slug so it is safe to re-run.

This is better than admin authoring in three ways that matter here: the
content is reviewable in a diff, re-seeding after a schema change is one
command, and phase 2 (AI generation) emits exactly this JSON shape — so these
eight files become the **few-shot corpus** the generator learns the house
style from. Migration is not only content preservation; it is building phase
2's examples. Author them as if a model will imitate them, because one will.

**Files:**
- Create: `server/seed-data/lessons/<slug>.json` (8 files)
- Create: `server/scripts/seed-lessons.mjs`
- Modify: `server/package.json` + root `package.json` (a `lessons:seed` script)
- Delete (one per lesson, after verifying): `client/src/routes/lessons.<name>.tsx`

**Interfaces:**
- Consumes: the REST API from Task 3; the block vocabulary from Task 2
- Produces: 8 lessons in Strapi; `yarn lessons:seed` re-runnable at any time

- [ ] **Step 1: Write the seed script**

Create `server/scripts/seed-lessons.mjs`:

```js
#!/usr/bin/env node
// Seeds lessons from server/seed-data/lessons/*.json.
//
// Idempotent: upserts by `slug`, so re-running after editing a lesson JSON
// updates in place rather than creating duplicates. Same identity-by-natural-
// key stance digests take with videoSetKey.
//
// Run against a LIVE Strapi (yarn server / yarn start). Uses the public-role
// create/update grants from server/src/index.ts, so no token is needed.
//
// Usage: node server/scripts/seed-lessons.mjs

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STRAPI = process.env.STRAPI_URL || 'http://localhost:1350';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed-data', 'lessons');

async function findBySlug(slug) {
  const url = `${STRAPI}/api/lessons?filters[slug][$eq]=${encodeURIComponent(slug)}&pagination[pageSize]=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lookup ${slug}: ${res.status}`);
  const body = await res.json();
  return body.data?.[0] ?? null;
}

async function upsert(lesson) {
  const existing = await findBySlug(lesson.slug);
  const target = existing
    ? `${STRAPI}/api/lessons/${existing.documentId}`
    : `${STRAPI}/api/lessons`;
  const res = await fetch(target, {
    method: existing ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: lesson }),
  });
  if (!res.ok) {
    throw new Error(`${existing ? 'update' : 'create'} ${lesson.slug}: ${res.status} ${await res.text()}`);
  }
  return existing ? 'updated' : 'created';
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.log('No lesson JSON files yet — nothing to seed.');
  process.exit(0);
}

let created = 0;
let updated = 0;
for (const file of files) {
  const lesson = JSON.parse(await readFile(join(DIR, file), 'utf8'));
  const action = await upsert(lesson);
  action === 'created' ? created++ : updated++;
  console.log(`  ${action}: ${lesson.slug}`);
}
console.log(`\nSeeded ${files.length} lesson(s) — ${created} created, ${updated} updated.`);
```

- [ ] **Step 2: Add the npm scripts**

In `server/package.json` scripts, add:

```json
    "lessons:seed": "node scripts/seed-lessons.mjs",
```

In the root `package.json` scripts, add:

```json
    "lessons:seed": "yarn --cwd ./server lessons:seed",
```

- [ ] **Step 3: Prove the script works before writing eight lessons**

Create `server/seed-data/lessons/smoke-test.json`:

```json
{
  "title": "Smoke test",
  "slug": "smoke-test",
  "summary": "Temporary. Deleted once the first real lesson lands.",
  "level": "beginner",
  "instrument": "any",
  "order": 999,
  "status": "published",
  "body": [
    { "__component": "lesson.heading", "text": "It works", "level": "h2" },
    { "__component": "lesson.prose", "body": "Seeded from JSON." }
  ]
}
```

Then, with Strapi running:

```bash
yarn lessons:seed
```

Expected: `created: smoke-test`. Run it a second time — expected `updated: smoke-test`, and still exactly one lesson at `/lessons`. That second run is the real test; a non-idempotent script silently duplicates.

Visit `http://localhost:3015/lessons/smoke-test` to confirm the blocks render.

- [ ] **Step 4: Commit the machinery**

```bash
git add server/scripts/seed-lessons.mjs server/seed-data/lessons server/package.json package.json
git commit -m "feat(lessons): add an idempotent lesson seed script"
```

**Per-lesson procedure — repeat for each of the 8:**

1. Open `docs/lessons-archive/lessons.<name>.tsx`.
2. Translate it top-to-bottom into `server/seed-data/lessons/<slug>.json`. Use the **same slug as the old route** so existing links keep working.
   - `<p>` / `<ul>` / `<h2>` / `<h3>` → `lesson.prose` (markdown). **Merge
     consecutive prose into one block.** A lesson should be ~12-15 coarse
     blocks — long prose runs punctuated by diagrams — not one block per
     paragraph. Fewer boundaries is less for phase 2's model to get wrong,
     and each block stays readable on its own.
   - `<h2>` / `<h3>` between blocks → `lesson.heading`
   - `<Step>` → `lesson.step`
   - `<MiniNeck>` / `<MiniKeyboard>` → `lesson.diagram`, `mode: "theory"` where the shape reduces to root + quality + string-set, `mode: "explicit"` otherwise
   - `<table>` → `lesson.table`
   - `<DegreeChips>` → `lesson.degree-chips`
3. `yarn lessons:seed`
4. Open `/lessons/<slug>` beside the archived original and compare section by section.
5. Only once it matches: `git rm client/src/routes/lessons.<name>.tsx` and commit the JSON, the deletion and the regenerated `routeTree.gen.ts` together.

**Order — easiest to hardest**, so the vocabulary is stress-tested progressively:

- [ ] **Step 5: `find-any-chord`** — prose + `Step` only. Proves the basic vocabulary end-to-end through the seed.

```bash
yarn lessons:seed
git rm client/src/routes/lessons.find-any-chord.tsx
git add server/seed-data/lessons/find-any-chord.json client/src/routeTree.gen.ts
git commit -m "feat(lessons): migrate find-any-chord to Strapi"
```

- [ ] **Step 6: `essential-chords`** — prose at volume. Same commit shape.
- [ ] **Step 7: `music-theory-fundamentals`** — prose at volume. Same commit shape.
- [ ] **Step 8: `caged-and-roman-numerals`** — prose at volume. Same commit shape.

- [ ] **Step 9: `power-chords`** — the first `diagram` blocks. Record how many needed `mode: "explicit"`.

- [ ] **Step 10: `scale-systems-on-the-neck`** — diagrams at volume (6 theory imports). If `resolveDiagramDots` cannot express a scale-position diagram, extend it **with a test** rather than falling back to `explicit`.

- [ ] **Step 11: `triads`** — the first `interactive` block. Add a `case 'lesson.interactive'` to `LessonBody`'s switch rendering the triad grid from `block.config`, plus a `LessonBody` test asserting it renders.

- [ ] **Step 12: `half-steps-to-chords`** — the hardest: 11 necks, 7 keyboards, 5 tables, and the lesson-level key parameter. Set `parameter` to `{"name":"key","label":"Key","default":"C"}`, put a `lesson.param-picker` block near the top, and set `"useParam": true` on every diagram and table that recomputed from `keyIdx` in the original.

**If a needed block type does not exist, that is a real finding** — add the component, the `LessonBody` case and a test, rather than distorting the lesson to fit the schema.

- [ ] **Step 13: Remove the smoke test and verify**

```bash
git rm server/seed-data/lessons/smoke-test.json
yarn lessons:seed
ls client/src/routes/lessons.*.tsx
```

Delete the smoke-test lesson row in the admin (the seed does not remove rows whose JSON is gone). Expected from `ls`: only `lessons.index.tsx` and `lessons.$slug.tsx`.

```bash
git add -A && git commit -m "chore(lessons): drop the seed smoke test"
```

---

### Task 10: Boundary test and final verification

**Files:**
- Modify: `client/src/lib/services/seroval-safety.test.ts`

**Interfaces:**
- Consumes: `Lesson` (Task 5)
- Produces: regression cover for the loader boundary

- [ ] **Step 1: Add the failing-if-broken boundary test**

Append to `client/src/lib/services/seroval-safety.test.ts`, inside the existing `describe`:

```ts
  it('a lesson body survives the server→client boundary', () => {
    // Lesson bodies cross the loader boundary as plain JSON from Strapi.
    // Block keys come from component names, so a block named e.g.
    // "constructor" is the reserved-name case this file exists for.
    const lesson = {
      documentId: 'abc',
      title: 'T',
      slug: 't',
      summary: null,
      level: 'beginner',
      instrument: 'guitar',
      order: 0,
      status: 'published',
      parameter: { name: 'key', label: 'Key', default: 'C' },
      body: [
        { __component: 'lesson.prose', id: 1, body: 'hi' },
        {
          __component: 'lesson.diagram',
          id: 2,
          instrument: 'guitar',
          mode: 'theory',
          root: 'C',
          quality: 'major',
          stringSet: 'e–B–G',
        },
      ],
    };
    expectSerovalSafe(lesson, 'lesson with blocks');
  });
```

- [ ] **Step 2: Run it**

```bash
cd /Users/paul/projects/music-kb/client
yarn test src/lib/services/seroval-safety.test.ts
```

Expected: PASS.

- [ ] **Step 3: Full verification**

```bash
cd /Users/paul/projects/music-kb
yarn test                              # expect 463+ passing
cd client && npx tsc --noEmit          # expect 0 errors
cd ../server && npx tsc --noEmit       # expect 0 errors
cd .. && yarn --cwd client build       # expect success
yarn --cwd web build                   # expect success
```

- [ ] **Step 4: End-to-end check with the stack up**

```bash
yarn start
```

Visit `/lessons` — all 8 migrated lessons listed. Open each; compare against `docs/lessons-archive/`. Confirm `half-steps-to-chords`'s key picker still recomputes the diagrams below it.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/services/seroval-safety.test.ts
git commit -m "test(lessons): cover the lesson loader boundary"
```

- [ ] **Step 6: Remove the archive once every lesson is verified**

```bash
git rm -r docs/lessons-archive
git commit -m "docs: remove the lesson archive now that all 8 render from Strapi"
```

Only after step 4 passes for all 8. Git history still holds them.

---

## Done when

- All 8 lessons render from Strapi; `client/src/routes/lessons.*.tsx` contains only `index` and `$slug`
- `/lessons` lists from Strapi, ordered by `order`
- `diagram-params.ts`, `lessons.ts`, `LessonBody.tsx` are unit-tested
- The seroval boundary covers a lesson body
- `yarn test` green, both typechecks clean, client and web build
- The count of `mode: explicit` diagrams is recorded — if it dominates, decision 1 in the spec needs revisiting before phase 2
