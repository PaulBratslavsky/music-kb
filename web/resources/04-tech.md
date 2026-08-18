# Technology Decisions

Tech choices made to serve the requirements in `03-requirements.md`. Each decision links back to the requirement(s) it supports.

## Stack summary

| Layer | Choice |
|---|---|
| App architecture | Single-page web app, fully client-side, no backend |
| Frontend framework | React 18+ with TypeScript |
| Build tool | Vite |
| Rendering | SVG for all three instrument views |
| Music theory | `tonal.js` library + thin custom layer for voicings and instrument layout math |
| State management | React `useState` + URL state (custom hook or React Router) |
| Hosting | Vercel or Netlify (free tier) |
| Package manager | npm or pnpm |

## Decision 1 — App architecture: client-side SPA

**Choice**: Single-page web app, runs entirely in the browser, no backend.

**Why**:
- Desktop-first, no offline requirement, single user, no persistence needed (per `03-requirements.md`).
- The app has no server-side concerns: no auth, no database, no API calls, no user data.
- Static deployment means zero hosting cost and trivial sharing later.

**Alternatives rejected**:
- *Electron / Tauri desktop app* — overkill for a stateless visual tool. No benefit.
- *Mobile-native (iOS/Android)* — explicitly out of scope for MVP.

## Decision 2 — Frontend framework: React + TypeScript + Vite

**Choice**: React 18+, TypeScript, Vite as the build tool.

**Why**:
- Three synchronized instrument views responding to the same selection is the exact shape of a React app: one source of truth, multiple components render from it.
- TypeScript catches errors around structured music data (chords, scales, notes have well-defined shapes).
- Vite gives fast dev startup and zero config for a modern React + TS project.
- Large ecosystem and excellent AI-assist coding support if needed.

**Alternatives rejected**:
- *Svelte* — lighter, but smaller ecosystem and less universal.
- *Vue* — solid choice, but no specific advantage over React here.
- *Vanilla JS* — synchronizing three views by hand will get messy quickly.

## Decision 3 — Instrument rendering: SVG

**Choice**: SVG for the piano, guitar fretboard, and Push grid.

**Why**:
- All three views are essentially static diagrams with note markers overlaid. SVG is purpose-built for this.
- SVG elements are DOM nodes, so React drives them declaratively the same way it drives HTML.
- Crisp at any zoom level. No pixel/canvas pressure.
- Easy to make interactive (each pad/key/fret is a clickable element).

**Alternatives rejected**:
- *Canvas* — needed only for high-frame-rate rendering; we have none of that.
- *HTML/CSS* — workable for the piano but awkward for guitar fretboard and Push grid geometry.

## Decision 4 — Chord and scale data: `tonal.js` + custom voicing layer

**Choice**: Use [`tonal.js`](https://github.com/tonaljs/tonal) for chord/scale/note theory. Write a thin custom layer on top for (a) voicing selection and (b) mapping notes to instrument-specific physical positions.

**Why**:
- `tonal.js` is a mature, well-maintained TypeScript music theory library. It already solves: chord construction from root + quality, inversions, scale generation, mode handling, note enharmonics — all the things we'd otherwise have to build and debug.
- It's a local library (no API calls), so it's fast and works offline once the page loads.
- The *interesting* code in this product isn't "what notes are in Cmaj7" — that's solved. The interesting code is voicing selection and instrument layout math, which we keep custom.

**Custom layer responsibilities**:
- Given a chord's notes, pick 2–3 sensible voicings per instrument.
- Map any note to its piano key positions (across visible octaves).
- Map any note to all its guitar fretboard positions (within visible frets, standard tuning).
- Map any note to its Push grid pad positions (chromatic mode, fourths layout).

**Alternatives rejected**:
- *Static JSON data file* — works, but rigid and painful to extend.
- *Build music theory from scratch* — fun but wasteful when `tonal.js` exists.

## Decision 5 — State management: `useState` + URL state

**Choice**: React's `useState` for in-memory state. URL state via a small custom hook (or React Router's `useSearchParams`) so the current selection lives in the URL.

**Why**:
- Total app state is small: root note, chord quality (or scale type), inversion index, voicing index, view mode. ~5–10 values.
- URL state is a hard requirement for bookmarking and sharing views (`03-requirements.md`).
- No need for Redux, Zustand, or context-heavy patterns at this scale.

**Alternatives rejected**:
- *Redux / Zustand* — over-engineered for this much state.
- *Context API only* — fine, but URL sync is a hard requirement, so we need URL handling either way.

## Decision 6 — Hosting & deployment: Vercel or Netlify

**Choice**: Vercel or Netlify, free tier.

**Why**:
- Static site, no backend, deploys from a Git push, free.
- Both have effectively identical UX for this case.
- Custom domain is easy to add later.

**Alternatives rejected**:
- *Self-hosted (S3, Cloudflare Pages, etc.)* — also fine, but no advantage over the simpler choice.

## Things explicitly NOT in the stack (and why)

- **No backend / server / API** — the app is fully static. No need.
- **No database** — no persistence required for MVP.
- **No authentication** — single user, no accounts.
- **No CSS framework (Tailwind, etc.) committed yet** — small enough app that vanilla CSS or CSS Modules is fine. Can add Tailwind later if we want; not a foundational choice.
- **No state library (Redux, Zustand)** — too small for it.
- **No analytics, logging, error tracking** — single user, MVP. Add later if shipped publicly.
- **No testing framework committed yet** — Vitest is the obvious pick if/when we want unit tests for the voicing/layout layer; not foundational.

## Open implementation questions (to resolve in stage 5)

- Exact data shapes for `Note`, `Chord`, `Scale`, and instrument layouts (`tonal.js` provides some, but our custom voicing/layout layer needs its own types).
- The voicing selection algorithm — how to pick "good" voicings deterministically.
- Component decomposition (how the React tree is structured).
- URL schema (what query params look like, e.g., `?chord=Cmaj7&inv=1&v=0`).
