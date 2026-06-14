# MCP (Model Context Protocol) Integration

This Strapi server exposes the knowledge base (videos, transcripts,
summaries, tags, notes, music data) as an **MCP server** so Claude
Desktop / Claude Code / Cursor can drive the app using a frontier model.
The in-app chat path stays local-first (Ollama, BM25 grounding); MCP is
the bridge for when you want more power than a local model can provide.

Served by the **official Strapi MCP server** (built into Strapi 5.47+).
Our 24 domain tools are registered on it from `server/src/index.ts` via
the adapter in `server/src/mcp-official/`; the tool bodies live in
`server/src/mcp/tools/`. See [ADR 0008](./adr/0008-official-strapi-mcp-over-hand-rolled.md)
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
expose two custom actions:

- `api::music-kb-mcp.read` — the 16 read tools.
- `api::music-kb-mcp.write` — the 8 write tools (`addVideo`,
  `saveSummary`, `tagVideo`, `untagVideo`, `saveNote`, `fetchTranscript`,
  `reindexEmbeddings`, `generateDigest`).

A token sees only the tools its permissions allow — grant read-only for a
safe browsing token, read+write for a full one. (To also expose the
built-in per-content-type CRUD tools, additionally grant the relevant
`content-manager` permissions.)

> A plain content-API "Full access" token from Settings → API Tokens is
> **rejected** — it isn't `kind: 'admin'`. Use the mint below.

### Mint an admin token (canonical, console)

The reliable, version-proof way is the admin-token service via
`strapi console`. Stop the dev server first (SQLite single-writer), then:

```bash
cd server
printf '%s\n' \
  "const u=(await strapi.db.query('admin::user').findMany({populate:['roles']}))[0]; const t=await strapi.service('admin::api-token-admin').create({name:'claude-'+Date.now(), description:'MCP', lifespan:null, adminUserOwner:u.id, adminPermissions:[{action:'api::music-kb-mcp.read'},{action:'api::music-kb-mcp.write'}]}, u); console.log('TOKEN='+t.accessKey);" \
  ".exit" | npx strapi console
```

Copy the `TOKEN=` value (shown once). For a read-only token, drop the
`.write` entry. Restart the dev server afterwards.

Every request to `/mcp` must carry:

```
Authorization: Bearer <your-token>
```

Rotate by minting a new token and revoking the old one
(`strapi.service('admin::api-token-admin').revoke(id)`).

## Tools

| Tool | Purpose |
|---|---|
| `listTranscripts` | Paged list of stored transcripts |
| `getTranscript` | Full transcript (or chunked / time-range slice) by videoId |
| `searchTranscript` | BM25 top-k passages inside a single video |
| `verifyCitations` | BM25-ground `[mm:ss]` citations in a draft text against a video's transcript; rewrites drifted ones, reports ungrounded ones |
| `findTranscripts` | Cross-transcript substring search with previews |
| `fetchTranscript` | Fetch from YouTube + upsert; acts as "regenerate" with `force=true` |
| `listVideos` | Paged video catalog |
| `getVideo` | Full video record (summary, sections, tags) |
| `searchVideos` | Substring search over titles + summaries |
| `addVideo` | Ingest a YouTube URL (creates Video + fetches transcript) |
| `saveSummary` | Persist a frontier-model-generated summary to a Video |
| `listTags` / `tagVideo` / `untagVideo` | Tag CRUD |
| `saveNote` | Attach a short note to a video |
| `getMusicData` | AI-extracted music data (key, chords, techniques, referenced songs; transcript-grounded timecodes) + the video's saved practice loops |

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
- Adding a tool: author a `ToolDef` in `server/src/mcp/tools/`, then add a
  zod-3 entry (read/write tier) to `server/src/mcp-official/tools.ts`.
  Registration is automatic. See ADR 0008 for the zod-4-vs-zod-3 reason
  schemas are declared twice.
