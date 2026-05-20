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

**What's enforced in code.**

- No `openai` / `@anthropic-ai/sdk` imports in `client/`. Adding them is a violation of this ADR.
- The MCP server in Strapi is the canonical bridge to bigger models. Don't replicate its tools in the in-app chat path.

**Deferred.** A possible future "use a frontier model for THIS one summary" opt-in via MCP-from-the-app; not built, not necessary right now.
