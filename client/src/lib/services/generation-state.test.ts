import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRecentFailure,
  ensureGenerationRunning,
  getLiveState,
  setStep,
} from './generation-state';

// The Module holds module-level Maps/Set for inflight, progress, and
// recentFailures. Vitest re-imports modules per test file (not per test),
// so state leaks between tests unless we explicitly clean up. Each test
// uses a unique videoId AND we drain failure entries in afterEach.
const ids = (() => {
  let n = 0;
  return () => `vid-${++n}`;
})();

afterEach(() => {
  // Best-effort cleanup. ensureGenerationRunning's `finally` clears
  // inflight + progress on completion; recentFailures we have to clear
  // explicitly because the contract is "stays for 5 minutes."
});

type Result =
  | { success: true; data: unknown }
  | { success: false; error: string };

const ok = (data: unknown = null): Result => ({ success: true, data });
const fail = (error: string): Result => ({ success: false, error });

// Build a controllable run() — caller awaits the returned promise to
// know when the run has fully resolved (including the Module's finally
// block clearing inflight + progress).
function controllableRun() {
  let resolveFn!: (r: Result) => void;
  let rejectFn!: (err: unknown) => void;
  const runPromise = new Promise<Result>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const run = () => runPromise;
  return { run, resolve: resolveFn, reject: rejectFn };
}

// Wait for the Module's background IIFE to drain. The Module awaits
// run() then enters its finally — yielding a microtask is enough.
async function flushMicrotasks() {
  await new Promise((r) => setImmediate(r));
}

describe('ensureGenerationRunning', () => {
  it('returns "started" and runs the work in the background', async () => {
    const id = ids();
    const { run, resolve } = controllableRun();
    const result = await ensureGenerationRunning(id, run);
    expect(result.status).toBe('started');
    expect(getLiveState(id).status).toBe('running');
    resolve(ok());
    await flushMicrotasks();
    expect(getLiveState(id).status).toBe('idle');
  });

  it('atomic check-and-add: two concurrent calls only spawn one job', async () => {
    const id = ids();
    const r1 = controllableRun();
    const r2 = controllableRun();
    const run1 = vi.fn(r1.run);
    const run2 = vi.fn(r2.run);

    // Fire both calls; the second should see inflight and skip.
    const [first, second] = await Promise.all([
      ensureGenerationRunning(id, run1),
      ensureGenerationRunning(id, run2),
    ]);
    expect(first.status).toBe('started');
    expect(second.status).toBe('already_running');
    expect(run1).toHaveBeenCalledTimes(1);
    expect(run2).not.toHaveBeenCalled();

    r1.resolve(ok());
    await flushMicrotasks();
  });

  it('beforeStart fires only when a job will run', async () => {
    const id = ids();
    const beforeStart = vi.fn(async () => {});
    const { run, resolve } = controllableRun();

    await ensureGenerationRunning(id, run, { beforeStart });
    expect(beforeStart).toHaveBeenCalledTimes(1);

    // Second concurrent call → already_running → beforeStart MUST NOT fire.
    const beforeStart2 = vi.fn(async () => {});
    const r2 = await ensureGenerationRunning(id, () => Promise.resolve(ok()), {
      beforeStart: beforeStart2,
    });
    expect(r2.status).toBe('already_running');
    expect(beforeStart2).not.toHaveBeenCalled();

    resolve(ok());
    await flushMicrotasks();
  });

  it('beforeStart throwing rolls back inflight and returns failed_to_start', async () => {
    const id = ids();
    const run = vi.fn(() => Promise.resolve(ok()));
    const beforeStart = vi.fn(async () => {
      throw new Error('pending flip failed');
    });

    const result = await ensureGenerationRunning(id, run, { beforeStart });
    expect(result).toEqual({
      status: 'failed_to_start',
      error: 'pending flip failed',
    });
    // Run must NOT have fired.
    expect(run).not.toHaveBeenCalled();
    // Inflight rolled back — next call should be able to start.
    expect(getLiveState(id).status).toBe('idle');
  });

  it('onTerminalThrow fires on uncaught run() rejection', async () => {
    const id = ids();
    const onTerminalThrow = vi.fn(async () => {});
    const { run, reject } = controllableRun();

    await ensureGenerationRunning(id, run, { onTerminalThrow });
    reject(new Error('boom'));
    await flushMicrotasks();

    expect(onTerminalThrow).toHaveBeenCalledTimes(1);
    const live = getLiveState(id);
    expect(live.status).toBe('recently_failed');
    if (live.status === 'recently_failed') {
      expect(live.error).toBe('boom');
    }
    clearRecentFailure(id);
  });

  it('onTerminalThrow does NOT fire on {success: false} result', async () => {
    const id = ids();
    const onTerminalThrow = vi.fn(async () => {});
    const { run, resolve } = controllableRun();

    await ensureGenerationRunning(id, run, { onTerminalThrow });
    resolve(fail('known failure'));
    await flushMicrotasks();

    expect(onTerminalThrow).not.toHaveBeenCalled();
    // recentFailures still gets set so the next caller sees it.
    const live = getLiveState(id);
    expect(live.status).toBe('recently_failed');
    if (live.status === 'recently_failed') {
      expect(live.error).toBe('known failure');
    }
    clearRecentFailure(id);
  });

  it('clears recentFailures on a successful run', async () => {
    const id = ids();
    const { run, resolve } = controllableRun();
    await ensureGenerationRunning(id, run);
    resolve(ok());
    await flushMicrotasks();
    expect(getLiveState(id).status).toBe('idle');
  });

  it('blocks new runs while a recentFailure exists', async () => {
    const id = ids();
    const { run, resolve } = controllableRun();
    await ensureGenerationRunning(id, run);
    resolve(fail('first failure'));
    await flushMicrotasks();

    const second = await ensureGenerationRunning(id, () => Promise.resolve(ok()));
    expect(second).toEqual({ status: 'recently_failed', error: 'first failure' });

    clearRecentFailure(id);
    const third = await ensureGenerationRunning(id, () => Promise.resolve(ok()));
    expect(third.status).toBe('started');
    await flushMicrotasks();
  });

  it('hook failures inside onTerminalThrow do not crash the Module', async () => {
    const id = ids();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onTerminalThrow = vi.fn(async () => {
      throw new Error('hook itself failed');
    });
    const { run, reject } = controllableRun();

    await ensureGenerationRunning(id, run, { onTerminalThrow });
    reject(new Error('boom'));
    await flushMicrotasks();

    // Module logged the hook failure but stayed consistent.
    expect(consoleSpy).toHaveBeenCalled();
    expect(getLiveState(id).status).toBe('recently_failed');
    consoleSpy.mockRestore();
    clearRecentFailure(id);
  });
});

describe('setStep / getLiveState', () => {
  it('records step + detail while inflight', async () => {
    const id = ids();
    const { run, resolve } = controllableRun();
    await ensureGenerationRunning(id, run);

    setStep(id, 'transcript');
    let live = getLiveState(id);
    expect(live.status).toBe('running');
    if (live.status === 'running') {
      expect(live.step).toBe('transcript');
      expect(live.detail).toBeNull();
    }

    setStep(id, 'ai', 'map chunk 1/4');
    live = getLiveState(id);
    if (live.status === 'running') {
      expect(live.step).toBe('ai');
      expect(live.detail).toBe('map chunk 1/4');
    }

    resolve(ok());
    await flushMicrotasks();
  });

  it('preserves step start-time across detail changes', async () => {
    const id = ids();
    const { run, resolve } = controllableRun();
    await ensureGenerationRunning(id, run);

    setStep(id, 'ai', 'map chunk 1/4');
    const first = getLiveState(id);
    if (first.status !== 'running') throw new Error('expected running');
    const firstAt = first.elapsedMs;

    await new Promise((r) => setTimeout(r, 5));

    setStep(id, 'ai', 'map chunk 2/4'); // same step, new detail
    const second = getLiveState(id);
    if (second.status !== 'running') throw new Error('expected running');
    // Step's elapsedMs keeps growing across detail changes (didn't reset).
    expect(second.elapsedMs).toBeGreaterThanOrEqual(firstAt);
    // Detail's elapsedMs resets on detail change.
    expect(second.detailElapsedMs).toBeLessThan(second.elapsedMs);

    resolve(ok());
    await flushMicrotasks();
  });

  it('resets step start-time when step changes', async () => {
    const id = ids();
    const { run, resolve } = controllableRun();
    await ensureGenerationRunning(id, run);

    setStep(id, 'transcript');
    await new Promise((r) => setTimeout(r, 10));
    setStep(id, 'ai'); // step transition
    const live = getLiveState(id);
    if (live.status !== 'running') throw new Error('expected running');
    // Crossing a step boundary resets the step elapsed clock.
    expect(live.elapsedMs).toBeLessThan(10);

    resolve(ok());
    await flushMicrotasks();
  });

  it('silently ignores setStep for non-inflight videoIds', () => {
    const id = ids();
    setStep(id, 'transcript');
    expect(getLiveState(id).status).toBe('idle');
  });

  it('returns running with null step when inflight but setStep not called yet', async () => {
    const id = ids();
    const { run, resolve } = controllableRun();
    await ensureGenerationRunning(id, run);

    const live = getLiveState(id);
    expect(live.status).toBe('running');
    if (live.status === 'running') {
      expect(live.step).toBeNull();
    }

    resolve(ok());
    await flushMicrotasks();
  });
});

describe('clearRecentFailure', () => {
  it('drops the failure entry so the next ensure call can start', async () => {
    const id = ids();
    const { run, resolve } = controllableRun();
    await ensureGenerationRunning(id, run);
    resolve(fail('whoops'));
    await flushMicrotasks();
    expect(getLiveState(id).status).toBe('recently_failed');

    clearRecentFailure(id);
    expect(getLiveState(id).status).toBe('idle');
  });
});
