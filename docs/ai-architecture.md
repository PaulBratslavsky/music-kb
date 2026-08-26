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

1. **Adapter** — resolved **per call**, never at module scope, from
   `services/model-policy.ts`. Local surfaces call `resolveModel(surface)`;
   lesson generation calls `resolveLessonModel()`. Those two modules are the
   only ones in `client/` that call `createOllamaChat` / `createAnthropicChat`
   — pinned by `services/model-policy.test.ts`.
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

Every row below except lesson generation and the two embedding rows is a
**surface key** in `services/model-policy.ts`'s `LOCAL_SURFACES`. Keys are per
*model-id binding*, not per user-facing feature — `note-summarize` and
`note-compose` are one feature on two different models, and the three digest
bindings have three different policies, so merging any of those pairs would
silently re-point a model for anyone who sets the optional env overrides.

| Surface key | Entry point | Model | Tier |
|---|---|---|---|
| `video-chat` | `routes/api.chat.tsx` + `learning.ts` `askAboutVideoService` | `OLLAMA_CHAT_MODEL` | local |
| `query-rewrite` | `services/chat-retrieval.ts` | `OLLAMA_CHAT_MODEL` | local |
| `digest-chat` | `routes/api.digest-chat.tsx` | `OLLAMA_CHAT_MODEL` | local |
| `library-ask` | `routes/api.ask.tsx` | `OLLAMA_SYNTHESIS_MODEL` | local |
| `note-compose` | `routes/api.notes.compose.tsx` | `OLLAMA_SYNTHESIS_MODEL` | local |
| `note-summarize` | `services/notes.ts` | `OLLAMA_MODEL` | local |
| `summary` | `services/learning.ts` | `OLLAMA_MODEL` | local |
| `music-extraction` | `services/music-extraction.ts` | `OLLAMA_MODEL` | local |
| `reader` | `services/reader.ts` | `OLLAMA_MODEL` | local |
| `digest-synthesis` | `services/digest.ts` `synthesizeDigest` | `OLLAMA_MODEL` | local default, frontier by inheritance — see below |
| `digest-article` | `services/digest.ts` `synthesizeDigestArticle` | `OLLAMA_MODEL` | local |
| *(no key)* | `services/lesson-generation.ts` | **`resolveLessonModel()`** | **frontier or local** |
| *(no key)* | `services/embeddings.ts` | `OLLAMA_EMBEDDING_MODEL` | local (raw `fetch`, no adapter) |
| *(no key)* | `server/src/mcp/utils/embeddings.ts` | `OLLAMA_EMBEDDING_MODEL` | local (raw `fetch`, no adapter) |

**Lesson generation is the only surface that can reach a frontier model.** That is
the documented single exception to local-first (CLAUDE.md, decided 2026-08-21):
`resolveLessonModel()` in `services/lesson-model.ts` returns an Anthropic adapter
when `ANTHROPIC_API_KEY` is set and an Ollama adapter when it isn't. Both tiers run
the identical staged pipeline, so the two are comparable rather than divergent code
paths. `ANTHROPIC_API_KEY` is read once, there, and never appears as a property of
the returned model — only the constructed adapter, the tier, and the model id.
(The adapter's own SDK client *does* hold the key at `.client.apiKey`, at Node's
default inspect depth, so the frontier object carries `toJSON` + a custom-inspect
hook to keep a stray `console.log(model)` from printing it.)

**The exception is enforced in the type system, not by convention.**
`resolveModel(surface)` accepts only a `LocalSurface` and returns only a
`LocalModel`; there is no `'lesson'` key and no `Surface` union to widen. Three
source-text guards in `services/model-policy.test.ts` close the routes around it:
only `model-policy.ts` may call `createOllamaChat`, only `lesson-model.ts` may
call `createAnthropicChat` or import `ANTHROPIC_API_KEY`, and `resolveLessonModel`
has exactly one importer (`lesson-generation.ts`). Promoting a surface therefore
takes a code change in two named modules *and* turns a test red.

**The one honest caveat:** `synthesizeDigest` takes an optional `ResolvedModel`,
and lesson generation passes its own — so digest synthesis *is* frontier-reachable
at runtime, by tier inheritance. Its own default is local and cannot be otherwise;
the only frontier path is an explicit argument from the one module allowed to build
a frontier adapter, and `digest.test.ts` pins that no other caller passes one.

Tier-specific behaviour travels **on** the resolved model rather than beside it:
`model.modelOptions(t)` (Ollama's nested `.options` shape vs. `{}` — newer
Anthropic models 400 on `temperature`), `model.friendlyError(raw)` (the echoing
`friendlyOllamaError` vs. the never-echoing `friendlyAnthropicError`), and
`model.redact(raw)`. Pairing the wrong mapper with a tier is unrepresentable.
The four SSE surfaces are the gap this cannot close — they map errors
*client-side*, hardcoded at `chat-stream.ts`, which is correct only because all
four are `LocalSurface`s.

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

Those tests live in the **client** suite and read the server's files off disk.
`server/` has had its own vitest since 2026-08-26, so that placement is no
longer forced — but it is still correct, and for the original reason: these
guards assert that two *files* agree, and the client cannot import the server's
copy without breaking the separate-installs rule (two zod instances, two React
majors). Reading server source as TEXT is what makes a text-level comparison
possible at all. The server's own suite is for what it can *execute*.

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

3. ~~**Model routing is scattered.**~~ **Fixed** (2026-08-26) by
   `services/model-policy.ts`. Note what actually shipped, because it is the
   *opposite* of what this entry used to propose: promotion to frontier still
   requires a code change, in two named modules, and `resolveModel` was
   deliberately given a signature that makes `resolveModel('lesson')` a compile
   error. Making tier a config row would have turned CLAUDE.md's "same kind of
   evidence" bar into a one-word edit.

   What remains: adapter construction moved from import time to call time, so a
   malformed `OLLAMA_BASE_URL` no longer crashes at boot — it warns once from
   `model-policy.ts` and then throws `TypeError: Invalid URL` per request, which
   `friendlyOllamaError` does not recognise and will echo verbatim. Call sites
   resolve inside their existing `try` so this lands as a normal failure rather
   than an unhandled rejection, but the user-facing string is raw.

4. **The two tool systems duplicate retrieval.** `library-tools.ts` and the MCP
   `searchVideos` / `getVideo` / `crossSearchTranscripts` answer the same
   questions with separate implementations. Merging them wholesale would undo the
   protocol-free local path, which is a deliberate choice — but the retrieval core
   underneath both could be one module.

5. ~~**`server/` has no test runner.**~~ **Fixed** (2026-08-26). `server/` now
   owns a vitest (`yarn --cwd server test`, wired into the root `yarn test` as
   the second leg), and `server/src/mcp/tools/lesson-blocks.ts` has 77
   behavioural tests in `lesson-blocks.test.ts`. Note what shipped, because it
   is narrower than the entry proposed: **one** test file, importing only its
   target and vitest — no `strapi` mock, no bootstrap, and the other 28 MCP
   tools are still covered only end-to-end by `server/scripts/test-mcp.mjs`.

   Two things the runner deliberately did *not* buy. Vitest resolves through
   Vite, which understands `packages/music`'s `exports` map, so a server *test*
   can import `@music-kb/music` where server *source* still cannot (see "What
   crosses the boundary"). That escape hatch was declined: it would put `tonal`
   in `server/node_modules` and invite an import from `src/` that fails `tsc`
   with TS2307 — and the tables it would have derived are already pinned by
   `theory-intent-parity.test.ts`, which throws rather than silently passing if
   the constant is renamed. And server test files are excluded from
   `server/tsconfig.json` (which is what keeps them out of the Strapi build),
   so **they are typechecked by nothing**.

