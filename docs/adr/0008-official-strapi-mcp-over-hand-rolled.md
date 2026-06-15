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
  lives in `src/mcp-official/` (permissions, adapter, tool list).
- **Reuse, don't rewrite, the tool bodies.** `src/mcp-official/adapter.ts`
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

### The load-bearing constraint: zod 4 vs zod 3

The official API requires schemas built with `@strapi/utils`'s **zod 3**
(3.25.x). The app uses **zod 4** (4.3.x); the two are not interchangeable
across the MCP SDK's schema conversion. So the adapter reuses each tool's
`execute` body (it operates on plain parsed args) but the **input/output
schemas are re-declared in zod-3** in `src/mcp-official/tools.ts`. Output
schemas must be a top-level `ZodObject`; the adapter normalizes any
array/scalar result into an object to satisfy that.

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
- **Dual zod versions in the tool layer.** Each tool's schema is declared
  twice — zod-4 in the `ToolDef` (for the execute body's arg typing) and
  zod-3 in `src/mcp-official/tools.ts` (for the official server). Drift
  between the two is possible; the verification pass (tools/list + sample
  calls) is the guard.
- **Output schemas start loose.** The adapter defaults to a permissive
  object schema; tightening per-tool is deferred.
- **Admin-token blast radius.** Admin tokens are more powerful than the old
  scoped content token. Mitigated by minting the narrowest role that lights
  up the needed tools and never committing it. Local-first single-user
  softens this.

**What's enforced in code.**

- `src/mcp/` no longer serves HTTP — it's just tool *implementations* the
  adapter consumes. Don't re-add a transport there.
- New tools: author a `ToolDef` in `src/mcp/tools/`, add a zod-3 entry in
  `src/mcp-official/tools.ts` with a read/write tier. Registration is
  automatic via the array.
