# 0008. Official Strapi MCP server over the hand-rolled one

**Status:** Accepted (2026-06-14). Supersedes the MCP-transport portion of the original design; the tool *implementations* are unchanged.

## Context

The fork shipped a hand-rolled MCP server: a Streamable-HTTP transport
(`server/src/mcp/transport.ts`), an MCP `Server` built from an in-process
tool registry (`server/src/mcp/server.ts` + `registry.ts`), and a
content-API route at `/api/mcp` (`server/src/api/mcp/`) authenticated by a
content API token scoped to `api::mcp.mcp.handle`. It exposed 24 domain
tools (videos, transcripts, tags, notes, music data, digests, embeddings).

Strapi **5.47+** ships an MCP server **built into `@strapi/core`** (MCP SDK
1.29.0): enabled with `server.mcp.enabled`, served at `/mcp` over
streamable-http, gated by **admin API tokens**, auto-deriving CRUD tools per
content type, and exposing `strapi.ai.mcp.registerTool` for custom tools.
That makes ~2.5K LOC of our transport/registry/route redundant — Strapi now
owns transport, session handling, auth, and CRUD generation.

We upgraded 5.42 → 5.48 (ADR-adjacent; see the migration plan) and ran both
servers in parallel long enough to port and verify every tool.

## Decision

**Retire the hand-rolled MCP server. Register our domain tools on the
official server instead, at the app level.**

- **Enable** the official server: `server.mcp.enabled` in
  `config/server.ts` (env `MCP_ENABLED`, default on).
- **Register** the 24 tools in `src/index.ts` `register()` via
  `strapi.ai.mcp.registerTool`, behind three custom admin permissions so a
  token's scope decides which tools it sees: `api::music-kb-mcp.read` (16
  read tools), `.write` (ordinary mutations — saveSummary, tag/untag,
  saveNote), and `.maintenance` (the expensive / external-side-effect /
  hard-to-undo tools — addVideo, fetchTranscript, reindexEmbeddings,
  generateDigest). The maintenance tier exists so a browse-and-annotate
  token can't trigger a reindex, a YouTube fetch, or an LLM digest. Code
  lives in `src/mcp/` (permissions, adapter, catalog) alongside the tool
  bodies. (Originally a separate `src/mcp-official/`; consolidated into
  `src/mcp/` 2026-06 once the hand-rolled host was gone — see note below.)
- **Reuse, don't rewrite, the tool bodies.** `src/mcp/adapter.ts`
  wraps each existing `ToolDef`'s `execute(args, { strapi })` into an
  official `registerTool` call. The tool implementations in
  `src/mcp/tools/*` and their helpers (`src/mcp/utils/*`,
  `src/mcp/registry.ts`'s `ToolDef` type) are kept verbatim.
- **App-level, not a local plugin.** Strapi supports both; app-level avoids
  a plugin scaffold / `strapi-plugin build` / duplicated `node_modules`,
  and `register()` already exists (it holds the documents middleware).
- **Delete** the transport surface: `src/api/mcp/` (route + controller),
  `src/mcp/server.ts`, `src/mcp/transport.ts`, and `src/mcp/tools/index.ts`
  (the old `registerAllTools` aggregator).

### The load-bearing constraint: one zod instance, not one zod version

**Corrected 2026-08-17, then corrected again 2026-08-18 — see the note at
the end of this section.** This section previously claimed the official API
required **zod 3** because `@strapi/utils` bundled 3.25.x while the app used
zod 4. That was wrong, and it cost us: it justified a second hand-maintained
copy of every input schema in `catalog.ts`, and the two copies drifted (see
below).

What is actually true. Strapi uses **zod v4** internally and re-exports it —
`packages/core/utils/src/zod.ts` is `import * as z from 'zod/v4'; export { z }`.
The `zod@3.25.67` in `node_modules/@strapi/*` is the npm package version;
that package ships **both** majors, and v4 is reached via the `zod/v4`
subpath. Runtime probe of `@strapi/utils`'s `z`: `toJSONSchema` present,
schemas carry `_zod`, core version `4.0.0`.

The real constraint is **instance and minor-version skew between two zod v4
copies**:

| | zod core |
|---|---|
| `@strapi/utils` z (Strapi 5.48) | 4.0.0 |
| the app's `zod` dependency | 4.3.6 |

`$ZodType`'s internals changed between those, so the two do not structurally
unify. Handing an app-zod schema to Strapi's MCP registry is a compile error:

```
TS2345: Argument of type 'ZodObject<{ page: ZodDefault<ZodNumber>; }, $strip>'
is not assignable to parameter of type
'ZodObject<Readonly<{ [k: string]: $ZodType<unknown, unknown, $ZodTypeInternals<unknown, unknown>>; }>, $strip>'
```

Strapi enforces the same thing at runtime elsewhere — `content-api/index.ts`
states it only accepts "schemas from the same zod/v4 instance used here" —
and their `zod.ts` doc block tells integrators to use the re-exported `z`
"so your code stays compatible across Strapi minor/patch updates."

~~So: build MCP schemas with `z` from `@strapi/utils`, and build them once.~~
**Corrected 2026-08-18: this conclusion was itself wrong — see below.** Each
tool's `ToolDef.schema` is the single declaration; `catalog.ts` supplies
only `title` + `access`, and the adapter reads the schema off the tool. Output
schemas must be a top-level `ZodObject`; the adapter normalizes any
array/scalar result into an object to satisfy that.

Everything outside `server/src/mcp/` stays on the app's own zod 4.

**2026-08-18 correction: schemas must be built with the app's own zod, not
`@strapi/utils`'s — the opposite of the conclusion above.** The instance/
minor-skew framing above is real but was the wrong lens: it explains a *type*
error, not the actual runtime bug found in production use. Zod 4 stores
`.describe()` text in a per-module-instance **global registry**. When a
schema is built with `@strapi/utils`'s bundled zod copy and then converted
by the MCP SDK's own, separately-bundled zod instance, the SDK's registry
lookup finds nothing — every `.describe()` string is silently dropped from
what MCP clients see, with no error, no warning. Building schemas with the
app's own top-level `zod` (`^4.3.x`) instead fixes this, because
`@modelcontextprotocol/sdk` declares `zod` only as a peer dependency (no
nested copy of its own), so it resolves to the same physical package the
app's schemas are built with. The remaining nominal-type mismatch against
`@strapi/strapi`'s ambient `registerTool` signature (still typed against
`@strapi/utils`'s zod) is bridged with a narrow type cast at the
`registerTool` call site in `server/src/mcp/adapter.ts` — see that file for
the up-to-date reasoning. `server/src/mcp/catalog.ts` no longer has a
"zod-3 vs zod-4" split at all: every tool schema is built with the same
top-level `zod` import.

**Why the duplication was worth removing, not just tidying.** The two copies
were the same contract typed twice, and only the `catalog.ts` copy was ever
advertised to MCP clients. `listVideos`' `verdict` parameter had been
carefully documented in the tool file — "worth_it = dense/actionable, skim =
mixed, skip = generic. Use `worth_it` to find videos the summary alone cannot
replace." — while clients saw only the catalog's "Filter by the AI watch
verdict." Descriptions *are* the prompt an agent reads to decide how to call a
tool, so that drift silently degraded every client. The other direction was
worse: zod `z.object()` strips unknown keys, so a field added to the tool
schema but not the catalog copy would arrive at `execute` as `undefined` with
TypeScript still insisting it was present.

### Auth

The official server authenticates **admin-kind** API tokens
(`authenticateAdminToken`): a token of `kind: 'admin'`, owned by an active
admin user, whose ability is generated from the token's `adminPermissions`.
These are minted via the `api-token-admin` service (Settings → API Tokens
in the admin UI), **not** the content `api-token` service. A content
full-access token — what the old `/api/mcp` used — is rejected.

## Consequences

**What we gain.**

- ~2.5K LOC of transport/registry/route/server deleted; Strapi owns the
  protocol, session handling, and auth.
- Free built-in CRUD tools per content type, gated by the same admin token.
- Token-scoped tool visibility: a read-only token sees only the read tools;
  a token without content-manager perms sees none of the built-in CRUD.
- One registration path (`registerTool`) instead of a bespoke registry +
  HTTP handler.

**What we accept.**

- **Breaking client-config change.** Clients must point at `/mcp` (not
  `/api/mcp`) with an **admin** token (not a content token). Anyone with the
  old config must reconfigure — see `docs/mcp.md`.
- ~~**Dual zod versions in the tool layer** — schema declared twice, zod-4
  in the `ToolDef` and zod-3 in `catalog.ts`.~~ **Stale as of 2026-08-18:**
  there is no longer a second declaration. Every tool schema is built once,
  in `src/mcp/tools/*`, with the app's own top-level `zod` — see the
  corrected note in the "load-bearing constraint" section above.
- **Output schemas start loose.** The adapter defaults to a permissive
  object schema; tightening per-tool is deferred.
- **Admin-token blast radius.** Admin tokens are more powerful than the old
  scoped content token. Mitigated by minting the narrowest role that lights
  up the needed tools and never committing it. Local-first single-user
  softens this.

**What's enforced in code.**

- `src/mcp/tools/` no longer serves HTTP — they're just tool
  *implementations* the adapter consumes. Don't re-add a transport there.
- New tools: author a `ToolDef` in `src/mcp/tools/` (schema built with the
  app's own `zod`), add an entry in `src/mcp/catalog.ts` with a read/write
  tier. Registration is automatic via the array.

> **Update (2026-06):** the official-server wiring originally lived in a
> separate `src/mcp-official/` folder (to keep tool bodies host-neutral
> while the hand-rolled host was still around). With the hand-rolled host
> gone there's only one host, so those four files were folded into
> `src/mcp/` — `adapter.ts`, `catalog.ts` (was `tools.ts`), `permissions.ts`,
> `index.ts` — next to `tools/` and `registry.ts`. No behavior change.
