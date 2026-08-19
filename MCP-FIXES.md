# MCP fixes — zod description drop + boot safety

Branch: `refactor/monorepo-shared-music` (not `main`; no new branch created per instructions since we were already off `main`).

## FIX 1 — `.describe()` text silently dropped

### What changed

The task's pointer named only `server/src/mcp/adapter.ts:16` and
`server/src/mcp/registry.ts:1`, but the actual `.describe()` calls live in
`server/src/mcp/tools/*.ts` (24 files), which also imported `z` from
`@strapi/utils`. Switching only the two named files would not have fixed
anything — the schema objects with the descriptions are built in the tool
files, not in adapter.ts/registry.ts. So all 26 files that imported
`z from '@strapi/utils'` were switched to `z from 'zod'` (the app's own
`^4.3.5` dependency in `server/package.json`):

- `server/src/mcp/adapter.ts`
- `server/src/mcp/registry.ts`
- all 24 files in `server/src/mcp/tools/*.ts`

This matches the pattern in the sibling plugin
(`strapi-plugin-ai-sdk-yt-transcripts/server/src/tools/*.ts` and
`strapi-plugin-ai-sdk/server/src/mcp/register-tools.ts`), which already
does `import { z } from 'zod'` and casts at the `registerTool` call site.

`server/src/mcp/catalog.ts` doesn't import `z` at all — it only wires up
`title`/`access`/tool references — but its header comment repeated the
stale "zod 3 vs zod 4" reasoning and was corrected to describe the actual
mechanism.

### Why it actually broke

`@strapi/utils` bundles its **own physically separate npm copy** of zod
(`@strapi/utils/node_modules/zod@3.25.67`, which internally is Zod 4 code
reached via the `zod/v4` subpath — the version string is misleading).
Zod 4 stores `.describe()` text in a per-module-instance **global
registry**. The MCP SDK (`@modelcontextprotocol/sdk`) declares `zod` only
as a **peer dependency** — it has no nested copy of its own — so it
resolves to whatever `zod` is hoisted at the workspace root, i.e. the
app's own top-level `zod@4.4.3`. When a tool schema was built with
`@strapi/utils`'s separate zod copy, the SDK's registry lookup (using a
*different* zod instance) found no description and silently dropped it.
Building schemas with the app's own top-level `zod` fixes this because
it's the *same physical package* the SDK's peer dependency resolves to.

### Before/after proof (real production schema)

Ran via `tsx` against `server/src/mcp/tools/get-video.ts`'s actual
`getVideoTool.schema` (field `videoId`, described as `"Either the
youtubeVideoId or the Strapi documentId."`), converted with
`z.toJSONSchema(...)`:

```
=== BEFORE: schema built with @strapi/utils re-exported z, converted with app zod (the instance the MCP SDK peer-resolves to) ===
[BEFORE (schema via @strapi/utils z)] {"type":"string","minLength":1} -> survived: false

=== AFTER: schema built with the app top-level zod (the fix) ===
[AFTER (schema via app zod)] {"type":"string","minLength":1,"description":"Either the youtubeVideoId or the Strapi documentId."} -> survived: true

=== Real catalog schema, post-fix (server/src/mcp/tools/get-video.ts) ===
[AFTER (real getVideoTool.schema, field "videoId")] {"type":"string","minLength":1,"description":"Either the youtubeVideoId or the Strapi documentId."} -> survived: true
```

The `BEFORE` case used a schema built with `@strapi/utils`'s `z` (same
construction the code did before this fix); the description is silently
absent from the converted JSON Schema. The `AFTER` case is the real,
currently-shipping `getVideoTool.schema` — description present.

The throwaway proof script (`server/_prove_describe.mjs`) was deleted
after use; it is not part of the diff.

### Type issues hit when switching zod instances

One, at the `registerTool(...)` call in `server/src/mcp/adapter.ts`:

```
error TS2769: No overload matches this call.
  ...
  Type 'ZodObject<...>' (app's zod, from node_modules/zod)
  is not assignable to type 'ZodObject<...>' (@strapi/utils's zod, from
  node_modules/@strapi/utils/node_modules/zod)
  ... Property 'id' is missing in type '$ZodTypeInternals<unknown, unknown>'
      but required in type '$ZodTypeInternals<unknown, unknown>'.
```

`@strapi/types`' ambient `McpService.registerTool` signature
(`node_modules/@strapi/types/dist/modules/mcp.d.ts`) is typed against
`@strapi/utils`'s bundled zod (`import { z } from '@strapi/utils'` at the
top of that file). That's a third-party ambient type we can't edit, and
the two zod packages are genuinely different major/minor builds with
different internal shapes (`$ZodTypeInternals` gained a required `id`
field between them) — so there is no way to make the app's schema
structurally satisfy that ambient type without either a cast or
reintroducing a second, description-losing schema (which is the bug this
fix removes). Investigated forcing a single deduped `zod` install across
the workspace via yarn resolutions instead of casting, but rejected it:
`@strapi/utils` requires the exact `zod/v4` subpath of its **pinned**
3.25.67 release, which is an internal implementation dependency used
elsewhere by Strapi core (not just the MCP tool surface); forcing it onto
a different major zod install risks breaking Strapi's own internal
validation in ways well outside this task's scope, for no gain over a
narrow cast.

The fix: a narrowly-scoped `as any` cast on just the two schema resolver
functions (`resolveInputSchema`, `resolveOutputSchema`) inside
`registerDomainTool`, not on the whole `registerTool(...)` call — so
`name`/`title`/`description`/`auth`/`createHandler` are still fully
type-checked. This mirrors (but narrows) the cast the sibling plugin
(`strapi-plugin-ai-sdk/server/src/mcp/register-tools.ts`) uses for the
exact same seam. Documented inline in `adapter.ts` with the reasoning
above.

`npx tsc --noEmit -p tsconfig.json` passes clean after the fix.

### Docs corrected

- `docs/mcp-official-plugin-migration-plan.md` — the file already had one
  self-correction banner (2026-08-17) for the "zod 3" misconception, but
  that correction *itself* concluded "so keep using `@strapi/utils`'s z" —
  the exact wrong conclusion that caused this bug. Added a second, dated
  correction (2026-08-18) explaining the actual per-instance-registry
  mechanism and pointing at the real fix.
- `docs/adr/0008-official-strapi-mcp-over-hand-rolled.md` — same pattern:
  the "load-bearing constraint" section's 2026-08-17 correction reached
  the wrong conclusion ("build MCP schemas with `z` from `@strapi/utils`").
  Struck that conclusion and added a 2026-08-18 correction with the actual
  mechanism. Also corrected two now-stale bullets under "Consequences" that
  described a "dual zod versions" / "zod-3 entry in catalog.ts" state that
  no longer exists (there's one schema declaration per tool now, on the
  app's zod).

## FIX 2 — boot safety

### What changed

`server/src/mcp/adapter.ts`, `registerDomainTool`:
- Wrapped the synchronous `registerTool({...})` call itself (not just the
  `createHandler` body inside it) in `try/catch`.
- On failure: `strapi.log.warn('[music-kb mcp] Skipped tool "<name>" —
  registration failed: <message>')`, then returns `false`.
- On success: returns `true`. Function signature changed from
  `void` to `boolean` so the caller can build an accurate count.

`server/src/mcp/index.ts`, `registerOfficialMcpTools`:
- The loop over `domainTools` now counts only tools where
  `registerDomainTool(...)` returned `true`; the final log line reports
  `Registered <succeeded>/<total> custom tool(s)` instead of always
  claiming the full catalog length regardless of failures.
- The whole body after the `isEnabled()` guard (permission registration +
  the tool-registration loop) is wrapped in an outer `try/catch` that logs
  at `strapi.log.error` and returns normally on failure — so a failure
  degrades to "MCP tools unavailable" rather than aborting
  `register()` (and Strapi's boot, since `registerOfficialMcpTools` is
  awaited directly from `src/index.ts` `register()`).

This mirrors `strapi-plugin-ai-sdk/server/src/mcp/register-tools.ts` +
`index.ts`'s per-tool try/catch and outer backstop pattern.

## Verification

- **Type-check:** `npx tsc --noEmit -p server/tsconfig.json` — passes,
  zero errors.
- **Description-survival proof:** see above — demonstrated with the real
  `getVideoTool.schema` from `catalog.ts`'s dependency chain, before and
  after.
- **Tests:** none exist for `server/`. The workspace root `test` script
  (`package.json`) only runs `packages/music`, `client`, and `web`; there
  is no `server` test script and no `*.test.ts` files under `server/`.
  Not adding a test framework per instructions — nothing was run because
  nothing exists to run.
- **Not verified (explicitly out of scope):** did not start, restart, or
  hit a live `/mcp` endpoint — static verification and the throwaway
  `tsx` script only, per instructions (shared ports in use by other
  work). The fix is verified at the schema-conversion level (the exact
  mechanism of the bug), not via an end-to-end MCP client round-trip.
- **Not verified:** the Fix 2 boot-safety paths (duplicate tool name,
  missing `auth.policies`) were not exercised against a live
  `strapi.ai.mcp.registerTool` — no local harness was built to simulate a
  throwing `registerTool`. The try/catch placement was checked by reading
  `node_modules/@strapi/core/dist/services/mcp/tool-registry.js` to
  confirm `registerTool` synchronously calls the underlying capability
  registry's `.define()`, which is what throws per the task description,
  and by structural comparison against the sibling plugin's
  already-working equivalent.

## Files changed

- `server/src/mcp/adapter.ts`
- `server/src/mcp/registry.ts`
- `server/src/mcp/catalog.ts` (comment only)
- `server/src/mcp/index.ts`
- `server/src/mcp/tools/*.ts` (24 files, import switch only)
- `docs/mcp-official-plugin-migration-plan.md`
- `docs/adr/0008-official-strapi-mcp-over-hand-rolled.md`
