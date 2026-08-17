# Companion web app — Paul's Music Helper

music-kb has a sibling project: **[Paul's Music Helper](https://github.com/PaulBratslavsky/music-push-guitar-piano-helper)**
(repo `music-push-guitar-piano-helper`, working copy usually at
`../music-push-guitar-piano-helper`). It is the **light version** of this
app and is meant to be **complementary**, not a fork that drifts.

> **One-line rule:** the web app should have every music feature music-kb
> has, minus the knowledge-base half. If a feature works without a
> transcript, an LLM, or a database, it belongs in both.

## Why two apps

| | music-kb (this repo) | Paul's Music Helper (web app) |
|---|---|---|
| **Stack** | TanStack Start + Strapi + SQLite | React + Vite, static SPA |
| **Backend** | Strapi REST on :1350 | none |
| **Persistence** | Strapi content types | `localStorage` (`tv:videos`, `tv:loops`, `tv:progressions`) |
| **AI** | Ollama — summaries, chat, embeddings | none |
| **Deploy** | run locally | Vercel, auto-deploys on push to `main` |
| **Audience** | the full personal KB, one machine | anyone with a browser, zero setup |

The web app exists because the music-practice half of music-kb is useful on
its own and has no reason to require a database, a local LLM, or a
checkout. Someone should be able to open a URL, paste a YouTube link, loop
a section, and work out the chords.

## What ports, and what does not

**Port these** — they are pure music features with no backend dependency:

- The visualizer: piano / guitar / bass / Push, scales, chords, modes
- Circle of fifths, interval tools
- The chord builder: mode / root / quality / inversion / voicing / labels
- Detect chord (fretboard *and* keyboard)
- Chord progressions: build, name, save, export to PNG
- YouTube player + A/B loop sections
- Sections linked to progressions, bar-based chord timing, play-along
- **Lessons** — they are static content and belong in both
- Theory reference (the generated cheat sheet)
- The play-along scale board: key inference from a section's chords,
  guitarscale.org box positions, the chord-tone overlay that follows the
  playhead
- "Find the chords in a scale" — triads and power chords inside a box

**Do not port** — these are the knowledge-base half and need a backend, an
LLM, or a corpus:

- Feed, Search, Digests, Notes, video summaries and scores
- Per-video chat, `/api/ask`, embeddings and semantic search
- Music extraction (chords/key/techniques pulled from transcripts)
- The MCP server
- Anything reading `Video.transcriptSegments` or `summaryStatus`

## Target navigation

music-kb's nav is `Feed · Digests · Search · Builder · Theory · Lessons ·
Music · About · Settings`. The web app should carry the music subset:

```
Builder · Theory · Lessons · Music
```

As of 2026-08-16 the web app carries all four (it previously had only
`Visualizer · Music`). Remaining gaps:

| Section | music-kb | Web app | Notes |
|---|---|---|---|
| **Builder** | `/builder` | `#/` home | ✅ Parity. The home view *is* the builder; the nav label was renamed. |
| **Theory** | `/theory` — 5 tabs: tools, practice, visualizer, compose, **reference** | `#/theory` — 3 tabs: tools, practice, reference | ⚠️ Mostly there. Tools, the cheat sheet and the scale/chord finder are across. **Compose** is not; *visualizer* needs no port (it is this app's home), and Practice carries only the finder, not the ear trainer / progression player. |
| **Lessons** | `/lessons` (index + 6 lessons) | `#/lessons` | ✅ Parity — all 6 lessons, verified in light and dark. |
| **Music** | `/music`, `/video/$documentId` | `#/music`, `#/video/<id>` | ✅ Closest to parity already. |

The Tailwind v4 setup added for the lesson port means future ports can keep
their `className` markup instead of being converted to inline styles.

Routing in the web app is hash-based (`useHashRoute.ts`), so new sections
are `#/lessons`, `#/theory`, etc.

## Why two repos, and not a monorepo

**Decided: two repos, shared code is copied.** Considered and rejected:

- **Monorepo** (web app moved into music-kb, one copy of the theory layer
  in a workspace package). Cleanest on duplication, but music-kb is
  local-only with no remote, ships a Strapi backend, and has a seed archive
  committed at `server/seed-data/seed-from-yt-kb.tar.gz.bak`. Giving it a
  remote just to deploy the web app means either publishing personal
  library data or moving to a private repo and rewiring the deploy. Not
  worth it for a duplication problem this stable.
- **Extracting `theory/` as a shared package.** Kills ~1,700 duplicated
  lines, but adds a release step to every theory change and only covers the
  framework-free half — the instrument views still diverge on CSS tokens.

The duplication is real but it is *quiet*: the theory layer changes rarely
and most of it has stayed byte-identical on its own.

## Keeping them in sync

The two share a music-theory layer by **copying, not by a package**:
music-kb's `client/src/lib/music/` and the web app's `app/src/` (`theory/`,
`instruments/`, `state/`) are near-identical, and music-kb's copy is the
one that usually gets improved first.

Measured 2026-08-17 — the theory layer now moves **verbatim**. The four
modules added for the scale board (`key-inference`, `chord-overlay`,
`voicing-positions`, `scale-chord-finder`) and their 44 tests were copied
across with zero edits and passed first run, because `theory/` sits at the
same relative depth in both trees and imports `../types` either way.

Earlier measurement — **28 shared files, ~4,600 lines**, of which 16 are
byte-identical:

| Byte-identical (safe to `cp`) | Diverged (port by hand) |
|---|---|
| `theory/`: chords, scales, notes, degrees, chord-scales, parse-chord, positions, quality-labels, voicings/{guitar, piano, push} | `theory/`: detect-chord, diatonic, voicings/guitar-shapes |
| `instruments/*/layout.ts` (all four) | `instruments/`: GuitarView, PianoView, BassView, PushView, notation/* |
| `state/gameModeStorage.ts` | `state/`: resolve, useAppState · `audio/synth.ts` |

The diverged ones mostly differ for a reason — music-kb carries fork
additions (`cellColors`, `detectMode`, voicing `positions`) and the two
apps use different palettes. Diff before overwriting.

Porting is mostly `cp` plus two mechanical fixes:

1. **Import paths** — music-kb uses the `#/` alias, the web app uses
   relative paths.
2. **CSS tokens** — the palettes are named differently. Map:

   | music-kb | web app |
   |---|---|
   | `--ink` | `--text` |
   | `--ink-muted` | `--text-dim` |
   | `--line` | `--border` |
   | `--card` | `--panel` |
   | `--bg-subtle` | `--panel-2` |

   Shared and identical: `--accent`, `--root`, `--highlight`, `--fret-wood`,
   `--fret-line`, `--string`, `--natural`, `--white-key`, `--black-key`,
   `--focus`, `--game-*`.

Two bugs have already come from missing step 2 — a chord-box drawn in
invisible colors, and a PNG export that came out black-on-black because
the exporter's `VAR_NAMES` list still named music-kb's tokens. **When you
copy a file, grep it for `var(--` and check every token exists on the other
side:**

```bash
grep -o 'var(--[a-z0-9-]*)' <file> | sort -u
```

Styling differs too: music-kb uses Tailwind classes, the web app uses
inline styles. Components that carry `className="..."` need converting.

## Divergences that are deliberate

- **Chord diagrams** render horizontally with the nut on the **left** in
  both apps, matching the full fretboard view.
- **Bass** floods every pitch-class match rather than pinning one voicing —
  bass plays single notes, so finding the nearest root anywhere on the neck
  is the point. Guitar pins the voicing; bass does not. This is intentional
  in both apps.
- **Test coverage is lopsided.** The web app has vitest configured but only
  two specs (`voicings`, `display-map`); music-kb has a much larger suite.
  Pure logic ported to the web app (e.g. `activeIndex` for bar timing) is
  covered on the music-kb side — worth porting those specs across when the
  logic moves, since they run unchanged.

## Working on the web app

```bash
cd ../music-push-guitar-piano-helper/app
npm install
npm run dev -- --port 5180
npm run build          # tsc -b && vite build — what Vercel runs
```

A `.githooks/pre-push` hook runs the production build before every push so
a broken build never reaches Vercel. On a fresh clone it is not active —
enable it once:

```bash
git config core.hooksPath .githooks
```
