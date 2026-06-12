# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`music-kb` is a personal knowledge base for YouTube **music tutorial** videos. It was forked from `yt-knowledge-base` and inherits its architecture wholesale (transcripts, BM25 chat, embeddings, summaries, hybrid Content score, MCP server). The differences live in the music layer:

- Music-flavored note templates and tag taxonomy
- An interactive **theory companion panel** on each learn page (piano, guitar, Ableton Push, tab, sheet music) backed by the `tonal` library — ported from the standalone `instrument-visualizer` project
- Music-aware AI extraction: chords, key, techniques, and referenced songs extracted from the transcript into `Video.musicExtraction` (`client/src/lib/services/music-extraction.ts`) — runs best-effort after summary generation, manually triggerable from the Theory tab or in bulk from `/settings`, timecodes BM25-grounded per ADR 0004. The extraction feeds every retrieval surface (embedding text-builder v3 + the BM25 legs), so "videos in E minor" works on `/feed` semantic search and `/api/ask`; each extraction re-embeds its video to keep the vector in sync.

The base architecture below carries over from the parent project unchanged unless noted.

## Repository shape

Two-package monorepo with an unversioned root:

- `client/` — TanStack Start (Vite + React 19) app on port **3015**. Server functions and Nitro API routes live alongside the React routes.
- `server/` — Strapi 5 (SQLite for dev) on port **1350**. Hosts the data model, REST API, the MCP server at `/api/mcp`, and the `seed-data/` archive.
- `docs/` — design notes, planning docs, and architecture deep-dive (`architecture.md`).
- Root `package.json` is a shell that delegates to the two packages via `yarn` workspaces-style scripts. **Do not run app code from the root** — it has no `src/`.

The two halves are independent: the client never imports from `server/` and vice versa. They communicate over Strapi's REST API and (for write-side internal services) authenticated REST calls in `client/src/lib/services/strapi-client.ts`.

## Common commands

All run from the **repo root** unless noted.

| Command | What it does |
|---|---|
| `yarn setup` | Install both packages + copy `.env.example` files. Run once after cloning. |
| `yarn start` | Full stack: tunes Ollama env (`OLLAMA_KEEP_ALIVE=15m`, `OLLAMA_NUM_PARALLEL=1`), launches Ollama if needed, kills orphans on :1350 / :3015, then `yarn dev`. |
| `yarn start:fresh` | Same as `start` but `pkill -9 ollama` first — required after changing `OLLAMA_NUM_PARALLEL`. |
| `yarn dev` | Strapi + client only, no Ollama setup. Uses `concurrently` + `wait-on http://localhost:1350`. |
| `yarn server` | Strapi only (`strapi develop`). |
| `yarn client` | Client only (assumes Strapi is up). |
| `yarn seed` | Imports `server/seed-data/seed.tar.gz`. **Run before starting Strapi** — needs exclusive write to SQLite. |
| `yarn export` | Exports current Strapi DB to `server/seed-data/seed.tar.gz`. |

### Tests

```bash
yarn --cwd client test                         # full vitest suite (~290 tests)
yarn --cwd client test path/to/file.test.ts    # single file
yarn --cwd client test -t "name fragment"      # filter by test name
yarn --cwd client test:e2e                     # Playwright smoke (needs stack up)
```

Unit tests are vitest, in `client/src/` only. The server has no test suite.
Playwright e2e specs live in `client/e2e/*.spec.ts` and assume the full
stack is already running (`yarn dev`/`yarn start` from the repo root) —
they do not boot it. They guard the seroval server→client boundary on the
video-shipping surfaces (`/feed`, semantic feed, `/learn`, `/search`).
`vitest.config.ts` (which vitest prefers over `vite.config.ts`, deliberately
plugin-free) holds the `test.include`/`exclude` that keep vitest out of `e2e/`.

### Typecheck

```bash
cd client && npx tsc --noEmit                  # client typecheck (no project-wide script)
```

There is no lint command — TypeScript and tests are the only static gates. The server has its own `tsconfig.json` and is built by Strapi when it boots.

## Architecture (the parts that span files)

The README at the repo root has the overview and `docs/architecture.md` has the deep dive. Read those for a full picture; the items below are the load-bearing ideas you'll trip over editing the code.

### Two retrieval layers, one app

- **Per-video chat** uses **BM25 over transcript chunks** (`client/src/lib/services/transcript.ts` for the index, `chat-retrieval.ts` for query rewriting + RRF fusion). One transcript fits in a single Ollama context, so dense embeddings would be operational overhead with no payoff.
- **Cross-video discovery** (Related videos, semantic search on `/feed`) uses **embeddings**, one per video, stored as JSON on the Strapi Video row. In-memory cosine scan in `client/src/lib/services/embeddings.ts` — no pgvector, no vector DB. Personal-KB scale (<1000 videos) is ~1–2ms.
- Both layers hit the same Ollama instance with **different models** (`OLLAMA_MODEL` for chat, `OLLAMA_EMBEDDING_MODEL` for vectors, `OLLAMA_SYNTHESIS_MODEL` optional for `/api/ask`).

### Generation is background + dedup'd + cached

`generateVideoSummary` in `client/src/lib/services/learning.ts` runs as fire-and-forget after a share/regenerate. A single in-process `Set` (`generationInflight` in `client/src/lib/services/generation-state.ts`) dedupes concurrent triggers. **The transcript is cached in Strapi** — once fetched from YouTube, regeneration only re-runs the AI step, never re-hits youtubei.js unless you pass `forceRefetch`. That assumption is single-node-only; horizontal scaling would need a shared inflight store.

### Hybrid Content score (LLM + programmatic)

Each video carries three score fields:
- `valueScore` (0–100) — LLM judgment, set during summary generation.
- `signalScore` (0–100) — programmatic composite from filler density, lexical density, gzip compression ratio, speaking pace, sponsor presence (`client/src/lib/services/content-signals.ts`).
- `finalScore` (0–100) — `computeFinalScore(valueScore, signalScore)` in `client/src/lib/services/videos.ts`. Default weights: 60% signal, 40% value (`FINAL_SCORE_WEIGHTS`). **`finalScore` is the canonical user-visible "Content score"**; the other two are the inputs.

All partial score updates (verdict-only re-rate, derived-value backfill, signal-only recompute, finalScore re-derive) go through **one writer**: `applyVideoScoreUpdateService` in `client/src/lib/services/videos.ts`, which derives `finalScore` internally. The full-summary save (`updateVideoSummaryService`) derives it the same way. **Never compute or pass `finalScore` from a caller** — if you add a score path, route it through the writer; the invariant is pinned by `videos.score-writer.test.ts`.

### Timecodes are deterministic

The model is **explicitly instructed not to emit timecodes** in summary output. After generation, each section runs through BM25 against transcript chunks and the top-match's real caption-segment start becomes the section's `timeSec`. Same pattern grounds every `[mm:ss]` chip the model emits in chat — drift is flagged in the Sources accordion. **Do not add a code path that trusts a timecode the model produced.**

### Strapi client wraps every backend call

`client/src/lib/services/strapi-client.ts` exposes `strapiFetch<T>` returning a discriminated union `StrapiResult<T> = { ok: true; data; meta? } | { ok: false; status; error }`. Every Strapi call goes through it; status `0` means network unreachable. Two route loaders (`/feed`, `/learn/$videoId`, `/video/$documentId`) use error-aware `*WithStatus` service helpers that distinguish "row doesn't exist" from "backend down" and render the shared `BackendErrorPanel` component.

### Ollama errors get translated for users

`client/src/lib/services/ollama-errors.ts` exports `friendlyOllamaError(raw)` that pattern-matches host-unreachable / model-not-found / timeout strings and returns a recovery hint. **Always pipe Ollama-related caught errors through it before surfacing to users** — chat hooks, generation FailedState, etc.

### Digest identity = video set

A digest is identified by `videoSetKey = sort(youtubeVideoIds).join(',')`, not a serial id. Re-saving the same selection upserts in place. The loader checks this key first to render cached structured data without re-running the LLM. Logic lives in `client/src/lib/services/digests.ts` and the `/digest` route loader.

### Embedding invalidation

Stored vectors carry `embeddingModel` + `embeddingVersion`. Mismatch with current env flags the row stale; `/settings` offers backfill (missing / stale / all). Bumping the code-level (client/src/lib/env.ts) `EMBEDDING_VERSION` alongside changing the text-builder in `client/src/lib/services/embeddings.ts` is the protocol — without it, old vectors silently keep being trusted.

### Map-reduce kicks in past ~25K tokens

Single-pass for short transcripts; long ones split into 2500-word windows (50-word overlap), parallel map-step at `MAP_CONCURRENCY` (which **must match** `OLLAMA_NUM_PARALLEL`), then a final reduce. Code in `client/src/lib/services/learning.ts`.

### MCP server lives in Strapi

`server/src/mcp/` exposes 23 tools (videos, transcripts, tags, notes, music data) over Streamable HTTP at `/api/mcp` with bearer-token auth. **Tools are defined once here** — the in-app Ollama chat does not use MCP, and reusing tool implementations across the two worlds is intentionally avoided to keep local inference protocol-free. See `docs/mcp.md`.

## Routing and aliases

- Client uses TanStack Router with **file-based routes** in `client/src/routes/`. `routeTree.gen.ts` is generated — never edit by hand.
- Path alias `#/*` → `./src/*` (defined in `client/package.json`'s `imports` field). Use it instead of relative `../../../` paths.
- API endpoints are file routes prefixed `api.*` (e.g. `routes/api.ask.tsx` → `POST /api/ask`).

## Conventions worth knowing

- **Server functions** (TanStack Start `createServerFn`) live in `client/src/data/server-functions/` and are the boundary between React loaders and the service layer in `client/src/lib/services/`. Put zod input validation on the server fn, business logic in the service, Strapi I/O in `strapi-client.ts`.
- **Background generation** writes to a Strapi field `summaryStatus: 'pending' | 'generated' | 'failed'`. The route loader reads this; the polling hook in `learn.$videoId.tsx` invalidates every 3s while pending.
- **Selection state** (digest mode, etc.) is page-local React state — it survives loader re-runs but resets on route change.

## Don't / Gotchas

- **Don't bypass `strapiFetch`.** It's the one place that handles auth, error shape, query param flattening, and logging. Inline `fetch('/api/...')` to Strapi has been removed; don't reintroduce it.
- **Don't trust LLM-generated timecodes.** See above. They get post-processed against the transcript every time.
- **Don't introduce cloud AI adapters.** Local-first is a design constraint — Ollama only for inference + embeddings. Frontier models are reachable via MCP from Claude Desktop / Code, not via in-app cloud SDKs.
- **`yarn seed` requires Strapi stopped.** SQLite needs exclusive write access for the import; running it against a live Strapi corrupts the DB.
- **Bump `EMBEDDING_VERSION` when changing the text-builder.** Otherwise old vectors silently survive a meaning-changing edit.
- **Orphan node on :1350 or :3015** breaks `yarn dev` with cryptic `[strapi] fetch failed` spam from the client. `start.sh` kills these pre-flight; if you're running `yarn dev` directly, do it yourself with `lsof -ti :1350 -ti :3015 | xargs kill -9`.
- **This repo's git history starts fresh from the fork.** Don't try to `git pull` from the original `yt-knowledge-base` — there's no shared history. If you want a fix from the parent project, cherry-pick the diff manually.
