# Architectural Decision Records

This folder records the load-bearing decisions in yt-knowledge-base — the choices that shaped the codebase and would cost real effort to undo.

Each ADR is short on purpose. The format is:

- **Status** — Accepted / Deprecated / Superseded
- **Context** — what forces and constraints existed when the decision was made
- **Decision** — what we chose
- **Consequences** — what we gain, what we accept as the cost, what's deferred

ADRs are append-only history. If a decision is replaced, write a new ADR that supersedes the old one — don't edit the old one in place.

## Index

| # | Title | Status |
|---|---|---|
| [0001](./0001-local-first-no-cloud-ai.md) | Local-first, no cloud AI in-app | Accepted |
| [0002](./0002-strapi-over-custom-backend.md) | Strapi 5 over a custom backend | Accepted |
| [0003](./0003-bm25-for-chat-embeddings-for-discovery.md) | BM25 for per-video chat, embeddings for cross-video discovery | Accepted |
| [0004](./0004-deterministic-timecodes-not-llm-generated.md) | Timecodes are deterministically grounded, never LLM-generated | Accepted |
| [0005](./0005-hybrid-content-score-llm-plus-programmatic.md) | Hybrid Content score: LLM judgement + programmatic signals | Accepted |
| [0006](./0006-digest-upsert-by-video-set-key.md) | Digest identity is the source-video set, not a serial id | Accepted |
| [0007](./0007-error-translation-strapi-ollama.md) | Boundary-layer error translation for Strapi + Ollama | Accepted |
| [0008](./0008-official-strapi-mcp-over-hand-rolled.md) | Official Strapi MCP server over the hand-rolled one | Accepted |
| [0009](./0009-monorepo-with-shared-music-package.md) | Monorepo with a shared music package | Accepted |
