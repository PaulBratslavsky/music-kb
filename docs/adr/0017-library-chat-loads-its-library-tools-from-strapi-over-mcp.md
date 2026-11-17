# 0017. The library chat loads its library tools from Strapi over MCP

**Status:** Accepted (2026-11-16). Partly supersedes ADR 0010: the three
app-side library tools it measured against the MCP tools are deleted. Reverses
the "the in-app chat does not use MCP" line in the README and in
`docs/ai-architecture.md` for the library chat. The video chat is unchanged.

## Context

Music KB had two sets of tools that do the same jobs.

- The app's library chat (`/api/ask`) defined four TanStack AI tools in
  `client/src/lib/services/library-tools.ts`: `load_passages`,
  `search_library`, `get_video_details` and `list_videos_by_topic`.
- Strapi's MCP server at `/mcp` defines 29 tools in `server/src/mcp/tools/`
  for outside agents (Claude Code, Claude Desktop). Three of them answer the
  same questions as the last three app tools: `crossSearchTranscripts`,
  `getVideo` and `searchVideos`.

ADR 0010 measured the two sets and kept both, because they share no code. That
left every library job with two definitions, two descriptions and two input
schemas to keep in step, and a new tool had to be written twice to reach both
the app's chat and outside agents.

`@tanstack/ai-mcp` 1.2.0 turns the tools of an MCP server into TanStack AI
tools (`createMCPClient` → `client.tools()`), so `chat()` can run a tool that
Strapi defines.

## Decision

**Strapi defines each library tool once. The library chat loads the tools over
MCP.**

- `client/src/lib/services/strapi-mcp-tools.ts` connects to `<STRAPI_URL>/mcp`
  with `createMCPClient`, sends the admin token in `STRAPI_MCP_TOKEN` as a
  Bearer header, keeps the tools named in `LIBRARY_CHAT_TOOLS`
  (`crossSearchTranscripts`, `searchVideos`, `getVideo`) and returns them as
  TanStack AI tools.
- `/api/ask` passes `[load_passages, ...strapi.tools]` to `chat()` and closes
  the MCP connection when the run ends, fails or is cancelled (`closeAfter`).
- `search_library`, `get_video_details` and `list_videos_by_topic` are
  deleted from the app. The system prompt names the Strapi tools instead.

| Old app tool | Strapi tool the chat calls now |
|---|---|
| `search_library` | `crossSearchTranscripts` |
| `get_video_details` | `getVideo` |
| `list_videos_by_topic` | `searchVideos` |

**Two tools stay in the app, because neither is a library tool.**

- `load_passages` closes over the passages one request retrieved, so the
  passages it returns carry the `[N]` citation indices sent to the browser in
  that request's `library-ask:citations` event. A Strapi tool has no access to
  that per-request state.
- `kb_web_search` (the video chat) searches the web, not the library.

**The chat must keep working without the MCP server.** `loadStrapiTools()`
never throws. With `STRAPI_MCP_TOKEN` unset it logs one warning per process
and returns no tools. With the server unreachable or the token rejected it
logs the reason and returns no tools. In both cases `/api/ask` answers with
`load_passages` and the seeded passages, as it did before the model called any
tool.

**The token is scoped to the three tools.** `docs/mcp.md` has the recipe
("Mint a token for the app"). It grants
`api::music-kb-mcp.tool.cross-search-transcripts`, `.search-videos` and
`.get-video`, so the app's chat cannot call a write or maintenance tool even
if `LIBRARY_CHAT_TOOLS` were edited.

## Consequences

- **A behaviour change in the fallback tools.** ADR 0010's measurement still
  holds: the old and new tools use different algorithms. `search_library` was
  dense-embedding + BM25 fusion in the app; `crossSearchTranscripts` is BM25
  over the stored per-video index in Strapi. `list_videos_by_topic` matched a
  substring or an exact tag; `searchVideos` requires every non-stopword token
  to match. The retrieval that seeds every answer (`retrievePassagesForQuery`,
  dense + BM25) is unchanged and still runs in the app, and these tools are
  fallbacks the model calls only when the seeded candidates do not answer.
- **One extra request per turn.** Each `/api/ask` call opens an MCP connection
  (measured locally: a `server/discover` probe that Strapi 5.52 answers with
  400, then `initialize`, `notifications/initialized` and `tools/list`, about
  10–35 ms each). A tool call is one more POST.
- **The library chat depends on an admin token.** It is optional, and the
  default install has none, so the default library chat has one tool.
- **Tool descriptions come from Strapi.** They were written for Claude Code
  and are longer than the app's were. A small local model sees the same text.
- **Tests.** `strapi-mcp-tools.test.ts` runs the real `@tanstack/ai-mcp`
  client against an in-process MCP server (`createMCPServer` from
  `@tanstack/ai-mcp/server`) and checks the URL, the Bearer header, the tool
  filter, a tool call reaching the server, the two no-tools paths and
  `closeAfter`. `api.ask.multiturn.test.ts` checks what `/api/ask` hands to
  `chat()`.
