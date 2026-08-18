# CLAUDE.md

Guidance for Claude Code working in this repo.

## Project

**Paul's Music Helper** — a visual + audio reference for **Ableton Push producers learning piano and guitar**. Push is the user's anchor instrument; piano and guitar are the destinations they're trying to learn. The app shows the same chord/scale/note across all three views simultaneously, plays it via Web Audio, and surfaces theoretical relationships (diatonic chords in a scale, scales containing a chord).

The app code lives under `app/`. It's a static SPA — no backend, no database, no accounts.

Read `README.md` for the user-facing summary and `resources/01-product.md` … `06-build.md` for the original product/spec (immutable history — don't edit).

## Stack

- React 18 + TypeScript + Vite (in `app/`)
- `tonal` for music theory (chord/scale/interval lookups, 100+ chord types)
- SVG for all instrument views
- Web Audio API for playback (custom 50-line synth in `audio/synth.ts`)
- React `useState` + URL params for state — no backend, no DB, no auth

## Working in the codebase

All commands run from `app/`:
- `npm run dev` — dev server (Vite picks a free port; we usually use `--port 5180`)
- `npm run build` — production build (also runs `tsc -b` for full type-check)

After non-trivial changes, run `npm run build` to type-check the whole tree. Tests aren't set up. Verify visually via the dev server (Playwright works against `localhost`; see `/tmp/triadview_*.py` for past patterns).

## Code structure

```
app/src/
  types.ts                     # all domain types (PitchClass, ChordQuality, ScaleType, etc.)
  App.tsx                      # composition root
  state/
    useAppState.ts             # all state + URL sync (transient state lives here too)
    resolve.ts                 # selection → per-instrument notes + metadata
  audio/
    synth.ts                   # Web Audio synth (triangle voices, AD envelope)
  theory/
    notes.ts                   # MIDI/note conversion + ascending-note builder + display-map builder
    chords.ts                  # tonal wrapper for chord notes + voicings stack
    scales.ts                  # tonal wrapper for scale notes
    degrees.ts                 # interval → "1, b3, 5, b7" labels
    positions.ts               # per-scale boxes (major=explicit CAGED, others=fret-window), tonic-anchored
    diatonic.ts                # diatonic 7th chords from a scale (with Roman numerals)
    chord-scales.ts            # reverse: every scale containing a given chord
    voicings/
      piano.ts                 # closed / drop-2 / wide
      guitar.ts                # shape realization + transposition
      guitar-shapes.ts         # handcrafted barre-chord shape table
      push.ts                  # pitch-class flood (no voicing concept on Push)
  instruments/
    piano/{layout,PianoView}.tsx
    guitar/{layout,GuitarView}.tsx
    push/{layout,PushView}.tsx
    notation/
      SheetMusicView.tsx       # 5-line staff with treble clef, stack/sequence/single
      TabView.tsx              # 6-line guitar TAB with note-letter labels
  components/
    SelectionBar.tsx           # all the picker chips
```

Conventions:
- `theory/` contains music theory only — no React, no rendering.
- `instruments/` contains layout math and SVG rendering only — no theory.
- `state/` is the glue.
- Pitch classes are stored as sharps internally (`'C' | 'C#' | …`). For DISPLAY we override with the correct enharmonic per key (e.g. F major shows `Bb`, not `A#`) via `pcDisplay` derived in `resolve.ts` from tonal's note names.
- String indexing on guitar: `0 = high E … 5 = low E`.
- Push pad indexing: `row 0 = bottom row` (lowest pitch); rendered with row 0 at the visual bottom.

## Key concepts

### View modes
4 modes selectable in the SelectionBar:
- **Chord** — root + quality (29 qualities supported, from triads to altered dominants)
- **Scale** — root + scale type (major, modes, harmonic/melodic minor, pentatonics, blues)
- **Note** — single pitch class
- **All** — every position lit; reference view for memorizing fretboard/keyboard

### Guitar shapes (positions) — guitarscale.org is the source of truth
The user decided **guitarscale.org is the authority** for scale positions, and the
shape system was rebuilt around that (this REVERSED the earlier "modes anchor on
the parent major" design — do not reinstate it):

- **Boxes are anchored on the scale's OWN tonic**, not a parent major.
- A scale gets a "Shape" picker only if guitarscale.org ships box images for it:
  **major, natural minor, harmonic minor, melodic minor, major pentatonic
  (boxes 1 & 5 only), minor pentatonic, blues**.
- **"2-oct"** (`scalePosition === '2oct'`) is a universal compact two-octave
  box on the 6th-string tonic (window `{lo:-1,hi:3}`), offered for EVERY scale
  including modes — mirrors guitarscale.org's "2 octaves" view and gives modes
  a practical playable position now that they have no CAGED boxes.
- **Modes (dorian/phrygian/lydian/mixolydian/locrian) have no numbered boxes** —
  guitarscale.org's mode pages show only the full-neck scale (the "All" view,
  which matches the site and fixed the C# Dorian bug). They still get All + 2-oct.
- `theory/positions.ts` has two representations:
  - **Major**: explicit per-string CAGED fingerings (Shape 1=E … 5=G),
    cross-checked dot-for-dot against `c_major_box1-5.png`. Kept explicit
    because the G-shape reaches a string back outside a plain fret block.
  - **Minor / harm / mel / pentatonics / blues**: a `{lo,hi}` **fret window**
    anchored on the tonic; dots regenerated by note math. Verified pure-window
    for natural minor / pentatonics / blues. Harmonic & melodic minor use a
    window that is a *complete superset* of the site's curated fingering
    (every in-position scale note; never a wrong or missing note).
- `availablePositions(scaleType)` drives the SelectionBar (major→1-5,
  majPent→[1,5], etc.). `realizeCagedShape(pos, scaleRoot, scalePcs, scaleType)`.

### Diatonic chords (in scale mode)
Every 7-note scale shows a "Chords in this scale" panel with the 7 diatonic 7th chords as chips: `Imaj7 / iim7 / iiim7 / IVmaj7 / V7 / vim7 / viim7♭5` (for major). Click a chip to **highlight that triad within the scale** (the rest of the scale dims). Stays in scale mode — does NOT switch to chord mode.

### Scales containing this chord (in chord mode)
The reverse: every scale whose pitch classes are a superset of the chord shows up as a chip, sorted by tightest fit. Click → switch to scale mode for that scale. Closes the chord↔scale loop.

### Audio
Click any key/fret/pad → plays the note via Web Audio synth. ▶ Play button plays the current chord (stacked) or scale (arpeggiated). Mute toggle in header. AudioContext is created lazily on first user gesture.

## Reference sources

When validating music theory output (especially scale shapes, fingerings, chord voicings), cross-check against authoritative reference sites rather than guessing. Primary:

- **<https://www.guitarscale.org/>** — guitar scale shapes, all 12 keys × all common scales. No API.
  - Page slug: `https://www.guitarscale.org/<root>-<type>.html` — sharps are
    `c-sharp`, flats `b-flat`; pentatonics are `pentatonic-major` /
    `pentatonic-minor` (NOT `major-pentatonic`); blues `c-blues`. Both
    enharmonic pages exist (`a-sharp-major` and `b-flat-major`).
    `theory/scales.ts` `guitarScaleOrgUrl()` builds this; the Guitar panel
    links to it in scale mode.
  - Box images use **underscores**: `images/c_major_box<N>.png` (N 1..5),
    `c_minor_box*`, `c_minor_harmonic_box*`, `c_minor_melodic_box*`,
    `c_pentatonic_minor_box*`, `c_blues_box*`. Major pentatonic has only
    `c_pentatonic_major_box1` & `_box5`. **Mode pages have NO box images**
    (only `*_full_letters.png` — the whole scale).
  - **WebFetch returns text only and will NOT show shape data** — `curl` the box images into a temp dir and Read them as image files. Each numbered dot = a fingering (1=index … 4=pinky); the darker filled dot = the tonic.
  - Source of truth for `theory/positions.ts`. Verify by note math (pc of each
    position ∈ scale), not just by eye — low-res dots are easy to misread.

When transcribing shapes from images, list each string's fret positions and double-check by computing each note's pitch class — easy to miss a position when the image has many dots.

## Things to keep in mind

- The audience is **producers who already know Push** and want to play piano/guitar fluently enough to become better musicians. NOT pianists or guitarists. Push stays prominent.
- Spec docs in `resources/` are immutable history — don't edit them, treat them as read-only context.
- The position selector only appears for scales guitarscale.org ships boxes for (see "Guitar shapes" above) and only filters the **guitar** view. Modes show the full scale (no selector). Piano and Push always show the full scale; mirroring a guitar fingering onto piano was tried and rejected as confusing.
- Roots can be flat-spelled: the Root picker stacks a flat button over each accidental (Db/​C#, …). `state.preferFlats` is URL-synced (`flats=1`) and only changes how tonal *names* the key (Bb major → Bb C D Eb F G A); PCs stay sharps-only internally. Natural-root keys are unaffected (D major is always F#/C#).
- Open-position guitar chords: `theory/voicings/guitar-shapes.ts` `OPEN_CHORD_SHAPES` (C/A/G/E/D maj, Am/Em/Dm, E7/A7/D7/G7/C7/B7) are voicing index 0 so e.g. C maj defaults to open `x32010`. Barre shapes follow.
- Clicking a diatonic-chord chip also plays the chord (full 7th) via the synth, in addition to previewing it in the scale.
- Diatonic chord chips do NOT switch modes — they preview the chord *within* the scale view. The user wanted to see the chord in the context of the scale, not switch contexts.
- Don't add a fret-shifting / arrow-key feature for shapes — shapes are anchored to the scale's tonic, not free-floating. (We had this and removed it.)
- Don't introduce: Redux/Zustand, a backend, an auth provider, an analytics SDK, or Tailwind unless the user explicitly asks. (Strapi has been suggested twice and rejected twice — static reference data doesn't need a CMS.)
- Note display uses the **correct enharmonic per key** (F major shows Bb, not A#). The PC type is sharps-only internally; `resolve.ts` builds a `pcDisplay` map from tonal's actual note names and the views use that.

## State machine

`useAppState` owns everything. State splits into:
- **Persistent (URL-synced):** `mode`, `chord` (root/quality/inversion/voicingIndex), `scale` (root/type), `singleNote`, `scalePosition`, `preferFlats` (`flats=1`).
- **Transient (in-memory only):** `focusedPitchClass`, `labelMode` (notes/degrees), `showNaturals`, `audioMuted`, `previewedChordDegree`.

URL schema: `?mode=chord&root=C&quality=maj7&inv=0&v=0` etc. Invalid params silently fall back to defaults.

## Open work / next steps

- **Ear-training games** (planned in task #36): find-the-note, chord-by-ear, scale-by-ear, intervals, degrees, progressions, inversions. Reuses synth + theory layer. Optional persistence later.
- **Verify all 12 keys** against guitarscale.org. Currently only C and F are explicitly verified. Other keys *should* work via the wrap rule but haven't been visually compared.
- **Mobile layout** — currently desktop-only. Three side-by-side panels stack reasonably on mobile but the SelectionBar gets cramped.
- **Deploy** — Cloudflare Pages was the chosen target. App is feature-complete; needs git init + GitHub repo + Cloudflare connection.
