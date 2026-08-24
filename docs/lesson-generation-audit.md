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

Two things stand out. The pipeline was **losing badly to Claude authoring over
MCP** — and splitting writing from illustrating closed most of that gap in one
change.

## Root causes

Ranked by how much they cost.

### 1. Structured JSON output is a capability ceiling

Six Anthropic structured-output restrictions, every one discovered by a live
400 rather than a test: `temperature` rejected, `minItems > 1`, `maxItems`,
integer bounds, `oneOf`, and objects needing explicit `additionalProperties`.

The sixth is the expensive one: **a request may carry at most 16 union-typed
parameters**, and every optional field is a union. To stay under it we cut
`param-picker`, `video-ref`, explicit `dots`/`marks`, `inversion`,
`fromFret`/`toFret`, and locked diagrams to theory mode.

Result: **the pipeline can emit 5 of 10 block types. Claude over MCP reaches
all 10.** That gap is caused by the output format, not the model.

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

### 5. The vocabulary is smaller than the widget set

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

1. **Markdown authoring, typed-block storage.** The model writes prose with
   inline component directives; a parser converts to the existing blocks. Every
   restriction in cause 1 disappears and all 10 block types become reachable.
   Validation moves to parse time, including the resolve check.
   *Briefed: `.superpowers/sdd/lesson-markdown/`.*
2. **Feed sections real source material.** Use the digest for the outline where
   structure is what matters; give section calls actual transcript passages via
   the existing BM25 index. Should fix specificity and citation coverage
   together — a section written from a real passage has something to cite.
   *Not yet briefed.*

### Tier 2 — changes the output shape

3. **Two-pass illustration.** Done, uncommitted — 12 diagrams where v1 managed
   zero.
4. **Remove the caps from code AND guide.** In flight. The guide half matters
   as much as the code half.
5. **Widen the vocabulary.** Missing block types, plus `diagram` exposing what
   `MiniNeck` actually does. *Briefed: `.superpowers/sdd/lesson-vocab/`.*

### Tier 3 — quality

6. **Recalibrate coverage.** Ask "can a useful lesson be built from these?"
   rather than "do these cover every aspect?". Better still: report what the
   sources *can* support and narrow the lesson, instead of refusing. In flight.
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
