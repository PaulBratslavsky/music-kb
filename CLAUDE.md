# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`music-kb` is a personal knowledge base for YouTube **music tutorial** videos. It was forked from `yt-knowledge-base` and inherits its architecture wholesale (transcripts, BM25 chat, embeddings, summaries, hybrid Content score, MCP server). The differences live in the music layer:

- Music-flavored note templates and tag taxonomy
- An interactive **theory companion panel** on each learn page (piano, guitar, Ableton Push, tab, sheet music) backed by the `tonal` library — ported from the standalone `instrument-visualizer` project
- Music-aware AI extraction: chords, key, techniques, and referenced songs extracted from the transcript into `Video.musicExtraction` (`client/src/lib/services/music-extraction.ts`) — runs best-effort after summary generation, manually triggerable from the Theory tab or in bulk from `/settings`, timecodes BM25-grounded per ADR 0004. The extraction feeds every retrieval surface (embedding text-builder v3 + the BM25 legs), so "videos in E minor" works on `/feed` semantic search and `/api/ask`; each extraction re-embeds its video to keep the vector in sync.

The base architecture below carries over from the parent project unchanged unless noted.

## Repository shape

Monorepo with **isolated installs** — four packages, each owning its own
`node_modules` and `yarn.lock`. Deliberately *not* a Yarn workspace: see
"Don't / Gotchas". One codebase, deployed separately; only `web` deploys
publicly.

- `client/` — TanStack Start (Vite + React 19) app on port **3015**. Server functions and Nitro API routes live alongside the React routes.
- `server/` — Strapi 5 (SQLite for dev) on port **1350**. Hosts the data model, REST API, the official Strapi MCP server at `/mcp`, and the `seed-data/` archive.
- `web/` — **Paul's Music Helper**, the light companion SPA. No backend, no LLM, `localStorage` only; deploys to Vercel. Hash-routed (`useHashRoute.ts`), Tailwind v4. Has its own `CLAUDE.md`. **Owns the hand-written lessons** — see "Two kinds of lesson" below.
- `packages/music/` — `@music-kb/music`, the music-theory layer **shared by `client/` and `web/`**: `theory/`, `instruments/*/layout.ts`, `state/gameModeStorage.ts`, `types.ts`. Framework-free by rule — no React, no DOM beyond `localStorage`, one runtime dependency (`tonal`).
- `docs/` — design notes, planning docs, and architecture deep-dive (`architecture.md`).
- Root `package.json` is a task runner: delegating scripts plus `concurrently` / `wait-on` / `typescript`. It has **no** workspace list and no React. **Do not run app code from the root** — it has no `src/`.

`client` and `server` are independent: the client never imports from `server/` and vice versa. They communicate over Strapi's REST API and (for write-side internal services) authenticated REST calls in `client/src/lib/services/strapi-client.ts`.

`client` and `web` share exactly one thing — `@music-kb/music`. **Their React views are deliberately separate** (different palettes, different state, Tailwind vs inline styles); don't try to unify them as a side effect of another change. See [ADR 0009](docs/adr/0009-monorepo-with-shared-music-package.md) and `docs/companion-web-app.md`.

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
| `yarn web` | The companion SPA's dev server only. |
| `yarn test` | All four suites: `packages/music`, then `server`, then `client`, then `web`. |
| `yarn export` | Exports current Strapi DB to `server/seed-data/seed.tar.gz`. |

### Tests

```bash
yarn test                                      # every suite (1657 tests)
yarn --cwd packages/music test                 # the shared theory layer (279)
yarn --cwd server test                         # lesson-block schema + BM25 parity (168)
yarn --cwd client test                         # the KB app (1201)
yarn --cwd web test                            # the companion SPA (9)
yarn --cwd client test path/to/file.test.ts    # single file
yarn --cwd client test -t "name fragment"      # filter by test name
yarn --cwd client test:e2e                     # Playwright smoke (needs stack up)
```

Unit tests are vitest. **They live in four places**: theory tests in
`packages/music/src/`, app tests in `client/src/`, SPA tests in `web/src/`,
and — since 2026-08-26 — server tests in `server/src/`. A bare
`yarn --cwd client test` silently skips 456 of them — use the root script.
The server suite is for what it can **execute**: `lesson-blocks.ts`, which the
client-side parity tests can only read as *text*, and — since ADR 0010 —
`bm25-search.parity.test.ts`, which imports the client's `transcript.ts`
directly to compare the two BM25 implementations by behaviour rather than by
source. That cross-package import is legal only because both files have zero
imports, and the guard asserts that. No `strapi` mock, no bootstrap.
**Server test files are typechecked by nothing** —
`server/tsconfig.json` excludes `**/*.test.*` (which is what keeps them out of
the Strapi build) and vitest strips types without checking them.
Playwright e2e specs live in `client/e2e/*.spec.ts` and assume the full
stack is already running (`yarn dev`/`yarn start` from the repo root) —
they do not boot it. They guard the seroval server→client boundary on the
video-shipping surfaces (`/feed`, semantic feed, `/learn`, `/search`).
`vitest.config.ts` (which vitest prefers over `vite.config.ts`, deliberately
plugin-free) holds the `test.include`/`exclude` that keep vitest out of `e2e/`.

### Typecheck

```bash
cd client && npx tsc --noEmit                  # client typecheck (no project-wide script)
cd server && npx tsc --noEmit                  # server typecheck (test files are excluded)
yarn --cwd web build                           # tsc -b && vite build — web's honest gate
```

There is no lint command — TypeScript and tests are the only static gates. The server has its own `tsconfig.json` and is built by Strapi when it boots.

For `web/`, use the **build**, not `tsc --noEmit`: `--noEmit` has passed there twice while `tsc -b` caught real type errors. The root `.githooks/pre-push` hook runs it before every push (`git config core.hooksPath .githooks` once per clone).

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

### Map-reduce kicks in past ~15K tokens

Single-pass for short transcripts (≤ `SINGLE_PASS_TOKEN_BUDGET`, 15K); long ones split into 2500-word windows (50-word overlap), parallel map-step at `MAP_CONCURRENCY` (which **must match** `OLLAMA_NUM_PARALLEL`), then a final reduce. Code in `client/src/lib/services/learning.ts`.

### MCP server lives in Strapi

The **official Strapi MCP server** (built into 5.47+) serves `/mcp`, gated by admin API tokens. Our 29 domain tools (videos, transcripts, tags, notes, music data, lessons) register on it from `server/src/index.ts` via the adapter in `server/src/mcp/` (`adapter.ts` + `catalog.ts` + `permissions.ts` + `registerTool` wrapping), reusing the tool bodies in `server/src/mcp/tools/`. **Permissions are one admin action per tool** — `api::music-kb-mcp.tool.<kebab-name>`, *derived* from `catalog.ts` by `permissions.ts`, never hand-listed; the read/write/maintenance tiers survive only as UI grouping, and a boot migration upgrades tokens minted against the old tier actions (ADR 0008, 2026-08-25 note). MCP tool schemas are built with the app's own top-level `zod` (verified: all 27 tool files import from `'zod'`). This used to be the `z` re-exported from `@strapi/utils` — Strapi's own zod instance, which did not structurally unify with the app's — but that changed in `f4ef249`; don't reintroduce the `@strapi/utils` import. **Each tool's input schema is declared exactly once**, on `ToolDef.schema`; `catalog.ts` supplies only `title` + `access`. Never re-declare a tool's schema in a second place — a previous split had the two copies drift, and only the catalog copy reached clients (see ADR 0008). **Tool implementations are defined once** in `server/src/mcp/tools/` — the in-app Ollama chat does not use MCP, keeping local inference protocol-free. The hand-rolled `/api/mcp` server was retired (ADR 0008); `server/scripts/test-mcp.mjs` targets the live `/mcp` (32 checks — verified green against it). **Never point it at data you care about**: a `RUN_WRITES=1` run once destroyed a real video summary. See `docs/mcp.md`.

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
- **Local-first by default; interactive surfaces are switchable.** Ollama for all inference + embeddings by default. Two documented exceptions: **lesson generation** (decided 2026-08-21) may use a hosted model when `ANTHROPIC_API_KEY` is set, falling back to local when it isn't — a real run showed the local model produces thin lessons with weak citations, and lesson writing is the one job here that needs judgment rather than throughput; and **the four interactive surfaces** (`video-chat`, `digest-chat`, `library-ask`, `note-compose`) may be re-pointed per request by an explicit user choice in the model picker (decided 2026-08-27, **[ADR 0011](docs/adr/0011-model-switcher-on-interactive-surfaces.md)**). Keys are server-side only and never reach the browser.

  **Bulk and background surfaces are still type-locked local, and that is the guarantee that matters.** `LOCAL_ONLY_SURFACES` — summaries, query rewriting, digest synthesis and articles, music extraction, reading mode, note summarisation — have **no override path at all**. The reason local-first exists is economic, not aesthetic: the local-first constraint is what makes bulk jobs like re-embedding the whole library free. That argument applies in full to an unattended pass over the library and not at all to one chat turn a human is waiting on, which is exactly where the 2026-08-27 line was drawn. **Do not widen the switchable set to a bulk surface** without the same kind of evidence the lesson exception required.

  **This is mechanised, not conventional.** Every surface still *defaults* local: with no explicit choice, `resolveModel(surface)` in `client/src/lib/services/model-policy.ts` returns the same local model from the same env constant it always did. `client/src/lib/services/frontier-model.ts` (renamed from `lesson-model.ts`) remains **the only module in the app** that may call `createAnthropicChat` or read `ANTHROPIC_API_KEY`; `buildFrontierModel` is extracted so lesson generation and chat share one construction and the log-safety hooks (`toJSON`/`inspect`/`redact`, which stop `console.log(model)` traversing into the SDK client's live `.apiKey`) cannot drift. Every export that can *return* a frontier model has a pinned importer list: `resolveLessonModel` → `lesson-generation.ts`, `resolveChatModel` → `chat-model-request.ts`. The client sends a **choice token** (`'default' | 'local:<id>' | 'frontier'`), never a model id and never a key; `local:` tokens are validated against the installed Ollama catalogue before an adapter is built, and an unknown id is refused with a `notice` rather than silently answered by a different model than the picker shows. All of it is pinned by **`client/src/lib/services/model-policy.test.ts`** (+ its `.tiers` sibling). One documented caveat — `synthesizeDigest` takes an optional resolved model and lesson generation passes its own, so digest synthesis is frontier-reachable *by inheritance*; its own default is local and `digest.test.ts` pins that no other caller passes an override. See ADR 0001's 2026-08-26 amendment and ADR 0011.

  **Sharp edge:** system prompts are delivered **tier-specifically**. Ollama accepts a `{ role: 'system' }` turn in the messages array; Anthropic does not — it takes a separate top-level `system` parameter, and a system turn left in the array is dropped *without failing the request*, silently losing the retrieved context and the skill persona. `api.chat.tsx` branches on `model.tier`. Any new switchable surface must do the same.
- **Install per package** — `yarn install:all` from the root, or a plain `yarn install` inside the one you're changing. There is no workspace and no hoisting, **on purpose**: Strapi needs React 18 (`@strapi/admin` peers `^17 || ^18`) while `client` and `web` are on React 19. Sharing one root put both in reach of each other and gave the client a second React *instance*, which nulls the hook dispatcher and killed SSR on `/feed` and `/learn` (`docs/ssr-client-fallback.md`). Isolation costs four installs and four lockfiles; it buys the guarantee that the two React majors can never meet.
- **`packages/music` is linked, not published.** `client` and `web` depend on it as `link:../packages/music`, which symlinks — edits are live in both. Never change this to `file:`; that *copies* and silently goes stale.
- **Two kinds of lesson — do not merge them.** This split is deliberate and was decided 2026-08-20:
  - **`web/src/lessons/*.tsx`** — the hand-written, interactive React lessons (triads, half-steps-to-chords, …), with their own widget set in `web/src/lessons/components/`. These are authored by hand (with Claude) and are the *only* home for that format. **Do not migrate these into Strapi.**
  - **`client/` `/lessons`** — the `api::lesson.lesson` Strapi collection, rendered from a dynamic zone of typed blocks (`LessonBody.tsx`). This is where AI-generated lessons land. It holds no hardcoded lessons.

  The client used to carry duplicate copies of all 8 hand-written lessons; they were deleted once this split was made. If you find yourself re-adding a hardcoded lesson route under `client/src/routes/lessons.*.tsx`, or translating a `web/` lesson into Strapi blocks, stop — that is undoing this decision. Design notes: `docs/superpowers/specs/2026-08-20-strapi-lessons-design.md`.
- **Theory changes hit both apps at once.** `packages/music` has no version skew to hide behind — break it and you break two builds. Its 279 tests are the guard; run them.
- **The BM25 retrieval core is duplicated on purpose — don't extract it.** `server/src/services/bm25-search.ts` is a hand-copy of the scoring, grounding and timecode-rewriting logic in `client/src/lib/services/transcript.ts`. Extracting it into a shared package was measured and rejected in **[ADR 0010](docs/adr/0010-duplicated-retrieval-guarded-not-shared.md)**: `packages/music` is ESM-only with an `exports` map pointing at raw `.ts` and no build step, so it is consumable *only by a bundler*, and Strapi's pipeline is `tsc` → Node. **No `server/tsconfig.json` setting fixes that** — and the one that *typechecks* clean (`module: "preserve"` + `moduleResolution: "bundler"`, 0 errors) then kills `strapi build` on `config/database.ts` with `__dirname is not defined`. The copy is pinned by `server/src/services/bm25-search.parity.test.ts` (58 behavioural cases, in the **server** suite because it *executes* both sides). The server's copy deliberately omits four client query-side filters — the `BM25_MIN_QUERY_IDF = 1.5` floor most of all, so a low-idf query returns nothing in-app and returns hits over MCP. That is intended; the header and the test both say so. The verdict reverses the day anything in `server/` calls `buildBM25Index` — the test asserts that too.
- **A cross-package guard goes in the client suite if it compares TEXT, the server suite if it compares BEHAVIOUR.** Text guards read the other package's source off disk. Behavioural guards import it directly — permitted **only for dependency-free modules**, and the guard must assert that dependency-freedom itself. The direction is fixed: `client/tsconfig.json` includes `**/*.ts`, so a client-side test importing server source would drag server files into the client's `tsc --noEmit` gate. See `docs/ai-architecture.md`, "What crosses the boundary".
- **`__component` must be the FIRST key when writing a dynamic zone over REST.** Strapi's own GET response serialises it *last*, so round-tripping a lesson body straight back is rejected with `Invalid key __component at body` — an error that names the key and says nothing about ordering. Reorder before PUT (`{ __component: b.__component, ...b }`). Two more shapes Strapi returns but won't accept back: component `id`s that belong to the entity, and `null` for an empty component array (`dots must be a array type, but the final value was: null`) — strip both; absent is how Strapi spells empty on the way in. `server/scripts/repair-diagram-windows.mjs` does all three and is the worked example.
- **`yarn seed` requires Strapi stopped.** SQLite needs exclusive write access for the import; running it against a live Strapi corrupts the DB.
- **Bump `EMBEDDING_VERSION` when changing the text-builder.** Otherwise old vectors silently survive a meaning-changing edit.
- **Orphan node on :1350 or :3015** breaks `yarn dev` with cryptic `[strapi] fetch failed` spam from the client. `start.sh` kills these pre-flight; if you're running `yarn dev` directly, do it yourself with `lsof -ti :1350 -ti :3015 | xargs kill -9`.
- **This repo's git history starts fresh from the fork.** Don't try to `git pull` from the original `yt-knowledge-base` — there's no shared history. If you want a fix from the parent project, cherry-pick the diff manually.
