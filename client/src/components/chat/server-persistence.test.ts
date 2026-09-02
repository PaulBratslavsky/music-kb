// @vitest-environment jsdom
//
// The server-backed persistence adapter.
//
// Three things here can fail silently, which is why each has a test:
//
//   1. The DEBOUNCE. The SDK writes on every message change; without
//      collapsing them, one answer is ~1000 requests. Nothing errors — the app
//      just hammers the backend for ~20 s after every answer.
//   2. DATE REVIVAL. JSON gives back an ISO string where a live message
//      carries a Date. The SDK's own storage adapters revive it; a custom one
//      that forgets hands the app messages that differ in runtime type from the
//      ones it just streamed, and nothing throws.
//   3. WRITE-AFTER-CLEAR. `setItem` resolves as soon as it has SCHEDULED a
//      write, so the SDK is free to call `removeItem` while a timer is armed.
//      A write that lands after the delete resurrects a cleared conversation.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import trace from './__fixtures__/persistence-trace-0.29.json';

const loadConversation = vi.fn();
const saveConversation = vi.fn();
const deleteConversation = vi.fn();

vi.mock('#/data/server-functions/chat-conversations', () => ({
  loadConversation: (...a: unknown[]) => loadConversation(...a),
  saveConversation: (...a: unknown[]) => saveConversation(...a),
  deleteConversation: (...a: unknown[]) => deleteConversation(...a),
}));

const { serverPersistence } = await import('./server-persistence');

const opts = () => ({
  surface: 'library-ask',
  onCitationsRestored: vi.fn(),
  onError: vi.fn(),
  onRecovered: vi.fn(),
});

beforeEach(() => {
  vi.useFakeTimers();
  loadConversation.mockReset().mockResolvedValue({ status: 'ok', conversation: null });
  saveConversation.mockReset().mockResolvedValue({ status: 'ok' });
  deleteConversation.mockReset().mockResolvedValue({ status: 'ok' });
});
afterEach(() => vi.useRealTimers());

const msg = (id: string, content = 'x') => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', content }],
});

describe('write batching', () => {
  it('collapses a burst of writes into a single save', async () => {
    const p = serverPersistence(opts());

    // 50 message changes in the same tick, as a stream produces.
    for (let i = 0; i < 50; i++) {
      p.setItem('t', { messages: [msg('m1', 'x'.repeat(i))] } as never);
    }
    expect(saveConversation).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(saveConversation).toHaveBeenCalledTimes(1);
  });

  it('saves the LAST state of the burst, not the first', async () => {
    const p = serverPersistence(opts());
    p.setItem('t', { messages: [msg('m1', 'first')] } as never);
    p.setItem('t', { messages: [msg('m1', 'second')] } as never);
    p.setItem('t', { messages: [msg('m1', 'final')] } as never);

    await vi.advanceTimersByTimeAsync(500);

    const sent = saveConversation.mock.calls[0][0].data.state.messages[0];
    expect(sent.parts[0].content).toBe('final');
  });

  it('checkpoints a long continuous stream instead of deferring forever', async () => {
    const p = serverPersistence(opts());
    // A stream that never goes quiet for the full debounce window: a change
    // every 100ms for 12s. A pure trailing debounce would write nothing.
    for (let i = 0; i < 120; i++) {
      p.setItem('t', { messages: [msg('m1', 'x'.repeat(i))] } as never);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(saveConversation.mock.calls.length).toBeGreaterThan(0);
    // …but still nothing like one write per change.
    expect(saveConversation.mock.calls.length).toBeLessThan(10);
  });

  it('flush() writes immediately, for unmount and tab-hide', async () => {
    const p = serverPersistence(opts());
    p.setItem('t', { messages: [msg('m1')] } as never);
    expect(saveConversation).not.toHaveBeenCalled();

    await p.flush();
    expect(saveConversation).toHaveBeenCalledTimes(1);
  });

  it('flush() with nothing pending does not write', async () => {
    const p = serverPersistence(opts());
    await p.flush();
    expect(saveConversation).not.toHaveBeenCalled();
  });
});

describe('clear', () => {
  it('cancels a pending write so it cannot resurrect the conversation', async () => {
    const p = serverPersistence(opts());
    p.setItem('t', { messages: [msg('m1')] } as never);

    await p.removeItem('t');
    await vi.advanceTimersByTimeAsync(2000);

    expect(deleteConversation).toHaveBeenCalledTimes(1);
    expect(saveConversation).not.toHaveBeenCalled();
  });

  it('deletes AFTER an in-flight save, so a clear cannot be undone by it', async () => {
    // THE BUG THIS REPLACES. A save and a delete are both find-then-write
    // against Strapi. Unordered, the delete can land first and the save then
    // recreates the row — the user clears the conversation, sees it vanish,
    // and it is back on the next reload with nothing reporting it. The old
    // test here asserted only that the stale save stayed quiet, which is true
    // of the broken behaviour too.
    const order: string[] = [];
    let releaseSave: () => void = () => {};
    saveConversation.mockImplementation(
      () =>
        new Promise((r) => {
          releaseSave = () => {
            order.push('save');
            r({ status: 'ok' });
          };
        }),
    );
    deleteConversation.mockImplementation(async () => {
      order.push('delete');
      return { status: 'ok' };
    });

    const o = opts();
    const p = serverPersistence(o);

    p.setItem('t', { messages: [msg('m1')] } as never);
    await vi.advanceTimersByTimeAsync(500); // the save is now awaiting the server

    const cleared = p.removeItem('t'); // must queue, not overtake
    await vi.advanceTimersByTimeAsync(0);
    expect(order, 'delete jumped ahead of the in-flight save').toEqual([]);

    releaseSave();
    await cleared;

    expect(order).toEqual(['save', 'delete']);
  });

  it('refuses to write after a failed load, so an outage cannot destroy the transcript', async () => {
    // A failed load and "nothing stored" are the SAME value at the SDK's port:
    // null. So the SDK starts an empty conversation, and an unguarded adapter
    // then PUTs that empty transcript over the real one. Degrading has to mean
    // not writing, or it means destroying.
    loadConversation.mockResolvedValue({ status: 'error', error: 'ECONNREFUSED' });
    const o = opts();
    const p = serverPersistence(o);

    await p.getItem('t');
    expect(o.onError).toHaveBeenCalledWith('load', 'ECONNREFUSED');

    p.setItem('t', { messages: [msg('only the new turn')] } as never);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(saveConversation).not.toHaveBeenCalled();
  });

  it('resumes writing once a load succeeds, and clears the banner', async () => {
    loadConversation.mockResolvedValueOnce({ status: 'error', error: 'down' });
    const o = opts();
    const p = serverPersistence(o);
    await p.getItem('t');

    loadConversation.mockResolvedValue({ status: 'ok', conversation: null });
    await p.getItem('t');

    expect(o.onRecovered).toHaveBeenCalled();
    p.setItem('t', { messages: [msg('m')] } as never);
    await vi.advanceTimersByTimeAsync(500);
    expect(saveConversation).toHaveBeenCalled();
  });

  it('a clear unblocks writing after a failed load', async () => {
    // Clearing is the user saying "start fresh": there is no longer a stored
    // transcript to protect, so the guard must lift or the chat is read-only
    // until reload.
    loadConversation.mockResolvedValue({ status: 'error', error: 'down' });
    const o = opts();
    const p = serverPersistence(o);
    await p.getItem('t');

    await p.removeItem('t');
    p.setItem('t', { messages: [msg('fresh')] } as never);
    await vi.advanceTimersByTimeAsync(500);

    expect(saveConversation).toHaveBeenCalled();
  });

  it('forgets restored citations, so the next write cannot carry them back', async () => {
    loadConversation.mockResolvedValue({
      status: 'ok',
      conversation: { messages: [msg('m1')], citations: [['m1', [{ index: 0 }]]] },
    });
    const p = serverPersistence(opts());
    await p.getItem('t');
    await p.removeItem('t');

    p.setItem('t', { messages: [msg('m2')] } as never);
    await vi.advanceTimersByTimeAsync(500);

    expect(saveConversation.mock.calls[0][0].data.state.citations).toEqual([]);
  });
});

describe('citations', () => {
  it('folds the caller-owned citations into the row it writes', async () => {
    const p = serverPersistence(opts());
    p.setCitations([['m1', [{ index: 0 }]]] as never);
    p.setItem('t', { messages: [msg('m1')] } as never);
    await vi.advanceTimersByTimeAsync(500);

    expect(saveConversation.mock.calls[0][0].data.state.citations).toEqual([
      ['m1', [{ index: 0 }]],
    ]);
  });

  it('hands restored citations to the caller on load', async () => {
    const stored = [['m1', [{ index: 0, youtubeVideoId: 'abc' }]]];
    loadConversation.mockResolvedValue({
      status: 'ok',
      conversation: { messages: [msg('m1')], citations: stored },
    });
    const o = opts();
    const p = serverPersistence(o);

    await p.getItem('t');
    expect(o.onCitationsRestored).toHaveBeenCalledWith(stored);
  });
});

describe('restoring a transcript', () => {
  it('revives createdAt as a Date, the way the SDK’s own adapters do', async () => {
    // What a JSON column gives back: ISO strings.
    loadConversation.mockResolvedValue({
      status: 'ok',
      conversation: {
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            createdAt: '2026-08-30T10:00:00.000Z',
            parts: [
              { type: 'tool-result', createdAt: '2026-08-30T10:00:01.000Z', result: 'r' },
            ],
          },
        ],
        citations: [],
      },
    });
    const p = serverPersistence(opts());

    const state = await p.getItem('t');
    const restored = state!.messages[0] as unknown as {
      createdAt: unknown;
      parts: Array<{ createdAt?: unknown }>;
    };

    expect(restored.createdAt).toBeInstanceOf(Date);
    expect((restored.createdAt as Date).toISOString()).toBe('2026-08-30T10:00:00.000Z');
    expect(restored.parts[0].createdAt).toBeInstanceOf(Date);
  });

  it('drops an unparseable createdAt rather than restoring an Invalid Date', async () => {
    loadConversation.mockResolvedValue({
      status: 'ok',
      conversation: {
        messages: [{ id: 'm1', role: 'assistant', createdAt: 'not-a-date', parts: [] }],
        citations: [],
      },
    });
    const p = serverPersistence(opts());
    const state = await p.getItem('t');
    expect((state!.messages[0] as unknown as { createdAt?: unknown }).createdAt).toBeUndefined();
  });

  it('returns null for a thread that was never saved', async () => {
    loadConversation.mockResolvedValue({ status: 'ok', conversation: null });
    const p = serverPersistence(opts());
    await expect(p.getItem('t')).resolves.toBeNull();
  });
});

describe('failing closed', () => {
  it('reports a failed load instead of swallowing it', async () => {
    loadConversation.mockResolvedValue({ status: 'error', error: 'backend down' });
    const o = opts();
    const p = serverPersistence(o);

    await expect(p.getItem('t')).resolves.toBeNull();
    expect(o.onError).toHaveBeenCalledWith('load', 'backend down');
  });

  it('reports a failed save', async () => {
    saveConversation.mockResolvedValue({ status: 'error', error: 'write refused' });
    const o = opts();
    const p = serverPersistence(o);

    p.setItem('t', { messages: [msg('m1')] } as never);
    await vi.advanceTimersByTimeAsync(500);

    expect(o.onError).toHaveBeenCalledWith('save', 'write refused');
  });

  it('reports a thrown server function rather than rejecting into the SDK', async () => {
    // The SDK wraps every adapter call in `.catch(() => {})`, so a rejection
    // here would be invisible. Catching it ourselves is what makes it visible.
    loadConversation.mockRejectedValue(new Error('network'));
    const o = opts();
    const p = serverPersistence(o);

    await expect(p.getItem('t')).resolves.toBeNull();
    expect(o.onError).toHaveBeenCalledWith('load', 'network');
  });

  it('does nothing at all during SSR', async () => {
    // useChat builds its ChatClient inside a useMemo — during render — and
    // <LibraryChat> lives in __root, so this adapter is constructed on the
    // server for every route. Calling a server function from inside a server
    // render is at best a wasted round trip and at worst a hydration
    // mismatch; the client re-reads after mount.
    vi.stubGlobal('window', undefined);
    const p = serverPersistence(opts());

    await expect(p.getItem('t')).resolves.toBeNull();
    p.setItem('t', { messages: [msg('m1')] } as never);
    await vi.advanceTimersByTimeAsync(500);

    expect(loadConversation).not.toHaveBeenCalled();
    expect(saveConversation).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('never falls back to localStorage', async () => {
    // Fail-closed is a decision, not an accident: a local fallback would make
    // the transcript silently diverge per device, which is the exact failure
    // this feature exists to remove. Asserted on behaviour, not on source.
    const setItemSpy = vi.fn();
    vi.stubGlobal('localStorage', {
      setItem: setItemSpy,
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
    });
    saveConversation.mockResolvedValue({ status: 'error', error: 'down' });
    const p = serverPersistence(opts());

    p.setItem('t', { messages: [msg('m1')] } as never);
    await vi.advanceTimersByTimeAsync(500);

    expect(setItemSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

// The SDK-side half, captured rather than reasoned about.
//
// Everything above tests OUR adapter. This tests the premise the adapter is
// built on: that the SDK really does write once per message change, so the
// debounce is load-bearing rather than defensive. If a future SDK coalesces
// writes itself, these go red and the debounce can be reconsidered — which is
// the whole point of pinning it.
/**
 * The write ops from the capture.
 *
 * The fixture's `ops` is heterogeneous — `getItem` rows carry no size fields —
 * so TS widens the JSON import to a union. Narrowing here keeps the
 * assertions below reading as plain numbers.
 */
const setItemOps = (): Array<{ messages: number; bytes: number }> =>
  trace.ops.flatMap((o) =>
    o.op === 'setItem' && typeof o.messages === 'number' && typeof o.bytes === 'number'
      ? [{ messages: o.messages, bytes: o.bytes }]
      : [],
  );

describe('against a captured ChatClient persistence trace', () => {
  it('the capture is a real streamed answer, not a synthetic one', () => {
    // Guard on the fixture. Without this, the assertions below would still
    // pass against a trace someone shrank to three ops.
    expect(trace.stream.source).toContain('/api/ask');
    expect(trace.stream.textDeltas).toBeGreaterThan(100);
    expect(trace.ops.length).toBe(
      trace.totals.getItem + trace.totals.setItem + trace.totals.removeItem,
    );
  });

  it('shows the SDK issuing roughly one write per streamed chunk', () => {
    // 956 setItem calls for a single answer. This is the number the debounce
    // exists to reduce.
    expect(trace.totals.setItem).toBeGreaterThan(trace.stream.textDeltas);
    expect(trace.totals.getItem).toBe(1);
  });

  it('shows each write re-serialising the whole transcript', () => {
    // The message COUNT barely moves while the bytes climb — the cost is
    // re-writing the growing transcript on every token, not more messages.
    const writes = setItemOps();
    const first = writes[0]!;
    const last = writes[writes.length - 1]!;
    expect(last.messages).toBeLessThanOrEqual(first.messages + 2);
    expect(last.bytes).toBeGreaterThan(first.bytes * 5);
    expect(trace.totals.bytesWritten).toBeGreaterThan(1_000_000);
  });

  it('replaying the captured trace through the adapter collapses it', async () => {
    // The end-to-end claim: this many SDK writes become a handful of requests.
    const p = serverPersistence(opts());
    for (const op of setItemOps()) {
      p.setItem('t', {
        messages: Array.from({ length: op.messages }, (_, i) => msg(`m${i}`)),
      } as never);
    }
    await p.flush();
    await vi.advanceTimersByTimeAsync(1000);

    expect(saveConversation.mock.calls.length).toBeLessThan(5);
    expect(trace.totals.setItem).toBeGreaterThan(500);
  });
});
