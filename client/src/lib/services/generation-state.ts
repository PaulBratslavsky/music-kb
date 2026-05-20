// Background-generation state machine. Owns the in-memory pieces that
// coordinate the summary-generation lifecycle:
//
//   • inflight tracking — atomic check-and-add prevents two concurrent
//     jobs for the same Video.
//   • progress — the step / detail / elapsed-time view the UI polls
//     during the pending state.
//   • recent-failure cache — 5-minute TTL window so a UI poll right
//     after a crash sees the error instead of assuming "still pending".
//
// All three were previously scattered across `videos.ts` (server fns)
// and `learning.ts` (the generation pipeline) with no consistency
// invariant tying them together. The Module enforces one: progress
// only exists while inflight; recentFailure only exists while idle.
//
// Persistence (Strapi) stays OUT of this Module. Callers inject hooks
// for `beforeStart` (e.g. flipping the DB row to `pending`) and
// `onTerminalThrow` (e.g. flipping the DB row to `failed` after an
// uncaught crash). The Module is testable without a database and the
// persistence layer can change without touching the state machine.

// Structural contract for the `run` callback. Defined locally (rather
// than imported) so the Module stays decoupled from any single result-
// shape source. Compatible with the `ServiceResult` type used across
// the services layer — TypeScript matches structurally.
type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type GenerationStep = 'transcript' | 'ai' | 'saving';

export type GenerationLiveState =
  | { status: 'idle' }
  | {
      status: 'running';
      step: GenerationStep | null;
      detail: string | null;
      // ms since the current step began. Preserved across detail
      // changes inside the same step so the UI's elapsed counter
      // doesn't reset on every map-chunk boundary.
      elapsedMs: number;
      detailElapsedMs: number;
    }
  | { status: 'recently_failed'; error: string; ageMs: number };

export type EnsureResult =
  | { status: 'started' }
  | { status: 'already_running' }
  | { status: 'recently_failed'; error: string }
  | { status: 'failed_to_start'; error: string };

type Progress = {
  step: GenerationStep;
  detail: string | null;
  at: number;
  detailAt: number;
};

type RecentFailure = { error: string; at: number };

type EnsureHooks = {
  // Fires after dedup checks pass and inflight is reserved, BEFORE the
  // run is kicked off. Use for pre-job persistence (e.g. flip Video row
  // to `pending`). If the hook throws, the Module rolls back the
  // inflight reservation and returns `failed_to_start`.
  beforeStart?: () => Promise<void>;
  // Fires when `run()` rejects with an uncaught error. Use for the
  // load-bearing "don't leave the row stuck in pending" persistence
  // (e.g. flip Video row to `failed`). NOT fired when run resolves
  // with `{ success: false }` — that's a known failure the run already
  // handled at its own seam.
  onTerminalThrow?: (err: unknown) => Promise<void>;
};

const FAILURE_TTL_MS = 5 * 60 * 1000;

const inflight = new Set<string>();
const progress = new Map<string, Progress>();
const recentFailures = new Map<string, RecentFailure>();

// Atomic check-and-add — no awaits between `inflight.has` and
// `inflight.add` so two concurrent calls can never both pass the check.
// Returns immediately if a job is already running or recently failed;
// otherwise reserves the slot and kicks off `run()` in the background.
export async function ensureGenerationRunning(
  videoId: string,
  run: () => Promise<ServiceResult<unknown>>,
  hooks?: EnsureHooks,
): Promise<EnsureResult> {
  if (inflight.has(videoId)) {
    return { status: 'already_running' };
  }
  const failure = readRecentFailure(videoId);
  if (failure) {
    return { status: 'recently_failed', error: failure };
  }
  inflight.add(videoId);

  if (hooks?.beforeStart) {
    try {
      await hooks.beforeStart();
    } catch (err) {
      inflight.delete(videoId);
      const message = err instanceof Error ? err.message : 'beforeStart failed';
      return { status: 'failed_to_start', error: message };
    }
  }

  void runInBackground(videoId, run, hooks);
  return { status: 'started' };
}

async function runInBackground(
  videoId: string,
  run: () => Promise<ServiceResult<unknown>>,
  hooks: EnsureHooks | undefined,
): Promise<void> {
  try {
    const result = await run();
    if (result.success) {
      recentFailures.delete(videoId);
    } else {
      // Known failure — `run()` already handled its own persistence
      // (e.g. markSummaryFailedService inside generateVideoSummary).
      // We only record the error for the UI's recent-failure window.
      recentFailures.set(videoId, { error: result.error, at: Date.now() });
    }
  } catch (err) {
    // Uncaught throw — the run might not have reached its own
    // mark-failed call. Surface to the caller's hook so the durable
    // state can be aligned (otherwise the row stays `pending` forever
    // and the UI polls indefinitely).
    const message = err instanceof Error ? err.message : 'Generation crashed';
    recentFailures.set(videoId, { error: message, at: Date.now() });
    if (hooks?.onTerminalThrow) {
      try {
        await hooks.onTerminalThrow(err);
      } catch (hookErr) {
        // eslint-disable-next-line no-console
        console.error('[generation-state] onTerminalThrow hook itself failed', {
          videoId,
          hookErr,
        });
      }
    }
  } finally {
    progress.delete(videoId);
    inflight.delete(videoId);
  }
}

// Step writer used by the generation pipeline. Silently ignored for
// videoIds that aren't inflight — protects the "progress only exists
// while inflight" invariant against accidental misuse.
export function setStep(
  videoId: string,
  step: GenerationStep,
  detail: string | null = null,
): void {
  if (!inflight.has(videoId)) return;
  const now = Date.now();
  const existing = progress.get(videoId);
  const stepStartedAt = existing && existing.step === step ? existing.at : now;
  progress.set(videoId, {
    step,
    detail,
    at: stepStartedAt,
    detailAt: now,
  });
}

// Single read of the in-memory state machine. Collapses inflight +
// progress + recentFailures into one answer.
export function getLiveState(videoId: string): GenerationLiveState {
  if (inflight.has(videoId)) {
    const entry = progress.get(videoId);
    const now = Date.now();
    if (!entry) {
      return {
        status: 'running',
        step: null,
        detail: null,
        elapsedMs: 0,
        detailElapsedMs: 0,
      };
    }
    return {
      status: 'running',
      step: entry.step,
      detail: entry.detail,
      elapsedMs: now - entry.at,
      detailElapsedMs: now - entry.detailAt,
    };
  }
  const failure = readRecentFailure(videoId);
  if (failure) {
    const entry = recentFailures.get(videoId);
    return {
      status: 'recently_failed',
      error: failure,
      ageMs: entry ? Date.now() - entry.at : 0,
    };
  }
  return { status: 'idle' };
}

// Drop a recent-failure entry. Used by `regenerateSummary` and the
// "Force retry" UI affordance to bypass the 5-minute window.
export function clearRecentFailure(videoId: string): void {
  recentFailures.delete(videoId);
}

function readRecentFailure(videoId: string): string | null {
  const entry = recentFailures.get(videoId);
  if (!entry) return null;
  if (Date.now() - entry.at > FAILURE_TTL_MS) {
    recentFailures.delete(videoId);
    return null;
  }
  return entry.error;
}
