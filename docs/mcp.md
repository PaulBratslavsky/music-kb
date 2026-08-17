# MCP (Model Context Protocol) Integration

This Strapi server exposes the knowledge base (videos, transcripts,
summaries, tags, notes, music data) as an **MCP server** so Claude
Desktop / Claude Code / Cursor can drive the app using a frontier model.
The in-app chat path stays local-first (Ollama, BM25 grounding); MCP is
the bridge for when you want more power than a local model can provide.

Served by the **official Strapi MCP server** (built into Strapi 5.47+).
Our 24 domain tools are registered on it from `server/src/index.ts` via
the adapter in `server/src/mcp/` (`adapter.ts` + `catalog.ts`); the tool
bodies live in `server/src/mcp/tools/`. See [ADR 0008](./adr/0008-official-strapi-mcp-over-hand-rolled.md)
for why we retired the previous hand-rolled server (which served
`/api/mcp` — **that endpoint no longer exists**).

## Endpoint

```
http://localhost:1350/mcp
```

Streamable HTTP transport, enabled by `server.mcp.enabled` in
`config/server.ts` (env `MCP_ENABLED`, default on).

## Authentication

The official server authenticates **admin API tokens** (not content API
tokens). A token must be `kind: 'admin'`, owned by an active admin user,
and carry the admin permissions that gate the tools it should see. We
expose three custom actions (a token sees only the tools its permissions
allow):

- `api::music-kb-mcp.read` — the 16 read tools.
- `api::music-kb-mcp.write` — ordinary data mutations: `saveSummary`,
  `tagVideo`, `untagVideo`, `saveNote`.
- `api::music-kb-mcp.maintenance` — the expensive / external-side-effect /
  hard-to-undo tools: `addVideo` and `fetchTranscript` (hit YouTube),
  `reindexEmbeddings` (long Ollama run), `generateDigest` (LLM cost).

Mix to taste: read-only for a safe browsing token; read + write for
browse-and-annotate (can't trigger reindexes or YouTube fetches);
all three for a full-power token. (To also expose the built-in
per-content-type CRUD tools, additionally grant the relevant
`content-manager` permissions.)

> A plain content-API "Full access" token from Settings → API Tokens is
> **rejected** — it isn't `kind: 'admin'`. Use the mint below.

### Mint an admin token (canonical, console)

The reliable, version-proof way is the admin-token service via
`strapi console`. Stop the dev server first (SQLite single-writer), then:

```bash
cd server
printf '%s\n' \
  "const u=(await strapi.db.query('admin::user').findMany({populate:['roles']}))[0]; const t=await strapi.service('admin::api-token-admin').create({name:'claude-'+Date.now(), description:'MCP', lifespan:null, adminUserOwner:u.id, adminPermissions:[{action:'api::music-kb-mcp.read'},{action:'api::music-kb-mcp.write'},{action:'api::music-kb-mcp.maintenance'}]}, u); console.log('TOKEN='+t.accessKey);" \
  ".exit" | npx strapi console
```

Copy the `TOKEN=` value (shown once). The snippet grants all three tiers
(full power); drop `.maintenance` for browse-and-annotate, or keep only
`.read` for a read-only token. Restart the dev server afterwards.

Every request to `/mcp` must carry:

```
Authorization: Bearer <your-token>
```

Rotate by minting a new token and revoking the old one
(`strapi.service('admin::api-token-admin').revoke(id)`).

## Tools

24 tools across three permission tiers — 16 read, 4 write, 4 maintenance:

| Tool | Tier | Purpose |
|---|---|---|
| `libraryStats` | read | High-level KB stats: video count, summary-status breakdown, top tags, top channels, monthly ingestion buckets |
| `listVideos` | read | Paged video catalog (filter by status / verdict / tag) |
| `searchVideos` | read | Tokenized substring search over titles + summaries (a full URL or 11-char id also works) |
| `getVideo` | read | Full video record (summary, sections, tags) |
| `getMusicData` | read | AI-extracted music data (key, chords, techniques, referenced songs; transcript-grounded timecodes) + the video's saved practice loops |
| `getReadableArticle` | read | Cached long-form readable article (filler/sponsor stripped); null until generated from the app UI |
| `relatedVideos` | read | Semantically similar videos by cosine similarity over the per-video topical embedding |
| `listTranscripts` | read | Paged list of stored transcripts |
| `getTranscript` | read | Full transcript (or chunked / time-range slice) by videoId |
| `searchTranscript` | read | BM25 top-k passages inside a single video |
| `findTranscripts` | read | Cross-transcript substring search with previews |
| `crossSearchTranscripts` | read | BM25 search across many transcripts at once, top-k passages per video (optional tag filter) |
| `aggregateByTag` | read | Gather summary data for every video matching a set of tags (avoids N `getVideo` round-trips) |
| `listUntagged` | read | List videos with zero tags + enough context to suggest tags |
| `listTags` | read | List existing tags |
| `verifyCitations` | read | BM25-ground `[mm:ss]` citations in a draft text against a video's transcript; rewrites drifted ones, reports ungrounded ones |
| `saveSummary` | write | Persist a frontier-model-generated summary to a Video |
| `tagVideo` / `untagVideo` | write | Add / remove a tag on a video |
| `saveNote` | write | Attach a short note to a video |
| `addVideo` | maintenance | Ingest a YouTube URL (creates Video + fetches transcript) |
| `fetchTranscript` | maintenance | Fetch from YouTube + upsert; acts as "regenerate" with `force=true` |
| `reindexEmbeddings` | maintenance | Backfill / refresh topical embeddings (`missing` / `stale` / `all`); serial Ollama run |
| `generateDigest` | maintenance | Bundle compiled summary fields for 2–5 videos into one payload for cross-video synthesis |

Alongside these, the connecting token also sees Strapi's **built-in
per-content-type CRUD tools** (`list_video`, `get_video`, …) if it carries
the matching `content-manager` permissions, plus the built-in `log` tool.

## Claude Code (quickest)

```bash
claude mcp add music-kb --transport http http://localhost:1350/mcp \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Then `claude mcp list` / restart Claude Code; the `music-kb` server should
list its tools (24 custom + any built-ins the token's permissions expose).

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "music-kb": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:1350/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

Restart Claude Desktop.

> Why `mcp-remote`? Claude Desktop's built-in client supports stdio
> transports; `mcp-remote` bridges a stdio client to the Streamable HTTP
> endpoint and handles the bearer header.

## Cursor / Windsurf

Both support Streamable HTTP MCP servers directly. Add to your client's
MCP config:

```json
{
  "mcpServers": {
    "music-kb": {
      "type": "http",
      "url": "http://localhost:1350/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

## MCP Inspector (for debugging)

```bash
npx @modelcontextprotocol/inspector http://localhost:1350/mcp
```

In the inspector UI, set the bearer under **Authentication → Bearer
Token**. From there you can list tools and call them with arbitrary args —
great for confirming a setup works without involving an LLM.

## Typical workflows

### "What do I have about X?"

```
findTranscripts(query: "X")
  → returns a list of videos with 244-char previews
→ getVideo(videoId: <pick one>)
  → full summary for context
→ searchTranscript(videoId: <that one>, query: "X")
  → top passages with timecodes for citation
```

### Ingest + summarize with Claude

```
addVideo(url: "https://youtu.be/…", tags: ["ai", "rag"])
  → creates Video + fetches transcript
→ getTranscript(videoId: <id>, mode: "full")
  → pull the whole thing into Claude's context
Claude reasons across it and writes a summary
→ saveSummary(videoId: <id>, summaryTitle: …, sections: [...], …)
  → now visible in the app UI alongside Ollama-generated summaries
```

### Regenerate a stale transcript

```
fetchTranscript(videoId: <id>, force: true)
```

## Notes

- Sessions and transport are managed by the official Strapi MCP server
  (`server.mcp.connectTimeoutMs` / `requestTimeoutMs` default 5s / 60s).
- The `saveSummary` tool does not build the in-app BM25 retrieval index
  (that's an Ollama-bound pipeline). If you want full in-app chat
  grounding for a Claude-generated summary, regenerate from the app UI
  afterwards.
- Adding a tool: author a `ToolDef` in `server/src/mcp/tools/` — importing
  `z` from `@strapi/utils`, **not** from `zod` — then add a one-line entry
  (`{ tool, title, access }`) to `server/src/mcp/catalog.ts`. Registration
  is automatic.
- The input schema is declared **once**, on the tool. Its `.describe()` text
  is what MCP clients read to decide how to call the tool, so write it for an
  agent. See ADR 0008 for why `@strapi/utils`' `z` is required and why the
  schemas are no longer declared twice.
