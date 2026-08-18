# 0009. Monorepo with a shared music package

**Status:** Accepted (2026-08-18). Supersedes the "Why two repos, and not a monorepo" decision recorded in `docs/companion-web-app.md`.

## Context

music-kb has a companion app, **Paul's Music Helper**
(`music-push-guitar-piano-helper`), a static SPA that carries the
music-practice half of this project with no backend, no LLM and no
database. The two shared a music-theory layer **by copying files between
repos**.

That was a deliberate choice, and the reasoning was recorded. It rested on
two facts about music-kb:

1. it was local-only, with no remote — giving it one just to deploy the
   web app meant publishing personal library data or rewiring the deploy;
2. it committed a seed archive containing that personal library data.

**Both facts stopped being true.** music-kb has a public remote at
`PaulBratslavsky/music-kb`, and the seed archive is neither committed nor
present in history. The decision outlived its premises.

The copying arrangement also stopped being quiet. It held for a long time
because the theory layer changed rarely — but in a single day of work the
two chord builders diverged into different gating, different colours, and
one of them broken, and the web app fell several features behind: no
triads or power-chords lesson, no minor-key substitutions, and chord chips
that had already been removed on the music-kb side. Every port cost a
round of manual import rewrites, which is where those bugs came from.

Measured before the move: 33 shared files, 22 byte-identical, 11 diverged
across 390 lines. The divergences split cleanly. Every *pure-logic* file
was already effectively one file — the differences were comment wording,
one blank line, one additive field, and one module where the web app was
simply behind. The genuine divergences were all React views, which differ
for real reasons: fork-only state, different CSS tokens, Tailwind classes
versus inline styles.

The layer is also framework-free: ~4,100 lines, no React import anywhere,
no import that escapes it, and exactly one runtime dependency (`tonal`).
It was a package in everything but name.

## Decision

**One repo. One copy of the theory layer, as a private workspace package.**

```
music-kb/
  packages/music/   @music-kb/music — theory, instrument layouts, shared types
  client/           TanStack Start + Strapi app
  web/              Paul's Music Helper; deploys to Vercel
  server/           Strapi
```

- The root gains real yarn workspaces (it previously had none — the
  scripts just `cd`ed). The per-package lockfiles are gone; the root
  lockfile is the only one.
- `packages/music` holds `theory/`, `instruments/*/layout.ts`,
  `state/gameModeStorage.ts` and `types.ts`, plus the tests for them. Its
  one rule: **no React, no DOM beyond `localStorage`.** That constraint is
  what makes it shareable.
- **The React views stay in the app that renders them.** `GuitarView`,
  `PianoView`, `BassView`, `PushView` and the notation views are not
  unified. The monorepo makes unifying them *possible* later; doing it
  during a structural move would bundle a risky refactor into a safe one.
- The web app came across with `git subtree`, so its 19 commits of history
  survive.

## Consequences

**What we gain.** Drift on the shared layer becomes *impossible* rather
than merely detectable — there is one file, so there is nothing to
diverge. A cross-app theory change is one commit instead of two plus a
manual port. The web app inherits the entire music-kb backlog of theory
work for free.

**What we accept.**

- A theory change now affects both apps at once. There is no version skew
  to hide behind: break the package and you break two builds. The 195
  tests in `packages/music` are the guard, and they run before either app's.
- Shared types are shared strictly. `AppState.chordDepth` exists only for
  the knowledge-base app; rather than make it optional and cost that app
  its exhaustive check, `web/` pins it to `'triad'`. Expect a few more of
  these.
- The root install is now the only install. `npm install` or a bare `yarn`
  inside a package fights the root lockfile.
- Two TypeScript majors coexist (client 5.7, web 6.0). yarn hoists one and
  nests the other; both builds are verified green. If this ever bites,
  converging on one version is the fix, not un-hoisting.

**What's deferred.**

- Unifying the instrument views.
- Converting the rest of `web/` from inline styles to Tailwind — partly
  done, proceeding opportunistically.
- The old repo stays archived, not deleted, until the Vercel deploy has
  run from `web/` for a couple of weeks.
