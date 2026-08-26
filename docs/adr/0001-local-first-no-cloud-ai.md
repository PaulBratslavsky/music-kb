# 0001. Local-first, no cloud AI in-app

**Status:** Accepted

## Context

The app stores a personal YouTube viewing history: transcripts, summaries, chat conversations, notes. Three options for inference and embeddings:

1. Cloud LLM/embedding APIs (OpenAI, Anthropic, etc.) — best quality, every transcript leaves the laptop.
2. Local inference via [Ollama](https://ollama.com) — quality bounded by what 4B–8B models can do, no data egress, works offline.
3. Hybrid (local default, cloud opt-in) — adds a per-call decision and a config surface.

The goal of the app is to be a knowledge base the user fully owns and runs on their laptop. Cloud upload of every transcript is a privacy posture mismatch even if quality would be better.

A separate concern is that frontier models (Claude, GPT-4) are genuinely useful for cross-video reasoning — but those use cases are intermittent, not the always-on hot path.

## Decision

**Ollama only for in-app inference and embeddings.** No cloud SDK adapters in the client. The default chat/summary model is a custom 4B Gemma variant (`gemma4-kb:latest`); embeddings use `nomic-embed-text`. Both are configurable via env.

**Frontier models are reachable via [MCP](https://modelcontextprotocol.io)**, not via in-app cloud calls. Strapi exposes an MCP server at `/api/mcp`; users connect Claude Desktop / Code / Cursor and drive the knowledge base from there when they want a bigger model. The two paths meet at the same Strapi data layer.

## Consequences

**What we gain.** Privacy by default. Offline-capable. No per-call cost. No vendor lock-in on the inference layer.

**What we accept.**

- Local model tool-call reliability is probabilistic. Gemma 4 at 4B-effective params lands ~42% on Tau2. Single-shot tool calls (like `web_search`) work most of the time; agentic multi-step chains don't. The `/web <query>` slash command exists for cases where determinism matters.
- Map-reduce for long videos is a hard requirement, not optional, because local context windows are smaller than typical podcast transcripts.
- Score calibration (see ADR 0005) suffers from local-model anchor-clustering — the hybrid scoring scheme exists in part to compensate.

**What's enforced in code.** (See the amendment below — this clause changed.)

- ~~No `openai` / `@anthropic-ai/sdk` imports in `client/`.~~ **Exactly one**
  module in `client/` may import the Anthropic adapter as a value:
  `src/lib/services/lesson-model.ts`. Every other value-import of
  `@tanstack/ai-anthropic` or `@anthropic-ai/sdk` is a violation of this ADR.
  There is still no `openai` import at all.
- The MCP server in Strapi is the canonical bridge to bigger models. Don't replicate its tools in the in-app chat path.

**Deferred.** A possible future "use a frontier model for THIS one summary" opt-in via MCP-from-the-app; not built, not necessary right now.

---

## Amendment — 2026-08-26: the lesson-generation exception, recorded

**Status:** Amended (the decision above stands for every surface but one).

Two things were true in the tree but not in this ADR, and this amendment
records both.

**1. The exception itself, decided 2026-08-21.** Lesson generation may use a
hosted Anthropic model when `ANTHROPIC_API_KEY` is set, falling back to the
local model when it isn't. The reason is empirical rather than aspirational: a
real run showed the local model produces thin lessons with weak citations, and
lesson writing is the one job in this app that needs judgement rather than
throughput. Everything else — chat, summaries, embeddings, music extraction,
digests, reading mode — works fine locally, and that is what keeps bulk jobs
like re-embedding the whole library free. The exception lived only in CLAUDE.md
and `docs/ai-architecture.md`; `lesson-model.ts` had been violating this ADR's
"no `@anthropic-ai/sdk` imports" clause with no amendment on file since.

**2. The enforcement mechanism changed shape.** It used to be "zero modules
import it", which a grep could check and nothing did. It is now "exactly one
module may import it, and that is pinned by a test":

- `src/lib/services/model-policy.ts` owns a `resolveModel(surface)` whose
  parameter type is `LocalSurface` and whose return type is `LocalModel`. There
  is no `'lesson'` key, and no `Surface` union to widen. A surface cannot reach
  a frontier model by resolving its own model — not by env, not by config.
- `src/lib/services/lesson-model.ts` is the only module that calls
  `createAnthropicChat` or imports `ANTHROPIC_API_KEY`, and `resolveLessonModel`
  has exactly one importer (`lesson-generation.ts`).
- All three of those are source-text assertions in
  `src/lib/services/model-policy.test.ts`, alongside a table-driven check that
  every one of the eleven local surfaces resolves a real `OllamaTextAdapter`
  with `ANTHROPIC_API_KEY` set — asserting on the adapter, not on the `tier`
  label the object supplies about itself.

Net effect: widening the exception is still a code change in two named modules,
and it now turns a test red. That is deliberately *stronger* than making tier a
configuration row would have been — a config row makes promotion a one-word
edit that reads as configuration rather than as a decision.

**One caveat worth stating plainly.** `synthesizeDigest` accepts an optional
resolved model and lesson generation passes its own, so digest synthesis *is*
frontier-reachable at runtime by tier inheritance (a frontier lesson should not
pay ~51s of local inference to build the structure a frontier model then writes
from). Its own default is local and cannot be otherwise; the only frontier path
is an explicit argument from the one module allowed to build a frontier adapter,
and `digest.test.ts` pins that no other caller passes one.
