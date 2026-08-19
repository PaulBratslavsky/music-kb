# SSR falls back to client rendering on `/feed` and `/learn`

**Status:** ✅ Fixed — by dropping the Yarn workspace so each package installs
its own dependencies. Kept as the record of why the repo is laid out that way.
**Was:** a degradation, not a breakage — both pages rendered, just in the
browser instead of on the server.
**Introduced by:** adding `client/` to the Yarn workspace.
**Fixed by:** `refactor: give each package its own install`.

## Symptom

Loading `/feed` or `/learn/$videoId` emits a page error and TanStack Start
abandons the server render:

```
Switched to client rendering because the server rendering errored:
Cannot read properties of null (reading 'useCallback')
```

`/search` and `/settings` are clean. Nothing user-visible breaks — the
fallback is the framework working as designed — but SSR is silently off on
the two most important pages, costing first paint and any SEO value.

## Cause

React requires exactly one **instance**. Not one version — one copy. Two
byte-identical copies still break it, because the renderer and the hook must
share the same module object.

There are two copies of React 19.2.8 in the tree, and the failing frame is
where they meet:

```
useCallback   node_modules/@radix-ui/react-compose-refs/node_modules/react   <- instance B
useComposedRefs  node_modules/@radix-ui/react-compose-refs/dist/index.mjs
Slot.Slot        client/node_modules/@radix-ui/react-slot/dist/index.mjs
renderWithHooks  client/node_modules/react-dom/...                           <- instance A
```

`react-slot` resolves from `client/node_modules` and uses instance A.
It imports `@radix-ui/react-compose-refs`, which is **absent from
`client/node_modules`**, so resolution walks up to the workspace root — and
that copy carries its own nested React, instance B. Hooks from B run inside a
render driven by A, so the dispatcher is null. `react-primitive` and
`react-context` sit in the same position.

**Both copies are 19.2.8.** This is not a version conflict at the point of
failure; it is instance identity. (An earlier draft of this doc said
"React 18 vs 19" — wrong, and the distinction matters, because it is why no
amount of version pinning fixes it.)

### Why a second copy exists at all

The version conflict is the *upstream* cause, one step back:

- `server/` (Strapi) requires React **18** — `@strapi/admin` peers
  `^17.0.0 || ^18.0.0`, so React 19 is not an option there.
- `client/` requires React **19**.
- They share one workspace root, so React 18 hoists to it and 19 lives in
  `client/node_modules`.
- Packages at the root that peer on React (`compose-refs` peers
  `^16.8 || ^17.0 || ^18.0 || ^19.0`) but are consumed by React-19 client code
  get their own nested 19 — a second instance.

### It is new, and it came from this branch

The pre-workspace lockfile (`client/package-lock.json` at `6613071`) proves
the old standalone install had **one React (19.2.5) and zero nested copies**.
A standalone project installs everything into its own folder, so there is no
shared root to resolve up into and nothing to collide with.

Two changes had to coincide:

1. **`client/` joined the workspace**, creating a shared root for Strapi's
   React 18 and the client's 19 to fight over.
2. **radix-ui 1.4.3 → 1.6.7** split into small sub-packages (`compose-refs`,
   `primitive`, `context`). They do not appear in the old lockfile at all;
   these are the packages that landed at the root and picked up their own
   React.

Neither alone would have done it.

## What was tried — three attempts, all reverted

**1. `workspaces.nohoist` for the server's React.** `yarn why` then reported
the intended shape (19 hoisted, 18 nested under the server), but Strapi would
not boot: `Cannot find module '@strapi/strapi/package.json'` — the reshuffle
moved `@strapi/strapi` under `server/node_modules` while `@strapi/core`
stayed at the root.

**2. Vite `resolve.dedupe`, then `resolve.alias`.** dedupe did not collapse
the nested copy. Aliasing `react` to a package *directory* made Vite evaluate
React's CJS entry as ESM and took the dev server to 500
(`ReferenceError: module is not defined`).

**3. Vite `ssr.noExternal: [/@radix-ui\//]`.** Refuted — identical stack,
unchanged. This is the informative failure: **bundler configuration cannot
fix this.** The duplication is physical, in `node_modules`, and Vite's SSR
path resolves through Node regardless of `resolve.*`.

## Fix (applied)

Stop `server/` and `client/` sharing an install root. Drop the `workspaces`
field so each package installs its own dependencies, and link the shared
theory layer explicitly:

```json
"@music-kb/music": "link:../packages/music"
```

`link:` symlinks in Yarn 1, so edits to `packages/music` stay live in both
consumers — the behaviour workspaces gave. (`file:` *copies* and goes stale;
do not use it here.)

This makes the collision structurally impossible rather than patched: Strapi
can stay on React 18 indefinitely and never share a resolution root with the
frontend. `client`, `web` and `packages/music` all agree on React 19, so
nothing is lost between them.

Costs: four installs instead of one (slower CI, more disk) and four lockfiles
to keep current.

**Do this on its own branch.** It changes the install layout, which is hard
to bisect if bundled with feature work. It also requires updating
`vercel.json` — `installCommand` currently runs `yarn install
--frozen-lockfile` at the root, which would install nothing once workspaces
are gone, and `web` is the only public deployment. Verify against a Vercel
preview before merging.

## Verifying a fix

```bash
# from client/, with the stack running
node -e "
const { chromium } = require('@playwright/test');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('ERR', e.message.split('\n')[0]));
  for (const u of ['/feed','/search','/settings','/learn/<id>'])
    { await p.goto('http://localhost:3015'+u, {waitUntil:'networkidle'}); }
  await b.close();
})();"
```

Clean output on all four means fixed — which is the current state, verified on
all four routes with zero `Switched to client rendering` in the dev server log.

`e2e/notes-editor.spec.ts` briefly filtered this error out while the bug was
open. That filter is **gone**: its console guard now catches everything, so a
regression here fails that spec rather than passing quietly.
