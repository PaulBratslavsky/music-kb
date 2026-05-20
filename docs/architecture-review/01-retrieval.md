# 1. Retrieval Module — collapse rewrite + multi-query BM25 + RRF into one Interface

**Status:** ✅ Shipped 2026-05-03 at scope A (narrow). New module: `client/src/lib/services/chat-retrieval.ts`.

## Files

- `client/src/lib/services/learning.ts:1231–1292` — `rewriteQuery`, `retrieveChunks` (the orchestrator).
- `client/src/lib/services/transcript.ts:541–567` — `searchBM25MultiQuery`.
- `client/src/data/server-functions/videos.ts:47–50` — imports the same building blocks for digest chat.

## Problem

Three steps that always run together — query rewriting (4 phrasings via LLM), multi-query BM25, RRF fusion — are exposed as three separate Modules. Each caller (the per-video chat retrieval path; the digest chat) re-orchestrates them. The Interface to "find evidence for a query" is currently the *union* of three Interfaces.

**Deletion test:** deleting `retrieveChunks` doesn't simplify anything; deleting `searchBM25MultiQuery` would just push the same orchestration up to callers. The orchestration *is* the concept — and right now it has no home Module.

A second consequence: when rewrite fails (Ollama timeout, model returns garbage), each caller has to know the fallback policy. Today that's "use the original query alone" and it's repeated implicitly in two call sites.

## Sketch

One Module: **Evidence retrieval over a `Video`**. One Interface — query in, ranked transcript chunks out. Behind the Seam:

- Decide whether to rewrite (config / call-site flag).
- Run rewrites in parallel (or skip on failure).
- Run BM25 per query.
- Fuse via RRF.
- Return top-k.

Callers (`learning.ts` chat path, digest chat) stop knowing about RRF, rewrite count, or the fallback policy.

## Locality / Leverage

- **Locality:** the "what is good evidence for this query?" decision lives in one place.
- **Leverage:** future improvements (ANN over embeddings, hybrid BM25+dense, reranking) swap the Implementation without touching either caller.

## Test surface change

Today `rewriteQuery` and `searchBM25MultiQuery` are tested separately, but the *composition* — does rewriting actually improve ranking on representative queries? — is not. The deepened Module's Interface makes that the natural test.

## Open questions for grilling

- Where does the Interface live? `client/src/lib/services/retrieval.ts`? Or under `lib/retrieval/` if we expect more pieces?
- Is "should we rewrite" a config flag, a call-site argument, or a property of the caller (`per-video chat: yes; library chat: also yes; ad-hoc snippet lookup: maybe no`)?
- Does the Module own the BM25 index or take it as input? Today the index lives on `Video.transcriptSegments` and is reloaded per request — that's an Implementation detail the Module should hide vs. one it should accept as input.
- What's the failure surface? Ollama down → Module logs and falls back? Or surfaces the failure to caller?
- What's the input shape — a `Video` row (rich), or just `(BM25Index, query)` (narrow)?

## Grilling notes

### Scope decision: A (narrow), not B or C

Three sizes considered:
- **A** — promote `retrieveChunks` to an exported Module. Just the per-video chat path.
- **B** — unify single-video chat + digest chat under one Interface with a policy switch (forces the product question: should digest also rewrite?).
- **C** — one Module for all BM25 retrieval everywhere (chat + library + citation grounding + moment search + …).

Picked A because:
1. The seam is real *today*: two adapters (`askAboutVideoService`, `prepareChatPrompt`) call the same private orchestration. That's the textbook "two adapters = real seam" — the deepening earns its keep without changing user-visible behavior.
2. B couples a refactor to a product decision ("should digest rewrite?"). That decision deserves its own deliberation; bundling it into an architecture refactor blurs both.
3. C fails the deletion test — the shapes are too different (top-1 vs top-K, single vs multi-video, BM25-only vs BM25+dense). One Interface trying to cover all of them gets wide and shallow. Library chat + citation grounding + moment search are coherent on their own.
4. A is **postpone-able**: it locks in nothing that B would later need to undo. If digest-chat recall becomes a real complaint, the A Module is the model to copy across.

### Final shape

```ts
// client/src/lib/services/chat-retrieval.ts

// Deep primitive — works with any BM25 index. Testable without Strapi.
getChatEvidence(index, query, opts?: { videoId? }) → Promise<TranscriptChunk[]>

// Strapi-coupled adapter — one-line wrapper for the common case.
getChatEvidenceForVideo(video, query) → Promise<TranscriptChunk[]>

// Re-exported (was previously private to learning.ts)
rewriteQuery(videoId, original) → Promise<string[]>
```

The seam is the narrow `getChatEvidence` interface. The Strapi adapter is the convenience layer. Two callers (`askAboutVideoService:1380`, `prepareChatPrompt:1410` in `learning.ts`) updated to use `getChatEvidenceForVideo`.

### Decisions made during grilling

- **Location:** `client/src/lib/services/chat-retrieval.ts` — matches existing `lib/services/*.ts` convention. New `lib/retrieval/` directory was rejected (would only earn its keep with more retrieval shapes coming, which scope A explicitly rules out).
- **Failure surface:** kept the existing silent-fallback contract. Module logs the rewrite failure (via internal `logPhase` with prefix `chat`) and returns chunks anyway. Richer return type (`{ chunks, rewriteFailed? }`) deferred — YAGNI until a UI consumer asks for the field.
- **`logPhase` helper:** duplicated from `learning.ts` rather than extracted to a shared file. Five lines, no shared helper introduced. Distinct prefix (`chat` vs. `summary`) so logs greppable to the right module.
- **Constants:** `CHAT_TOP_K = 8` and `REWRITE_COUNT = 4` moved out of `learning.ts` into the new file alongside the code that uses them.

### Test surface

`client/src/lib/services/chat-retrieval.test.ts` — 13 tests covering:
- `rewriteQuery`: empty input, very short query, very long query, success path, bullet/quote noise stripping, Ollama failure fallback.
- `getChatEvidence`: empty query, single-query path (when rewrite is skipped), multi-query fusion path, fallback when rewrite throws.
- `getChatEvidenceForVideo`: missing transcriptSegments, non-stored-shape, valid-index delegation.

Mocks: `chat()` from `@tanstack/ai` (the only network-touching call) and `createOllamaChat()` (called at module load). The BM25 path stays unmocked so tests verify real fusion logic, not just orchestration.

**Fixture gotcha worth remembering:** `searchBM25` has a `BM25_MIN_QUERY_IDF = 1.5` floor (`transcript.ts:452`). With a tiny corpus every term scores below the floor and the filter strips them all → empty results. Test fixtures need ~12+ chunks for target terms to clear the IDF threshold while still appearing in only one chunk each. Same gotcha is *also* present in pre-existing `transcript.test.ts` failures (4 tests fail for the same reason — independent issue, not introduced by this refactor).

### What got rejected and why

- **Pure narrow Interface, no Strapi adapter:** would have forced both callers (`askAboutVideoService`, `prepareChatPrompt`) to repeat the `isStoredIndex` check + `youtubeVideoId` extraction. ~3 lines of duplication × 2. The convenience adapter costs almost nothing and keeps callers as one-liners.
- **Pure rich Interface (StrapiVideo only):** would have coupled the Module to a DB shape it doesn't need. Tests would have to fabricate fake `StrapiVideo` objects with many fields.

### Follow-up candidates (not done)

- **B (unify with digest chat) — defer until digest-recall complaint.** When the time comes, copy the `getChatEvidence` shape across to the digest path; add a `rewrite?: boolean` opt to make the policy explicit.
- **Richer return type with `rewriteFailed` flag** — wait until a UI consumer wants it.

