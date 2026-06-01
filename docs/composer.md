# Progression Composer

The **Compose** tab on `/theory` — a Hookpad-style 8-bar sketchpad. You
lay down a chord progression, a melody, and a bassline entirely in
**scale degrees** relative to a key, then loop it back through the
in-app Web Audio synth. Because nothing is stored as an absolute pitch,
changing the key transposes the whole piece for free.

> Scope: this is a sketch tool, not a DAW. Fixed 8 bars, 4/4, monophonic
> melody + bass, triad chords. Those constraints are load-bearing (see
> [§9](#9-constraints--extension-points)).

---

## 1. The two coordinate systems

Everything in the composer is expressed in two key-relative coordinates,
never absolute pitch or seconds:

- **Pitch → scale degree.** A degree is `1..7` within the chosen key.
  Degree 1 in C-major is C; in A-minor it's A. Melody/bass notes also
  carry an `octave` band (`0 | 1`) so the melody lane can span two
  octaves; bass ignores it.
- **Time → ticks.** The grid is sixteenth-note resolution:
  `TICKS_PER_BEAT = 4`, `BEATS_PER_BAR = 4`, `BARS = 8` →
  `TOTAL_TICKS = 128`. A quarter note is 4 ticks, a bar is 16.

Both live in `client/src/lib/music/compose/types.ts`. The payoff: a
`Composition` is a pure description; resolving it to MIDI happens only at
playback/preview time against the current key, so **transposition is a
no-op re-render**.

---

## 2. Data model (`compose/types.ts`)

```ts
type TimeSpan  = { id; start; length };               // ticks
type ChordSpan = TimeSpan & { degree: 1..7 };
type NoteSpan  = TimeSpan & { degree: 1..7; octave: 0|1 };

type Composition = {
  id; version; name;
  key: { root: PitchClass; mode: 'major' | 'minor' };
  bpm;                       // 60–180 in the UI
  chords: ChordSpan[];       // non-overlapping, sorted
  melody: NoteSpan[];        // monophonic (non-overlapping in time)
  bass:   NoteSpan[];        // monophonic
};
```

Chords, melody, and bass are all **time-span lanes** — variable-length
blocks on the same 128-tick grid. The only difference is payload
(`degree` vs `degree + octave`) and how a span resolves to MIDI.

`version` (`SCHEMA_VERSION`) tags the persisted shape so stored rows can
be validated/migrated as the model evolves (it already went beats →
ticks once). See [§6](#6-persistence).

---

## 3. Span manipulation + the monophonic invariant (`compose/spans.ts`)

All structural edits route through pure, generic helpers over
`TimeSpan`:

- `sortSpans`, `spanAt(tick)`, `freeGapAt(tick)`
- `moveSpan(id, newStart)` — clamps to `[prevEnd, nextStart - length]`
- `resizeSpan(id, newLength)` — clamps to `[1, nextStart - start]`
- `removeById`, plus typed builders `addChord` / `addNote` (clamp the new
  span's length to the free gap at the drop tick)

**Invariant: lanes never overlap and stay in `[0, TOTAL_TICKS)`.** It's
enforced by the builders + clamps, *not* the types — `moveSpan`/
`resizeSpan` derive neighbours from sort position and assume the lane is
already well-formed. Anything that ingests spans from outside (a loaded
row, future AI generation) must run them through validation first; the
load path does (`compose/schema.ts`). Monophony for melody/bass is just
the same non-overlap rule applied per lane.

Covered by `__tests__/compose-spans.test.ts`.

---

## 4. Playback (`compose/playback.ts` + `useCompositionPlayback.ts`)

**Resolution (pure).** `playback.ts` turns degrees into MIDI:

- Degrees resolve through `notesAscending` so pitch rises with the
  degree number even when the key wraps the octave (A-minor degree 3 = C
  *above* the degree-1 A, not below).
- Octave bands keep the layers apart: chords ~octave 3, melody 4, bass 2.
- `resolveChordMidis` builds the **triad** (root/3rd/5th) of a diatonic
  degree — the 7th from `getDiatonicChords` is dropped.
- `buildSchedule(comp)` flattens the composition into a sparse, sorted
  list of per-tick `StepEvent`s, each carrying the layer MIDI + its span
  length (for sustain). This is the clean seam any exporter (MIDI, etc.)
  should build on.

**The clock (`useCompositionPlayback`).** A self-scheduling `setTimeout`
walks ticks `0..127` and fires the synth per event. The live schedule and
tempo are read through **refs**, and the effect depends only on
play/stop + loop — so editing or nudging the tempo *while playing*
applies on the next tick instead of restarting the cursor at 0. Each
layer plays with its own voice (see §5) and sustains for its span length.

> Known limitation: it's a `setTimeout` clock, not an
> `AudioContext.currentTime` lookahead scheduler, so timing drifts
> slightly. Fine for a sketch tool; revisit if it ever needs to be
> tight. Tested in `__tests__/compose-playback.test.ts`.

---

## 5. Voices (`lib/music/audio/synth.ts`)

The shared Web Audio synth gained selectable **voices** (oscillator type
+ envelope + optional lowpass): `piano` for melody, `string` for chords,
`bass` for bass, plus the original `default` used elsewhere (Circle of
Fifths, intervals). `playNote`/`playChord` take an optional trailing
`voice` arg, so existing callers are unaffected.

---

## 6. Persistence

A composition is saved to a Strapi **`composition`** collection type as
`{ title, data }`, where `data` is the whole `Composition` JSON blob
(`server/src/api/composition/`). Public role gets full CRUD in
`server/src/index.ts` bootstrap, same as loops/digests/notes.

- **One shared zod schema** (`compose/schema.ts`) validates both the save
  server-function input (`CompositionSchema`, strict) and the read path
  (`parseStoredComposition`, lenient — defaults a missing `version`,
  returns `null` for blobs it can't coerce). The list server-fn validates
  every row's `data` and **drops** uncoercible rows rather than crashing
  the editor on load.
- Client layer mirrors the Loop pattern: `lib/services/compositions.ts`
  (over `strapiFetch`) ← `data/server-functions/compositions.ts` (zod) ←
  the Composer's save/load/delete bar.
- On **load**, span ids are re-minted (`reidentify`) so they can't
  collide with ids created later in the session; the Strapi `documentId`
  is kept for upsert (`save` creates when null, updates in place
  otherwise).

Migration story: bump `SCHEMA_VERSION` and add a branch in
`parseStoredComposition` keyed on the parsed version. Tested in
`__tests__/compose-schema.test.ts`.

---

## 8. UI architecture (`components/compose/`)

Stacked lanes over one shared 128-column grid, aligned by a fixed
`LABEL_W` gutter (`laneLayout.ts`):

```
BeatRuler        bar numbers 1–8
NoteLane melody  7 degree rows (piano-roll)
ChordLane        variable-length chord blocks
NoteLane bass    7 degree rows
```

- **State** lives in a reducer, `compose/useCompositionState.ts`, owning
  `comp` + `cursor` + `selected` (a typed `{ kind, id }`). Every edit is
  one atomic transition; action callbacks are stable. The
  `Composer` is mostly wiring + transport/save-load/keyboard UI.
- **Lanes are presentational + `memo`'d.** They take only what they need
  — `ChordLane` gets key-derived `labels`, `NoteLane` gets `pcs` +
  a `previewNote` callback — *not* the whole `comp`. Combined with stable
  handler bundles and a memoized highlight, editing or playing one lane
  doesn't re-render the others.
- **Dragging** is one shared hook, `useSpanDrag.ts`: pointer-capture on
  the block (so a quick flick's first move isn't dropped), pixel→tick
  math against the track width, live `onMove`/`onResize`. Note lanes pass
  a `rowHeight` so vertical drag also remaps the degree (pitch), with
  audition.
- **Playhead** is a single CSS-`calc()` line in `Composer` spanning the
  lanes; the lanes themselves don't track the current tick, so they don't
  re-render every playback tick.
- **Chord-tone highlight:** selecting a chord shades its triad degrees
  across its span in the melody grid (`chordToneDegrees` in `labels.ts`).
- Keyboard: `Delete`/`Backspace` removes the selection, `Escape`
  deselects (ignored while typing in the name field).

---

## 9. Constraints & extension points

What's deliberately fixed, and what it'd take to change:

| Constraint | Where | To extend |
|---|---|---|
| 8 bars, 4/4 | `BARS`/`TICKS_PER_BAR`/`TOTAL_TICKS` constants | lift meter/length into `Composition`, thread through grids + clamps |
| Monophonic melody/bass | non-overlap in `spans.ts` | a per-lane collision policy; the lane UI already renders arbitrary spans |
| Triad chords only | `resolveChordMidis` drops the 7th | keep the 7th / add a quality field on `ChordSpan` |
| One octave per note band | `octave: 0\|1`, melody uses both, bass none | widen the band + add rows to `NoteLane` |
| `setTimeout` clock | `useCompositionPlayback` | swap to an `AudioContext.currentTime` lookahead scheduler |

Natural next features the architecture already supports cheaply:
**undo/redo** (wrap the reducer in a history meta-reducer),
**export** (consume `buildSchedule`), **MCP tools** (mirror the loop
tools against the `composition` type), **attach-to-video** (add a Strapi
relation).

---

## File map

```
client/src/lib/music/compose/
  types.ts                 model + tick/degree constants + SCHEMA_VERSION
  spans.ts                 generic TimeSpan ops (move/resize/add/clamp)
  schema.ts                shared zod schema + parseStoredComposition
  playback.ts              degree→MIDI resolution + buildSchedule
  useCompositionPlayback.ts tick clock → synth
  useCompositionState.ts   reducer (comp + cursor + selection)
  labels.ts                triad labels + chord-tone degrees
  colors.ts                per-degree colors + hexToRgba
client/src/lib/music/audio/synth.ts   per-voice Web Audio synth
client/src/components/compose/
  Composer.tsx             top-level wiring + transport + save/load
  ChordLane.tsx            chord block lane (memo, presentational)
  NoteLane.tsx             melody/bass piano-roll (memo, presentational)
  ChordPalette.tsx         "Chords in {key}" diatonic chips
  BeatRuler.tsx            bar-number header
  useSpanDrag.ts           shared pointer-drag (move/resize/pitch)
  laneLayout.ts            shared grid geometry (LABEL_W, columns)
  chordHighlight.ts        ChordToneHighlight type
client/src/data/server-functions/compositions.ts   zod-validated CRUD fns
client/src/lib/services/compositions.ts             strapiFetch wrappers
server/src/api/composition/                         Strapi content type
```

Tests: `client/src/lib/music/__tests__/compose-{spans,playback,schema}.test.ts`.
