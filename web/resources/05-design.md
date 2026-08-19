# System Design

Concrete shapes, structures, and design decisions that turn `04-tech.md` into something Claude Code can build. No code is written yet — this is the blueprint.

## 1. Domain types

These are the TypeScript types the whole app uses. `tonal.js` provides music theory primitives, but we keep our own clean app-level types.

```typescript
type PitchClass =
  | 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F'
  | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

type Note = {
  pitchClass: PitchClass;
  octave: number; // C4 = middle C
};

type ChordQuality =
  | 'maj' | 'min' | 'dom7' | 'maj7' | 'min7'
  | 'dim' | 'aug' | 'sus2' | 'sus4';

type ChordSelection = {
  root: PitchClass;
  quality: ChordQuality;
  inversion: number;     // 0 = root, 1 = 1st inv, etc.
  voicingIndex: number;  // which precomputed voicing to render
};

type ScaleType =
  | 'major' | 'minor' | 'harmonicMinor' | 'melodicMinor'
  | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian'
  | 'majorPentatonic' | 'minorPentatonic' | 'blues';

type ScaleSelection = {
  root: PitchClass;
  type: ScaleType;
};

type ViewMode = 'chord' | 'scale' | 'note';

type AppState = {
  mode: ViewMode;
  chord?: ChordSelection;
  scale?: ScaleSelection;
  singleNote?: PitchClass;
};
```

## 2. Instrument layout types

Each instrument has its own positional model.

```typescript
type PianoKey = {
  note: Note;
  isBlack: boolean;
  index: number; // position from left
};

type GuitarPosition = {
  string: number; // 0 = high E, 5 = low E
  fret: number;   // 0 = open
  note: Note;
};

type PushPad = {
  row: number; // 0..7 (0 = bottom row)
  col: number; // 0..7 (0 = leftmost column)
  note: Note;
};
```

Layouts are generated once at startup from a tuning/layout config — they are not stored as static JSON.

## 3. Push grid layout — chromatic, fourths

The Push view uses Push's default chromatic mode layout:

- **Each pad to the right** = +1 semitone (chromatic step).
- **Each pad up** = +5 semitones (perfect fourth).
- 8×8 grid, bottom-left is the lowest pitch.
- Notes repeat across the grid (the same note appears on multiple pads), which is part of the intended visualization — when a chord is selected, every pad that holds one of the chord notes lights up.

Lowest pitch (bottom-left pad) is configurable but defaults to a sensible playing range (e.g., C1 or similar — final value to be tuned during build).

## 4. Component tree

```
<App>
├─ <SelectionBar>     // mode toggle, root picker, quality/scale picker, inversion + voicing controls
├─ <PianoView>        // SVG piano keyboard
├─ <GuitarView>       // SVG fretboard
└─ <PushView>         // SVG 8x8 grid
```

Data flow:

1. User interacts with `<SelectionBar>` → updates app state.
2. State changes → URL updates (custom hook).
3. `<App>` calls `resolveSelection(state)` to produce one `Note[]` per instrument (since voicings are per-instrument).
4. The three view components each receive their highlighted notes and render.

The view components are dumb — they don't know about chords or scales, only "highlight these notes."

## 5. The resolve layer

This is the glue between selection state and instrument rendering.

```typescript
type ResolvedSelection = {
  piano: Note[];
  guitar: Note[];
  push: Note[];
  label: string; // e.g., "Cmaj7 — 1st inversion (voicing 1)"
};

function resolveSelection(state: AppState): ResolvedSelection;
```

Internally it dispatches by `mode`:
- `chord` → `resolveChord(state.chord)` — produces per-instrument voicings.
- `scale` → `resolveScale(state.scale)` — same scale notes for all three instruments.
- `note` → `resolveNote(state.singleNote)` — same single note for all three.

## 6. Voicing strategy (MVP)

Voicings are per-instrument and chosen with simple, deterministic rules.

### Piano
- **Voicing 0 (closed root position)**: chord notes stacked in thirds in a single octave above the root.
- **Voicing 1 (closed inversion N)**: same closed shape but with `inversion` applied (rotate the bottom note up an octave).
- **Voicing 2 (open)**: root + 5 in lower octave, 3 + 7 (or upper extensions) in upper octave.

### Guitar
- **Handcrafted lookup table** keyed by chord quality. Each entry stores a fingering shape relative to root (string-and-fret offsets). Shape is transposed by root note.
- Example structure:
  ```typescript
  const guitarShapes: Record<ChordQuality, GuitarShape[]> = {
    maj: [
      { name: 'open',   positions: [...] },   // C-shape, A-shape adapted, etc.
      { name: 'barre',  positions: [...] },
    ],
    // ...
  };
  ```
- 2–3 shapes per quality for MVP.
- Shapes that go below fret 0 after transposition are filtered out or shifted up by an octave.

### Push
- Take the chord's notes (octaves stripped — we only care about pitch classes).
- Highlight every pad on the 8×8 grid whose note matches one of those pitch classes.
- Because Push's chromatic-fourths layout repeats notes across the grid, this naturally produces a visual "shape" pattern that the user can play in the lowest comfortable region.
- No "voicing" choice in the traditional sense — the grid shows all positions of the chord notes, and the user picks where to play it.

### Scales (all instruments)
- Highlight every position whose note matches one of the scale's pitch classes.
- No voicing concept — scales show all notes everywhere.

### Single notes (all instruments)
- Highlight every position whose pitch class matches the selected note.

## 7. URL schema

```
/?mode=chord&root=C&quality=maj7&inv=1&v=0
/?mode=scale&root=C&type=major
/?mode=note&note=C
```

Default state if no params: `mode=chord&root=C&quality=maj&inv=0&v=0`.

URL is the source of truth on page load. A custom hook (`useAppState`) syncs URL ↔ React state in both directions.

Invalid or missing params fall back to sensible defaults rather than erroring.

## 8. Folder structure

```
src/
├─ types.ts                       // all domain types
├─ App.tsx
├─ state/
│  ├─ useAppState.ts              // useState + URL sync
│  └─ resolve.ts                  // resolveSelection, resolveChord, resolveScale, resolveNote
├─ theory/
│  ├─ chords.ts                   // wraps tonal.js for chord notes + inversions
│  ├─ scales.ts                   // wraps tonal.js for scale notes
│  └─ voicings/
│     ├─ piano.ts
│     ├─ guitar.ts
│     ├─ guitar-shapes.ts         // handcrafted shape lookup table
│     └─ push.ts
├─ instruments/
│  ├─ piano/
│  │  ├─ layout.ts
│  │  └─ PianoView.tsx
│  ├─ guitar/
│  │  ├─ layout.ts
│  │  └─ GuitarView.tsx
│  └─ push/
│     ├─ layout.ts
│     └─ PushView.tsx
├─ components/
│  └─ SelectionBar.tsx
└─ main.tsx                       // Vite entry
```

Separation:
- `theory/` — music theory only, no React, no rendering.
- `instruments/` — layout math and SVG rendering only, no theory.
- `state/` — glue.
- `components/` — generic UI.

## 9. Rendering notes (SVG)

- Each instrument view is a single root `<svg>` with a fixed viewBox.
- Static parts (piano keys, fretboard frets/strings, Push pad outlines) render once.
- Highlighted notes render as overlay elements (`<circle>` for fret/pad markers, `<rect>` overlays for piano keys).
- Visual style: clean, high-contrast, distinct color for highlighted notes. Root note can be visually distinct from other chord notes (e.g., filled vs outlined, or different color) — small but useful affordance.

## 10. Open implementation choices (for Claude Code to decide during build)

- Exact piano range to render (probably 2–3 octaves centered around C4).
- Exact guitar fret count to render (12 or 15).
- Push lowest pitch (bottom-left pad).
- Specific guitar shapes to include in the handcrafted lookup table (Claude Code can ship with a starter set and we extend over time).
- Color palette and typography.
- Whether to use Tailwind or plain CSS.

## 11. What this design does NOT include

Per `02-users.md` and `03-requirements.md`:

- No reverse-lookup (translation loop).
- No audio playback.
- No hardware Push MIDI integration.
- No alternate guitar tunings.
- No accounts, persistence, or sharing beyond URL state.
- No analytics, error tracking, or testing infrastructure (can be added later; not foundational).
