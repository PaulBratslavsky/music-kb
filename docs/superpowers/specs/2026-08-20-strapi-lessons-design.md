# Design: lessons served from Strapi

**Status:** Approved. **Amended 2026-08-20 — see "Scope revision" below;
the Migration section is superseded.**
**Date:** 2026-08-20
**Scope:** Phase 1 only — move the 8 hardcoded lessons into a Strapi
collection rendered from a dynamic zone. AI lesson generation is phase 2 and
gets its own spec; this design only guarantees the seam it plugs into.

## Why

The 8 lessons are React routes — 3,585 lines across
`client/src/routes/lessons.*.tsx`. Editing one means a deploy. Adding one
means writing a component. Neither is viable for the goal behind this work:
*"generate an interesting lesson on a topic, using AI to read related videos."*
A model cannot write a React route, but it can emit structured blocks.

So lessons become data. The block vocabulary defined here is simultaneously
the authoring surface, the render contract, and — in phase 2 — the AI's
output schema. That triple duty is why it is deliberately small and
enum-heavy rather than expressive.

## What the lessons actually are

Not prose. Measured before designing:

| Lesson | `useState` | theory imports | Character |
|---|---|---|---|
| `caged-and-roman-numerals` | 0 | 0 | prose |
| `essential-chords` | 0 | 0 | prose |
| `find-any-chord` | 0 | 0 | prose |
| `music-theory-fundamentals` | 0 | 0 | prose |
| `power-chords` | 0 | 1 | prose + diagrams |
| `scale-systems-on-the-neck` | 0 | 6 | prose + diagrams |
| `triads` | 3 | 2 | interactive |
| `half-steps-to-chords` | 2 | 7 | interactive |

`half-steps-to-chords` alone renders 11 `MiniNeck`, 7 `MiniKeyboard`,
7 `Step` and 5 tables. Any design that treats lessons as rich text loses the
thing that makes them worth reading.

Two facts that make the migration tractable, both verified:

- **`MiniNeck.tsx` has zero imports** — pure props-in, SVG-out. It is a dumb
  renderer that takes explicit `NeckDot[]`.
- **`packages/music` theory modules are framework-free** (only
  `state/gameModeStorage.ts` touches `window`). Diagrams can be computed
  anywhere, including eventually inside Strapi's admin.

## Decisions

| # | Decision | Rejected alternative |
|---|---|---|
| 1 | All 8 lessons move; every widget becomes a block | Prose-only migration, leaving two systems forever |
| 2 | Interactive widgets are blocks holding *configuration*; the React component owns its state | A generic `custom-component` block with freeform props — untyped, and an LLM invents component names |
| 3 | Port all 8 by hand, archiving originals first | Port a representative subset; never validates the vocabulary |
| 4 | Plain JSON/enum fields now; visual custom field later | Build the chord picker up front, before the schema settles |
| 5 | SSR on demand via route loader | Prerender at build — fights "AI generates a lesson and it appears" |
| 6 | `Lesson ↔ Video` relation + per-block `source` from day one | Add later; costs a migration and leaves lessons unbackfillable |
| 7 | One lesson-level parameter; blocks opt in via `useParam` | A full `{{variable}}` template language inside a CMS |

## Content model

### `api::lesson.lesson`

| Field | Type | Notes |
|---|---|---|
| `title` | string, required | |
| `slug` | uid ← title, required | drives `/lessons/$slug` |
| `summary` | text | shown on the index |
| `level` | enum | `beginner` \| `intermediate` \| `advanced` |
| `instrument` | enum | `guitar` \| `piano` \| `push` \| `any` |
| `order` | integer | index ordering; the current index is hand-ordered |
| `parameter` | component, repeatable **max 1** | see below |
| `body` | **dynamic zone** | the lesson |
| `videos` | relation m:n → `api::video.video` | provenance |
| `status` | enum | `draft` \| `published` \| `ai-generated` |

`status` is deliberately not a boolean. AI output must land in a third state
that is neither "someone wrote this" nor "this is live."

### `lesson.parameter` (component, max 1 per lesson)

One reader-controlled variable for the whole lesson. Exists because
`half-steps-to-chords` picks a key at the top and every diagram and table
below recomputes from it — those 11 fretboards are one spec rendered in the
chosen key, not 11 authored diagrams.

| Field | Type | Notes |
|---|---|---|
| `name` | enum | `key` only in v1 |
| `label` | string | control label, e.g. "Key" |
| `default` | string | e.g. `C` |

Capped at one deliberately. Two parameters means resolving interactions
between them, and no current lesson needs it.

### Block vocabulary

Eleven components under `lesson.*`. Every block carries an optional
`source` component (`videoId`, `timeSec`) — empty for migrated lessons,
populated by phase 2.

| Block | Renders via | Fields |
|---|---|---|
| `prose` | markdown | `body` (rich text) — covers `p`, `ul`/`ol`, `h2`/`h3`. **Prefer few large blocks over many small ones** |
| `step` | `Step` | `number`, `title`, `lede`, `body` |
| `diagram` | `MiniNeck` | `instrument` enum (**guitar/bass only**); `mode` enum; params **or** dots; `useParam` |
| `keyboard-diagram` | `MiniKeyboard` | `mode` enum; params **or** marks; `useParam`; `octaves` |
| `degree-chips` | `DegreeChips` | `degrees[]`, `size` |
| `table` | table | `headers[]`, `rows[][]`, `useParam` |
| `callout` | — | `tone` enum, `body` |
| `interactive` | `GuitarView` / picker | `kind` enum, `config` JSON |
| `param-picker` | control | renders the lesson parameter |
| `video-ref` | player link | `videoId`, `timeSec`, `label` |
| `heading` | `h2`/`h3` | `text`, `level` — a *standalone* heading between blocks; headings **inside** a prose body stay in its markdown |

**Prose blocks are coarse, not one-per-paragraph.** A `prose` block holds
markdown, so one block can carry many paragraphs, lists and `##` headings.
`half-steps-to-chords` should be roughly 12-15 blocks — long prose runs
punctuated by diagrams — not 38. Fewer boundaries is less for a model to get
wrong, and it keeps each block a readable chunk. This also demotes the
standalone `heading` block to a rare case: headings normally live inside
prose markdown.

**Split by addressing scheme, not by instrument** (revised 2026-08-20 after
implementation surfaced the gap). `MiniNeck` is *position*-addressed
(`{string, fret}`); `MiniKeyboard` is *pitch-class*-addressed (`{pc}`). Guitar
and bass are the same shape with a different string count, so they share one
block with `instrument` as a field. Piano is a different shape and gets its
own block.

Keeping all three in one block would have made `stringSet`/`inversion`/
`fromFret`/`toFret` meaningless-but-valid whenever `instrument` was `piano` —
conditional knowledge, which is exactly what a model gets wrong, and the same
error as leaving `root` freeform. It also left `mode: "explicit"`
*unexpressible* for piano, since `dots` is `NeckDot[]` with no `pc`.

`push` is dropped entirely: no lesson uses `MiniPush`, so a third conversion
would be speculative. The component stays; it is simply not offered as a block
instrument until something needs it.

**One `diagram` block for guitar and bass.** Instrument is a field there. Fewer components,
and a model picks an enum value rather than choosing between three
near-identical block names.

**Every field that can be an enum, is one.** `stringSet` is the four named
sets from `STRING_SETS` (`e–B–G`, `B–G–D`, `G–D–A`, `D–A–E`), not a raw
`[0,1,2]` array. This is the single most important rule for phase 2: freeform
JSON is where a model goes wrong silently, whereas a closed enum under
Ollama's JSON mode makes an invalid value impossible to emit. It also asks
the model for something it is good at — *naming* a chord and string set —
rather than something it is bad at, which is computing fret positions.
`resolveDiagramDots` does the arithmetic.

**`diagram` has two modes.** `mode: 'theory'` stores
`{root, quality, stringSet, inversion}` and computes dots at render;
`mode: 'explicit'` stores `dots[]` directly. Theory mode is the default and
the only mode phase 2 emits. Explicit mode exists because some current
diagrams are hand-placed illustrations that will not reduce to a clean
theory query — and it is better to have the escape hatch than to distort a
lesson to fit the schema.

**Track how often `explicit` is used during migration.** If most diagrams
need it, decision 1 (parameters over raw data) was wrong and should be
revisited before phase 2 depends on it.

## Rendering

Nine routes collapse to two.

```
routes/lessons.index.tsx   loader → listLessonsService()        replaces LESSONS[]
routes/lessons.$slug.tsx   loader → getLessonBySlugWithStatus()
   └── <LessonBody blocks={lesson.body} parameter={lesson.parameter} />
          └── switch (block.__component) → widget
```

| Layer | File | Responsibility |
|---|---|---|
| Server fn | `data/server-functions/lessons.ts` | zod-validate slug |
| Service | `lib/services/lessons.ts` | Strapi I/O via `strapiFetch`; `*WithStatus` variants |
| Renderer | `components/lesson/LessonBody.tsx` | block → component, one `switch` |
| Adapter | `lib/lesson/diagram-params.ts` | theory params → `NeckDot[]` |

This mirrors the boundaries CLAUDE.md already mandates: zod on the server
function, business logic in the service, all Strapi I/O through
`strapiFetch`, and `*WithStatus` + `BackendErrorPanel` so "lesson not found"
and "Strapi is down" render differently.

### The adapter is the load-bearing new piece

`MiniNeck` wants explicit `NeckDot[]`; blocks store theory parameters.
`diagram-params.ts` is the single translation point, reusing `triadVoicing`,
`guitarVoicing`, `realizeCagedShape` and `getScalePitchClasses` from
`@music-kb/music`. It is pure, has no I/O, and is where a wrong diagram would
come from — so it gets real unit tests.

Parameter resolution lives here too: when a block sets `useParam: true`, its
root comes from the lesson parameter's current value rather than its own
`root` field.

### Failure behaviour

**Unknown block types render `null`, not a crash.** The `switch` logs and
returns nothing. An AI-generated lesson naming a block that does not exist
degrades to a gap rather than a white page — the same defensive posture
`chat-stream.ts` takes toward unknown SSE event types.

## Scope revision (2026-08-20, after Task 8)

The Migration section below assumed `client/src/routes/lessons.*.tsx` held the
only copies of the 8 hand-written lessons, and that serving them from Strapi
therefore meant translating all 3,456 lines into blocks.

That assumption was wrong. **`web/src/lessons/` already contains all 8**, with
its own complete widget set (`web/src/lessons/components/` — including
`LessonChordDiagram` and `NaturalNotesStrings`, which the client never had).
They were duplicated when the monorepo refactor folded `web/` in; line counts
differ only by the TanStack route wrapper.

The ruling, made by the repo owner:

- The **hand-written React format stays in `web/`** and continues to be
  authored there by hand. It is not a legacy format awaiting migration — it is
  one of two supported lesson formats, and the better one for the intricate,
  bespoke, heavily-interactive lessons that motivated it.
- **`client/`'s `/lessons` becomes Strapi-only.** It carries the
  `api::lesson.lesson` collection and nothing hardcoded. This is where
  AI-generated lessons land.
- The 8 client route copies are **deleted**, not translated.

Everything above this section — the block vocabulary, content model, and
rendering contract — stands unchanged. What changes is only what fills the
collection: phase-2 AI output rather than back-ported hand-written lessons.

**The cost of this, stated plainly:** the plan's migration was also its
validation. Translating 8 real lessons was how the block vocabulary was going
to be proven expressive enough before phase 2 depended on it.

That cost was not theoretical, and it came due immediately. Writing a *single*
real lesson (`server/seed-data/lessons/one-fret-one-half-step.json`) plus one
adversarial review of the branch surfaced seven contract defects that
`LessonBody`'s own unit tests did not catch, because those tests fed it
well-formed data:

- `caption` was declared on four block types and rendered by nothing, while
  the renderer read a `label` field those schemas never declared — content
  written by an author, accepted by Strapi, and silently dropped. The seeded
  lesson tripped this five times and nobody noticed while writing it.
- Three `json`-typed fields crashed the whole route (SSR 500, not a missing
  block) on plausible model output such as `degrees: [1,2,3]`.
- Three of the seven `quality` enum values could never render, so a model
  picking a legal value got a blank.
- `parameter.default` was a freeform string while the picker offered seven
  naturals; a default of `Eb` blanked every parameterised diagram in a lesson.

All are fixed. The lesson to carry into phase 2 is not "the vocabulary is now
proven" — one lesson is not proof — but that **the failure mode of this design
is silence.** Nothing threw. Typecheck was clean and every test passed through
all of it. Any future block type, or any change to an existing one, needs a
render check against real data, because neither the compiler nor the unit
tests can see this class of bug.

Two lesser consequences:

- `lesson.interactive` was removed from the dynamic zone entirely (2026-08-22).
  It was specified for the triads lesson's live chord builder, that migration
  was cancelled, and it shipped declared-but-unrendered. Once the `createLesson`
  MCP tool let a model author blocks, a schema-legal `interactive` block became
  an invisible hole with no error — so the declaration went rather than the
  renderer arriving. Re-add schema and renderer together or not at all.
- Three cross-links in `TheoryReference.tsx` pointed at deleted routes. Since
  the client has no URL for the deployed companion app, the links were reduced
  to plain text rather than rewritten — the prose still names the lesson, it
  just no longer navigates.

## Migration

> **Superseded by the Scope revision above.** Kept for the reasoning it
> records about block coverage, which informed the vocabulary.

### Step 0 — archive before touching anything

Copy all 8 route files to `docs/lessons-archive/` with a README explaining
why they are there.

**It must be outside `client/`.** `client/tsconfig.json` includes
`**/*.ts`/`**/*.tsx`, so an archive anywhere under `client/` would still be
typechecked and would fail once the components it imports are gone. Anything
left under `client/src/routes/` would additionally be picked up by the
file-based router as a live route.

Git history preserves these regardless; the folder's value is reading the
original side-by-side while authoring the replacement.

### Order — easiest to hardest

| # | Lesson | Proves |
|---|---|---|
| 1 | `find-any-chord` | prose + `Step` only — the basic vocabulary |
| 2 | `essential-chords`, `music-theory-fundamentals`, `caged-and-roman-numerals` | prose at volume |
| 3 | `power-chords` | first `diagram` block |
| 4 | `scale-systems-on-the-neck` | diagrams at volume |
| 5 | `triads` | first `interactive` block |
| 6 | `half-steps-to-chords` | parameter + every block type at once |

Per lesson: author in Strapi → render side-by-side against the archived
original → only then delete the route. One commit each, so a regression
bisects to a single lesson.

**Delete each route as its lesson lands.** Leaving `lessons.triads.tsx` in
place while a Strapi `triads` exists means the file router wins and the
Strapi version is never seen — a confusing failure that looks like the data
did not save.

### Definition of done

- All 8 lessons render from Strapi
- All 8 route files deleted; `routeTree.gen.ts` regenerated
- `/lessons` index lists from Strapi
- `diagram-params.ts` unit-tested
- A lesson case added to `seroval-safety.test.ts` — lesson bodies cross the
  server→client loader boundary, which is exactly the class of bug that file
  and `docs/ssr-client-fallback.md` exist for
- `yarn test` green, client typecheck clean, client build passes

## Phase 2 seam

Phase 2 (AI lesson generation) is a separate spec. Phase 1 must leave:

0. **The 8 migrated lessons as a few-shot corpus.** Hand-verified lesson JSON
   is precisely what phase 2 shows a model as "this is what good looks like."
   Migration is not only content preservation — it builds the examples the
   generator learns the house style from. Every field carries `.describe()`
   in the phase-2 zod schema; the model reads those as instructions.
1. **The block vocabulary as a zod schema** — passed to
   `chat({ outputSchema })` exactly as `music-extraction.ts` and
   `learning.ts` already do. This is why the vocabulary is small and
   enum-heavy: it is an LLM output contract, not just an authoring surface.
2. **`status: 'ai-generated'`** so output is reviewable, not live.
3. **`videos` relation + per-block `source`** so a claim traces to a moment.
4. **Unknown blocks rendering as gaps** — the safety net for invented names.

The pipeline is mostly existing machinery: semantic search over video
embeddings (`embeddings.ts`, as `/feed` does) → passage retrieval
(`chat-retrieval.ts`, as `/api/ask` does) → `chat({ outputSchema })` → zod
validate → save as draft.

**Timecodes in generated lessons must be BM25-grounded, never
model-emitted.** This is a standing invariant in this repo and lesson
generation is precisely where it would be tempting to skip.

## Risks

- **`half-steps-to-chords` may need blocks this vocabulary lacks.** It is
  last for that reason: by then the schema has been proven six times, so a
  gap is a real finding rather than a guess. It may warrant its own commit
  and its own review.
- **`explicit` diagram mode could dominate.** Tracked during migration; if it
  does, revisit decision 1 before phase 2 relies on theory params.
- **Authoring 10-block lessons by hand in Strapi admin is tedious** until the
  custom field exists. Accepted for v1 — decision 4 defers the picker until
  the schema has stopped moving.
- **Scope.** Porting all 8 by hand is the bulk of this work. If a shippable
  `/lessons` is wanted sooner, migration rows 1–5 deliver that (seven of the
  eight lessons) and `half-steps-to-chords` can land separately without
  changing any decision here.

## Out of scope

- AI lesson generation (phase 2, separate spec)
- The visual chord custom field and `packages/music-ui` (decision 4)
- Prerendering or publishing lessons to `web/` (decision 5)
- Any change to the full instrument system in `lib/music/instruments/`
