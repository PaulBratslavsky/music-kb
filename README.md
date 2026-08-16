# Paul's Music Helper

**A visual + audio reference for Ableton Push producers learning piano and guitar.**

You already program harmony in Push. Paul's Music Helper shows you what those same chords, scales, and notes look like on a **piano keyboard** and a **guitar fretboard** — all three views synchronized in real time. Click anywhere to hear the note. Pick a chord and see every scale it lives in. Pick a scale and see the chords inside it.

Becoming fluent on piano and guitar makes you a better producer, even if you never perform. Most chord/scale references on the web target one instrument at a time. Paul's Music Helper uses Push as the anchor and treats piano and guitar as the destinations.

## Why

Each instrument has a totally different physical layout: piano is linear, guitar is mostly tuned in fourths, and Push is a chromatic grid in fourths. The same musical idea looks completely different on each. Paul's Music Helper puts all three side-by-side so the shapes start to feel like dialects of the same language.

## Features

### Four view modes
- **Chord** — 12 roots × 29 qualities, from triads (`maj`, `m`, `dim`, `aug`, `sus2`, `sus4`) through 7ths (`maj7`, `m7`, `7`, `m7♭5`, `dim7`, `mMaj7`, `7sus4`), 6ths (`6`, `m6`), add chords (`add9`, `m(add9)`), 9ths/11ths/13ths, and altered dominants (`7♭5`, `7♯5`, `7♭9`, `7♯9`, `alt`). Inversions and per-instrument voicings.
- **Scale** — major, natural / harmonic / melodic minor, all seven church modes, major + minor pentatonic, blues — across all 12 keys.
- **Note** — pick any pitch class and see every position on every instrument.
- **All** — every position on every instrument lit with its note name. Reference view for memorizing fretboard/keyboard.

### Connections
- **Diatonic chords in scale mode** — every scale shows its 7 diatonic 7th chords as Roman-numeral chips (`I / ii / iii / IV / V / vi / vii°`). Click one to highlight the triad *within the scale* (rest dimmed) without leaving scale view.
- **Scales containing this chord in chord mode** — pick a chord and see every scale it lives in, sorted by tightest fit. Click to switch to scale mode.
- **Click-to-focus** — click any key, fret, or pad to ring that pitch class on all three views, regardless of current selection.

### Display
- **Audio playback** — click any key, fret, or pad to hear it. ▶ Play button plays the current chord stacked or scale arpeggiated. Mute toggle.
- **Sheet music + guitar TAB** — compact book-style notation panels matching the current selection. TAB shows note letters under fret numbers.
- **Notes ↔ scale degrees** toggle — switch between note names (`C`, `D`, `E`) and scale-degree numbers (`1`, `2`, `b3`, `5`, `b7`).
- **Correct enharmonic per key** — F major shows `Bb`, not `A#`. Sharp keys use sharps, flat keys use flats.
- **Naturals overlay** — toggle yellow markers on every C/D/E/F/G/A/B position on the guitar fretboard for fretboard memorization.
- **Side-position dots** above the guitar fretboard at frets 3, 5, 7, 9, 12 (double), 15 — like a real guitar neck.

### Guitar specifics
- **5 CAGED scale shapes** for major-derived scales — pick `Shape 1 (E-shape)` through `Shape 5 (G-shape)` to filter the fretboard to one CAGED position. Modes share their parent major's shapes (D Dorian uses C-major shapes with D as root).
- **Hand-curated chord voicings** for common qualities (E-shape and A-shape barres), with a graceful "all matching positions" fallback for chord types without a defined shape.

### State
- **Shareable URLs** — every selection is reflected in the URL: `?mode=scale&root=D&type=dorian&pos=3` always opens the same view.

## Tech stack

- React 18 + TypeScript + Vite
- [`tonal`](https://github.com/tonaljs/tonal) for chord, scale, and interval math
- Web Audio API for synth playback
- SVG for all instrument views and notation
- React `useState` + URL sync for state — no backend, no database, no accounts

## Getting started

```bash
cd app
npm install
npm run dev
```

Open the URL Vite prints. To build for production:

```bash
npm run build
```

The output in `app/dist/` is a static site — host it anywhere (Cloudflare Pages, Vercel, Netlify, GitHub Pages, S3).

## Project layout

```
app/src/
├─ types.ts                       # all domain types
├─ App.tsx                        # composition root
├─ audio/synth.ts                 # Web Audio synth
├─ state/
│  ├─ useAppState.ts              # state + URL sync (transient state too)
│  └─ resolve.ts                  # selection → per-instrument notes + metadata
├─ theory/
│  ├─ chords.ts                   # tonal wrapper for chords
│  ├─ scales.ts                   # tonal wrapper for scales
│  ├─ degrees.ts                  # interval → "1, b3, 5, b7" labels
│  ├─ notes.ts                    # midi/note conversion + display-name builder
│  ├─ positions.ts                # 5 CAGED scale shapes + parent-major lookup
│  ├─ diatonic.ts                 # diatonic 7th chords for a scale
│  ├─ chord-scales.ts             # reverse: scales containing a given chord
│  └─ voicings/
│     ├─ piano.ts                 # closed / drop-2 / wide
│     ├─ guitar.ts                # shape realization + transposition
│     ├─ guitar-shapes.ts         # handcrafted barre-chord shapes
│     └─ push.ts                  # pitch-class flood (no voicing concept)
├─ instruments/
│  ├─ piano/{layout,PianoView}.tsx
│  ├─ guitar/{layout,GuitarView}.tsx
│  ├─ push/{layout,PushView}.tsx
│  └─ notation/
│     ├─ SheetMusicView.tsx       # 5-line staff with treble clef
│     └─ TabView.tsx              # 6-line guitar TAB
└─ components/SelectionBar.tsx
```

## URL schema

```
/?mode=chord&root=C&quality=maj7&inv=1&v=0
/?mode=scale&root=D&type=dorian&pos=3
/?mode=note&note=A
/?mode=all
```

Invalid or missing params silently fall back to defaults.

## Data sources

CAGED guitar scale shapes are transcribed from [guitarscale.org](https://www.guitarscale.org/) (image diagrams; manually verified for C major and F major). Music theory primitives (chord notes, scale notes, intervals, enharmonics) come from [tonal](https://github.com/tonaljs/tonal).

## Not included (yet)

- Reverse lookup (click positions to identify a chord by ear/touch)
- MIDI output to a hardware Push
- Alternate guitar tunings or other Push grid modes
- User accounts, saved favorites, shared progressions
- Ear-training games (planned)

## License

MIT — see [LICENSE](LICENSE).
