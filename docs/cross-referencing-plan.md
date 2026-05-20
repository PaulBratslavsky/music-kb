# Cross-Referencing & Future RAG Plan

A design discussion on how yt-knowledge-base can grow into a stronger knowledge base — supporting cross-video connections today through retrieval/synthesis, and optionally layering in RAG later.

This is a **planning doc**, not a build order. Nothing here needs to ship until real friction appears.

---

## Background

The trigger: we looked at a sibling project (`/Users/paul/work/plugin-dev/knowledge-base`) that does AI-powered knowledge management on Strapi. It has a three-layer model (Source → Concept → Research) with:

- `Concept` as an AI-compiled wiki entry synthesized from multiple sources
- A `Concept ↔ Concept` self-relation forming a backlink graph
- A `KnowledgeIndex` singleton holding an LLM-readable master catalog
- Maturity/confidence ladders, ActivityLog, OAuth, Research entries

The question was whether to port some of those ideas here for cross-referencing videos.

## What We Already Have

```
Transcript  (immutable, per YouTube videoId)
Video       (our instance — summary, sections, takeaways, actionSteps, notes, tags)
Tag         (user taxonomy, lowercase-normalized)
```

Plus:

- MCP server at `/api/mcp` with 14 tools (`searchVideos`, `searchTranscript`, `getVideo`, `listTags`, `tagVideo`, `saveNote`, …)
- BM25 retrieval per transcript for in-video chat
- Deterministic timecode grounding
- A `web_search` tool for external context during chat

Key realization: **the Video summary is already an LLM-compiled artifact.** Running another LLM pass to extract `Concept` entries from a summary is compressing what's already compressed. That lowers the value of porting the knowledge-base Concept layer wholesale.

## The Core Conclusion

Cross-referencing is a **retrieval + synthesis** problem, not a schema problem. When an LLM (via Claude Desktop over MCP) asks "what connects video A and video B?" — or "what do I know about BM25?" — it can:

1. `getVideo(A)` + `getVideo(B)` → read the summaries
2. `searchVideos("shared term")` → find neighbors
3. Synthesize the connection in its own context

No Topic/Concept table required. The "wiki view of BM25" is just search + `getVideo` on the hits + LLM synthesis at query time. No persisted wiki content to go stale.

### Why not persist synthesized wiki content

In knowledge-base, `Concept.content` is a 2–4 paragraph LLM-authored article stored per concept. That persistence buys admin-panel readability at three costs:

- **Staleness** — every new linked source makes the cached article incomplete
- **Token cost on every compile**
- **Two sources of truth** — the cached article can disagree with the underlying sources

For an LLM-native KB driven over MCP, the LLM can synthesize views at read time from structured data. No cache to invalidate.

## Proposed Additions (When Pain Appears)

All additive. No migrations. Add in order of triggered need.

### 1. `searchKnowledge` — richer cross-video search

Today `searchVideos` likely returns shallow records. Upgrade to a tool that searches across **summary + sections + takeaways + notes**, returns ranked results with matched-context excerpts.

```ts
searchKnowledge({ query, type?, page?, pageSize? }) → {
  results: [{ videoId, title, excerpt, score, _type: 'video'|'note'|'section' }],
  query,
  total
}
```

Pattern to copy: `knowledge-base/src/plugins/kb-ai/server/src/tools/logic/knowledge.ts` — specifically `scoreResult()` + `makeExcerpt()`.

**Trigger to build:** you search for something you know is in the library and the current search misses it.

### 2. `KnowledgeIndex` singleton — LLM cheat sheet

Single-type, auto-regenerated on Video create/update. Holds a markdown catalog the LLM can pull in one call instead of paginating:

```
Videos by tag:
  #tanstack (3): Video A, Video B, Video C
  #strapi (5): …

Recent additions:
  - Video X (2026-04-18)
  - Video Y (2026-04-15)

Stats: 42 videos, 128 tags, …
```

The rebuild is pure formatting — **no LLM call needed.** Just a query + string assembly. Rebuild on lifecycle hook (afterCreate / afterUpdate on Video).

Schema:

```
KnowledgeIndex (singleType):
  content: richtext       // the rendered markdown catalog
  stats: json             // { videos: n, tags: n, … }
  lastUpdatedAt: datetime
```

MCP tools: `getIndex()`, `updateIndex()` (manual override).

**Trigger to build:** you drive the KB from Claude Desktop and notice the LLM burns tokens paginating `listVideos` before every answer.

### 3. `findRelatedVideos(videoId)` — neighbor discovery

Takes a video, returns the N most similar videos in the library. Two implementation options:

- **BM25 variant** — use the source video's top keywords as a query against the rest of the library. Zero new dependencies.
- **Embedding variant** — cosine similarity over video summary embeddings (see §RAG below).

Start with BM25. Add embeddings only if the BM25 neighbors feel off.

**Trigger to build:** you're watching a video and want "what else have I watched about this?" and nothing surfaces it.

## Future: RAG Capabilities

Everything above stays BM25-first. The architecture is designed so semantic search can slot in without breaking any MCP client or changing any tool signature.

### The seam: `searchKnowledge` stays stable

Design `searchKnowledge` today with a stable contract (query + ranked excerpts out). Swap its internals from BM25-only to hybrid (BM25 + vector) later. No client code changes.

### Embedding the right layer

- **Video summary** — one vector per video. Cheapest, best for "find related videos" and cross-video conceptual similarity. Probably all that's needed.
- **Transcript chunks** — you already have these for in-video BM25. Reuse them if you want chunk-level cross-video RAG (deep Q&A across your whole library).
- **Skip full transcript embedding** — redundant with chunks.

### Provider

Same pattern as your existing chat model provider:

- **Local:** `nomic-embed-text` via Ollama (~274MB, runs alongside your chat model)
- **Cloud:** `text-embedding-3-small` via OpenAI, or any other through a provider interface

Embedding model is configured separately from the generation model.

### Schema additions for RAG

Additive, nullable. Can be backfilled via a one-time script.

```
Video:
  + embedding: vector(768)   // or json blob if no pgvector
  + embeddingModel: string   // track which model produced it (for migrations)
  + embeddedAt: datetime
```

If staying on SQLite for dev, store the vector as a JSON array and do cosine in-process. Move to pgvector when you move to Postgres.

### New RAG MCP tools

Add only when needed — each has a clear trigger:

- **`semanticSearch(query, topK)`** — vector-only search across video summaries. Trigger: BM25 keeps missing videos that are conceptually on-topic but don't share vocabulary.
- **`hybridSearch(query, topK)`** — BM25 + vector with reciprocal rank fusion. Trigger: you want one tool that does both, for the LLM's convenience.
- **`ragQuery(question)`** — retrieve top-k chunks across all videos + synthesize an answer with citations. Trigger: you want "ask across my whole library" instead of per-video chat.

### Staying out of the corner

Three design choices keep the upgrade path clean:

1. **Tool surface is stable** — `searchKnowledge` is the same contract whether BM25 or hybrid under the hood
2. **Embeddings are optional and nullable** — existing videos keep working; new field fills in over time
3. **Provider-pluggable** — swap embedding models without changing consumers

## What To Do Right Now

**Nothing.**

All of this is additive. No schema pressure, no "build it now or regret later" tradeoff. The right next move:

1. Use the KB as it is
2. Ingest more videos
3. Drive real cross-video queries from Claude Desktop over the existing MCP
4. Note the moment something feels missing — that's the signal to build

The smallest thing that fixes a specific friction point is almost always better than pre-building a complete system.

## Reference: What We Explicitly Decided NOT To Port

From the sibling `knowledge-base` project:

| Feature | Decision | Reason |
|---|---|---|
| `Concept` content type with wiki `content` field | Skip | Video summary is already an LLM-compiled artifact; second pass is redundant. LLM can synthesize cross-video views at read time. |
| `Concept ↔ Concept` self-relation | Skip | Cross-reference via retrieval (search + tags + future embeddings), not a persisted graph. |
| Maturity ladder (stub → draft → reviewed → canonical) | Skip | Editorial workflow overhead for a single-user personal tool. |
| Confidence enum on concepts | Skip | Summaries already reflect source confidence via the model's own hedging. |
| `Research` content type | Skip | Your existing `Video.notes` field covers the same use case. |
| `ActivityLog` | Skip | Audit scaffolding for multi-client setups. `git log` on notes + Strapi timestamps cover personal use. |
| OAuth 2.0 flow | Skip | Local-first, single-user. API token auth is sufficient. |
| Full compile lifecycle hook | Skip | Your `generateVideoSummary` already fills this role for your domain. |
| `KnowledgeIndex` singleton | **Consider later** | Cheap, useful for MCP-driven LLMs. Build when pagination burns tokens. |
| Cross-type keyword search with excerpts | **Consider later** | Worth porting the scoring logic when current search misses things. |

---

*This doc captures a design conversation from April 2026. Update it when assumptions change — especially if RAG lands, or if cross-referencing patterns turn out differently in practice than predicted here.*
