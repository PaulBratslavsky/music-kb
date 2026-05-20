# 4. Background Generation Module — the inflight Set, progress Map, and recentFailures Map are one concept

**Status:** ✅ Shipped 2026-05-03 at scope B (medium). New module: `client/src/lib/services/generation-state.ts`.

## Files

- `client/src/data/server-functions/videos.ts:130–150` — `generationInflight` Set, `kickoffSummaryGeneration`, `recentFailures` Map.
- `client/src/lib/services/learning.ts` — `setGenerationStep` / `readGenerationStep` (the progress map).
- `client/src/routes/learn.$videoId.tsx:81` — the loader's polling-and-trigger logic.

## Problem

Three pieces of process state live in three Modules with three Interfaces:

1. **"Is a job running for this Video?"** — `generationInflight: Set<string>`.
2. **"Where is it in the pipeline?"** — `progress: Map<videoId, { step, detail, elapsedMs }>` in `learning.ts`.
3. **"Did it just fail?"** — `recentFailures: Map<videoId, { error, at }>` with a 5-minute TTL.

The share flow, the learn-page loader, `Force retry`, and `Regenerate` each have to know about all three. This is the most concurrency-bug-prone shape in the codebase; the architecture doc itself notes a past bug from a two-Set design ([architecture.md:148–149](../architecture.md)).

A second concern: the "completed" state isn't represented anywhere except indirectly (`Video.summaryStatus === 'generated'` in the database). The state machine is partially in-memory and partially in Strapi.

## Sketch

One Module owns "background generation for a `Video`". Its Interface answers: *what is the state of generation for this `Video`, and how do I kick one off if needed?*

Behind the Seam: the Set, the Map, and the failure cache are Implementation. The state machine (idle → queued → running → completed/failed) is enforced by the Module, not by every caller remembering to check the Set before mutating it.

Callers stop saying "add this id to `generationInflight`, kick off the IIFE, log if `recentFailures` had something." They say "ensure generation for this `Video`."

## Locality / Leverage

- **Locality:** the dedup invariant (only one job per `videoId` at a time) is enforced in one place. The progress contract is unified with kickoff.
- **Leverage:** when we eventually need a queue (multiple videos at once, GPU contention) or move to a worker process, the Module is the seam — callers stay the same.

## Test surface change

Today this is effectively untestable without spinning up real generation against Ollama. After: mock the generator, verify the state machine — two concurrent kickoffs run once; failure surfaces to the next caller; retry clears the failure entry; progress updates are visible to readers.

The Module's surface is the test surface.

## Open questions for grilling

- In-memory only, or persisted state? Today `generationInflight` is per-process; a server restart loses it but a stuck `summaryStatus='pending'` row is the only durable trace. Is that the right resilience story?
- What's the Interface return shape? `'idle' | 'running' | 'completed' | 'failed'` plus optional progress/error? Or one richer object?
- Does the Module own the `Video.summaryStatus` write, or does `learning.ts` keep that and the Module only owns the in-memory bits?
- The 5-minute `recentFailures` TTL — is that policy worth preserving, or did it grow organically?
- Does this Module need to know about `mode` (`auto | single-pass | map-reduce`) at all, or is that a generation-pipeline detail it just passes through?
- Should there be an event/observer surface for the progress polling, or is the existing 3s loader-polling pattern fine?

## Grilling notes

### Scope decision: B (medium), not A or C

- **A (narrow)** — extract just the inflight Set + recentFailures Map, leave progress where it is. Rejected: only deduplicates, doesn't address the inflight ↔ progress consistency gap, which is the actual bug-prone shape (a stuck `pending` row is the visible bug). "Deduplicate, not deepen."
- **B (medium)** — one Module owns the entire in-memory state machine: inflight + progress + recentFailures. Single read (`getLiveState`), single mutating entry (`ensureGenerationRunning`).
- **C (broad)** — also subsume `Video.summaryStatus` writes (`markSummaryFailedService`, `markSummaryPendingService`). Rejected: persistence is a different concern; pulling it in widens the Interface and creates the shallow-Module trap.

### Hidden race uncovered during grilling

Reading the original code surfaced a real concurrency bug:

```ts
// Old regenerateSummary
if (inflight.has(data.videoId)) return { status: 'already_running' };
recentFailures.delete(...);            // sync
const flip = await markSummaryPendingService(...);  // ← await yields the event loop
if (!flip.success) return { status: 'error', error: flip.error };
inflight.add(data.videoId);            // ← the add happens AFTER an await
```

Two concurrent regenerate clicks for the same `videoId` could both pass the `has` check (because the `add` doesn't happen until after the `markSummaryPendingService` await), and both kick off the IIFE → two concurrent generations of the same video. The Module's atomic check-and-add (no awaits between `inflight.has` and `inflight.add`) eliminates this.

### Final shape

```ts
// client/src/lib/services/generation-state.ts

ensureGenerationRunning(
  videoId,
  run: () => Promise<ServiceResult<unknown>>,
  hooks?: {
    beforeStart?: () => Promise<void>;     // pre-job persistence
    onTerminalThrow?: (err) => Promise<void>;  // crash-recovery persistence
  }
): Promise<EnsureResult>     // 'started' | 'already_running' | 'recently_failed' | 'failed_to_start'

setStep(videoId, step, detail?): void
getLiveState(videoId): GenerationLiveState  // 'idle' | 'running' | 'recently_failed'
clearRecentFailure(videoId): void
```

Three external server-fn callers (`shareVideo` via `kickoffSummaryGeneration`, `triggerSummaryGeneration`, `regenerateSummary`) all collapse to thin wrappers around `ensureGenerationRunning`. The 30-line kickoff dance × 3 callers is now one Module + three ~8-line server fns.

### Decisions made during grilling

- **Persistence stays out of the Module.** `markSummaryFailedService` and `markSummaryPendingService` are wired via `beforeStart` / `onTerminalThrow` hooks. Module is testable without Strapi. Three callers share one tiny `markVideoFailedHook` helper in `videos.ts` so the wiring is DRY without coupling the Module.
- **Auto-clear progress in the Module's `finally`.** The four inline `clearGenerationStep` calls inside `generateVideoSummary` are removed — single source of truth for "when is progress cleared." If the Module's IIFE finally runs, progress and inflight are both cleared. No orphan entries possible.
- **Defensive `setStep`** — silently ignores videoIds that aren't inflight. Protects the "progress only exists while inflight" invariant against accidental misuse.
- **`run()` is typed as `() => Promise<ServiceResult<unknown>>`.** Lets the Module distinguish "known failure" (run returned `{success: false}` — `generateVideoSummary` already marked the DB) from "uncaught throw" (rejected promise — `onTerminalThrow` fires for crash recovery).
- **5-minute `recentFailures` TTL preserved** — has a real reason (retry-spam prevention), not relitigated.
- **`beforeStart` rolls back inflight on failure.** If the pending-flip throws, the Module deletes from inflight and returns `failed_to_start`, so the next caller can start fresh. Without this, a failed pending-flip would leave a phantom inflight entry.

### Test surface

`client/src/lib/services/generation-state.test.ts` — 15 tests covering:
- `ensureGenerationRunning`: started path, atomic check-and-add (concurrent calls), `beforeStart` fires only on started (not already_running), `beforeStart` throwing rolls back, `onTerminalThrow` fires on rejection, `onTerminalThrow` does NOT fire on `{success: false}`, recentFailures cleared on success, recentFailures blocks new runs, hook itself throwing doesn't crash the Module.
- `setStep` / `getLiveState`: records step/detail while inflight, preserves step start-time across detail changes, resets step start-time when step changes, ignores non-inflight videoIds, returns running with null step before first setStep.
- `clearRecentFailure`: drops the entry so next ensure call can start.

The Module is testable without a database, without Ollama, without TanStack AI. `controllableRun()` helper builds a Promise the test resolves/rejects to drive state transitions deterministically.

### What got rejected and why

- **Module hardcodes Strapi mark-failed (no hooks):** simpler today, but the Module would import from `videos.ts` (the Strapi REST wrapper) — coupling the in-memory state machine to a persistence layer it shouldn't strictly need. Rejected for future-flexibility (worker-queue migration, alternative persistence) at the cost of a tiny bit more ceremony today.
- **One-required-hook design (`onTerminalThrow` not optional):** considered making the hook required so callers can't accidentally skip the load-bearing crash-recovery wire-up. Rejected because the Module is also useful without persistence (e.g. tests, future non-DB-backed contexts). Optional with documented load-bearing semantics is the right balance.
- **Subsume `markSummaryPendingService` into the Module (scope C):** would mean the Module knows about Strapi document IDs, Strapi error shapes. Rejected — that's the durable-state layer's job.

### Bug fixes shipped alongside the refactor

1. **Race condition in `regenerateSummary`** (described above) — atomic check-and-add eliminates double-generation under concurrent clicks.
2. **Possible orphan progress entries** — 4 redundant `clearGenerationStep` calls inside `generateVideoSummary` removed; `finally` block guarantees cleanup.

### Follow-up candidates (not done)

- **Unify with the `pending` DB-row write** — when (if ever) the persistence layer changes shape, consider whether the Module should own the state-transition writes. Today the carve-out (Module owns crash recovery, callers own pending-flip) is the right balance.
- **Persisted state for resilience** — if the server ever needs to recover from a restart mid-generation (today: a stuck `pending` row is the only durable trace), the Module would gain a persistence-backed inflight store. Out of scope for local-first single-process.
