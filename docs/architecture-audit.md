# Architecture audit — 2026-05-09

## Summary

Six candidates surfaced, ranked strongest first. Three are **strong** — the
score-write fan-out, the hybrid dense+BM25+RRF triplet in
`server-functions/videos.ts`, and the unsegmented spine of
`generateVideoSummary`. Two are **medium** — the verdict-only / signal-only
re-rate fragmentation (downstream of #1 and #3) and `useLibraryChat`'s
inline SSE parser. One is **weak** but recorded — the `*WithStatus`
doubling. Two suspected items (the chat-hooks split, splitting
`transcript.ts`) are explicitly **rejected** after inspection — the
user's prior review (`docs/architecture-review/07-transcript-split-skip.md`)
already pushed back on the latter, and inspection re-confirmed.

---

## Candidate 1: `finalScore` is recomputed at seven sites instead of being a consequence of writing its inputs

**Files:**
`client/src/lib/services/videos.ts:108-120` (`computeFinalScore`),
`client/src/lib/services/videos.ts:511-642` (writers),
`client/src/lib/services/learning.ts:1062-1086`,
`client/src/data/server-functions/videos.ts:1523, 1586-1595, 1738-1745, 1795-1801, 1875-1882`.

**Problem.** Every writer that touches `valueScore` or `signalScore` is
required to (a) compute `finalScore` itself, (b) pass it explicitly into
the update, (c) write all three fields together. That contract is recited
in JSDoc on `updateVideoVerdictService` and `updateVideoSignalScoresService`
("Caller is expected to derive this from … via `computeFinalScore` and
pass it here") because the seam can't enforce it.

Deletion test on `computeFinalScore`: deleting it produces *one* correct
call site and six places that would silently start writing a stale
`finalScore`. The helper exists to encode the invariant; the writers
don't enforce it. ADR 0005 names this directly: "All three writers must
write `finalScore` consistently — guarded by tests in
`content-signals.test.ts`." Tests are the seam today; the seam should be
the writer.

**Solution.** Push the derivation **into** the score-update writers. The
deepened module's responsibility: "given a partial score change for a
Video — verdict-only, signal-only, or full — write the row so that all
three score fields end up consistent." Callers hand it the delta plus
the row's existing prior state (or just a documentId; the writer
re-fetches). They never compute or pass `finalScore`. The two partial
writers (`updateVideoVerdictService`, `updateVideoSignalScoresService`)
collapse into one write surface; the full-summary path in `learning.ts`
goes through it too.

**Benefits.** "If the math changes, are six call sites still correct?"
becomes "is the writer still correct?" — that's the locality win. Tests
stop verifying every writer enforces the invariant and verify the
writer alone. The "three-writer code-review discipline" ADR 0005
explicitly accepts as a constraint becomes unnecessary. Deferred Phase 3
calibration (manual ratings tuning `FINAL_SCORE_WEIGHTS`) becomes a
pure-function test instead of a cross-file consistency check.

**Strength:** strong.

**Notes.** No ADR conflict — ADR 0005's "what we accept" section calls
out the discipline gap; this candidate closes it.

---

## Candidate 2: hybrid dense+BM25+RRF library search is implemented three times inline

**Files:**
`client/src/data/server-functions/videos.ts:716-895` (`relatedVideos`),
`:923-1013` (`semanticSearchVideos`),
`:1218-1381` (`searchLibraryPassages`).

**Problem.** Each handler builds the same retrieval primitive inline:
filter candidates, compute cosine over `summaryEmbedding`, build a BM25
index over a per-candidate text bag, run BM25, RRF-merge with
`RRF_K=60` and `BM25_WEIGHT=2.5`, then layer on caller-specific
concerns (per-video cap, tag/title boost, `minScore`). The merge math
is literal copy-paste, and the `denseTop10` / `bm25Top10` / `rrfTop10`
diagnostic `console.log` block is too.

Three-adapter test passes: real seam, three implementations with
different input shapes (target-video as query, query string over
videos, query string over flat passages) and different boost layers.
If the fusion primitive existed, each handler shrinks to ~30 lines
describing only what's *unique* (candidate source, BM25 corpus text,
boosts).

**Solution.** A retrieval-fusion primitive whose responsibility is "rank
N candidates by fused dense+lexical similarity with this query, return
both raw component scores and the fused score." Per-caller concerns
(per-video cap, tag boost, title boost, `minScore` filter,
`maxQueryTerms`) stay at the call site, layered on the primitive's
output. The `relatedVideos` boost layer (tag overlap, title-token
overlap) is distinct enough that it stays in its handler.

**Benefits.** Three handlers shrink dramatically. The empirically-tuned
constants (`RRF_K=60`, `BM25_WEIGHT=2.5`) live in one place. Adding a
fourth retrieval surface (a server-side MCP search tool, etc.) reuses
the primitive. Tests: hybrid-merge math is currently untested because
it's buried in server-fn handlers; `embeddings.ranking.test.ts` is the
natural home for the primitive.

**Strength:** strong.

**Notes.** No ADR conflict — ADR 0003 explicitly anticipates layered
retrieval ("adding moment-level embeddings later is mechanical"); the
third adapter (`searchLibraryPassages`) is exactly that addition, and
the primitive crystallizes the pattern.

---

## Candidate 3: `generateVideoSummary` is a 400-line spine with no internal seams

**Files:** `client/src/lib/services/learning.ts:781-1174`.

**Problem.** The orchestrator inlines every step: video lookup →
transcript resolution (three cases: relation / by-id lookup / fresh
fetch) → meta + transcript fetch → cleaning → AI generation (single-
pass or map-reduce) → sanitization → BM25 index build → timecode
grounding → signal score computation → DB save → Tier-1 embedding →
Tier-2 passage embedding (last two best-effort).

Deletion test on the orchestrator itself: complexity vanishes — it's
the canonical path, not pulling work back from the caller. But
deletion test on the **steps**: removing "timecode grounding" or
"score-and-save" leaves nothing reusable because those concerns have
no name, no signature, no test surface. `regenerateVerdictForVideo`
(lines 1484-1588) goes through a parallel mini-pipeline and **cannot
reuse any of the spine** because the spine has no seams.

This is **not** a "split the file" candidate — chat prompt builders,
digest-chat builder, and verdict-only path earn their place in
`learning.ts`. The candidate is to give the spine internal seams.

**Solution.** Three steps get names:

1. **Transcript resolution** — "Given a videoId, return a usable
   `TranscriptData` plus a Strapi-linked Transcript row, regardless of
   whether the row already existed via the relation, by youtubeVideoId,
   or had to be fetched from YouTube." (Lines 813-901 today.)
2. **Score-and-save** — "Given a Video row, sanitized AI summary, BM25
   index, and cleaned transcript, write the canonical summary state
   with all derived fields (signal scores, `finalScore`,
   `transcriptSegments`) computed once." (Lines 1044-1095.) This holds
   the same invariant as Candidate 1; they're the same concern viewed
   from different paths.
3. **Embedding refresh (best-effort)** — Lines 1097-1170 are two
   try/catch blocks lazy-importing `embeddings.ts`. The "log-but-don't-
   fail" contract has a recognizable shape; the helper can own it.

**Benefits.** Verdict-only and signal-only re-rate paths can call
`score-and-save` directly. Transcript resolution becomes the natural
home for `forceRefetch` semantics. Tests improve dramatically:
`generateVideoSummary` is impossible to unit-test today (Strapi +
youtubei.js + Ollama + Strapi); the three named pieces are
independently testable.

**Strength:** strong.

**Notes.** No ADR conflict — ADR 0004 (deterministic timecodes) and
ADR 0005 (hybrid scoring) both rely on the orchestrator's step order.
Explicit seams make those invariants visible at the type level
instead of buried in the file.

---

## Candidate 4: verdict-only and signal-only re-rate paths each carry their own mini-orchestrator

**Files:**
`client/src/lib/services/learning.ts:1484-1588` (`regenerateVerdictForVideo`),
`client/src/data/server-functions/videos.ts:1697-1748` (`regenerateVideoSignals`),
`:1750-1810` (`backfillSignalScores`).

**Problem.** Each path mini-orchestrates: fetch row + transcript →
clean → compute (AI verdict OR signal scores) → recompute `finalScore`
against the existing-but-untouched component → write via the partial-
update service. The "recompute the un-touched component" wart is a
symptom of #1; the "fetch + clean transcript" prelude is a symptom of
#3.

**Solution.** Don't deepen this directly — track as a downstream
beneficiary of #1 and #3. If both ship, this collapses; if neither
moves, revisit.

**Benefits.** Marginal alone; substantial after #1 and #3. ADR 0005's
deferred manual-calibration UI becomes much cleaner once this
fragmentation is gone — the manual-rating writer would be a sibling of
verdict-only re-rate going through the same unified writer.

**Strength:** medium (downstream of stronger candidates).

**Notes.** No ADR conflict.

---

## Candidate 5: `useLibraryChat` parses SSE inline; `chat-stream.ts` exists but is bypassed

**Files:**
`client/src/lib/hooks/useLibraryChat.ts:78-157` (`streamAsk`),
`client/src/lib/services/chat-stream.ts`.

**Problem.** `chat-stream.ts` was extracted (per the post-2026-05-05
refactor note in `architecture.md`) so `VideoChat` and `DigestChat`
could share the AG-UI parser without dialect drift. `useLibraryChat`,
written separately, has its own `while (reader.read())` loop, its own
frame splitter, and its own `event.type` discriminator. Three real
divergences:

1. The library-chat path emits `CITATIONS` frames that
   `streamChatSSE` doesn't surface — so the parser **needs to grow a
   shape** before this can converge; it's a real Interface gap, not
   just a copy.
2. ADR 0007's `friendlyOllamaError` is wired in `useLibraryChat`'s
   `onError` but `VideoChat` and `DigestChat` each call it separately
   on caught errors — cross-cutting concern, three places, one
   missing in the parser itself.
3. The library-chat parser pulls the response body on non-OK status
   to surface the upstream Ollama detail (line 97). The other two
   surfaces lose that info. Feature drift.

**Solution.** Extend `chat-stream.ts` to surface a `citations` event
shape and own the "translate transport-level errors via
`friendlyOllamaError` before throwing" rule. All three consumers go
through it. Three-adapter test will pass after the deepening — it
already passes structurally (three SSE consumers); it just needs the
parser to cover all three event sets.

**Benefits.** "What events does the wire format produce?" lives in one
place. Adding a new chat surface (the deferred MCP-from-app path in
ADR 0001's notes) gets streaming for free. The
"library chat surfaces Ollama detail; per-video doesn't" inconsistency
goes away. `chat-stream.test.ts` (161 lines) gets new event-type
cases instead of a sibling file.

**Strength:** medium.

**Notes.** No ADR conflict — ADR 0007's "pipe caught errors through
`friendlyOllamaError`" rule is followed today at all sites; this
moves the rule into the parser so new surfaces inherit it.

---

## Candidate 6: `*WithStatus` services double the lookup surface for two route loaders

**Files:** `client/src/lib/services/videos.ts:350-412`,
`client/src/data/server-functions/videos.ts:114-132`.

**Problem.** Per ADR 0007, three route loaders need to distinguish "row
missing" from "Strapi unreachable" to render `BackendErrorPanel`. The
chosen seam: sibling services — nullable (`fetchVideoBy*Service`) and
`WithStatus` (`{ video, error }`). The `WithStatus` variants are used in
**two places**; every other site (15+) uses the nullable.

**Solution.** Probably nothing today — return `{ video, error }`
unconditionally and let nullable callers `?.video` it. 15-site port,
no behavior change. Recording so it doesn't sneak up to "four
`*WithStatus` siblings" if a third loader-facing lookup arrives.

**Strength:** weak.

**Notes.** ADR 0007 picked this shape deliberately to ship without
breaking callers; deferred cleanup, not actionable.

---

## Items inspected and rejected

**`transcript.ts` (1069 lines, "mixed responsibilities").** The user's
prior review
(`docs/architecture-review/07-transcript-split-skip.md`) pushed back:
splitting cleaning / chunking / BM25 produces three shallow modules,
and the orchestration that lives inside the file gets pushed up into
`learning.ts`. Long file ≠ shallow module. Re-confirmed on inspection
— public surface is small (~5 entry points), implementation is large
but coherent, `extractCitationsWithEvidence` needs locality with the
BM25 primitives it composes on. Skip.

**The "three chat hooks, two streaming patterns" framing.** Right fix
is Candidate 5 (deepen the parser), not unifying the three UIs.
`VideoChat` carries timecode-evidence + slash-commands + skill-picker;
`DigestChat` carries cross-video citation labels; `useLibraryChat`
carries persistence + dock-state + cross-page survival. Three
distinct UIs sharing one transport — that's the right shape; the leak
is at the transport.

**`server-functions/videos.ts` length (1890 lines).** Long, but per
concern most handlers are thin server-fn wrappers. The fat is in the
three RRF handlers (Candidate 2) and the score backfills (downstream
of Candidate 1). Fix those and the file shrinks naturally.
