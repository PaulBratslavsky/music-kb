# Migration plan: hand-rolled MCP server → official Strapi MCP plugin

**Status:** Planned. Created 2026-06-12.
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

```ts
strapi.ai.mcp.registerTool({
  name: 'search_transcript',
  title: 'Search a video transcript',
  description: '…when-to-use guidance, same care as today…',
  resolveInputSchema: () => z.object({ videoId: z.string(), query: z.string() }),
  resolveOutputSchema: () => z.object({ /* REQUIRED — see workload note */ }),
  auth: { policies: [{ action: 'plugin::content-manager.explorer.read' }] },
  createHandler: (strapi) => async (input) => ({
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
  }),
})
```

Non-negotiables from the guide:

- **`z` from `@strapi/utils`**, never the `zod` package (version-mismatch
  foot-gun).
- **`resolveOutputSchema` is required.** Our current tools return loose
  JSON; writing output zod schemas for the ~13 ported tools is the bulk of
  the migration effort. Budget it; don't hand-wave it.
- **Plugin loads from `dist/`** — `npm run build` after source changes; a
  stale build silently serves old tools.
- `auth.policies` entries are **OR**, not AND; action strings must be exact
  (`plugin::content-manager.explorer.read` / `.create` / `.update` …).
- Permission gating is strict: the admin token's permissions decide which
  tools even *appear* in `tools/list`. Mint a scoped token rather than a
  full-access one once parity is proven.
- **No mechanism to disable built-in tools.** If a built-in is dangerous in
  our setup (e.g. `delete_video`), gate it by *omitting that permission
  from the token*, not by code.
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

### Phase 2 — local plugin with ported tools
- Scaffold `server/src/plugins/music-kb-mcp` (plugin boilerplate +
  `config/plugins.ts` entry per the blog).
- Port the ~13 tools: move `execute` bodies, add output schemas, choose
  `auth.policies` per tool (reads → `.read`, writers like `saveSummary` →
  `.update`), snake_case names to match built-in convention.
- Keep shared helpers (`bm25-search.ts`, `mcp/utils/embeddings.ts`) — they
  move under the plugin or stay in `src/services/`; they are not
  MCP-coupled.
- Exit: `tools/list` on `/mcp` shows built-ins + ported tools; spot-check
  each ported tool from Claude Code.

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
