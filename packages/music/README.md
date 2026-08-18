# `@music-kb/music`

The music-theory layer, shared by the `music-kb` client and the light web app.

## The one rule

**Nothing in here may import React, or touch the DOM beyond `localStorage`.**

That constraint is what makes the package shareable at all: the two apps
render very differently — Tailwind vs inline styles, TanStack Router vs hash
routing — but they agree completely on what a G♯ diminished triad is. Views
stay in the app that renders them; the answers live here.

The only runtime dependency is `tonal`.

## Layout

| Path | What's in it |
|---|---|
| `src/types.ts` | The shared vocabulary — `PitchClass`, `ScaleType`, `ScalePosition`, … |
| `src/theory/` | Notes, scales, chords, diatonic harmony, voicings, CAGED boxes, triad and power-chord shapes |
| `src/instruments/*/layout.ts` | Pure geometry: which pitch sits at which fret or pad. No rendering. |
| `src/state/gameModeStorage.ts` | The one piece of persistence both apps share |

## Importing

Reach for the subpath you need — it keeps the import line self-documenting:

```ts
import { getScalePitchClasses } from '@music-kb/music/theory/scales';
import type { PitchClass } from '@music-kb/music/types';
```

`src/index.ts` re-exports the handful of primitives every caller touches, but
it is deliberately not a full barrel.

## Tests

```bash
yarn --cwd packages/music test    # 195 tests
yarn test                         # from the repo root: this package + the client
```

Tests for theory modules live beside them; the older `__tests__/` folder came
across with the move and stayed put rather than churn the diff.
