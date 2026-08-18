# Companion web app — Paul's Music Helper

music-kb ships two apps. **Paul's Music Helper** lives at `web/` in this
repo and is the **light version**: same music features, none of the
knowledge-base half. It is meant to be **complementary**, not a fork that
drifts.

It used to be its own repo (`music-push-guitar-piano-helper`), which is why
much of the history below is written as if there were two. It was folded
in on 2026-08-18 — see [ADR 0009](./adr/0009-monorepo-with-shared-music-package.md).

> **One-line rule:** the web app should have every music feature music-kb
> has, minus the knowledge-base half. If a feature works without a
> transcript, an LLM, or a database, it belongs in both.

## Why two apps

| | music-kb (`client/`) | Paul's Music Helper (`web/`) |
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

## One repo, one theory layer

**Decided 2026-08-18: one repo, and the shared code is a package, not a
copy.** See [ADR 0009](./adr/0009-monorepo-with-shared-music-package.md)
for the full reasoning; the short version is that the two-repo decision
rested on music-kb being local-only with a committed seed archive, and
neither is true any more.

```
music-kb/
  packages/music/   @music-kb/music — the shared layer
  client/           the knowledge-base app
  web/              Paul's Music Helper
  server/           Strapi
```

`packages/music` holds `theory/`, `instruments/*/layout.ts`,
`state/gameModeStorage.ts` and `types.ts`. Its one rule: **no React, no DOM
beyond `localStorage`.** Both apps import from it:

```ts
import { getScalePitchClasses } from '@music-kb/music/theory/scales';
import type { PitchClass } from '@music-kb/music/types';
```

**The React views are still per-app**, and deliberately so —
`GuitarView`, `PianoView`, `BassView`, `PushView` and the notation views
differ on state, palette and styling for real reasons. Unifying them is
possible now but is its own job.

### What this changes about porting

Nothing gets copied any more. A theory change lands once and both apps
have it. What still needs porting is **views and pages** — a new lesson, a
new panel — and for those, two of the three old mechanical fixes still
apply:

1. ~~Import paths~~ — gone. Both apps use `@music-kb/music/...` for theory.
   The client still uses its own `#/` alias for its own files.
2. **CSS tokens** — the palettes are named differently. Map:

   | music-kb (`client/`) | web app (`web/`) |
   |---|---|
   | `--ink` | `--text` |
   | `--ink-muted` | `--text-dim` |
   | `--line` | `--border` |
   | `--card` | `--panel` |
   | `--bg-subtle` | `--panel-2` |

   Shared and identical: `--accent`, `--root`, `--highlight`, `--fret-wood`,
   `--fret-line`, `--string`, `--natural`, `--white-key`, `--black-key`,
   `--focus`, `--game-*`.

   Two bugs came from missing this — a chord box drawn in invisible
   colours, and a PNG export that came out black-on-black because the
   exporter's `VAR_NAMES` list still named music-kb's tokens. **Grep any
   view you move for `var(--` and check every token exists on the other
   side:**

   ```bash
   grep -o 'var(--[a-z0-9-]*)' <file> | sort -u
   ```

3. **Styling** — music-kb uses Tailwind throughout. The web app now has
   Tailwind v4 too, so `className` markup survives the move; older parts of
   `web/` still use inline styles and get converted opportunistically.

## Divergences that are deliberate

- **Chord diagrams** render horizontally with the nut on the **left** in
  both apps, matching the full fretboard view.
- **Bass** floods every pitch-class match rather than pinning one voicing —
  bass plays single notes, so finding the nearest root anywhere on the neck
  is the point. Guitar pins the voicing; bass does not. This is intentional
  in both apps.
- **The web app has no tests of its own yet.** Every spec it had was a
  test of the theory layer, and those went into `packages/music` with the
  code they cover. `yarn --cwd web test` runs `--passWithNoTests` until
  component tests land there.

## Working on the web app

```bash
yarn install                  # from the repo root — one install, every workspace
yarn --cwd web dev --port 5180
yarn --cwd web build          # tsc -b && vite build — what Vercel runs
yarn test                     # packages/music + client + web
```

Never run `npm install` or a bare `yarn` inside `web/` — it fights the root
lockfile.

Use the **build**, not `tsc --noEmit`, as the gate: `--noEmit` has passed
here while `tsc -b` caught real type errors. The root `.githooks/pre-push`
hook runs the build before every push so a broken one never reaches Vercel.
On a fresh clone it is not active — enable it once:

```bash
git config core.hooksPath .githooks
```
