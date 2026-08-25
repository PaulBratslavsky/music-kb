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
and a `body` dynamic zone of thirteen typed blocks. Every block's
`__component` value is the literal string in its heading below, e.g.
`lesson.prose`. `lesson.interactive` is **not** one of the thirteen — it
used to exist, had no renderer, and was deleted from the schema. Never emit
it.

Five of the thirteen draw something: `lesson.diagram` (a stretch of neck),
`lesson.chord-diagram` (one chord box), `lesson.neck-pattern` (several
patterns over one neck), `lesson.keyboard-diagram` (a piano), and
`lesson.natural-notes` (a fixed reference strip). They answer different
questions and are not interchangeable — each entry below opens with which
question it answers.

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
| `body` | dynamic zone | the thirteen block types below |

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

### `lesson.source` (embedded in prose, callout, step, and every diagram block)

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

### Writing the body as markdown directives

There are two ways a lesson body reaches Strapi, and they use different
input formats for the *same* thirteen blocks:

- **The in-app generator writes MARKDOWN** with inline component
  directives, and a parser
  (`client/src/lib/lesson/markdown-blocks.ts`) converts it to the typed
  blocks below.
- **The MCP write tools (`createLesson` / `updateLesson`) take the typed
  blocks directly**, as JSON, validated by `server/src/mcp/tools/
  lesson-blocks.ts`.

The field reference below is the source of truth for both. Every directive
attribute is that block's own field name, so one entry documents both
forms.

**Why markdown at all.** Anthropic's structured-output mode rejects
`oneOf`, array `minItems > 1`, array `maxItems`, and integer bounds — and
caps a request at **16 union-typed parameters**, which every optional field
counts against. Under that ceiling the generator could reach 5 of the 13
block types while Claude over MCP reached all 13. None of those
restrictions apply to a text answer. The trade is that validation happens
at parse time instead: an unknown directive, an illegal enum, a malformed
table, a diagram that would draw nothing — each fails with the line number,
and the block is dropped rather than shipped as a silent gap.

#### The syntax

```
Ordinary prose is ordinary markdown. Paragraphs become lesson.prose.

::callout{tone=tip src=dQw4w9WgXcQ}
One fret is one half step, everywhere on the neck.
::
```

- A directive opens with `::name{attributes}` **alone on its line** and
  closes with a line containing **only `::`**. There is no self-closing
  form: a directive with no body still needs its closing `::`. A missing
  close never swallows the rest — the body stops at the next directive —
  but it is always reported, and if it runs to the end of the answer the
  block is dropped (the answer may have been truncated). Close them.
- The directive **name** is the component name without the `lesson.`
  prefix: `::prose` is `lesson.prose`. There are no aliases.
- Directive **attributes** are that component's own field names, spelled
  exactly (`stringSet`, `fromFret`, `barreFromString`). Exactly two
  attributes are not fields:
  - `src=<youtubeVideoId>` — shorthand for `source.videoId`, which is a
    nested component and cannot be written flat. Only on blocks that have
    a `source` field (so: not `table`, not `degree-chips`, not
    `param-picker`).
  - `after=<n>` — placement, used only by the illustrate pass, never
    stored.
- `key=value` for a simple value, `key="value with spaces"` when it
  contains a space, and a **bare word for a boolean** — `useParam`,
  `root`, `hollow` are true just by appearing.
- An unknown attribute is an **error**, not a silent strip. `boxy` where
  you meant `body` has to fail here or it becomes an invisible gap later.

#### What goes in the body

| Directive | Body |
|---|---|
| `prose`, `step` | markdown |
| `callout`, `heading` | plain text |
| `table` | a markdown table — header row, `\|---\|` separator, then rows |
| `degree-chips` | the chips on one line, e.g. `I ii IV V7` |
| `param-picker` | nothing |
| `video-ref` | a description of the moment being pointed at — **never rendered**, it is what locates the timecode |
| `diagram`, `keyboard-diagram`, `chord-diagram`, `neck-pattern` | lines starting with `-` are structured entries (one dot, mark, string or pattern); every other line is the **caption** |

That last rule is the only one worth memorising: inside a drawing
directive, `-` means "an entry", anything else means "the caption".
`neck-pattern` nests one level deeper — a top-level `-` starts a pattern
and **indented** `-` lines are that pattern's dots.

A `caption="…"` attribute works too, and wins if you give both.

#### A whole section

```
The minor third sits three frets above the root. On an open low E that
puts it at fret 3.

::callout{tone=tip src=dQw4w9WgXcQ}
Count frets, not notes — every fret is one half step, with no exceptions.
::

::table{caption="Counting up from an open low E"}
| Interval | Half steps | Fret |
|---|---|---|
| Minor 3rd | 3 | 3 |
| Major 3rd | 4 | 4 |
::

::diagram{root=C quality=major stringSet=e–B–G}
The third is the middle dot — two frets above the root, not three.
::
```

#### What the parser refuses

Each of these drops the one block and names the line; the rest of the
lesson survives.

| Refused | Why it matters |
|---|---|
| unknown directive / unknown attribute | a typo would otherwise become an invisible gap |
| an illegal enum value | a hyphenated `stringSet` lookalike is named with its en-dash fix |
| a theory diagram missing `root`/`quality`/`stringSet` | `resolveDiagramDots()` returns `[]` — an empty diagram, no error |
| an explicit diagram or keyboard with no entries | same |
| a chord box missing one of its six strings, or `state=fretted` with no `fret` | a missing string renders **muted** — a different chord, silently |
| a partial barre (one or two of the three barre fields) | no bar is drawn and nothing complains |
| a `neck-pattern` with fewer than two patterns, or only one of `fromFret`/`toFret` | a one-pill picker draws nothing; a half window re-crops each pattern |
| a table row whose cell count differs from the header | |
| an authored `timeSec` | timecodes are BM25-derived from the transcript, never authored — see "Citing sources" |

An over-length `caption` is **truncated, not rejected** (with a warning
naming the line): losing a whole diagram over 20 surplus characters would
cost more than it saves. A directive left unclosed *mid-answer* is
likewise recovered with a warning rather than dropped — its body plainly
ended where the next directive began.

### `lesson.prose`

Markdown body copy: paragraphs, lists, inline headings.

| Field | Type | Notes |
|---|---|---|
| `body` | richtext, required | markdown. Along with `lesson.step.body`, this is one of only two block fields rendered through a markdown parser (`ReactMarkdown` + GFM) — every other text field in every block (callout body, step lede, table cells, captions) is plain text. Markdown syntax typed into a plain-text field renders as literal asterisks and backticks, not formatting. |
| `source` | component | see `lesson.source` above |

**As a directive.** Plain markdown paragraphs already become
`lesson.prose` — the directive form exists to carry a citation.

```
::prose{src=dQw4w9WgXcQ}
The minor third sits **three frets** above the root. One fret is one half
step, so three half steps up from an open low E lands on fret 3.
::
```

### `lesson.heading`

A standalone heading *between* blocks — not a substitute for a markdown
`##`/`###` inside a `lesson.prose` body, which should stay inline instead.

| Field | Type | Notes |
|---|---|---|
| `text` | string, required | |
| `level` | enum, required, default `h2` | `h2` or `h3` only — no `h1` (the lesson title already is one) and no `h4`+ |

**As a directive.** `::heading{level=h2}` with the text as its body. The
in-app generator never emits one — section headings come from the outline
and the write pass rejects a `::heading` by name.

```
::heading{level=h3}
Where the root lives
::
```

### `lesson.callout`

A short aside, rendered as a colored box with a tone label.

| Field | Type | Notes |
|---|---|---|
| `tone` | enum, required, default `note` | `note`, `tip`, `warning` |
| `body` | text, required | **plain text, not markdown** — see `lesson.prose` above |
| `source` | component | see `lesson.source` above |

**As a directive.**

```
::callout{tone=warning src=dQw4w9WgXcQ}
The fifth-fret tuning trick fails between G and B — there the match is at
fret 4.
::
```

### `lesson.step`

One numbered step in a sequence.

| Field | Type | Notes |
|---|---|---|
| `number` | integer, required, min 1 | displayed as-is. **Not auto-renumbered by the schema** — the MCP path must keep steps sequential (1, 2, 3, …) itself across the whole lesson. (The in-app generator does renumber deterministically after assembly, since steps are drafted per-section and each section restarts at 1.) |
| `title` | string, required | |
| `lede` | text | plain text, one line, shown above the body |
| `body` | richtext | markdown — rendered the same way as `lesson.prose.body` |
| `source` | component | see `lesson.source` above |

**As a directive.** `number` may be omitted: the parser numbers steps in
the order they appear, and the generator renumbers the whole lesson after
assembly anyway.

```
::step{title="Find the root" lede="Low E, fifth fret." src=dQw4w9WgXcQ}
Fret the low E at 5 and let it ring — that is A.
::
```

### `lesson.diagram`

A stretch of fretboard (guitar or bass). Answers **"where do these notes
live on the neck"** — a scale shape, a triad voicing, an interval, a
position. Position-addressed: dots live at a `(string, fret)` pair.

Not the block for *"how do I hold this chord"* — that is
`lesson.chord-diagram`, the songbook chord box. Not the block for a scale
system with five or seven shapes either — that is `lesson.neck-pattern`,
which puts them all over one neck. And for a piano/keyboard use
`lesson.keyboard-diagram`: it is pitch-class addressed, a structurally
different shape (no strings, no frets), which is why it is a separate
block rather than an `instrument: "piano"` option here.

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
gap where a chord shape should be. Both authoring paths catch it, and
neither by schema validity: the MCP path with a `superRefine` naming the
missing field, and the markdown parser by running the renderer's own
`resolveDiagramDots()` on every parsed diagram and dropping any that
resolves to nothing, with the line number and the three field values. It
is the single most common way a diagram block goes silently wrong, which
is why it is checked by executing the resolver rather than by inspecting
the shape.

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

**As a directive.** Theory mode carries everything in attributes and uses
the body as the caption:

```
::diagram{root=C quality=major stringSet=e–B–G inversion=0 fromFret=3 toFret=8}
The third is the middle dot — two frets above the root, not three.
::
```

Explicit mode adds one `-` line per dot (see `lesson.neck-dot` below);
non-`-` lines are still the caption:

```
::diagram{mode=explicit instrument=guitar fromFret=5 toFret=8}
Chord tones inside the scale shape, with the fretted notes ringed.
- string=5 fret=5 label=A root ringed
- string=4 fret=7 label=E light
- string=3 fret=5 hollow
::
```

### `lesson.neck-dot` (used inside `lesson.diagram.dots`)

One hand-placed dot on a fretboard, for `mode: "explicit"`.

| Field | Type | Notes |
|---|---|---|
| `string` | integer, required, 0–5 | **String index: `0` = the highest-pitched string (high e on guitar), increasing toward the lowest (`5` = low E).** This is the opposite of how a lot of guitar tab numbers strings — get it backwards and every dot lands on the wrong string. On a `bass` diagram there are only 4 strings (G–D–A–E), so only indices 0–3 are meaningful even though the field's schema range (0–5) doesn't itself restrict that per instrument. |
| `fret` | integer, required, min 0 | **absolute fret number.** `0` = open string, drawn to the left of the nut, not "no dot." |
| `label` | string | max 8 chars — text shown on the dot, typically a note name |
| `root` | boolean, default `false` | true if this is the chord's root — see the "root" disambiguation above; renders in the accent colour |
| `dim` | boolean, default `false` | fade the dot right back |
| `hollow` | boolean, default `false` | draw an outlined ring instead of a filled disc |
| `ringed` | boolean, default `false` | draw an accent halo around the dot |
| `light` | boolean, default `false` | draw the dot as a cut-out: light fill, dark outline, dark text |

**The four style flags are the difference between a diagram that shows
three dots and a diagram that teaches something.** They exist so ONE
picture can carry two layers of meaning at once instead of forcing two
pictures the reader has to hold in their head together. What each is for,
from `MiniNeck.tsx`'s own doc comments:

- **`dim`** — show the whole scale across the neck while spotlighting one
  position. The out-of-position notes stay visible, so the reader sees
  where the box sits inside the larger shape, without competing with the
  notes they are meant to play.
- **`hollow`** — background context. The canonical use is a chord overlay:
  scale tones that are *not* in the current chord go hollow, so the chord
  tones read as the solid ones. An **unlabelled** hollow dot renders small
  — it sketches the scale's shape without competing with the labelled
  notes, so omit `label` when a dot is context rather than content.
- **`ringed`** — "here is where your hand actually is", as opposed to
  "here is where else that note lives". Marks the notes genuinely fretted
  in the shape being played, against the same pitch classes occurring
  elsewhere on the neck. Combines with any fill.
- **`light`** — a cut-out dot: brighter than a solid one without becoming
  an empty ring, so chord tones stand out from a surrounding scale while
  still looking like real notes. Pairs with `hollow`: `light` for the
  foreground layer, `hollow` for the background one.

They compose. "These are the scale tones, these are the chord tones inside
it" is `hollow` (unlabelled) for the scale plus `light` for the chord
tones; add `ringed` on the four your hand is actually holding and the same
diagram now says three things. A diagram where every dot is plain is
usually a diagram that could have taught more.

**As a directive entry.** One `-` line inside a `::diagram{mode=explicit}`
or under a `::neck-pattern` pattern. The four style flags are bare words:

```
- string=5 fret=5 label=A root ringed
- string=3 fret=5 hollow
```

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

**As a directive.**

```
::keyboard-diagram{mode=explicit octaves=1}
E–F and B–C are the two white pairs with no black key between them.
- pc=E label=E flag
- pc=F label=F flag
::
```

### `lesson.key-mark` (used inside `lesson.keyboard-diagram.marks`)

One hand-placed mark on a keyboard, for `mode: "explicit"`.

| Field | Type | Notes |
|---|---|---|
| `pc` | enum (pitch class), required | which key — see "The 12 pitch classes" above |
| `label` | string | max 8 chars |
| `root` | boolean, default `false` | see the "root" disambiguation above |
| `flag` | boolean, default `false` | visually flags the key — used for landmark/teaching marks, e.g. the two "no black key between them" pairs (E–F, B–C) in the half-step lesson's opening diagram |

**As a directive entry.** One `-` line inside a
`::keyboard-diagram{mode=explicit}`:

```
- pc=C label=R root
- pc=E label=3
```

### `lesson.chord-diagram`

The songbook chord box. Answers **"how do I hold this chord"** — a 4–6
fret window with a dot per fretted string, `O`/`×` markers above the nut,
and an optional barre. This is the single most expected visual in a guitar
lesson: **any lesson that names a chord the reader is meant to play should
show one.**

Distinct from `lesson.diagram`, which shows a stretch of neck. A chord box
is cropped to the hand, oriented the way method books draw it (low E on
the left, nut at the top), and says nothing about where those notes sit in
a scale. Use whichever matches the question the surrounding prose just
asked.

| Field | Type | Notes |
|---|---|---|
| `strings` | repeatable `lesson.chord-string`, required | **exactly six entries, one per string.** Each carries its own `string` index, so array order does not matter — but a string you leave out renders **muted**, which is a different chord, silently. List all six, including the open ones. |
| `barreFret` | integer, min 1 | absolute fret of the barre. Omit entirely for a chord with no barre. |
| `barreFromString` / `barreToString` | integer, 0–5 | inclusive string indices the barre spans, same `0` = high e convention |
| `fretCount` | integer, 3–6, default `5` | how many frets the box shows |
| `startFret` | integer, min 1 | override the fret at the top of the box. Omit to derive it: chords reachable inside the window start at the nut; higher shapes start at their lowest fretted note and get a `5fr`-style position label automatically. |
| `orientation` | enum, default `vertical` | `vertical` is the songbook box (nut across the top, strings running down) and is right almost always. `horizontal` rotates it so the neck runs left-to-right with the nut on the LEFT — matching `lesson.diagram`. Reach for it only when a chord box sits next to a fretboard diagram and the two must not disagree about which way the neck runs. |
| `caption` | string | max 255 chars |
| `source` | component | see `lesson.source` above |

**All three barre fields go together.** Give one or two and the barre is
dropped at render — no bar drawn, no error. The MCP path rejects a partial
barre and names the fix.

**As a directive.** All six strings, one `-` line each; the caption is the
non-`-` line.

```
::chord-diagram{barreFret=1 barreFromString=0 barreToString=5 fretCount=5}
F major — the barre does the work of the nut.
- string=0 state=fretted fret=1
- string=1 state=fretted fret=1
- string=2 state=fretted fret=2
- string=3 state=fretted fret=3
- string=4 state=fretted fret=3
- string=5 state=fretted fret=1 root
::
```

### `lesson.chord-string` (used inside `lesson.chord-diagram.strings`)

One string's state in a chord box.

| Field | Type | Notes |
|---|---|---|
| `string` | integer, required, 0–5 | **`0` = the highest-pitched string (high e), `5` = the lowest (low E)** — the same convention as `lesson.neck-dot.string`, and the opposite of most tab numbering. The rendered box flips this so low E appears on the left, where a chord chart expects it; you do not compensate for that yourself. |
| `state` | enum, required, default `muted` | `fretted` — a finger at `fret`. `open` — played unfretted, drawn as `O` above the nut. `muted` — not played, drawn as `×`. |
| `fret` | integer, min 1 | absolute fret. **Required when `state` is `fretted`**, ignored otherwise. Never `0` — an unfretted string is `state: "open"`, not fret 0. (The renderer forgives a `fretted` entry at fret 0 by reading it as open, but the MCP path rejects a `fretted` entry with no `fret` at all, because that one renders as a muted string — a wrong chord with no error.) |
| `root` | boolean, default `false` | true if this fretted note is the chord's root — drawn in the accent colour so the shape's anchor is obvious |

**As a directive entry.** `state` is required explicitly — a string with no
state renders muted, which is a different chord with no error, so the
parser refuses to guess.

```
- string=0 state=open
- string=3 state=fretted fret=2 root
- string=5 state=muted
```

### `lesson.neck-pattern`

Several fretboard patterns over **one** shared diagram, switched by pills.
Answers **"how does this shape system cover the whole neck"** — five
pentatonic boxes, seven three-note-per-string shapes, the CAGED positions.

Stacking that many separate fretboards makes a page unreadable, and the
shared fret window is the other half of the idea: with `fromFret`/`toFret`
fixed for the whole set, stepping through the pills shows the patterns
*climbing the neck* rather than each one being re-cropped to its own span.
One pattern is a `lesson.diagram`, not this block.

| Field | Type | Notes |
|---|---|---|
| `instrument` | enum, required, default `guitar` | `guitar` or `bass`, same enum as `lesson.diagram.instrument` |
| `patterns` | JSON array, required | **two or more** entries of `{ label, sub?, dots[] }` — shape below. A single pattern renders nothing at all: a picker with one pill is a control that does nothing. |
| `fromFret` / `toFret` | integer, min 0 | the shared window. **Set both or neither** — with only one, the renderer auto-fits each pattern separately, which is exactly the re-cropping this block exists to avoid. |
| `caption` | string | max 255 chars |
| `source` | component | see `lesson.source` above |

There is **no link-out field.** An earlier version of this widget carried a
"hear this on the fretboard explorer →" deep link; it was dropped on the
way in, because lessons here are self-contained — that principle is why
diagrams are inline in the first place.

#### The pattern shape (entries in `lesson.neck-pattern.patterns`)

| Field | Type | Notes |
|---|---|---|
| `label` | string, required | max 40 chars — pill text, e.g. `"Position 3"`. Kept short; the pills sit on one row. |
| `sub` | string | max 160 chars — the line under the diagram while this pattern is selected, e.g. `"E minor pentatonic · frets 4–8"`. Plain text. |
| `dots` | array, required | this pattern's dots — same fields, same string-index convention and same four style flags as `lesson.neck-dot` (see above). A pattern with no dots is dropped rather than shown as a pill over an empty neck. |

**Why `patterns` is a JSON array and not a repeatable component.** Strapi
populates a dynamic zone exactly **one component deep**. A pattern nested
as a component would come back with an empty `dots` array at render —
pills over blank necks, no error anywhere, the same silent class as the
four unrendered fields. `lesson.table`'s `headers`/`rows` make the same
trade. The MCP write tools validate the shape in full, so a malformed
pattern is rejected there with a message naming the field, not discovered
by looking at the page.

The one-level limit is worth knowing generally: `lesson.diagram.dots`,
`lesson.chord-diagram.strings` and `lesson.keyboard-diagram.marks` are
real components and populate fine because each is exactly one level below
its block. Anything a level deeper than that has to be JSON.

Do **not** give a pattern an `id`. Patterns are identified by their
position in the array, and `id` is a reserved Strapi field the write tools
reject (see "field naming trap: block `id`" below).

**As a directive.** A top-level `-` starts a pattern; **indented** `-`
lines are that pattern's dots.

```
::neck-pattern{instrument=guitar fromFret=0 toFret=15}
The five boxes, on one neck, climbing.
- label="Box 1" sub="E minor pentatonic · frets 0–3"
  - string=5 fret=0 label=E root
  - string=5 fret=3 label=G
- label="Box 2"
  - string=5 fret=3 label=G
  - string=5 fret=5 label=A
::
```

### `lesson.natural-notes`

A fixed reference strip of the natural notes on the low E and A strings,
frets 0–12, with the two half-step pairs (B–C, E–F) banded. **Takes no
parameters** — it is the same diagram every time, which is the point:
those 14 notes are the anchor for finding any root on the neck by name,
and every sharp or flat is one fret away from one of them.

Use it once, at the moment a lesson first asks the reader to *locate* a
root rather than just play a given shape. It is a reference, not an
illustration of the current sentence — a second one in the same lesson
adds nothing.

| Field | Type | Notes |
|---|---|---|
| `caption` | string | max 255 chars — the only thing you can vary |
| `source` | component | see `lesson.source` above |

**As a directive.** No attributes worth setting beyond the caption, which
is simply the body.

```
::natural-notes{}
Every sharp and flat is one fret away from one of these fourteen notes.
::
```

### `lesson.degree-chips`

A row of scale-degree chips, e.g. `1 2 3 4 5 6 7` or `R ♭3 5`.

| Field | Type | Notes |
|---|---|---|
| `degrees` | JSON array of strings, required | in order, e.g. `["1","2","3","4","5","6","7"]` or `["I","ii","IV","V7"]` — the field is a bare JSON array, not an enum, so any string is schema-legal; keep them short and consistent within one lesson (don't mix Arabic scale degrees and Roman-numeral chord functions in the same chip row) |
| `label` | string | names what the row IS. **Effectively required in practice** — see below |
| `caption` | string | max 255 chars — what to notice about the row |
| `size` | enum, default `md` | `sm`, `md` |

**Always label a chip row.** This is the one block a reader cannot identify
from its own contents. A bare `1 2 3 4 5 6 7` sitting in a lesson reads as a
pagination control, not a scale — that happened in a real generated lesson and
the reader's reaction was "I have no idea what this component is". Every other
visual block carries a caption; use these.

**As a directive.** The chips go on one line, separated by spaces.

```
::degree-chips{label="C major scale" caption="Degree 1 is the root — every chord in the key is built from these seven."}
1 2 3 4 5 6 7
::
```

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

**As a directive.** The body is a markdown table; the caption is an
attribute, since the body is already spoken for.

```
::table{caption="Counting up from an open low E"}
| Interval | Half steps | Fret |
|---|---|---|
| Minor 3rd | 3 | 3 |
| Major 3rd | 4 | 4 |
::
```

### `lesson.param-picker`

Renders the control for the lesson-level `parameter` (a key selector,
today). Renders **nothing** if the lesson has no `parameter` set — it's
not an error, just an empty gap, so only emit this block on a lesson that
actually sets `parameter`.

| Field | Type | Notes |
|---|---|---|
| `label` | string | overrides the parameter's own label. Omit to use the parameter's default label. |

**As a directive.** No body.

```
::param-picker{label="Try it in"}
::
```

### `lesson.video-ref`

A link into a library video at a timecode.

| Field | Type | Notes |
|---|---|---|
| `videoId` | string, required | max 32 chars — the `youtubeVideoId` (**not** a Strapi `documentId`) |
| `timeSec` | integer, min 0 | same grounding rule as `lesson.source.timeSec` — never invented |
| `label` | string | link text. Defaults to "Watch this moment" if omitted. |

**As a directive.** The body is the moment description — never rendered,
used only to locate the timecode. Do **not** write `timeSec`: the parser
refuses an authored one.

```
::video-ref{videoId=dQw4w9WgXcQ label="Watch the barre demonstrated"}
He barres the first fret and rolls the finger back onto its side.
::
```

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

There is no target length or target block-per-section count — a lesson
should be as many blocks as the content actually needs, no more and no
less, and different lessons should come out different sizes. Don't treat
any specific lesson's block count (including the hand-authored
`one-fret-one-half-step.json`, which has grown well past its original size
as it's been enriched over time — see its own note below) as a size to
imitate; imitate its shape and judgment instead, per the sections above and
below.

The one place a count is still deliberately bounded is the in-app
pipeline's outline step, which targets roughly 2 to 6 teaching-beat
sections — and that bound is about a DIFFERENT problem than block count
per section: a local model's failure mode past a certain length isn't a
clean error, it's silent drift — dropped fields, invalid enum values, a
lesson that trails off. Smaller, independently-generated sections is what
keeps that failure contained to one section instead of the whole lesson.
It is not a claim that 2–6 is the right number of ideas for every lesson,
only a reliability guard on how much one model call is asked to hold at
once. Composing by hand via MCP, in one sitting, doesn't have this failure
mode and isn't bound by it.

A section that only produces one block is thin — that's a sign the goal
statement was too narrow, not a sign to pad it with filler. A section
that wants far more blocks than the rest of the lesson is a sign it's
actually two sections, not a sign to trim it back to a target count.

### Generation is two passes: write, then illustrate

The in-app pipeline (`lesson-generation.ts`) splits each section into two
independent model calls, not one: a **write** pass emits text only —
prose, callout, step, table, degree-chips, video-ref, param-picker; no
drawing directive is even available to it — and a separate **illustrate**
pass, given the finished section text, decides what would be clearer shown
than described and answers with the five drawing directives plus where
each belongs in the section (`after=N`). The two passes run per section,
and every section's illustrate call is independent of every other
section's, so the pipeline runs them concurrently rather than one at a
time.

This split exists because a combined write+illustrate call makes a
diagram an afterthought — the model is mid-explanation when it has to
also pick a diagram, and it shows.

It used to matter for a second reason that no longer applies: when both
passes emitted structured JSON, a combined schema carried every prose
field AND every diagram field in one request, which pushed it into
Anthropic's 16-union-typed-parameter cap and forced dropping `inversion`,
`fromFret`/`toFret`, explicit-mode `dots`/`marks`, `param-picker` and
`video-ref`, and locking generation to `mode: "theory"`. Both passes now
author in markdown, so there is no cap and nothing is cut: the illustrate
pass reaches all five drawing blocks, both modes, and every field on each.
The split survives on the editorial argument alone, which was always the
better one.

Composing a lesson by hand via MCP has no such split — one sitting does
both — but the same judgment applies: write the section first, then look
at what you actually wrote and ask what a reader would rather see than
read, rather than reaching for a diagram while still mid-sentence.

### When a diagram earns its place versus when prose is clearer

Pick a block by what the content actually *is*, not out of habit or to
fill a quota. Each component in this library exists for a specific job:

- a **fretboard diagram** (`lesson.diagram`) shows a shape you are asking
  someone to play — an actual position on an actual instrument.
- a **keyboard diagram** (`lesson.keyboard-diagram`) shows pitch
  relationships without fingering — which notes, not which fingers.
- **degree chips** show a scale's structure as numbers — the shape of a
  scale abstracted away from any one key or instrument.
- a **table** compares things along shared dimensions — several items,
  several properties, read across and down.
- a **step** is an instruction performed in order — do this, then this.
- a **callout** is an aside that would break the flow inline — one
  specific, checkable fact worth flagging, not folded into the paragraph
  around it.
- **prose** is the reasoning that connects them — *why*, not just *what*
  or *where*.

Use as many or as few of these as the content actually needs, and let
that number vary. A section teaching five pentatonic box positions wants
five diagrams; a section explaining why a diminished chord resolves the
way it does wants prose and maybe a table, no diagram at all. There is no
fixed shape every lesson is supposed to follow — different lessons should
look like genuinely different documents, not the same block sequence with
the words swapped in.

The concrete test for a diagram specifically: it earns its place when the
reader needs to see *where*, not just *what* — a specific shape on a
specific part of the instrument. "The minor third sits three frets above
the root" is something prose can say precisely; "here is what that looks
like on the D–A–E string set, root position vs. first inversion" is
something only a diagram shows without the reader mentally simulating a
fretboard. Prose is clearer when the content is a relationship or a
reason, not a position — *why* the major and minor triad differ by one
half step, *why* a string crossing changes the fret math, *why* two
sources disagree. A diagram with nothing new to show past the previous
one in the lesson is decoration, not teaching, no matter how "visual" the
topic is in general.

**Chord progressions are a diagram opportunity, not a prose one.** If a
section names an ordered progression — a chord sequence like G–C–D, or a
Roman-numeral pattern like ii–V–I — show it: one diagram per chord, in
the order named, not a sentence describing what the shapes look like. A
progression described in prose and never shown is exactly the gap the
write/illustrate split above exists to close.

**The resolve check is not optional, and it is not a style preference.**
Diagrams are schema-valid without being renderable, and nothing catches
that except actually resolving them. `root`/`quality`/`stringSet` missing
or wrong in `mode: "theory"`, or an empty/malformed `dots`/`marks` in
`mode: "explicit"`, all render as a blank gap with no error anywhere (see
the conditional-required trap under `lesson.diagram` above) — Half A's
field constraints tell you what's *accepted*, not what actually *draws
something*. The in-app pipeline resolve-checks every generated diagram
against the exact renderer function (`resolveDiagramDots`/
`resolveDiagramMarks` in `client/src/lib/lesson/diagram-params.ts`) and
drops anything that resolves to zero dots/marks before it reaches the
lesson body — a diagram that draws nothing is worse than no diagram at
all, because it renders as an invisible gap with no error. When composing
by hand via MCP, there is no equivalent safety net — double-check
`root`+`quality`+`stringSet` (theory mode) or a non-empty `dots`/`marks`
array (explicit mode) against Half A before shipping a diagram block,
since a validation pass is not the same guarantee as a render.

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
not just a schema example. It is a living lesson, not a frozen fixture —
it has grown since this walkthrough was written (an MCP-authoring session
added a string-pair comparison table, a callout, and a deliberately-wrong
worked step to close a pedagogical gap the original didn't cover), and
will likely grow again. Don't expect the numbered walkthrough below to
enumerate every block in the current live lesson; it documents the six
teaching beats it opened with, as an example of the sequencing judgment in
"Sequencing blocks" above, not an exhaustive index of its current content:

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
