# Music KB

A local-first knowledge base for YouTube **music tutorial** videos. Paste a URL, get a structured AI summary with timestamped sections, chat with the transcript, find related tutorials by topic, and use the built-in **theory companion** (piano, guitar fretboard, Ableton Push, tab, sheet music) to follow along — no leaving the page to look up a chord shape.

Forked from [yt-knowledge-base](https://github.com/) and reshaped for music learning. Same local-first stance: no cloud AI, no accounts, runs entirely on your machine against [Ollama](https://ollama.com) and [Strapi](https://strapi.io).

---

## Highlights

- **Local-first by design** — [Ollama](https://ollama.com) for inference + embeddings, [Strapi](https://strapi.io) (SQLite) for storage, YouTube captions fetched in-process via [youtubei.js](https://github.com/LuanRT/YouTube.js). Zero cloud dependencies.
- **Grounded citations, not guesses** — section timecodes are recovered deterministically from the transcript via BM25, not invented by the model. Chat responses ship with an expandable "Sources" panel showing the transcript text behind each citation.
- **Agentic chat** — streaming chat over [TanStack AI](https://tanstack.com/ai/latest) with a built-in `web_search` tool. Force-trigger with `/web <query>` when you want external context.
- **Cross-video digests** — synthesize 2–5 videos into structured themes, contradictions, unique insights, and a long-form article. Saved digests are upserted by a deterministic `videoSetKey` so re-saving the same selection updates in place instead of duplicating.
- **Notes that stick** — "Summarize to note" turns a chat conversation into a markdown note attached to the video. MCP clients (Claude Desktop, etc.) can also leave notes. Every note is markdown; every note renders timecode chips back into the player.
- **Semantic discovery** — per-video embeddings from the summary layer power "Related videos" on the learn page and library-wide semantic search on the feed. Same `embeddings.ts` infra ready to layer onto transcript chunks for moment-level search.
- **Frontier-model bridge via MCP** — Strapi exposes an [MCP server](https://modelcontextprotocol.io) at `/api/mcp` so you can drive the knowledge base from Claude Desktop / Claude Code / Cursor with a bigger model when you need one. Tools cover transcripts, videos, tags, notes — defined once in Strapi, no duplication with the in-app chat. See [`docs/mcp.md`](./docs/mcp.md).
- **Handles long videos** — map-reduce summary pipeline kicks in past ~25K tokens. Transcript caching means regeneration never re-hits YouTube.
- **Fully TanStack stack** — [TanStack Start](https://tanstack.com/start) (Vite + React 19) + [TanStack Router](https://tanstack.com/router) + TanStack AI + [Tailwind v4](https://tailwindcss.com).

---

## Stack

| Layer | Tech |
|---|---|
| Client | [TanStack Start](https://tanstack.com/start), React 19, [Tailwind v4](https://tailwindcss.com), [Radix UI](https://www.radix-ui.com) |
| AI (in-app) | [TanStack AI](https://tanstack.com/ai/latest) + `@tanstack/ai-ollama` |
| Chat/summary model | Any Ollama chat model — default `gemma4-kb:latest` (custom [Gemma 4](https://ollama.com/library/gemma4) Modelfile, Q4) |
| Embedding model | [`nomic-embed-text`](https://ollama.com/library/nomic-embed-text) via Ollama (768-dim, ~137MB). One vector per video; cosine similarity in-memory |
| Backend | [Strapi 5](https://strapi.io) (SQLite for dev, Postgres-ready) |
| MCP server | [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/sdk) Streamable HTTP transport at `/api/mcp`, auth via Strapi API tokens |
| Transcripts | [youtubei.js](https://github.com/LuanRT/YouTube.js) directly against YouTube caption tracks |

---

## Quick start

**Prerequisites:** Node 20+, [Yarn Classic](https://classic.yarnpkg.com/), [Ollama](https://ollama.com) installed.

```bash
# 1. Install everything + copy .env files
yarn setup

# 2. Pull the models.
#    Two models by default: a chat/summary model and an embedding model.
#    The embedding model is small (~137MB) and powers related-videos +
#    library semantic search. Skipping it just hides those features;
#    summaries/chat still work.
ollama pull gemma4-kb:latest   # chat/summary (or gemma3, llama3.2, qwen2.5 — any chat-capable)
ollama pull nomic-embed-text   # embeddings  (override with OLLAMA_EMBEDDING_MODEL)

# 3. (Optional) Load example videos so the feed isn't empty on first run.
#    Reads server/seed-data/seed.tar.gz. Only run BEFORE starting Strapi —
#    the import needs exclusive write access to the SQLite DB.
yarn seed

# 4. Start Ollama + Strapi + the client together
yarn start
```

Open `http://localhost:3015`, paste a YouTube URL on `/new-post`. The row is created immediately; the AI summary runs in the background and lands on `/learn/$videoId` when done.

> `yarn start` is a convenience wrapper that sets Ollama env vars (`OLLAMA_KEEP_ALIVE=15m`, `OLLAMA_NUM_PARALLEL=1`) and then runs `yarn dev`. Use `yarn start:fresh` to hard-restart Ollama first (required after changing `OLLAMA_NUM_PARALLEL`).

> **Seed data.** `yarn seed` runs `strapi import` against `server/seed-data/seed.tar.gz` and **replaces** any existing content in the matching collections. To capture your own library as a seed, stop the dev server and run `yarn export` — it writes to the same path, ready to commit.

---

## How it works

```mermaid
flowchart TD
    A["Client<br/>(/new-post)"] -->|share URL| B["Server function:<br/>shareVideo"]
    B --> B1["create Video row"]
    B --> B2["kick off background generation"]
    B2 --> C["generateVideoSummary"]
    C --> C1["1. lookup or create Transcript (youtubei)"]
    C1 --> C2["2. clean + chunk with real segment times"]
    C2 --> C3{"transcript tokens<br/>&le; 15K?"}
    C3 -->|yes| C4a["3a. single-pass summarize"]
    C3 -->|no| C4b["3b. map-reduce summarize"]
    C4a --> C5["4. BM25 index for chat retrieval"]
    C4b --> C5
    C5 --> C6["5. deterministic timecode grounding"]
    C6 --> C7["6. save summary + chunks to Video row"]
```

### The entities

- **Transcript** — immutable, per YouTube videoId. Caption segments + duration + title/author. Created once per video; reused across regenerations.
- **Video** — your instance. Holds the AI summary, sections, takeaways, action steps, BM25 retrieval index, and a topical embedding. Many-to-many with Tag, Digest, and Note.
- **Tag** — user-created labels. Lowercase-normalized automatically.
- **Note** — markdown entry attached to one or more videos. Four sources: `chat` (summarized from an in-app conversation), `digest-chat` (summarized from a cross-video digest chat), `mcp` (written by an external MCP client), `manual` (user-authored scratchpad).
- **Digest** — structured cross-video synthesis, stored as first-class Strapi components (`sharedThemes`, `uniqueInsights`, `contradictions`, `viewingOrder`, `bottomLine` + `overallTheme`). Optionally carries a long-form `articleMarkdown`. Upserted by `videoSetKey` so the same source-video selection updates one row instead of duplicating.

### The chat path

```mermaid
flowchart LR
    Q["User question"] --> R["BM25 retrieval<br/>(contextual + query rewriting)"]
    R --> P["Top-k chunks + sections<br/>+ takeaways → system prompt"]
    P --> S["TanStack AI chat() stream"]
    S -.->|tool available| W["web_search"]
    W -.-> S
    S --> G["Deterministic [mm:ss]<br/>citation grounding"]
    G --> U["'Sources' accordion<br/>with transcript snippets"]
```

---

## Usage

### Share a video
Paste any YouTube URL on `/new-post`. Tags are optional and comma-separated.

### Summary generation
Runs automatically in the background. The learn page shows live step progress (Fetch transcript → Run local model → Save to library). Short videos go through a single-pass; longer ones map-reduce. Stuck? Hit **Force retry** on the pending screen or **Regenerate** on a completed summary.

### Chat with a video
Stream a conversation at the bottom of any `/learn/$videoId` page. Citations become clickable chips that seek the player. Right-click the timecode chip on a walkthrough section to manually edit it (useful when the grounding mis-anchors).

### Web search during chat
The model will call `web_search` on its own when the transcript doesn't cover the question. To **force** a search regardless of model judgment:

```
/web <your query>
```

e.g. `/web tanstack ai documentation`. The tool call is visible as an expandable panel above the response.

### Manual timecode override
**Right-click** any walkthrough section's timecode chip → popover opens with an editable `mm:ss` field + "Use current video time" button (pulled from the YouTube player via IFrame API). Overrides persist on the Video row.

### Read as article
On any `/learn/$videoId` page, toggle the **Read** tab. Turns the transcript into a clean long-form markdown blog post — filler, sponsor reads, and tangents stripped. Long videos go through a map-reduce pipeline. Generated on-demand on first click, then cached on the Video row.

### Cross-video digests
1. On `/feed`, click **Create digest** and pick 2–5 videos (summaries required).
2. Land on `/digest?videos=A,B,C` — the synthesis runs immediately (shared themes, unique insights, contradictions, viewing order, bottom line).
3. Toggle **Article** for a long-form prose version (click-to-generate).
4. Click **Save digest** — persists to the `api::digest.digest` collection with structured Strapi components.
5. Revisits of the same URL hit the saved row instead of re-running the LLM. Regenerate resets in place.

Saved digests live at `/digests` with full-text search (`title` + `description`) and pagination.

### Notes
From any video chat, click **Summarize to note** — the conversation + full transcript get synthesized into a markdown note attached to the video, written in personal-note voice with preserved `[mm:ss]` timecode chips. The **Notes** tab on the learn page lists every note for that video (chat summaries, digest-chat summaries, MCP-authored notes, manual entries) with delete affordance.

### Related videos + semantic search
- **Related videos** — bottom of any learn page, thumbnail grid of the semantically closest entries in the library. Cosine over the per-video topical embedding.
- **Semantic search on the feed** — toggle search mode from **Keyword** (default) to **Semantic** on `/feed`. Query gets embedded, ranked by similarity to each video's topical embedding. Hybrid intent: "find videos about X" → semantic; "find videos mentioning 'Ollama'" → keyword. Per-result `NN%` similarity chips.

### Settings
`/settings` is the home for app-level infrastructure. Currently hosts the **Semantic embeddings** panel: total/current/stale/missing counts, backfill buttons scoped to `missing`, `stale`, or `all`. Concurrency 3; safe to run anytime.

---

## MCP — driving the KB from Claude Desktop

The in-app chat stays local (Ollama). When you want a frontier model (Claude, GPT, etc.) to reason across your knowledge base — or when you want multiple videos in a single context — connect to the built-in MCP server.

```
Claude Desktop ──▶ POST /api/mcp  (Streamable HTTP + Bearer token)
                   │
                   ▼
                 Strapi MCP server
                 ├── listVideos / getVideo / searchVideos / addVideo / saveSummary
                 ├── listTranscripts / getTranscript / searchTranscript / findTranscripts / fetchTranscript
                 └── listTags / tagVideo / untagVideo / saveNote
```

**Quick setup:**

1. Start Strapi (`yarn server`).
2. Admin UI → **Settings → API Tokens → Create new** → type `Custom` → check **Mcp → handle** → Save → copy the token.
3. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "yt-knowledge-base": {
         "command": "npx",
         "args": [
           "-y", "mcp-remote",
           "http://localhost:1350/api/mcp",
           "--header", "Authorization: Bearer YOUR_TOKEN"
         ]
       }
     }
   }
   ```

4. ⌘Q Claude Desktop and reopen. The connector toggles on; 14 tools appear.

Full walkthrough (Claude Code, Cursor, MCP Inspector, auth rotation) in [`docs/mcp.md`](./docs/mcp.md).

**Design constraint: no tool duplication.** Tools are defined once in `server/src/mcp/tools/` and consumed via MCP. The in-app Ollama chat does not use MCP — it stays on its BM25 + `web_search` path so local inference doesn't pay the protocol overhead. The two worlds meet at the same Strapi data layer, not at the tool definitions.

---

## Environment

### `client/.env`

| Variable | Default | Purpose |
|---|---|---|
| `STRAPI_URL` | `http://localhost:1350` | Local Strapi |
| `STRAPI_API_TOKEN` | *(empty)* | Optional bearer token for locked-down deployments |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Ollama endpoint (the `/v1` suffix is stripped for the TanStack AI adapter, but kept for env-file portability) |
| `OLLAMA_MODEL` | `gemma4-kb:latest` | Summary generation model |
| `OLLAMA_CHAT_MODEL` | *(inherits `OLLAMA_MODEL`)* | Separate model for chat Q&A if you want one |
| `OLLAMA_SYNTHESIS_MODEL` | *(inherits `OLLAMA_CHAT_MODEL`)* | Optional bigger model for library-wide synthesis (`/api/ask`, note compose) |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Embedding model for related-videos + semantic search. Any Ollama embedding model works — swap + bump `EMBEDDING_VERSION` to force reindex. |
| `MAP_CONCURRENCY` | `1` | Parallel map-step chunks on long videos. Bump to 2-4 if you have RAM headroom. Must match `OLLAMA_NUM_PARALLEL` on the server side. |
| `TRANSCRIPT_PROXY_URL` | *(empty)* | Residential proxy for the YouTube caption fetch — only needed if your IP hits a bot wall |

`EMBEDDING_VERSION` is not a client env var — it's a code constant in `client/src/lib/env.ts` (currently `2`), the compound invalidation key alongside `OLLAMA_EMBEDDING_MODEL`. Bump it by editing that file when the text-builder in `client/src/lib/services/embeddings.ts` changes (different fields concatenated, different ordering); any stored `embeddingVersion` that doesn't match is flagged stale.

### Ollama environment (via `launchctl setenv` on macOS)

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_KEEP_ALIVE` | `5m` (Ollama default) | How long models stay warm. `yarn start` sets this to `15m` |
| `OLLAMA_NUM_PARALLEL` | `1` (Ollama 0.20+) | Concurrent inference slots. Raise alongside `MAP_CONCURRENCY` if you have RAM for it |

### `server/.env`

Standard Strapi config. `yarn setup` copies `server/.env.example` into `server/.env` with sane local defaults; regenerate the secrets before shipping anywhere beyond your laptop.

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address for the Strapi HTTP server |
| `PORT` | `1350` | Strapi port — must match `STRAPI_URL` in `client/.env` |
| `APP_KEYS` | *(generated)* | Comma-separated session cookie signing keys. **Regenerate for any non-local deploy.** |
| `API_TOKEN_SALT` | *(generated)* | Salt used when hashing issued API tokens |
| `ADMIN_JWT_SECRET` | *(generated)* | Signs admin-panel JWTs |
| `TRANSFER_TOKEN_SALT` | *(generated)* | Salt for the transfer-tokens used by `strapi export` / `strapi import` |
| `ENCRYPTION_KEY` | *(generated)* | Symmetric key for Strapi's field-level encryption |
| `JWT_SECRET` | *(generated)* | Signs users-and-permissions JWTs |
| `DATABASE_CLIENT` | `sqlite` | `sqlite` for local dev; set to `postgres` (or `mysql`) in production |
| `DATABASE_FILENAME` | `.tmp/data.db` | SQLite file path (relative to `server/`). Ignored when `DATABASE_CLIENT` is not sqlite |
| `DATABASE_HOST` / `_PORT` / `_NAME` / `_USERNAME` / `_PASSWORD` | *(empty)* | Connection details for Postgres/MySQL. Leave empty for SQLite. |
| `DATABASE_SSL` | `false` | Enable SSL for the DB connection (managed Postgres providers usually require this) |

**Regenerating secrets:** each of the six `*_KEY` / `*_SECRET` / `*_SALT` values is just a base64-encoded 16-byte random string. Regenerate with:

```bash
openssl rand -base64 16
```

For `APP_KEYS`, generate four and comma-separate them.

---

## Architecture notes

### All generation is background + cached
`generateVideoSummary` runs as a fire-and-forget task after a share or regenerate. A single `generationInflight` Set in the server function module dedupes concurrent triggers. If generation fails after the transcript is saved, the next retry starts from AI generation — **YouTube is never re-hit** unless you pass `forceRefetch`.

### Two retrieval layers, one app
- **Chat retrieval = BM25.** Single-video Q&A where the whole transcript fits in the local model's context budget doesn't need dense embeddings. BM25 + contextual retrieval + reciprocal rank fusion across rewritten queries delivers solid top-k without the operational overhead. See `client/src/lib/services/transcript.ts`.
- **Cross-video discovery = embeddings.** Related-videos (learn page) and library-wide semantic search (`/feed` in Semantic mode) both cosine-rank the per-video topical embedding (title + summary overview + takeaways + section headings + tags). One vector per video, stored as JSON on the Video row — no pgvector, no vector DB. At personal-KB scale (<1000 videos) an in-memory cosine scan runs in ~1–2 ms. See `client/src/lib/services/embeddings.ts`. Both layers use the same Ollama instance with different models (`OLLAMA_MODEL` for chat, `OLLAMA_EMBEDDING_MODEL` for vectors).

### Digest upsert by videoSetKey
A digest's identity is *the set of source videos it synthesizes*, not a serial ID. Every save computes `videoSetKey = sort(youtubeVideoIds).join(',')` and upserts on that key — re-saving the same `/digest?videos=A,B` URL updates the existing row in place instead of creating duplicates. The loader also checks this key first, so revisiting a saved digest URL renders the cached structured data without re-running the LLM. Regenerate is explicit.

### Embedding invalidation
Stored vectors carry two invalidation keys: `embeddingModel` (the Ollama model that produced them) and `embeddingVersion` (the text-builder's schema version). A mismatch against either current-env value flags the vector stale; `/settings` offers one-click backfill for missing/stale/all. Graduating to a larger embedding model, or changing what fields feed the embedder, is a two-line env change followed by one click.

### Timecodes are deterministic, not model-generated
The model is explicitly instructed NOT to emit timecodes in its output. After generation, each section runs through BM25 against the transcript chunks; the top match's real caption-segment start becomes the section's `timeSec`. Same pattern is used in chat to ground every `[mm:ss]` the model does emit, with drift flagged in the Sources accordion.

### Map-reduce for long videos
Transcripts over ~25K estimated tokens split into 2500-word windows (50-word overlap). Each window produces bullet notes in parallel (up to `MAP_CONCURRENCY`); a final reduce pass synthesizes the structured summary. Chunk timecodes come from real caption segments, not wpm estimation.

---

## Development

```bash
yarn dev            # Strapi + client only (skip the Ollama env setup)
yarn client         # Client only (expects Strapi already running)
yarn server         # Strapi only
yarn --cwd client test    # Run vitest suite
```

The `server/` and `client/` directories are independent git repos; the monorepo root is unversioned. The `tanstack-ai-migration` branch in `client/` is where active development has happened — merge to `main` when ready.

---

## Known limitations

- **Local model tool-call reliability is probabilistic.** Gemma 4 at 4B-effective params lands around 42% on [Tau2](https://arxiv.org/abs/2406.12045). Single-shot tool calls (like `web_search`) work most of the time; agentic multi-step chains don't. Use `/web <query>` when you need determinism.
- **Single-node process assumption.** Inflight generation state is tracked in an in-memory `Set`. Horizontal scaling would need to move this to Redis or a DB table.
- **SQLite for dev.** Set `DATABASE_CLIENT=postgres` in `server/.env` and restart for production.

---

## License

GNU GPL v3 or later. See [LICENSE](./LICENSE) for the full text.

Built by Paul @ [Strapi](https://strapi.io).
