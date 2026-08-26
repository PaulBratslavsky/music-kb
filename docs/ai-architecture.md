# AI architecture

Where the model calls live, what crosses the client/Strapi boundary, and why
the two tool systems don't share code.

Companion to `docs/architecture.md` (the general deep dive) and `docs/mcp.md`
(the MCP server's operational detail). This file covers only the AI layer.

## The one-sentence version

**Every model call lives in `client/`. Strapi calls a model exactly once — to
build an embedding — and does it with a raw `fetch`, no SDK.**

## Package boundary

| | `client/` | `server/` (Strapi) |
|---|---|---|
| `@tanstack/ai` | 0.45.1 | — |
| `@tanstack/ai-ollama` | 0.9.1 | — |
| `@tanstack/ai-anthropic` | 0.16.6 | — |
| Model calls | all of them | one raw `fetch` to `/api/embeddings` |

`@tanstack/ai-anthropic` is pinned at **0.16.6**, not 0.17.0: 0.17.0 declares a
peer of `@tanstack/ai@^0.47.3` and throws at import against the pinned 0.45.1
(`adapter-internals` doesn't export `assertUniqueToolNames` until after 0.45.1).
Bumping the core to chase it is its own task — see
`docs/tanstack-ai-upgrade-plan.md`.

## How a TanStack AI call is assembled

Three layers, in every AI surface:

1. **Adapter** — `createOllamaChat(model, host)` or `createAnthropicChat(model, key)`,
   constructed once at module scope.
2. **`chat({ adapter, messages, tools, modelOptions })`** — the single entry point.
   Tools declared with `toolDefinition()` are auto-executed server-side by the
   agent loop; the model's tool call never reaches the browser.
3. **Transport** — `toServerSentEventsResponse()` on the route, parsed back into a
   typed `StreamEvent` iterator by `client/src/lib/services/chat-stream.ts`. That
   parser is the one transport for every streaming consumer (`VideoChat`,
   `DigestChat`, `useLibraryChat`, `NoteComposer`); it exists because the four had
   drifted apart on field names.

Two `@tanstack/ai` 0.45 quirks are encoded in
`client/src/lib/services/ollama-model-options.ts` so call sites don't repeat them:
sampling knobs moved under `modelOptions.options`, and `model` is a required
field the adapter never reads.

## Which model backs which surface

| Surface | Entry point | Model |
|---|---|---|
| Per-video chat | `routes/api.chat.tsx` | `OLLAMA_CHAT_MODEL` |
| Query rewrite (RRF) | `services/chat-retrieval.ts` | `OLLAMA_CHAT_MODEL` |
| Digest chat | `routes/api.digest-chat.tsx` | `OLLAMA_CHAT_MODEL` |
| Library ask | `routes/api.ask.tsx` | `OLLAMA_SYNTHESIS_MODEL` |
| Note compose | `routes/api.notes.compose.tsx` | `OLLAMA_SYNTHESIS_MODEL` |
| Summaries | `services/learning.ts` | `OLLAMA_MODEL` |
| Music extraction | `services/music-extraction.ts` | `OLLAMA_MODEL` |
| Reading mode | `services/reader.ts` | `OLLAMA_MODEL` |
| Digest synthesis | `services/digest.ts` | `OLLAMA_MODEL`, overridable |
| **Lesson generation** | `services/lesson-generation.ts` | **`resolveLessonModel()`** |
| Embeddings (in-app) | `services/embeddings.ts` | `OLLAMA_EMBEDDING_MODEL` |
| Embeddings (MCP) | `server/src/mcp/utils/embeddings.ts` | `OLLAMA_EMBEDDING_MODEL` |

**Lesson generation is the only surface that can reach a frontier model.** That is
the documented single exception to local-first (CLAUDE.md, decided 2026-08-21):
`resolveLessonModel()` in `services/lesson-model.ts` returns an Anthropic adapter
when `ANTHROPIC_API_KEY` is set and an Ollama adapter when it isn't. Both tiers run
the identical staged pipeline, so the two are comparable rather than divergent code
paths. `ANTHROPIC_API_KEY` is read once, there, and never appears in the returned
`LessonModel` — only the constructed adapter, the tier, and the model id.

## The two tool systems

This is the part that surprises people: **there are two completely separate tool
systems, and they share no code.**

### A — TanStack AI tools (in-app agent loop)

Declared with `toolDefinition()` from `@tanstack/ai`. They run inside the client's
Node process, called by the local model mid-turn.

- `services/chat-tools.ts` — `webSearchTool`
- `services/library-tools.ts` — `search_library`, `get_video_details`,
  `list_videos_by_topic`, and `buildLibraryTools({ pool })` → `load_passages`
  (progressive retrieval: the synthesizer starts with only the top candidate's
  passages loaded and pulls the rest on demand)

These are **never exposed over MCP.**

### B — MCP tools (external clients)

Declared as `ToolDef` (`server/src/mcp/registry.ts`). They run inside the Strapi
process, talk to the document service directly, and — apart from
`reindexEmbeddings` — never call a model at all.

```
server/src/index.ts  register()
  └─ registerOfficialMcpTools(strapi)          src/mcp/index.ts
       ├─ registerMcpAdminPermissions()        src/mcp/permissions.ts
       ├─ migrateLegacyTierPermissions()       (scheduled on content-types.afterSync)
       └─ registerDomainTool(...)              src/mcp/adapter.ts
            └─ strapi.ai.mcp.registerTool()    the official Strapi MCP server
```

**29 tools** (19 read / 6 write / 4 maintenance), bodies in `server/src/mcp/tools/`,
served at `/mcp` over streamable-http, gated by admin API tokens.

Three files carry the wiring, and each owns exactly one thing:

- **`registry.ts`** — the `ToolDef` shape. A tool's input schema is declared **here
  and nowhere else**, built with the app's own top-level `zod`. (Not the `z`
  re-exported from `@strapi/utils`: Zod 4 keeps `.describe()` text in a
  per-instance registry, and the MCP SDK converts with its own bundled zod, which
  can't see a description recorded by a different copy — so descriptions silently
  vanished. See ADR 0008.)
- **`catalog.ts`** — pairs each body with a `title` and an `access` tier. The tier is
  now **only** a UI grouping heading.
- **`permissions.ts`** — derives one admin action per tool,
  `api::music-kb-mcp.tool.<kebab-name>`, from the catalog. Never hand-listed.

Keeping the in-app chat off MCP is deliberate: it keeps local inference
protocol-free. The cost is the duplication described next.

## What crosses the boundary

`client` never imports from `server/`, and `server` never imports from `client/`.
The only runtime channel is `strapiFetch<T>` in `services/strapi-client.ts`.

But some knowledge has to agree on both sides, and **`server/` cannot import
`@music-kb/music`** — it fails `TS2307` under its CommonJS, default-resolution
tsconfig, and fixing that means changing how the whole Strapi server compiles. So
that knowledge is duplicated, and the duplication is pinned by tests.

Those tests live in the **client** suite and read the server's files off disk,
because the client's vitest is the repo's only test runner:

| Invariant | Guard |
|---|---|
| Pitch labels on diagrams | `lib/lesson/pitch-label-parity.test.ts` |
| Theory intents (quality × position) | `lib/lesson/theory-intent-parity.test.ts` |
| Lesson block vocabulary | `components/lesson/block-vocabulary.test.ts` |
| Per-tool MCP permissions | `lib/mcp-tool-permissions.test.ts` |
| Authoring guide ↔ Strapi schema | `lib/lesson/authoring-guide.test.ts` (bidirectional) |
| Declared-but-unrendered fields | `components/lesson/render-reachability.test.ts` |
| Embedding contract (version, model default, text-builders, prefixes, truncation) | `lib/services/embeddings.parity.test.ts` |

`docs/lesson-authoring.md` deserves a special mention: it is the single source of
truth for lesson authoring, read at runtime by **both** the in-app generator
(`lib/lesson/authoring-guide.ts`) and the MCP `getLessonAuthoringGuide` tool. One
document, two consumers, one drift test in both directions.

## Known gaps

1. **Ollama host resolution is split.** The client resolves its host from
   `OLLAMA_BASE_URL` (`client/src/lib/env.ts`), the MCP embedding utils from
   `OLLAMA_HOST` (`server/src/mcp/utils/embeddings.ts`), and **neither key
   appears in `server/.env.example`**, which otherwise carries no `OLLAMA_*`
   keys at all. Point the client at a remote Ollama and the MCP reindex stays on
   localhost — same model *name*, possibly different weights or quantization,
   both vectors written and labelled current. It is builder-drift severity
   through a config door, and the embedding parity guard names it in its "what
   this cannot catch" list because source parity cannot reach it. If a remote or
   deployed Strapi is ever real, this breaks the MCP reindex before the parity
   question even arises.

2. **`lesson-generation.ts` trusts vectors every other surface rejects.**
   `rankVideosByTopic` filters on `Array.isArray(v.summaryEmbedding) &&
   length > 0` and never calls `embeddingStatus`, unlike the four call sites in
   `data/server-functions/videos.ts` which all gate on `=== 'current'`. So
   lesson generation ranks source videos against stale vectors. Fixing it is a
   behavior change (fewer source videos when the library is stale) and needs its
   own reasoning about whether degraded ranking beats no ranking.

3. **Model routing is scattered.** Ten module-scope `createOllamaChat(...)` calls
   bind their model at import time. `lesson-model.ts` demonstrates the better
   shape — one resolver returning adapter + tier + the matching friendly-error
   mapper — and the cost of not generalizing it showed up when the digest needed
   to become tier-aware and had to grow a bespoke `override?: DigestModel`
   parameter. A `resolveModel(surface)` would let any surface be promoted to
   frontier by configuration instead of by code change.

4. **The two tool systems duplicate retrieval.** `library-tools.ts` and the MCP
   `searchVideos` / `getVideo` / `crossSearchTranscripts` answer the same
   questions with separate implementations. Merging them wholesale would undo the
   protocol-free local path, which is a deliberate choice — but the retrieval core
   underneath both could be one module.

5. **`server/` has no test runner.** Every server-side guarantee is pinned from the
   client suite by reading files off disk. That is honest and it works, but it can
   only check *static* agreement, never behaviour.
   `server/src/mcp/tools/lesson-blocks.ts` is 1051 lines of validation logic with
   no executable test.

