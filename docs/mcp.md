# MCP (Model Context Protocol) Integration

This Strapi server exposes the knowledge base (videos, transcripts,
summaries, tags, notes, music data) as an **MCP server** so Claude
Desktop / Claude Code / Cursor can drive the app using a frontier model.
The in-app chat path stays local-first (Ollama, BM25 grounding); MCP is
the bridge for when you want more power than a local model can provide.

Served by the **official Strapi MCP server** (built into Strapi 5.47+).
Our 29 domain tools are registered on it from `server/src/index.ts` via
the adapter in `server/src/mcp/` (`adapter.ts` + `catalog.ts` +
`permissions.ts`); the tool bodies live in `server/src/mcp/tools/`. See
[ADR 0008](./adr/0008-official-strapi-mcp-over-hand-rolled.md) for why we
retired the previous hand-rolled server (which served `/api/mcp` — **that
endpoint no longer exists**).

## Endpoint

```
http://localhost:1350/mcp
```

Streamable HTTP transport, enabled by `server.mcp.enabled` in
`config/server.ts` (env `MCP_ENABLED`, default on).

## Authentication

The official server authenticates **admin API tokens** (not content API
tokens). A token must be `kind: 'admin'`, owned by an active admin user,
and carry the admin permissions that gate the tools it should see.

**One permission per tool.** Every tool has its own admin action:

```
api::music-kb-mcp.tool.<tool-name-in-kebab-case>
```

`getVideo` → `api::music-kb-mcp.tool.get-video`, `createLesson` →
`api::music-kb-mcp.tool.create-lesson`, and so on. A token sees exactly the
tools whose actions it holds — nothing else. (Kebab-case because Strapi's
action registry only accepts lowercase letters, dots and hyphens in a
permission uid; the ids are still derived one-to-one from the tool names,
never from their display titles.)

In the admin UI (Settings → Roles / API Tokens) the checkboxes are grouped
under an **MCP** category with three sub-headings, each with a "Select all":

- **read tools** (19) — no mutation.
- **write tools** (6) — ordinary data mutations: `saveSummary`, `tagVideo`,
  `untagVideo`, `saveNote`, `createLesson`, `updateLesson`.
- **maintenance tools** (4) — expensive / external side effects / hard to
  undo: `addVideo` and `fetchTranscript` (hit YouTube), `reindexEmbeddings`
  (long Ollama run), `generateDigest` (LLM cost).

Those three groups are **presentation only** — there is no `read` /
`write` / `maintenance` permission any more, only the per-tool ones. That
matters because the two cannot coexist: Strapi enables a tool when *any* of
its policies passes, so a surviving tier grant would re-expose every tool in
its group no matter what the per-tool boxes said. Scoping is now genuinely
per tool — "let this client author lessons" no longer also means "let it
overwrite video summaries".

> **Existing tokens keep working.** Tokens minted against the old
> `api::music-kb-mcp.read` / `.write` / `.maintenance` actions are upgraded
> in place on the next boot: each is granted every per-tool action its tier
> covered, and the dead tier grant is retired. The boot log says exactly what
> it did (`[music-kb mcp] Migrated apiToken "…": api::music-kb-mcp.read → 19
> per-tool action(s)`), and shouts if it could not grant something. The
> migration runs once per token — after it, unchecking a tool sticks.

(To also expose the built-in per-content-type CRUD tools, additionally grant
the relevant `content-manager` permissions.)

> A plain content-API "Full access" token from Settings → API Tokens is
> **rejected** — it isn't `kind: 'admin'`. Use the mint below.

### Mint an admin token (canonical, console)

The reliable, version-proof way is the admin-token service via
`strapi console`. Stop the dev server first (SQLite single-writer), then —
for a **full-power** token, which asks the running app for the action list
rather than repeating 29 ids here:

```bash
cd server
printf '%s\n' \
  "const P='api::music-kb-mcp.tool.'; const acts=strapi.service('admin::permission').actionProvider.keys().filter(a=>a.startsWith(P)); const u=(await strapi.db.query('admin::user').findMany({populate:['roles']}))[0]; const t=await strapi.service('admin::api-token-admin').create({name:'claude-'+Date.now(), description:'MCP', lifespan:null, adminUserOwner:u.id, adminPermissions:acts.map(action=>({action}))}, u); console.log('TOKEN='+t.accessKey); console.log('GRANTED='+acts.length);" \
  ".exit" | npx strapi console
```

Copy the `TOKEN=` value (shown once); `GRANTED=` should read 29. Restart the
dev server afterwards.

For a **narrow** token, list the tools instead of taking them all — this one
can read the library and author lessons, and cannot touch a video summary:

```bash
cd server
printf '%s\n' \
  "const acts=['list-videos','get-video','search-videos','get-transcript','search-transcript','list-lessons','get-lesson','get-lesson-authoring-guide','create-lesson','update-lesson'].map(n=>({action:'api::music-kb-mcp.tool.'+n})); const u=(await strapi.db.query('admin::user').findMany({populate:['roles']}))[0]; const t=await strapi.service('admin::api-token-admin').create({name:'lesson-author-'+Date.now(), description:'MCP (lesson authoring)', lifespan:null, adminUserOwner:u.id, adminPermissions:acts}, u); console.log('TOKEN='+t.accessKey);" \
  ".exit" | npx strapi console
```

An unknown action id is rejected at mint time (`Unknown admin action: …`),
so a typo fails loudly instead of quietly producing a token that sees fewer
tools than you meant.

Every request to `/mcp` must carry:

```
Authorization: Bearer <your-token>
```

Rotate by minting a new token and revoking the old one
(`strapi.service('admin::api-token-admin').revoke(id)`).

## Tools

29 tools, each with its own permission, grouped into three safety tiers —
19 read, 6 write, 4 maintenance. The **Group** column is the sub-heading the
tool's checkbox sits under; the permission itself is always
`api::music-kb-mcp.tool.<kebab-name>`.

| Tool | Group | Purpose |
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
| `listLessons` | read | Paged catalog of lessons (slug, title, status, level, instrument) |
| `getLesson` | read | Fetch one lesson with its full block body, by slug |
| `getLessonAuthoringGuide` | read | The block vocabulary + house rules an agent needs before calling `createLesson` |
| `saveSummary` | write | Persist a frontier-model-generated summary to a Video |
| `tagVideo` / `untagVideo` | write | Add / remove a tag on a video |
| `saveNote` | write | Attach a short note to a video |
| `createLesson` | write | Create a lesson from typed blocks — never overwrites; appends `-2`, `-3`, … on a slug collision |
| `updateLesson` | write | Update an existing lesson by `documentId` |
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
list its tools (up to 29 custom, whichever the token's per-tool permissions
allow, plus any built-ins it can reach).

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
  `z` from the app's own top-level `zod` dependency, **not** the `z`
  re-exported from `@strapi/utils` — then add a one-line entry
  (`{ tool, title, access }`) to `server/src/mcp/catalog.ts`. Registration
  **and its permission** are automatic: `server/src/mcp/permissions.ts`
  derives one admin action per catalog entry, so there is no second list to
  keep in step. Existing tokens do NOT get the new tool — grant it
  deliberately. `client/src/lib/mcp-tool-permissions.test.ts` asserts both
  directions (every tool has an action, every action has a tool) and that
  each derived uid is one Strapi will actually accept. Name it **camelCase**: Strapi's content-manager plugin
  derives its own built-in per-content-type tools as `{verb}_${slug}`
  (`create_video`, `get_lesson`, …) and registers them unconditionally at
  boot; a name collision there throws outside this adapter's per-tool
  try/catch and crashes the whole Strapi boot, not just that one
  registration.
- The input schema is declared **once**, on the tool. Its `.describe()` text
  is what MCP clients read to decide how to call the tool, so write it for an
  agent. See ADR 0008 for why the app's own `zod` import is required (not
  `@strapi/utils`'s) and why the schemas are no longer declared twice.
