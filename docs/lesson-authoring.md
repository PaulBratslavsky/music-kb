# Lesson authoring guide

This is the single source of truth for writing a `api::lesson.lesson`
record: what every block accepts, and what makes the result worth reading.
It exists because this branch built lesson generation twice — an in-app
staged pipeline (`client/src/lib/services/lesson-generation.ts`) and an
MCP write path (`createLesson`/`updateLesson`, so Claude Desktop or Claude
Code can author lessons directly) — and a fact that lives in only one of
them rots. Both authoring paths load excerpts of this file into their
prompts; the MCP path also exposes it whole via the `getLessonAuthoringGuide`
read tool, for a client (Claude Desktop) with no filesystem access to this
repo.

Two halves, deliberately different in kind:

- **Half A** is facts — every field, every enum, every constraint. Derived
  by reading the schema, not from memory. If this half and the schema ever
  disagree, the schema wins and this file is wrong.
- **Half B** is judgment — what makes a generated lesson worth reading
  instead of generic filler a model already knew. It is not derivable from
  any schema, and it is the part that took four real generation runs to
  learn.

If you are the model generating a lesson: read Half A for what a block
*accepts*, Half B for what makes it *good*. A block that validates and
teaches nothing has still failed.

---

## Half A — block reference

The lesson record has fields outside the body (title, level, status, …)
and a `body` dynamic zone of ten typed blocks. Every block's
`__component` value is the literal string in its heading below, e.g.
`lesson.prose`. `lesson.interactive` is **not** one of the ten — it used
to exist, had no renderer, and was deleted from the schema. Never emit it.

### Lesson record fields (outside the body)

| Field | Type | Constraint |
|---|---|---|
| `title` | string, required | max 160 chars |
| `slug` | uid (derived from `title`) | required; MCP callers pass an optional explicit one — see "Slugs are never overwritten" below |
| `summary` | text | max 400 chars |
| `level` | enum, default `beginner` | `beginner`, `intermediate`, `advanced` |
| `instrument` | enum, default `any` | `guitar`, `piano`, `push`, `any` — **do not confuse with `lesson.diagram.instrument`**, a different enum on a different object (see "instrument means two different things" below) |
| `order` | integer, default `0` | sort position, lower shows first |
| `duration` | string | max 40 chars, free text like `"~6 min read"` |
| `status` | enum, required, default `draft` | `draft`, `published`, `ai-generated` — generation should set `ai-generated`, never `published`; that value is a human-review signal, not a default |
| `parameter` | component, non-repeatable | at most one per lesson — see `lesson.parameter` below |
| `videos` | many-to-many relation | referenced videos, resolved from `youtubeVideoId` or Strapi `documentId` |
| `body` | dynamic zone | the ten block types below |

**Slugs are never overwritten.** On `createLesson`, a collision appends a
numeric suffix (`-2`, `-3`, …) rather than clobbering an existing lesson.
Always read the actual `slug` back from the result instead of assuming
your input was used.

### `lesson.parameter` (lesson-level, not a body block)

One reader-controlled variable for the whole lesson — currently always a
key. Blocks opt in with their own `useParam: true`.

| Field | Type | Notes |
|---|---|---|
| `name` | enum, required, default `key` | `key` is the only supported value today |
| `label` | string, default `"Key"` | control label shown to the reader |
| `default` | enum, default `C` | one of the 12 pitch classes (sharps only — see below) |

### `lesson.source` (embedded in prose, callout, step, diagram, keyboard-diagram)

Provenance: which video and moment a block came from.

| Field | Type | Notes |
|---|---|---|
| `videoId` | string | max 32 chars — the `youtubeVideoId`, not a Strapi `documentId` |
| `timeSec` | integer | min 0. **Never invent this.** See "Citing sources" in Half B — a timecode must be grounded against the real transcript, the same way summary sections are, never guessed or copied from what "feels right." |

Both fields are optional. Omit `source` entirely for hand-authored content
with no grounding video.

### The 12 pitch classes

Every `root`/`pc`/parameter-`default` enum in this schema uses exactly
these twelve, **sharps only, no flats**:

```
C, C#, D, D#, E, F, F#, G, G#, A, A#, B
```

`Eb`, `Bb`, `Db`, etc. are not legal values anywhere in this schema, even
though they're valid music theory — the enum is closed to sharps.

### `lesson.prose`

Markdown body copy: paragraphs, lists, inline headings.

| Field | Type | Notes |
|---|---|---|
| `body` | richtext, required | markdown. Along with `lesson.step.body`, this is one of only two block fields rendered through a markdown parser (`ReactMarkdown` + GFM) — every other text field in every block (callout body, step lede, table cells, captions) is plain text. Markdown syntax typed into a plain-text field renders as literal asterisks and backticks, not formatting. |
| `source` | component | see `lesson.source` above |

### `lesson.heading`

A standalone heading *between* blocks — not a substitute for a markdown
`##`/`###` inside a `lesson.prose` body, which should stay inline instead.

| Field | Type | Notes |
|---|---|---|
| `text` | string, required | |
| `level` | enum, required, default `h2` | `h2` or `h3` only — no `h1` (the lesson title already is one) and no `h4`+ |

### `lesson.callout`

A short aside, rendered as a colored box with a tone label.

| Field | Type | Notes |
|---|---|---|
| `tone` | enum, required, default `note` | `note`, `tip`, `warning` |
| `body` | text, required | **plain text, not markdown** — see `lesson.prose` above |
| `source` | component | see `lesson.source` above |

### `lesson.step`

One numbered step in a sequence.

| Field | Type | Notes |
|---|---|---|
| `number` | integer, required, min 1 | displayed as-is. **Not auto-renumbered by the schema** — the MCP path must keep steps sequential (1, 2, 3, …) itself across the whole lesson. (The in-app generator does renumber deterministically after assembly, since steps are drafted per-section and each section restarts at 1.) |
| `title` | string, required | |
| `lede` | text | plain text, one line, shown above the body |
| `body` | richtext | markdown — rendered the same way as `lesson.prose.body` |
| `source` | component | see `lesson.source` above |

### `lesson.diagram`

A fretboard diagram (guitar or bass). Position-addressed: dots live at a
`(string, fret)` pair. For a piano/keyboard use `lesson.keyboard-diagram`
instead — that one is pitch-class addressed, a structurally different
shape (no strings, no frets), which is why it is a separate block rather
than an `instrument: "piano"` option here.

| Field | Type | Notes |
|---|---|---|
| `instrument` | enum, required, default `guitar` | `guitar` or `bass` **only** — this is a different enum from the lesson-level `instrument` field, see below |
| `mode` | enum, required, default `theory` | `theory` computes dots at render time from music parameters; `explicit` renders exactly the hand-placed `dots` you give it |
| `root` | enum (pitch class) | **required when `mode: "theory"` and `useParam` is false or omitted.** See "The conditional-required trap" below |
| `quality` | enum | **required when `mode: "theory"`.** `major`, `minor`, `augmented`, `diminished` — **triads only.** Seventh-chord qualities existed in an earlier version of this schema and were removed — the theory layer only voices triads, so a 7th-chord quality can't be rendered. Never emit one, even one that sounds plausible by analogy to these four. |
| `stringSet` | enum | **required when `mode: "theory"`.** One of `e–B–G`, `B–G–D`, `G–D–A`, `D–A–E`. **These separators are EN DASHES (U+2013, "–"), not hyphens (U+002D, "-").** A hyphenated lookalike like `e-B-G` is a different string, fails the enum, and — on the MCP path — is rejected with a message telling you the fix; on any other path that skips MCP's `superRefine`, it silently renders an empty diagram. `stringSet` cannot be marked `required` in the Strapi schema itself, because `explicit` mode doesn't use it at all — that conditional requirement is real but invisible to anyone just reading the schema JSON, which is why it's spelled out here in prose. |
| `inversion` | integer, 0–2 | `0` = root position, `1` = first inversion, `2` = second. Only meaningful in `mode: "theory"`; ignored in `explicit`. |
| `useParam` | boolean, default `false` | when true, the lesson-level `parameter`'s current reader-chosen key supplies `root` at render time instead of this block's own `root` |
| `dots` | repeatable `lesson.neck-dot` | **required (non-empty) when `mode: "explicit"`.** Ignored in `theory` mode. |
| `fromFret` / `toFret` | integer, min 0 | the fret window shown |
| `caption` | string | max 255 chars — a Strapi `string` column, hard cap, no auto-truncation. Shorten before saving, don't rely on the backend to do it for you. |
| `source` | component | see `lesson.source` above |

**The conditional-required trap.** Reading `diagram.json` alone, `root`,
`quality`, and `stringSet` all look optional — none carries
`"required": true`. They aren't optional in practice: in `mode: "theory"`,
missing any one of the three makes `resolveDiagramDots()` return `[]`,
which renders as a completely empty diagram with **no error anywhere** —
not a validation failure, not a console warning outside dev mode, just a
gap where a chord shape should be. The MCP path catches this with a
`superRefine` that names the missing field; the in-app generator never
emits `lesson.diagram` at all (see Half B's scope note), so this trap is
almost entirely an MCP-authoring concern — but it's the single most common
way a hand-composed diagram block goes silently wrong, so it's called out
here rather than left to be discovered by a blank render.

**"Instrument" means two different things depending on which object you're
looking at.** The lesson record's own `instrument` field (`guitar`,
`piano`, `push`, `any`) describes what the *whole lesson* is taught on.
`lesson.diagram.instrument` (`guitar`, `bass`) describes what *this one
fretboard diagram* depicts. A lesson with top-level `instrument: "guitar"`
can still be entirely prose and never contain a `lesson.diagram` block at
all — they are independent fields that happen to share a name.

**"Root" means two different things depending on which object you're
looking at, too.** On `lesson.diagram`/`lesson.keyboard-diagram` (and
`lesson.parameter.default`), `root` is a *pitch class value* — which note
the chord is built on. On `lesson.neck-dot`/`lesson.key-mark`, `root` is a
*boolean flag* — whether this one hand-placed dot happens to be the chord's
root note, so it renders distinctly from the other dots. Same field name,
unrelated types, unrelated meaning.

### `lesson.neck-dot` (used inside `lesson.diagram.dots`)

One hand-placed dot on a fretboard, for `mode: "explicit"`.

| Field | Type | Notes |
|---|---|---|
| `string` | integer, required, 0–5 | **String index: `0` = the highest-pitched string (high e on guitar), increasing toward the lowest (`5` = low E).** This is the opposite of how a lot of guitar tab numbers strings — get it backwards and every dot lands on the wrong string. On a `bass` diagram there are only 4 strings (G–D–A–E), so only indices 0–3 are meaningful even though the field's schema range (0–5) doesn't itself restrict that per instrument. |
| `fret` | integer, required, min 0 | **absolute fret number.** `0` = open string, drawn to the left of the nut, not "no dot." |
| `label` | string | max 8 chars — text shown on the dot, typically a note name |
| `root` | boolean, default `false` | true if this is the chord's root — see the "root" disambiguation above |
| `dim` | boolean, default `false` | true to render the dot dimmed (an optional/context note) |

### `lesson.keyboard-diagram`

A piano/keyboard diagram, pitch-class addressed rather than
position-addressed — a keyboard has no fret/string coordinate system, so
this block is structurally distinct from `lesson.diagram`, not a variant
of it.

| Field | Type | Notes |
|---|---|---|
| `mode` | enum, required, default `theory` | `theory` computes marks from root/quality; `explicit` renders exactly the hand-placed `marks` you give it |
| `root` | enum (pitch class) | required when `mode: "theory"` unless `useParam` is true — same conditional-required trap as `lesson.diagram.root` |
| `quality` | enum | required when `mode: "theory"`. Triads only — same four values, same removed-sevenths caveat as `lesson.diagram.quality` |
| `useParam` | boolean, default `false` | same meaning as on `lesson.diagram` |
| `octaves` | integer, 1–3 | how many octaves the keyboard spans |
| `marks` | repeatable `lesson.key-mark` | required (non-empty) when `mode: "explicit"`; ignored in `theory` mode |
| `caption` | string | max 255 chars, same hard cap as `lesson.diagram.caption` |
| `source` | component | see `lesson.source` above |

### `lesson.key-mark` (used inside `lesson.keyboard-diagram.marks`)

One hand-placed mark on a keyboard, for `mode: "explicit"`.

| Field | Type | Notes |
|---|---|---|
| `pc` | enum (pitch class), required | which key — see "The 12 pitch classes" above |
| `label` | string | max 8 chars |
| `root` | boolean, default `false` | see the "root" disambiguation above |
| `flag` | boolean, default `false` | visually flags the key — used for landmark/teaching marks, e.g. the two "no black key between them" pairs (E–F, B–C) in the half-step lesson's opening diagram |

### `lesson.degree-chips`

A row of scale-degree chips, e.g. `1 2 3 4 5 6 7` or `R ♭3 5`.

| Field | Type | Notes |
|---|---|---|
| `degrees` | JSON array of strings, required | in order, e.g. `["1","2","3","4","5","6","7"]` or `["I","ii","IV","V7"]` — the field is a bare JSON array, not an enum, so any string is schema-legal; keep them short and consistent within one lesson (don't mix Arabic scale degrees and Roman-numeral chord functions in the same chip row) |
| `size` | enum, default `md` | `sm`, `md` |

### `lesson.table`

Headers plus rows.

| Field | Type | Notes |
|---|---|---|
| `headers` | JSON array of strings, required | column headers |
| `rows` | JSON array of string arrays, required | every row must have exactly as many cells as `headers` has columns — the MCP path rejects a mismatched row and names which one |
| `caption` | string | max 255 chars |

There is **no `useParam` field on this component.** An earlier design had
one (to recompute cells from the reader's chosen key), and Strapi's own
`info.description` metadata on `table.json` still says "useParam
recomputes cells from the lesson parameter" — that line is stale, kept
alive only in admin-panel copy nobody reads at authoring time. The actual
attribute was removed. Do not emit `useParam` on a table block; it is not
in the schema and will be rejected by the MCP tool's `.strict()` schema
(or, on any path that doesn't validate, silently dropped).

### `lesson.param-picker`

Renders the control for the lesson-level `parameter` (a key selector,
today). Renders **nothing** if the lesson has no `parameter` set — it's
not an error, just an empty gap, so only emit this block on a lesson that
actually sets `parameter`.

| Field | Type | Notes |
|---|---|---|
| `label` | string | overrides the parameter's own label. Omit to use the parameter's default label. |

### `lesson.video-ref`

A link into a library video at a timecode.

| Field | Type | Notes |
|---|---|---|
| `videoId` | string, required | max 32 chars — the `youtubeVideoId` (**not** a Strapi `documentId`) |
| `timeSec` | integer, min 0 | same grounding rule as `lesson.source.timeSec` — never invented |
| `label` | string | link text. Defaults to "Watch this moment" if omitted. |

### One more field-naming trap: block `id`

Every block Strapi returns carries a numeric `id` (its component row id,
assigned by Strapi). **Do not pass `id` when authoring a block** — the
MCP write tools' block schemas are `.strict()` and reject an unrecognized
field, and `id` isn't one of their declared fields; Strapi assigns it on
create. Passing one back on `updateLesson` doesn't "keep" the old row
either — `body` replacement is whole-array-replace, not a per-block patch
(see `updateLesson`'s own description: there is no partial dynamic-zone
update in Strapi).

---

## Half B — how to author a good lesson

Half A tells you what a block will *accept*. None of it tells you whether
the result is worth a learner's time. This half is what four real
generation runs against this exact library taught about the gap between
"validates" and "good" — most of it is about catching a model (including
this one) reaching for its own generic training-data instincts instead of
the library it's supposed to be grounded in.

### Opening and progression

Open with the concrete hook, not the abstract frame. The first block after
the title heading should put the reader in front of something they can
see or hear immediately — a diagram, a specific example, a real
distinction — not a throat-clearing paragraph about why the topic matters.
`one-fret-one-half-step.json` opens with one sentence defining a half step,
then immediately a keyboard diagram showing the two "no black key" pairs.
It does not open with "Understanding intervals is fundamental to guitar
playing."

Progression should be **concrete → general → applied**, in that order, not
general → concrete: establish one fact the reader can verify (a specific
fret, a specific interval), generalize it into a rule, then show the rule
paying off somewhere that matters (chord shapes, string-crossing,
whatever the topic is actually for). A lesson that states the general rule
first and illustrates it after reads like a textbook definition, not a
walkthrough.

When a digest's `viewingOrder` is available (cross-video lessons, via
`synthesizeDigest`), let it inform section order — it already encodes
which source teaches a prerequisite for which other source. Don't
re-derive that from scratch when it's handed to you.

### Lesson length and section sizing

`one-fret-one-half-step.json` is 18 blocks across roughly 4–5 teaching
beats and takes about 6 minutes to read — that is the right order of
magnitude for one lesson. The in-app generator's own outline step is
capped to 2–6 sections, each producing 2–4 content blocks, for the same
reason: a local model's failure mode past a certain length isn't a
clean error, it's silent drift — dropped fields, invalid enum values, a
lesson that trails off. Smaller, independently-generated sections is what
keeps that failure contained to one section instead of the whole lesson.

A section that only produces one block is thin — that's a sign the goal
statement was too narrow, not a sign to pad it with filler. A section
that wants 6+ blocks is a sign it's actually two sections.

### When a diagram earns its place versus when prose is clearer

A diagram earns its place when the reader needs to see *where*, not just
*what* — a specific shape on a specific part of the instrument. "The minor
third sits three frets above the root" is something prose can say
precisely; "here is what that looks like on the D–A–E string set, root
position vs. first inversion" is something only a diagram shows without
the reader mentally simulating a fretboard.

Prose is clearer when the content is a relationship or a reason, not a
position — *why* the major and minor triad differ by one half step, *why*
a string crossing changes the fret math, *why* two sources disagree. Don't
reach for a diagram just because the topic is "visual" (music generally
is) — a diagram with nothing new to show past the previous one in the
lesson is decoration, not teaching.

**Don't overdo it.** A lesson that is mostly diagrams is as bad as one
with none — a diagram earning its place (per the test above) is different
from a diagram appearing on every section out of habit. The hand-authored
`one-fret-one-half-step.json` (18 blocks across ~5 teaching beats) uses
4 diagram-type blocks total, never more than one in the same section —
that ratio, not "diagram on every beat," is the shape to imitate. The
in-app pipeline enforces this as a hard cap (at most one diagram or
keyboard-diagram block per section, at most 4 across the whole lesson) on
top of the judgment above; when composing by hand via MCP, use the same
restraint even though nothing enforces it there.

**Diagrams are schema-valid without being renderable, and nothing catches
that except actually resolving them.** `root`/`quality`/`stringSet`
missing or wrong in `mode: "theory"`, or an empty/malformed `dots`/`marks`
in `mode: "explicit"`, all render as a blank gap with no error (see the
conditional-required trap under `lesson.diagram` above) — Half A's field
constraints tell you what's *accepted*, not what actually *draws
something*. The in-app pipeline resolve-checks every generated diagram
against the exact renderer function (`resolveDiagramDots`/
`resolveDiagramMarks` in `client/src/lib/lesson/diagram-params.ts`) and
drops anything that resolves to zero dots/marks before it reaches the
lesson body. When composing by hand via MCP, there is no equivalent
safety net — double-check `root`+`quality`+`stringSet` (theory mode) or a
non-empty `dots`/`marks` array (explicit mode) against Half A before
shipping a diagram block, since a validation pass is not the same
guarantee as a render.

### Sequencing blocks — the combinations that read well

`heading → prose → diagram → callout` is the backbone pattern in
`one-fret-one-half-step.json`: state the beat (heading), explain it
(prose), show it (diagram), then land one memorable, checkable takeaway
(callout) before moving on. `prose → table → prose` works for the interval
count-up, where the table *is* the content and the prose bookends explain
what to do with it before and after. `heading → param-picker → prose →
diagram → diagram` closes the lesson by making two diagrams reader-
interactive against the same root, right after explaining why they'd want
to compare them.

What reads badly: a wall of one block type. Three `lesson.prose` blocks
in a row is a paragraph that got split for no reason — merge them, or put
something else (a table, a diagram, a step) between the ideas that
actually differ. A `lesson.step` sequence with no lede on any step reads
like a numbered list with extra chrome; give at least the first step a
lede that orients the reader, even if the rest don't need one.

### Citing sources

Only `lesson.prose`, `lesson.callout`, `lesson.step`, `lesson.diagram`,
and `lesson.keyboard-diagram` carry a `source`. `lesson.heading`,
`lesson.table`, `lesson.degree-chips`, `lesson.param-picker`, and
`lesson.video-ref` do not — a table of interval counts or a row of scale
degrees is derived music theory, not a claim that came from one specific
video, so there's nothing to cite.

**A `timeSec` must be grounded, never invented.** This mirrors the whole
codebase's stance on timecodes (see CLAUDE.md: "the model is explicitly
instructed not to emit timecodes"): the in-app pipeline never asks the
model for a `timeSec` at all — it asks only *which video* a block draws
from (`sourceVideoId`), then BM25-matches the block's own text against
that video's real transcript chunks to find *where*, exactly the way
summary sections get grounded. If no good match exists, the block cites
the video with no `timeSec` rather than a guessed one — a video-only
citation is honest; a wrong timecode is worse than none. On the MCP path,
where a model composes `source` directly, the same rule applies even
though there's no BM25 pass enforcing it: if you don't know precisely
where in the video a claim was made, omit `timeSec` and cite only
`videoId`. Never estimate one because the block "feels like" it's from
around the middle of the video.

**Never write a bare video ID in reader-facing text.** The context you're
given lists each source as `[videoId] "Title"` so you can copy the id
exactly into `sourceVideoId` — that bracketed id is for *you*, not for the
reader. A sentence like "one fix from PS54GhZoojo is octave displacement"
ships an opaque YouTube id straight into prose a learner reads. Refer to a
source in text by its title ("as *Blues Turnaround Shapes* shows...") or a
natural phrase ("one video recommends..."); the id belongs only in the
`source`/`sourceVideoId` field, never typed into the body text itself.

**A lesson that can't point at where a claim came from is generic theory
the model already knew — which defeats the point of building on this
library.** Across four real generation runs, only 3 of 18 blocks in one
lesson carried a source citation; the rest were content the model could
have written without the library at all. If a lesson's blocks read as
true-in-general-for-guitar rather than drawn-from-this-source, something
in retrieval or grounding failed upstream, and more citations should have
been possible than what shipped. When composing by hand via MCP: if you
pulled a claim from a specific transcript, cite it. A lesson built from
real source videos that ends up mostly uncited is a lesson that didn't
need the videos.

**Where two sources disagree is the single most valuable thing a
generated lesson can contain**, and the thing a generic model — one that
wasn't grounded in this specific library — cannot produce on its own. Two
guitarists giving genuinely opposed advice on the same concrete question
(pick angle, whether to mute with the palm or the fretting hand, which
fret to treat as the "real" barre-chord anchor) is not noise to smooth
over into a consensus paragraph — smoothing it away is actively wrong,
because it erases the one piece of information a single-video summary
could never have surfaced. The in-app pipeline treats this as
non-negotiable: it never lets the model notice or phrase a disagreement
on its own. `synthesizeDigest`'s structured `contradictions` field is
turned into callouts deterministically (`buildContradictionCallouts` in
`lesson-generation.ts`), appended under a fixed "Where the sources
disagree" heading, one callout per contradiction, each naming both
positions by video title. When composing by hand via MCP and the sources
genuinely conflict: don't average them into an agreement neither video
stated. State both positions and name which video holds which.

### What real generation runs got wrong — and the fix

Evidence from four real generation runs against this library. Each
pattern below reads as *correct on a schema level and worthless on a
teaching level* — Half A's validators don't catch any of this, because
none of it is a shape violation.

#### Titles: kill the formula

Every single run produced a title of the shape **"From X to Y: Mastering
Z"** — "From Shapes to Sounds: Mastering the Fretboard," "From Notes to
Chords: Mastering Triads," and so on, every time, regardless of topic.
It's a template, and a reader who has seen one lesson title in this
library has effectively seen all of them.

Better patterns, drawn from what an actual teacher would title a lesson:

- **State the rule directly:** "One fret, one half step" (the real seed
  lesson's title — it names the fact, not a journey toward the fact).
- **Ask the question the lesson answers:** "Why does the major scale skip
  two notes?"
- **Name the concrete payoff:** "Deriving open chords from one shape."

If a generated title contains the words "From," "to," and "Mastering" in
the same sentence, throw it out and write one that names what the lesson
actually says, not a narrative arc around saying it.

#### Callouts: carry a fact, not a mood

Generated callouts came back uniformly generic — the recorded example was
*"Remember that the goal is not just to know the shapes, but to make them
feel like one continuous scale."* That sentence is filler wearing the
shape of advice: it doesn't reference anything the reader could check,
misremember, or apply the next time they pick up an instrument. It would
be true of literally any lesson on any instrument.

A good callout carries one specific, checkable fact — something the
reader could get *wrong* if they didn't retain it, which is what makes it
worth flagging as a callout instead of folding into prose. Compare:

- Bad: *"Remember that the goal is not just to know the shapes, but to
  make them feel like one continuous scale."*
- Good (from the real seed lesson): *"Notice E→F is one fret and B→C is
  one fret, same as the keyboard. The guitar does not hide the exception
  — it just stops making it look special."*
- Good (also from the seed lesson): *"Change the root above and both
  shapes move together, keeping their fret counts. That is the whole
  reason guitarists talk in shapes: the counts are fixed, so the shape is
  portable."*

Both good examples name a specific, verifiable relationship (which two
note pairs are the exception; what stays constant when the root changes).
If a callout could be pasted, unedited, into a lesson on a completely
different topic, it isn't earning its slot — cut it or replace it with
the actual fact underneath the vague encouragement.

#### Prose: name the note, not the shape

Generated prose stayed abstract — recorded examples read "understand the
pattern" and "focus on clean articulation." Neither sentence teaches
anything a reader didn't already believe before reading it; both could
apply to any instrument, any technique, any skill level.

Good lesson prose names actual notes, frets, and chord symbols:

- Bad: *"Understand the pattern of the notes on the fretboard."*
- Good: *"Fret 5 on the low E is A; the minor third sits three frets up
  at fret 8."*
- Bad: *"Focus on clean articulation as you move through the shapes."*
- Good (paraphrased from the seed lesson): *"The A string is a perfect
  4th above E — 5 half steps. So any fret on E is the same note as five
  frets lower on A, one string up."*

The test: could a reader act on this sentence without already knowing the
topic? "Understand the pattern" gives them nothing to do. "Fret 5 on the
low E is A" gives them a fret to touch and a note to check it against. If
a sentence would survive unedited in a lesson about a completely different
key, instrument, or chord, it's too abstract — go find the actual note
name, fret number, or chord symbol the source material names and use it.

### Worked example: `one-fret-one-half-step.json`

`server/seed-data/lessons/one-fret-one-half-step.json` is a real,
hand-authored lesson (not AI-generated — `status: "published"`) that
exercises 9 of the 10 dynamic-zone block types (everything except
`lesson.video-ref`). It's worth reading end to end as a shape to imitate,
not just a schema example:

1. **`heading` → `prose` → `keyboard-diagram`** — states the general rule
   about half steps, then immediately grounds it in the one exception
   (E→F, B→C) with a concrete, hand-placed (`mode: "explicit"`) keyboard
   diagram. Concrete before general, per "Opening and progression" above.
2. **`prose` → `diagram` → `callout`** — the same idea transferred to
   guitar, with an explicit fretboard diagram walking one string chromatically,
   then a callout that states the specific parallel (E→F and B→C are both
   one fret) rather than a generic "notice the pattern."
3. **`heading` → `prose` → `table`** — a new sub-topic (interval naming)
   introduced with a heading, one sentence of framing, then a 13-row table
   that *is* the content — every interval name mapped to a half-step count,
   a fret, and a note, all real values, not placeholders.
4. **`prose` → `degree-chips` → `prose`** — narrows the table down to the
   seven scale degrees, chips as the compact visual, prose on both sides
   explaining what the chips mean and what falls out of them (the 2-2-1-
   2-2-2-1 fret pattern).
5. **`heading` → three `step` blocks** — practice instructions, each with
   a lede and a body that names specific frets and notes ("Hold fret 5 (A)
   as your root...").
6. **`heading` → `param-picker` → `prose` → two `diagram` (theory mode,
   `useParam: true`) → `callout`** — the payoff section. The param-picker
   makes the root reader-controlled; both theory-mode diagrams read that
   shared parameter instead of a hardcoded root, so moving the picker
   moves both diagrams together; the closing callout states *why* that
   matters (shapes are portable because the fret counts are fixed) instead
   of just restating that it happened.

Notice what it does *not* do: no block type appears in isolation with
nothing before or after it in the same idea; every diagram has a caption
that adds information beyond "here's a diagram" (see the major/minor
triad diagram captions, which explain *why* the third's dot sits where it
does, not just that it's a triad); and the two theory-mode diagrams near
the end are the only ones using `useParam` — the earlier explicit ones are
deliberately fixed to one key because the lesson is teaching the half-step
*mechanism*, not yet inviting exploration across keys.
