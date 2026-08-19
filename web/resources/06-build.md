# Build Spec — TriadView

A build-ready specification for Claude Code (or any developer). This is a self-contained brief: read this file first; the other files (`01-product.md` through `05-design.md`) are background context if you want deeper reasoning.

---

## What you're building

**TriadView** is a single-page web app that helps a musician learn chords, scales, and notes across three instruments at once: a piano keyboard, a guitar fretboard (standard tuning), and an Ableton Push grid (chromatic mode, fourths layout). The user picks a chord, scale, or note in a control bar, and all three instrument views highlight the corresponding notes simultaneously. Looking up "Cmaj7" once and seeing it on all three layouts is the core experience.

Everything is client-side. No backend, no database, no accounts, no audio. Hosted as a static site.

---

## Tech stack (locked)

- **React 18+** with **TypeScript**
- **Vite** as build tool
- **`tonal.js`** for chord/scale/note theory
- **SVG** for all three instrument views
- **React `useState` + URL state** for app state
- **Vercel or Netlify** for hosting
- Package manager: **npm** (or pnpm if preferred)

Do not introduce: Redux, Zustand, Tailwind (unless you choose it for styling — fine either way), Canvas rendering, a backend, a database, an auth provider, an analytics SDK.

---

## Build order

Build in this order. Each phase is independently shippable and lets you test before moving on.

### Phase 1 — Project scaffold
1. `npm create vite@latest` — React + TypeScript template.
2. Install `tonal` (`npm i tonal`).
3. Set up the folder structure (see "Folder structure" below).
4. Confirm dev server runs and renders a placeholder.

### Phase 2 — Theory layer (no UI yet)
5. Implement `theory/chords.ts` — wraps `tonal` to produce chord notes for a given `ChordSelection` (root + quality + inversion).
6. Implement `theory/scales.ts` — wraps `tonal` to produce scale notes for a given `ScaleSelection`.
7. Sanity-check in the browser console: `console.log(getChordNotes({root:'C', quality:'maj7', inversion:0, voicingIndex:0}))` returns the right notes.

### Phase 3 — Piano view
8. Implement `instruments/piano/layout.ts` — generates a `PianoKey[]` for a fixed range (start with 2 octaves: C3 to C5).
9. Implement `instruments/piano/PianoView.tsx` — renders an SVG keyboard that highlights any notes passed via prop.
10. Add it to `App.tsx` with hardcoded test notes (e.g., C, E, G) to verify rendering.

### Phase 4 — Guitar view
11. Implement `instruments/guitar/layout.ts` — generates a 6-string × 13-fret position grid in standard tuning (E2, A2, D3, G3, B3, E4).
12. Implement `instruments/guitar/GuitarView.tsx` — renders an SVG fretboard, highlights any note passed via prop on every position where it appears (initially — voicing comes later).
13. Add to `App.tsx` and verify with hardcoded notes.

### Phase 5 — Push view
14. Implement `instruments/push/layout.ts` — generates an 8×8 `PushPad[][]` in chromatic-fourths layout. Bottom-left pad starts at a configurable low pitch (default: F1 — chosen so a comfortable mid-range chord like Cmaj falls roughly in the middle of the grid; tunable).
15. Implement `instruments/push/PushView.tsx` — renders an 8×8 SVG grid with note labels on each pad, highlights any pad whose pitch class matches a highlighted note.
16. Add to `App.tsx` and verify.

### Phase 6 — State & URL sync
17. Implement `types.ts` with all domain types from `05-design.md`.
18. Implement `state/useAppState.ts` — a hook that owns app state and syncs it with URL search params bidirectionally. Default state on empty URL: chord mode, C, major, inversion 0, voicing 0.
19. Implement `state/resolve.ts` with `resolveSelection(state)` that returns `{ piano: Note[], guitar: Note[], push: Note[], label: string }`. For now, return the same notes for all three instruments (voicings come next phase).

### Phase 7 — Selection bar
20. Implement `components/SelectionBar.tsx`:
    - Mode toggle: Chord / Scale / Note.
    - Root note picker (12 buttons or dropdown).
    - Chord quality picker (in chord mode) — 9 options from `ChordQuality` type.
    - Scale type picker (in scale mode) — 12 options from `ScaleType` type.
    - Inversion control (in chord mode): prev/next buttons + display.
    - Voicing control (in chord mode): prev/next buttons + display.
    - Label display showing current selection (e.g., "Cmaj7 — 1st inversion, voicing 0").
21. Wire it into `App.tsx`. App is now usable end-to-end with chord/scale/note selection driving all three views.

### Phase 8 — Voicings
22. Implement `theory/voicings/piano.ts` — closed root-position, closed inversions, one open voicing.
23. Implement `theory/voicings/guitar-shapes.ts` — handcrafted shape lookup. Start with 2 shapes per quality (open-position-style and barre-style). Include at minimum: maj, min, dom7, maj7, min7. Other qualities can fall back to "highlight all matching notes" with a TODO comment.
24. Implement `theory/voicings/guitar.ts` — given chord + voicing index, transpose the chosen shape to the chord's root and return the resulting `Note[]`.
25. Implement `theory/voicings/push.ts` — return all chord notes as pitch classes (Push lights up every matching pad; no octave-specific voicing needed).
26. Update `state/resolve.ts` to call the per-instrument voicing functions instead of using the same notes for all three.

### Phase 9 — Polish
27. Visual style pass: clean colors, root note visually distinct from other chord notes (e.g., filled vs outlined circles).
28. Layout pass: three views laid out vertically on desktop. (Mobile layout is a nice-to-have; if implemented, stack is fine.)
29. Default sensible page title, favicon, and meta tags.
30. Deploy to Vercel or Netlify via Git push.

---

## Domain types (from `05-design.md`)

```typescript
type PitchClass =
  | 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F'
  | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

type Note = { pitchClass: PitchClass; octave: number };

type ChordQuality =
  | 'maj' | 'min' | 'dom7' | 'maj7' | 'min7'
  | 'dim' | 'aug' | 'sus2' | 'sus4';

type ChordSelection = {
  root: PitchClass;
  quality: ChordQuality;
  inversion: number;
  voicingIndex: number;
};

type ScaleType =
  | 'major' | 'minor' | 'harmonicMinor' | 'melodicMinor'
  | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian' | 'locrian'
  | 'majorPentatonic' | 'minorPentatonic' | 'blues';

type ScaleSelection = { root: PitchClass; type: ScaleType };

type ViewMode = 'chord' | 'scale' | 'note';

type AppState = {
  mode: ViewMode;
  chord?: ChordSelection;
  scale?: ScaleSelection;
  singleNote?: PitchClass;
};

type PianoKey = { note: Note; isBlack: boolean; index: number };

type GuitarPosition = { string: number; fret: number; note: Note };

type PushPad = { row: number; col: number; note: Note };
```

---

## Folder structure

```
src/
├─ types.ts
├─ main.tsx
├─ App.tsx
├─ state/
│  ├─ useAppState.ts
│  └─ resolve.ts
├─ theory/
│  ├─ chords.ts
│  ├─ scales.ts
│  └─ voicings/
│     ├─ piano.ts
│     ├─ guitar.ts
│     ├─ guitar-shapes.ts
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
└─ components/
   └─ SelectionBar.tsx
```

---

## Push grid specification

- 8 rows × 8 columns.
- Bottom-left pad = lowest pitch. Default: **F1** (tunable).
- **Right** = +1 semitone (chromatic step).
- **Up** = +5 semitones (perfect fourth).
- Notes repeat across the grid by design.
- Each pad shows the note name (sharp preferred, e.g., "C#" not "Db" — let `tonal` decide and accept whichever it returns).
- Highlighted pads light up with a distinct fill color when their pitch class matches a highlighted note.

---

## Guitar specification

- 6 strings, standard tuning: E2 (low) / A2 / D3 / G3 / B3 / E4 (high).
- 13 frets visible (open + 12).
- Highlighted positions render as filled circles on the fret intersection.
- For chord views with a chosen voicing, only the voicing positions highlight. For scale and single-note views, every matching position highlights.

---

## Piano specification

- 2 octaves visible: C3 to C5 (24 white-key positions worth, 14 white keys + 10 black).
- Standard piano keyboard SVG.
- Highlighted keys render with a colored overlay.
- Root note of the chord visually distinct from other chord notes.

---

## URL schema

```
/?mode=chord&root=C&quality=maj7&inv=1&v=0
/?mode=scale&root=C&type=major
/?mode=note&note=C
```

- URL is the source of truth on page load.
- Empty URL → defaults to `mode=chord&root=C&quality=maj&inv=0&v=0`.
- Invalid params → fall back to defaults silently (no error UI for MVP).
- Every state change writes to the URL via `history.replaceState` or React Router's `setSearchParams`.

---

## What "done" looks like (acceptance criteria)

The MVP is done when **all** of these are true:

1. App loads at a URL and shows piano, guitar, and Push views simultaneously.
2. User can pick any of 12 root notes × any of 9 chord qualities and see the chord highlighted on all three views.
3. User can cycle through inversions on chords with at least 3 notes.
4. User can cycle through at least 2 voicings per chord quality on piano and guitar; Push lights up all matching pads.
5. User can switch to scale mode, pick any of 12 scale types × 12 roots, and see scale notes highlighted on all three views.
6. User can switch to note mode, pick any of 12 pitch classes, and see all positions highlighted on all three views.
7. The current selection appears as a readable label (e.g., "Cmaj7 — 1st inversion, voicing 0").
8. Refreshing the page or sharing the URL preserves the current view exactly.
9. Selection changes feel instant (<100ms perceived latency).
10. Site is deployed and publicly accessible.

---

## Out of scope (do not build)

- Reverse-lookup / translation (clicking shapes to identify chords).
- Audio playback (no MIDI, no synth, no "play" button).
- Hardware Push MIDI integration.
- Alternate guitar tunings.
- Push in-key mode or sequencer mode.
- User accounts, favorites, save/share-via-account features.
- Lessons, learning paths, progress tracking.
- Mobile-native apps.
- Analytics, error tracking, A/B testing infrastructure.
- Tests (can be added in a future pass — start with manual verification).

---

## Notes for Claude Code

- **Commit after each phase.** Each phase above is a sensible commit boundary.
- **Don't over-engineer.** This is a small app. If you're reaching for a state management library, abstraction layer, or design system, stop.
- **`tonal.js` does the heavy lifting for chord/scale notes.** Don't reimplement music theory; wrap `tonal` in our own functions that return our app's types.
- **Voicings are the only non-trivial logic.** Especially guitar — start with a small handcrafted shape table and accept that some chord qualities will only have a "all-matching-positions" fallback for MVP.
- **Visual quality matters.** This is a learning tool — the user will stare at it. Spend real time on Phase 9 (polish): clean SVG, readable labels, distinct root color, sensible spacing.
- **Default values matter.** Pick sensible defaults for piano range, guitar fret count, Push lowest pitch — the spec gives starting suggestions but you're free to tune them during build if something looks better.
- **Reference files**: `01-product.md` through `05-design.md` are in the same folder if you want context on why a decision was made.
