# MCP (Model Context Protocol) Integration

This Strapi server exposes the knowledge base (videos, transcripts,
summaries, tags, notes) as an **MCP server** so Claude Desktop / Claude
Code / Cursor can drive the app using a frontier model. The in-app chat
path stays local-first (Ollama, BM25 grounding); MCP is the bridge for
when you want more power than a local model can provide.

## Endpoint

```
http://localhost:1350/api/mcp
```

Speaks the MCP Streamable HTTP transport (JSON-RPC over POST/GET/DELETE
with `mcp-session-id` session header). All three verbs are mounted.

## Authentication

The `/api/mcp` endpoint lives under `src/api/mcp/routes/` so Strapi's
native content-API auth middleware applies — no custom bearer check, no
env var. You can scope a token to MCP-only access using a **Custom**
token.

### Option A — Custom token (least privilege, recommended)

1. Start Strapi: `yarn --cwd server develop`.
2. Open the admin UI at `http://localhost:1350/admin`.
3. **Settings → API Tokens → Create new API Token**.
   - **Name:** `claude-desktop`
   - **Token duration:** Unlimited
   - **Token type:** `Custom`
4. In the **Permissions** tree, expand **Mcp** and check **`handle`**.
   (This is the action the MCP route resolves to. No other boxes needed.)
5. **Save** — copy the token from the top of the next screen. Shown once.

### Option B — Full access (quick and dirty)

Same flow but **Token type: `Full access`**. Skips the permissions
picker entirely. Fine for a single-user local app; not recommended if
the token will ever leave the machine.

Every request to `/api/mcp` must carry:

```
Authorization: Bearer <your-token>
```

Rotate by creating a new token in the admin UI, updating your MCP client
config, and deleting the old one.

## Tools

| Tool | Purpose |
|---|---|
| `listTranscripts` | Paged list of stored transcripts |
| `getTranscript` | Full transcript (or chunked / time-range slice) by videoId |
| `searchTranscript` | BM25 top-k passages inside a single video |
| `findTranscripts` | Cross-transcript substring search with previews |
| `fetchTranscript` | Fetch from YouTube + upsert; acts as "regenerate" with `force=true` |
| `listVideos` | Paged video catalog |
| `getVideo` | Full video record (summary, sections, tags) |
| `searchVideos` | Substring search over titles + summaries |
| `addVideo` | Ingest a YouTube URL (creates Video + fetches transcript) |
| `saveSummary` | Persist a frontier-model-generated summary to a Video |
| `listTags` / `tagVideo` / `untagVideo` | Tag CRUD |
| `saveNote` | Attach a short note to a video |

The server also exposes one resource — `strapi://tools/guide` — which
returns a markdown catalog of the above (useful for clients that don't
auto-render tool schemas).

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on your platform:

```json
{
  "mcpServers": {
    "yt-knowledge-base": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "http://localhost:1350/api/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

Restart Claude Desktop. The `yt-knowledge-base` server should appear in
the tools menu with ~14 tools available.

> Why `mcp-remote`? Claude Desktop's built-in client supports stdio
> transports; `mcp-remote` bridges a stdio client to our Streamable HTTP
> endpoint and handles the bearer header.

## Claude Code / Cursor

Both support Streamable HTTP MCP servers directly. Add to your client's
MCP config:

```json
{
  "mcpServers": {
    "yt-knowledge-base": {
      "type": "http",
      "url": "http://localhost:1350/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

## MCP Inspector (for debugging)

```bash
npx @modelcontextprotocol/inspector http://localhost:1350/api/mcp
```

In the inspector UI, set the bearer under **Authentication → Bearer
Token**. From there you can list tools, call them with arbitrary args,
and read the `strapi://tools/guide` resource — great for confirming a
setup works without involving an LLM.

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

- Sessions live in-memory. Killing the Strapi process drops them; clients
  auto-reconnect on their next request. TTL is 4 hours idle.
- Max 100 concurrent sessions. Past that, the server returns 503 until
  idle sessions age out.
- The `saveSummary` tool does not build the in-app BM25 retrieval index
  (that's an Ollama-bound pipeline). If you want full in-app chat
  grounding for a Claude-generated summary, regenerate from the app UI
  afterwards.
