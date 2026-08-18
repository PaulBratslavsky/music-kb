# Migration plan: hand-rolled MCP server → official Strapi MCP plugin

**Status:** ✅ COMPLETE (2026-06-14). All phases shipped — Strapi 5.48, official `/mcp` enabled, all 24 tools ported app-level and verified live (read + write round-trip), client docs updated, hand-rolled `/api/mcp` retired. Decision recorded in [ADR 0008](./adr/0008-official-strapi-mcp-over-hand-rolled.md). Plan retained below as the execution record. (Created 2026-06-12.)
**⚠️ Two "verified" claims below are wrong.**

- **(corrected 2026-08-17):** this plan asserts `@strapi/utils` ships
  **zod 3** and that every schema must therefore be **re-declared** in it.
  Strapi actually re-exports **zod v4** (`zod/v4`, from its pinned
  `zod@3.25.67` — a transitional release that ships v4 under that version
  string). The re-declaration was reverted — schemas are now declared once,
  on the tool.
- **(corrected 2026-08-18, supersedes the 2026-08-17 note above):** that
  correction still concluded wrong — it kept "use `@strapi/utils`'s `z`" as
  the rule, on the theory that only a minor-version *skew* between two zod-4
  instances mattered. That's not the mechanism. Zod 4 stores `.describe()`
  text in a **per-module-instance global registry**. `@strapi/utils` bundles
  its **own separate copy** of zod (not a version skew of the app's copy —
  a different physical package under `@strapi/utils/node_modules/zod`), and
  the MCP SDK converts schemas with its **own** bundled zod instance, which
  cannot see a description recorded in a different instance's registry. Any
  schema built with `@strapi/utils`'s `z` silently loses every
  `.describe()` string on the way to an MCP client — verified empirically
  (see `server/src/mcp/adapter.ts` and `server/src/mcp/registry.ts`). The
  fix actually shipped: tool schemas are built with the **app's own
  top-level `zod` dependency** (`^4.3.x`), not `@strapi/utils`'s re-export.
  `@strapi/strapi`'s ambient `registerTool` type still expects a
  `@strapi/utils`-flavored `ZodObject`, which is a distinct nominal TS type
  from the app's zod even though both are runtime-compatible Zod 4 — that
  seam is bridged with a narrowly-scoped type cast at the `registerTool`
  call site (not a rewrite of the schemas).

The text below is left as-written as a record of what we believed at the
time. See [ADR 0008](./adr/0008-official-strapi-mcp-over-hand-rolled.md)
for the corrected reasoning.
**Source guide:** Paul's own write-up — [`strapi-mcp-demo-and-tool-extension/BLOG-strapi-mcp-custom-tools.md`](https://github.com/PaulBratslavsky/strapi-mcp-demo-and-tool-extension/blob/main/BLOG-strapi-mcp-custom-tools.md) — plus the [official docs](https://docs.strapi.io/cms/features/strapi-mcp-server).

## Why migrate

The custom server (`server/src/mcp/`, ~2.5K LOC) owns transport, session
handling, auth, and a tool registry that the official feature now provides
for free. After migration, the only code we keep is **domain tool logic**
(BM25 search, hybrid retrieval, digest generation, music data, citation
verification) registered through `strapi.ai.mcp.registerTool` — everything
else (Streamable HTTP endpoint, auth, CRUD tools, schema plumbing) is
Strapi's problem. The blog's framing applies directly: *custom tools only
add domain-specific logic; no need to manage MCP server lifecycle or HTTP
transport yourself.*

## Hard prerequisite: Strapi upgrade 5.42.0 → ≥ 5.47.0

The official MCP server ships **built into Strapi 5.47.0+** (no separate
package). We run 5.42.0. The upgrade is its own change with its own risks
and must land (and soak for a few days of normal use) before any MCP work:

- [ ] `yarn upgrade @strapi/strapi@^5.47` (+ matching `@strapi/*` peer
      packages) in `server/`.
- [ ] Boot against dev SQLite; watch for migration output. Snapshot first:
      `./db-backup.sh`.
- [ ] Run the client suite with the stack up (videos.smoke.test.ts is the
      live-contract gate — it now actually runs, see 2026-06-12 tag fix).
- [ ] Verify the custom `/api/mcp` endpoint still works post-upgrade (it
      keeps serving production traffic until phase 4).
- [ ] Boot once in production mode against Neon before calling it done
      (the dev/prod split means SQLite success proves nothing about pg).

## What the official plugin gives us vs. what must port

Enabled via `config/server.ts` → `mcp: { enabled: true }`. Endpoint:
`http://localhost:1350/mcp` (streamable-http). Auth: **Admin API tokens**
(Settings → Admin Tokens) — *not* Content API tokens, *not* our current
custom bearer secret.

Built-in tools are auto-derived CRUD per content type:
`list_<type>`, `get_<type>`, `create_<type>`, `update_<type>`,
`delete_<type>` (+ publish/unpublish where Draft & Publish is on — ours is
off everywhere).

### Tool disposition table (24 custom tools today)

| Custom tool | Disposition | Notes |
|---|---|---|
| `listVideos` | **Retire** → `list_video` | Built-in filtering covers the use. |
| `getVideo` | **Retire** → `get_video` | We strip `transcriptSegments` for size; the built-in returns everything — if context bloat bites, re-add as a thin custom wrapper later. |
| `addVideo` | **Retire** → `create_video` | The dedupe + youtubeVideoId guard lives in documents middleware (`src/index.ts` Rule 1), which built-in tools also pass through. Verify in phase 1. |
| `saveSummary` | **Port** | Writes derived fields and must keep the unified-score-writer invariant (finalScore is server-derived); a raw `update_video` would let a frontier model write inconsistent scores. |
| `listTranscripts` / `getTranscript` | **Retire** → built-ins | Plain reads. |
| `findTranscripts` | **Port** | Search semantics beyond built-in filters. |
| `searchTranscript` | **Port** | BM25 over the stored index (`server/src/services/bm25-search.ts`). |
| `crossSearchTranscripts` | **Port** | Multi-video BM25. |
| `fetchTranscript` | **Port** | Hits youtubei.js — pure domain logic. |
| `searchVideos` | **Port** | Hybrid retrieval. |
| `relatedVideos` | **Port** | Embedding cosine + boosts. |
| `reindexEmbeddings` | **Port** | Must keep using `server/src/mcp/utils/embeddings.ts` text-builder (v3, music-aware) so vectors match the client's. |
| `listTags` / `tagVideo` / `untagVideo` | **Retire** → `list_tag` + `update_video` | Tag slug derivation lives in documents middleware (tag.create Rule 2) so built-in creates inherit it. Confirm relation updates through `update_video` are ergonomic; if not, keep `tagVideo` as a porting candidate. |
| `saveNote` | **Retire** → `create_note` | |
| `aggregateByTag` / `listUntagged` / `libraryStats` | **Port** | Aggregations; exactly the blog's `get_stats_overview` shape. |
| `generateDigest` | **Port** | Multi-step domain pipeline. |
| `getReadableArticle` | **Retire** → `get_video` (field) or **Port** if the trigger-generation side matters via MCP. Decide in phase 2. |
| `getMusicData` | **Port** | Extraction blob + Loops join. |
| `verifyCitations` | **Port** | BM25 grounding; shipped 2026-06-12. |

Net: ~9 retire, ~13 port. Ported tools are mostly `execute` bodies that
already take `(args, { strapi })` — the adaptation per tool is mechanical
(see registration shape below).

## Registration mechanics (from the blog — follow exactly)

Custom tools live in a **local plugin** (`server/src/plugins/music-kb-mcp/`)
and register during the plugin's `register()`/`bootstrap()` phase — tools
lock when the MCP server starts; late registration is silently useless.

Custom tools register during the plugin's `register()`/`bootstrap()` phase
via `strapi.ai.mcp.registerTool` — tools lock when `strapi.ai.mcp.start()`
runs, and registering after throws. Prefer `bootstrap()` for any tool that
touches synced content-types, permissions, or DB state.

> **Authoritative API** — verified against the installed build
> `@strapi/types/dist/modules/mcp.d.ts` (Strapi 5.48, MCP SDK 1.29.0), not
> just the blog. The blog's prose is right in spirit but the handler/return
> shapes below are stricter than it shows.

```ts
import { z } from '@strapi/utils'; // NOT the `zod` package — version-mismatch foot-gun

strapi.ai.mcp.registerTool({
  name: 'search_transcript',
  title: 'Search a video transcript',
  description: '…when-to-use guidance, same care as today…',
  resolveInputSchema: (ctx) => z.object({ videoId: z.string(), query: z.string() }),
  // REQUIRED, and must be a z.ZodObject (top-level object). Tools that
  // return a top-level array today (libraryStats lists, search hits) must
  // wrap: z.object({ results: z.array(...) }).
  resolveOutputSchema: (ctx) => z.object({ /* … */ }),
  // Access is a discriminated union: EITHER devModeOnly:true (dev-only,
  // gated by `autoReload` = `strapi develop`) OR auth with ≥1 policy.
  auth: { policies: [{ action: 'plugin::content-manager.explorer.read' }] },
  createHandler: (strapi, ctx) => async ({ args, extra }) => {
    // ctx.userAbility — enforce field/entity perms like an HTTP controller.
    // ctx.user.id    — for setCreatorFields on write tools.
    // args is typed from resolveInputSchema; `never` (omit it) if no input.
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result, // REQUIRED on success
    };
    // Error path is a SEPARATE branch of the union:
    //   return { content: [{ type: 'text', text: msg }], isError: true };
    // success → structuredContent present, isError absent;
    // error   → isError:true present, structuredContent ABSENT. Not optional.
  },
})
```

Non-negotiables (verified):

- **`z` from `@strapi/utils`, never the `zod` package — and this is not
  cosmetic in music-kb.** Verified versions: the app's `zod` is **4.3.6**,
  `@strapi/utils`'s bundled zod is **3.25.67**. A zod-4 schema object handed
  to the official API (zod-3) breaks schema conversion. Consequence for the
  port: each tool's `execute` body is reusable as-is (it operates on plain
  parsed args + `strapi`), but **every input/output schema must be
  re-declared with `@strapi/utils` z (zod-3)** — the legacy `def.schema`
  (zod-4) cannot be passed through. The adapter reuses `execute`; schemas
  are hand-written in z3.

  > **⚠️ Wrong on the *why*, and the re-declaration was reverted** — see the
  > correction in the status banner at the top of this file, and ADR 0008.
- **Handler takes one object `{ args, extra }`** — not a positional `input`.
  `args` is `never` when there's no input schema (omit it).
- **Return is a strict discriminated union.** Success: `{ content,
  structuredContent }`. Error: `{ content, isError: true }`. You cannot
  carry `structuredContent` on an error or omit it on success.
- **`resolveOutputSchema` is required and must be a `z.ZodObject`.** Writing
  these for the ~13 ported tools is the bulk of the work; top-level arrays
  must be wrapped in an object. Budget it; don't hand-wave it.
- **Enable via `server.mcp.enabled: true`** in `config/server.ts`. Endpoint
  is `/mcp`. Tunables: `server.mcp.connectTimeoutMs` (5s default),
  `server.mcp.requestTimeoutMs` (60s default) — fine for our fast retrieval
  tools; the slow extraction path is in-app only and never an MCP tool.
- **Plugin loads from `dist/`** — `yarn build` (server) after source changes;
  a stale build silently serves old tools.
- `auth.policies` is a **non-empty tuple**, evaluated **OR**; action strings
  must be exact (`plugin::content-manager.explorer.read` / `.create` / …).
- Permission gating is strict: the admin token's permissions decide which
  tools even *appear* in `tools/list`. Mint a scoped token once parity is
  proven.
- **No mechanism to disable built-in tools.** Gate a dangerous built-in
  (e.g. `delete_video`) by *omitting that permission from the token*.
- The service also exposes **`registerPrompt` and `registerResource`** — so
  the custom server's "usage instructions" (risk #4 below) can move into a
  registered prompt/resource instead of being lost. Reconsider that risk.
- Media upload not supported via MCP; dynamic zones arrive untyped (we use
  neither in the tool surface — confirm in phase 1).

## Phases

### Phase 0 — Strapi upgrade (prerequisite, separate PR)
Checklist above. Exit: 5.47+ boots dev+prod, suite green, custom `/api/mcp`
still serving.

### Phase 1 — enable official server alongside the custom one
- `mcp: { enabled: true }` in `config/server.ts`; mint an Admin token.
- Point a scratch Claude Code config at `http://localhost:1350/mcp`
  (`claude mcp add strapi-mcp --transport http … -H "Authorization: Bearer <admin-token>"`).
- Parity-test every **Retire**-row built-in against today's behavior —
  especially that documents-middleware rules (video dedupe, tag slug
  derivation) fire through built-in creates.
- Exit: built-ins proven; disposition table corrections recorded here.

### Phase 2 — register ported tools (app-level, NOT a local plugin)
**Decision (revised after studying the reference impl, see below): register
at the app level in `server/src/index.ts`, not as a separate local plugin.**
The reference demonstrates both; app-level is right for us because (a) we
already own `src/index.ts` `register()` (the documents middleware lives
there), (b) no plugin scaffold / `strapi-plugin build` / duplicated
`node_modules` overhead, and (c) the tool-module array pattern ports our
existing `server/src/mcp/tools/` registry almost 1:1.

- New `server/src/mcp-tools/` (or keep `mcp/tools/`, dropping the
  transport/registry siblings): one module per tool exporting
  `{ register(registerTool, strapi) }`, collected in an `index.ts` array,
  looped from `register()` guarded by `strapi.ai.mcp.isEnabled()`.
- **Register custom admin permissions first** (the step the blog glosses):
  `strapi.service('admin::permission').actionProvider.registerMany([...])`
  with `section: 'settings'` (app) — action ids like
  `api::music-kb-mcp.transcript.read`. Each tool's `auth.policies` then
  references its own action, grantable per token. (The reference's plugin
  variant uses `section: 'plugins', pluginName` → `plugin::<name>.x.read`;
  app-level uses `settings`/`api::`.) Don't default to
  `plugin::content-manager.explorer.read` — mint purpose-built actions so
  token scoping is meaningful.
- Port the ~13 tools: move `execute` bodies into
  `createHandler: (strapi) => async ({ args }) => ({ content, structuredContent })`,
  write `resolveOutputSchema` ZodObjects (wrap top-level arrays), snake_case
  names to match built-in convention.
- Keep shared helpers (`bm25-search.ts`, `mcp/utils/embeddings.ts`) in
  `src/services/` — not MCP-coupled.
- The "usage instructions" the custom server sends can ship as a
  `get_*_guide` tool returning a `?raw`-imported markdown file (the
  reference's `get_article_authoring_guide` pattern), or a `registerPrompt`.
- Exit: `tools/list` on `/mcp` shows built-ins + ported tools; spot-check
  each ported tool from Claude Code.

> **Reference implementation** — verified working on Strapi 5.48 at
> `/Users/paul/work/temp/test-mcp-post/my-app` (Paul's own demo for the
> blog). Proven shapes mirrored above:
> - `config/server.ts` → `mcp: { enabled: true }`; tools registered in app
>   `register()` behind `if (!strapi.ai.mcp.isEnabled()) return;`.
> - `createHandler: (strapi) => async ({ args }) => ({ content: [{type:'text',
>   text: JSON.stringify(payload)}], structuredContent: payload })`.
> - `resolveOutputSchema: () => z.object({ count: z.number()…, articles:
>   z.array(z.object({…})) })` — top-level object, arrays nested.
> - Custom permission via `actionProvider.registerMany` is a real,
>   required step.

### Phase 3 — client cutover
- Update Claude Desktop (`mcp-remote` + Authorization header per the blog)
  and Claude Code configs; update `docs/mcp.md` setup snippets (they were
  the port-drift casualty once already — keep them exact).
- Run both endpoints for a few days; watch the custom endpoint's logs for
  stragglers.

### Phase 4 — retire the custom server
- Delete `server/src/mcp/` transport/registry/route/middleware; keep only
  what the plugin imports.
- Rewrite `docs/mcp.md` around the official server; fix CLAUDE.md's MCP
  section; **add an ADR** ("official Strapi MCP plugin over hand-rolled
  server") superseding the relevant part of the current design — append-only,
  per the ADR convention.
- Exit: one endpoint, one registry, suite green, docs match reality.

## Risks / open questions

1. **Admin-token blast radius.** Admin tokens are more powerful than our
   current scoped bearer. Local-first single-user softens this, but mint
   the narrowest role that lights up the needed tools, and never commit it.
2. **Output schemas may force shape changes.** Some tools return large
   heterogeneous JSON (digest, libraryStats). If a faithful zod schema gets
   absurd, simplify the tool's contract during the port and note it in
   `docs/mcp.md`.
3. **`saveSummary` invariants.** The unified score writer lives client-side;
   the MCP path re-implements the derivation server-side today. During the
   port, assert the two stay aligned (same finalScore math) — or expose a
   narrow custom tool and gate `update_video` permissions so the raw write
   path can't corrupt scores.
4. **Server instructions not configurable from plugins** (feature proposal
   pending upstream) — our current server sends usage guidance; ported
   tool descriptions must absorb it.
5. **Strapi upgrade unknowns** (5.42 → 5.47): plugin API churn, better-sqlite3
   bump, generated-types changes. Hence phase 0 stands alone.
