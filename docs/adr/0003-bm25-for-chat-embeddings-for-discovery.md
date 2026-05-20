# 0003. BM25 for per-video chat, embeddings for cross-video discovery

**Status:** Accepted

## Context

The app has two retrieval needs that look superficially similar but differ in shape:

1. **Per-video chat** — answer a question about *this* video. The transcript already fits in a single Ollama context window for short videos and into the map-reduce pipeline for long ones. Top-k retrieval picks chunks for the chat prompt and grounds citations.
2. **Cross-video discovery** — "related videos" on a learn page, "videos like this one" on the feed, semantic search across the library. Scale grows with the number of videos.

A naive answer is "use embeddings for both". But embeddings hide signal that BM25 surfaces:

- Exact-phrase matches ("how does Ollama handle KV cache?") work better with lexical overlap than with similarity.
- Per-video chat doesn't benefit from `O(N_videos)` scaling — it's already scoped to one video's chunks.
- Embeddings cost an Ollama round-trip per query; BM25 is in-process.

The flip side: cross-video discovery doesn't benefit from BM25 — it's looking for *meaning* similarity, and exact-phrase signal is too narrow to find conceptually related videos.

## Decision

Two retrieval layers, each fit-for-purpose:

**Per-video chat: BM25 with contextual retrieval + reciprocal rank fusion.**

- Index lives on the Video row (per-video, computed at summary-generation time).
- Implementation in `client/src/lib/services/transcript.ts`.
- Query rewriting (one rewrite into N variants via the local model) + RRF across the variants in `client/src/lib/services/chat-retrieval.ts`. Improves recall on paraphrased questions without giving up exact-phrase strengths.
- A minimum-IDF gate (`BM25_MIN_QUERY_IDF`) drops too-common query terms.

**Cross-video discovery: per-video embeddings, in-memory cosine.**

- One vector per video over `(title + summary overview + takeaways + section headings + tags)`. Stored as JSON on the Strapi Video row, no pgvector / vector DB.
- Implementation in `client/src/lib/services/embeddings.ts`.
- At <1000 videos, in-memory cosine scan runs in 1–2 ms. No index data structure, no separate service.

Both layers hit the same Ollama instance with **different models**: `OLLAMA_MODEL` for chat, `OLLAMA_EMBEDDING_MODEL` for vectors. `OLLAMA_SYNTHESIS_MODEL` optionally swaps in a bigger chat model for `/api/ask` (cross-video QA).

## Consequences

**What we gain.**

- Each retrieval path is appropriately sized. BM25 is zero-config and zero-deps; embeddings stay simple because there's no scale pressure to introduce a vector store.
- The two layers can evolve independently. Adding moment-level (per-chunk) embeddings later is mechanical: same `embeddings.ts` infra, different text-builder, different field on the row.

**What we accept.**

- Two retrieval implementations to maintain. Acceptable because they're answering structurally different questions.
- BM25 is bound to in-app chat. MCP tools that want cross-video moment search use embeddings instead.
- Embedding rebuild on text-builder change requires a coordinated `EMBEDDING_VERSION` bump, or vectors silently survive a meaning change (see ADR 0007 / embedding invalidation in CLAUDE.md).
- In-memory cosine breaks down past ~10K videos (memory + scan latency). Personal-KB scale, not public-app scale. **If scale grows past that, revisit** — the natural next step is per-chunk embeddings + a real vector index, not scaling the per-video approach.

**What's enforced in code.**

- Don't add embedding-based retrieval to per-video chat. The point of the split is that BM25 is the right tool for that case.
- Don't add BM25 to cross-video discovery; phrase-overlap doesn't surface conceptually related videos.
