# Lesson generation: audit and plan

**2026-08-24.** Written after a week of building it and a day of watching it
fail in ways tests could not see.

## Where it stands

Every real lesson in the KB, oldest pipeline to newest:

| lesson | blocks | visual | cited | types | author |
|---|---|---|---|---|---|
| from-triads-to-theory | 23 | 0 | 9 | 5 | pipeline, v1 |
| whole-steps-and-half-steps | 24 | 2 | 14 | 6 | pipeline, + diagrams |
| how-to-write-a-melody-that-sticks | 54 | 10 | 20 | 9 | **Claude via MCP** |
| pentatonic-shapes-mapping-the-whole-fretboard | 57 | 16 | 44 | 7 | pipeline, two-pass |
| how-chords-come-from-scales | 70 | 22 | 43 | 10 | pipeline, + passages |
| …-building-triads-by-stacking-thirds | 82 | 21 | 43 | 10 | pipeline, **markdown** |

Two things stand out. The pipeline was **losing badly to Claude authoring over
MCP** — and splitting writing from illustrating closed most of that gap in one
change.

Since then the pipeline has passed the MCP lesson on every column, and cause
1 below is fixed rather than worked around.

## Root causes

Ranked by how much they cost.

### 1. Structured JSON output is a capability ceiling — **fixed**

Six Anthropic structured-output restrictions, every one discovered by a live
400 rather than a test: `temperature` rejected, `minItems > 1`, `maxItems`,
integer bounds, `oneOf`, and objects needing explicit `additionalProperties`.

The sixth is the expensive one: **a request may carry at most 16 union-typed
parameters**, and every optional field is a union. To stay under it we cut
`param-picker`, `video-ref`, explicit `dots`/`marks`, `inversion`,
`fromFret`/`toFret`, and locked diagrams to theory mode.

Result: **the pipeline can emit 5 of 10 block types. Claude over MCP reaches
all 10.** That gap is caused by the output format, not the model.

**Fixed 2026-08-25** by making markdown the authoring format (Tier 1 item 1
below). Both generation passes now answer in markdown with inline component
directives and a parser converts to the same typed blocks; the only
structured-output calls left are the coverage verdict and the outline, two
small fixed records with no vocabulary problem. Measured on three live
frontier runs:

- `lesson.chord-diagram` (7, then 9), `lesson.neck-pattern` (4) and
  `lesson.natural-notes` (1) appeared in generated lessons for the first
  time — three block types that had a schema, a renderer and no way to be
  reached.
- Explicit-mode dots, the four dot styles, inversions, fret windows and
  barres came back with them.
- Same-topic comparison against the pre-change pipeline: 70 → 82 blocks, 22
  → 21 visual, 43 → 43 cited, 10 → 10 types. Roughly a wash on the counting
  metrics and a clear win on what is *in* them — a chord lesson now shows
  chord boxes.

What it cost: the schema's guarantees have to be earned at parse time
instead. Three of the four things the first live runs got wrong were
recoverable rather than fatal (an unclosed directive mid-answer, a
`barreFret=0` at the nut, an over-long caption), and the fourth — bare
markdown paragraphs carrying no citation — was a prompt default, not a
format limit. All four are handled; see `client/src/lib/lesson/
markdown-blocks.ts` and its tests.

### 2. The digest compresses away what sections need

Sections were written from digest themes rather than source material. A digest
exists to compress five videos into a readable synthesis; sections need the
specifics compression discards. Symptom: prose that says "understand the
pattern" instead of "fret 5 on the low E is A".

### 3. Templating — mine, not the model's

Fixed section counts, blocks-per-section caps, one-diagram-per-section,
four-per-lesson. All constants I invented from a guess at good taste. Every
lesson came out the same shape because the shape was decided before the model
saw any content.

Worse: the caps were also written into `docs/lesson-authoring.md`, so they
constrained **Claude authoring over MCP too**. It declined to add a diagram it
judged would help, citing the guide's cap.

### 4. The coverage check was calibrated against a misdiagnosis

I saw one bad lesson ("barre chords" producing content about triads), concluded
the library lacked barre-chord material, and built a coverage check tuned hard
to refuse — "partial or tangential coverage is NOT coverage".

The diagnosis was wrong. The library does cover barre chords; that run was a
generation fluke. The over-tuned guard shipped anyway and now refuses valid
topics: five videos scoring 0.70–0.77 on "what I need to know as a beginner
guitar student" were rejected as insufficient.

### 5. The vocabulary is smaller than the widget set — **fixed**

Four widgets the hand-written `web/` lessons use have no block at all:
`LessonChordDiagram`, `NaturalNotesStrings`, `NeckPatternPicker`, `MiniPush`
(Push explicitly ruled out). And `lesson.diagram` exposes roughly a third of
what `MiniNeck` can draw — no `hollow`/`ringed`/`light` dot styles, so one
diagram cannot show scale tones and chord tones together.

### 6. Declared but never rendered — four times

`caption`, `lesson.interactive`, `source`, `Lesson.instrument`. Each declared in
the schema, each written by something, each drawn by nothing, each silent. No
error, no failing test. `source` was the worst: timestamps BM25-grounded
against real transcripts specifically so they could not be wrong, then dropped
at render.

## Plan

### Tier 1 — raises the ceiling

1. **Markdown authoring, typed-block storage.** Done (2026-08-25). The model
   writes prose with inline component directives; a parser converts to the
   existing blocks. Every restriction in cause 1 disappears and all 13 block
   types are reachable. Validation moved to parse time, resolve check
   included — it now runs the renderer's own `resolveDiagramDots` /
   `resolveDiagramMarks` on every parsed diagram.

   Still open from that brief: **the MCP write tools still take JSON**, not
   markdown. Sharing one parser needs a package `client/` and `server/` can
   both depend on, and they share nothing today — that is an ADR-level
   decision, not a side effect of this change.
   *Briefed: `.superpowers/sdd/lesson-markdown/`.*
2. **Feed sections real source material.** Use the digest for the outline where
   structure is what matters; give section calls actual transcript passages via
   the existing BM25 index. Should fix specificity and citation coverage
   together — a section written from a real passage has something to cite.
   *Not yet briefed.*

### Tier 2 — changes the output shape

3. **Two-pass illustration.** Done (`cdfbb0a`). Two live lessons, same day:
   shape-oriented 57 blocks / 12 diagrams (per-section 1,2,1,6,2), conceptual
   67 blocks / 23 diagrams (3,1,7,10,2). The per-section counts track content —
   7 diagrams for the 7 diatonic triads, 6 for the 5 pentatonic boxes — which is
   what the caps were preventing. Prose fell to 21% of the shape-oriented
   lesson. Note the conceptual lesson drew MORE diagrams than the shape one,
   inverting the naive expectation and correct on inspection.
4. **Remove the caps from code AND guide.** Done, same commit.
5. **Widen the vocabulary.** Missing block types, plus `diagram` exposing what
   `MiniNeck` actually does. *Briefed: `.superpowers/sdd/lesson-vocab/`.*

### Tier 3 — quality

6. **Recalibrate coverage.** Done, same commit, with regression tests. Still
   open: report what the sources *can* support and narrow the lesson, rather
   than refusing outright.
7. **Kill the title formula.** Every pipeline lesson is "From X to Y: Mastering
   Z". Guide work.
8. **Callouts must carry a checkable fact**, not encouragement. Guide work.

### Tier 4 — stop the silent-failure class

9. **A render-reachability test.** For every field in every lesson component,
   assert something reads it. Four fields reached production unread; a derived
   test makes a fifth impossible.
10. **A live smoke generation**, run manually before merging generation
    changes. Six restrictions and four unrendered fields were all found by
    running the thing, never by the suite. Mocked tests cannot see this class.

## The through-line

Every individual piece worked. The generator worked, the schema worked, the
renderer worked, the tests passed. What failed was the connections between
them, and nothing complains when a connection is missing.

That is worth remembering beyond this feature: **the failure mode of this kind
of work is silence.**
