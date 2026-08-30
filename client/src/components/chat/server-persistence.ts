// A `ChatClientPersistence` backed by server functions instead of the browser.
//
// WHY THIS IS POSSIBLE AT ALL. Every method on the SDK's persistence port may
// return a promise — verified against the installed SDK, not the docs:
//
//   // node_modules/@tanstack/ai-client/dist/esm/types.d.ts:482-486
//   export interface ChatClientPersistence<TTools> {
//     getItem: (id) => ChatPersistedState | UIMessage[] | null | undefined
//                    | Promise<…>;
//     setItem: (id, state: ChatPersistedState) => void | Promise<void>;
//     removeItem: (id) => void | Promise<void>;
//   }
//
// So swapping `localStoragePersistence()` for this is the entire change needed
// to make a conversation follow the user. <Chat> is untouched.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY IT DEBOUNCES. MEASURED, NOT ASSUMED.
//
// The SDK persists on every message change, and during a stream that is every
// token. `ChatPersistor.runOperation` (client-persistor.js) does not coalesce —
// it CHAINS each write onto an ordered queue, so every one of them eventually
// executes. Driving the real `ChatClient` headlessly with an instrumented
// async adapter (see `server-persistence.test.ts`, which pins the shape of
// this) gave:
//
//   answer length   adapter latency   setItem calls   bytes     write tail
//   200 tokens      15 ms                       204   177 KB     3.2 s
//   800 tokens      15 ms                       804   2.37 MB   12.7 s
//   800 tokens      30 ms                       804   2.37 MB   24.8 s
//
// "Write tail" is how long writes kept landing AFTER the stream finished — the
// stream itself completed in ~55 ms in every run. Un-debounced, one 800-token
// answer would post 804 requests through a server function into SQLite and
// keep going for 25 seconds after the user has read the answer. That is not a
// tuning question; it is a correctness one.
//
// The policy here is a trailing debounce with a max-wait ceiling:
//   - trailing DEBOUNCE_MS of quiet before writing, so a burst collapses to one
//     write, and a whole streamed answer normally costs exactly one;
//   - MAX_WAIT_MS so a long stream still checkpoints instead of holding
//     everything until the end — worst case ~1 write per 5 s, not ~1 per token.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THERE IS NO localStorage FALLBACK. This fails CLOSED.
//
// The point of the feature is one conversation across devices. A silent local
// fallback produces the opposite: a transcript that LOOKS saved and quietly
// diverges per browser, with no merge rule and last-writer-wins when the server
// comes back. That is a worse failure than not saving, because it is invisible.
//
// This does not weaken ADR 0001. Local-first there is about inference and data
// egress, and Strapi is the local store — SQLite on localhost:1350, the same
// place notes, digests and transcripts already live. Nothing leaves the
// machine that was not already there; this moves chat state from one local
// store to the one the rest of the app uses.
//
// When the server is unreachable the SDK swallows the failure (every adapter
// call is wrapped in `.catch(() => {})` — verified: a fully rejecting adapter
// still streams a complete answer and raises no unhandled rejection). The chat
// therefore degrades to exactly its pre-persistence behaviour: it works, it
// just does not survive a reload. `onError` exists so that degradation can be
// SHOWN rather than guessed at, because the SDK will never tell you.

import type { useChat } from '@tanstack/ai-react';
import {
  loadConversation,
  saveConversation,
  deleteConversation,
} from '#/data/server-functions/chat-conversations';
import type { StoredCitations, JsonValue } from '#/lib/services/chat-conversations';

/** One quiet period before a write lands. Collapses a token burst to one save. */
const DEBOUNCE_MS = 400;
/** Ceiling on how long a continuous stream can defer its first checkpoint. */
const MAX_WAIT_MS = 5_000;

/**
 * The SDK's own persistence types, reached through `useChat` rather than by
 * importing `@tanstack/ai-client`.
 *
 * Same discipline as <Chat>'s `Durability` union: `ai-client` is a TRANSITIVE
 * dependency here (package.json declares `ai-react`, not `ai-client`), so
 * importing from it directly would pin a version nothing in this repo
 * controls. Deriving from the hook's own options means this adapter is
 * structurally checked against the exact contract <Chat> will pass it to.
 */
type Persistence = Extract<
  NonNullable<Parameters<typeof useChat>[0]['persistence']>,
  { setItem: unknown }
>;
/** `ChatPersistedState` — `{ messages, resume? }`. */
type PersistedState = Parameters<Persistence['setItem']>[1];
type PersistedMessage = PersistedState['messages'][number];

/**
 * Revive `createdAt` on a restored message.
 *
 * NOT optional, and not obvious. The SDK's built-in web-storage adapters run
 * every loaded record through `revivePersistedState`
 * (storage-adapters.js:26-33) precisely because `JSON.parse` gives back an ISO
 * STRING where a live message carries a `Date`. `ChatPersistor` does not do it
 * for you — `readInitial`/`hydrateAsync` pass an adapter's value straight
 * through — so a custom adapter that skips this hands the app restored
 * messages whose `createdAt` has a different runtime type than the ones it
 * just streamed. Nothing throws; the two simply differ.
 *
 * Mirrors `normalizeMessageDates`: message-level `createdAt`, plus the same
 * field on `tool-result` parts.
 */
function reviveDates(messages: JsonValue[]): PersistedMessage[] {
  const toDate = (v: unknown): Date | undefined => {
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v;
    if (typeof v !== 'string') return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };

  return messages.map((raw) => {
    // The storage boundary is where opaque JSON becomes a typed message. The
    // SDK's own adapter casts here too (JSON.parse returns `any`); the row was
    // written by this same adapter from the SDK's own value.
    const message = raw as Record<string, unknown>;
    const parts = Array.isArray(message.parts)
      ? message.parts.map((p) => {
          const part = p as Record<string, unknown>;
          if (part.type !== 'tool-result') return part;
          const at = toDate(part.createdAt);
          const { createdAt: _dropped, ...rest } = part;
          return at ? { ...rest, createdAt: at } : rest;
        })
      : message.parts;

    const at = toDate(message.createdAt);
    const { createdAt: _dropped, ...rest } = message;
    return (at ? { ...rest, parts, createdAt: at } : { ...rest, parts }) as PersistedMessage;
  });
}

export type ServerPersistenceOptions = {
  /** Stored on the row for legibility in the admin UI. */
  surface: string;
  /**
   * Called once, with whatever citations came back with the transcript, so the
   * caller can render them. Fires inside `getItem`, before the SDK applies the
   * restored messages.
   */
  onCitationsRestored: (citations: StoredCitations) => void;
  /**
   * Called when a load/save/delete fails. The SDK swallows adapter errors, so
   * without this a broken backend is completely silent.
   */
  onError?: (op: 'load' | 'save' | 'delete', message: string) => void;
};

export type ServerPersistence = {
  getItem: (id: string) => Promise<PersistedState | null>;
  setItem: (id: string, state: PersistedState) => void;
  removeItem: (id: string) => Promise<void>;
  /**
   * Push the caller's current citations in, so the next write carries them.
   *
   * Citations are NOT part of a `UIMessage` — keeping them out is what stops
   * transcript excerpts being replayed to the model on later turns — so the
   * SDK never sees them and cannot hand them to `setItem`. The adapter holds
   * the latest set instead and folds it into the row it writes.
   */
  setCitations: (citations: StoredCitations) => void;
  /**
   * Write any pending debounced state immediately.
   *
   * Needed because <Chat> unmounts when the drawer closes and the tab can be
   * hidden at any time — a debounce with nothing to flush it loses the last
   * turn of every conversation.
   */
  flush: () => Promise<void>;
};

/**
 * Build the adapter.
 *
 * Not a React hook, and holds its own mutable state rather than reading React
 * state at write time. That is deliberate: `setItem` is called from inside the
 * SDK's stream processor, where a stale closure over a render's state would
 * write yesterday's citations. One owner, updated explicitly.
 */
export function serverPersistence(options: ServerPersistenceOptions): ServerPersistence {
  let citations: StoredCitations = [];
  let pending: { id: string; state: PersistedState } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** When the current burst began, for the MAX_WAIT_MS ceiling. */
  let burstStartedAt = 0;
  /**
   * Bumped by `removeItem`. A write scheduled before a clear must never land
   * after it — `setItem` resolves as soon as it has SCHEDULED a write, so the
   * SDK is free to call `removeItem` while a timer is still armed. Cancelling
   * the timer handles the common case; this guard covers a write already
   * in flight.
   */
  let generation = 0;

  const isBrowser = () => typeof window !== 'undefined';

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    burstStartedAt = 0;
  };

  async function writeNow(): Promise<void> {
    const next = pending;
    if (!next) return;
    pending = null;
    cancelTimer();

    const writeGeneration = generation;
    try {
      const result = await saveConversation({
        data: {
          threadId: next.id,
          surface: options.surface,
          state: {
            // Out through the same JSON door they came in by. The SDK's value
            // is what we store; we never reinterpret it.
            messages: next.state.messages as unknown as JsonValue[],
            ...(next.state.resume == null
              ? {}
              : { resume: next.state.resume as unknown as JsonValue }),
            citations,
          },
        },
      });
      // A clear happened while this was in flight. The delete has already been
      // issued, so saying nothing here would leave the row we just re-created.
      if (writeGeneration !== generation) return;
      if (result.status === 'error') options.onError?.('save', result.error);
    } catch (e) {
      if (writeGeneration !== generation) return;
      options.onError?.('save', e instanceof Error ? e.message : String(e));
    }
  }

  function schedule(id: string, state: PersistedState): void {
    pending = { id, state };
    const now = Date.now();
    if (burstStartedAt === 0) burstStartedAt = now;

    // Past the ceiling: stop deferring and checkpoint this burst now.
    if (now - burstStartedAt >= MAX_WAIT_MS) {
      void writeNow();
      return;
    }

    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void writeNow();
    }, DEBOUNCE_MS);
  }

  return {
    async getItem(id) {
      // useChat builds its ChatClient inside a `useMemo`, i.e. DURING render —
      // so on a server-rendered tree this runs on the server. Returning null
      // there keeps hydration honest: the client re-reads after mount and the
      // SDK's own async-hydration path applies it. Same reason the citations
      // map is adopted in an effect rather than a useState initializer.
      if (!isBrowser()) return null;
      try {
        const result = await loadConversation({ data: { threadId: id } });
        if (result.status === 'error') {
          options.onError?.('load', result.error);
          // `undefined`/`null` both mean "nothing stored" to the SDK, and there
          // is no third answer available to us. The onError call above is what
          // keeps this from being silent — see the fail-closed note at the top.
          return null;
        }
        const stored = result.conversation;
        if (!stored) return null;

        citations = stored.citations;
        options.onCitationsRestored(stored.citations);

        return {
          messages: reviveDates(stored.messages),
          ...(stored.resume == null
            ? {}
            : { resume: stored.resume as unknown as PersistedState['resume'] }),
        };
      } catch (e) {
        options.onError?.('load', e instanceof Error ? e.message : String(e));
        return null;
      }
    },

    // Returns void, not a promise. The SDK treats a returned promise as "this
    // write is still running" and serialises the next operation behind it;
    // resolving as soon as the write is SCHEDULED is what lets the debounce
    // actually collapse a burst instead of queueing one write per token.
    setItem(id, state) {
      if (!isBrowser()) return;
      schedule(id, state);
    },

    async removeItem(id) {
      generation++;
      pending = null;
      cancelTimer();
      citations = [];
      if (!isBrowser()) return;
      try {
        const result = await deleteConversation({ data: { threadId: id } });
        if (result.status === 'error') options.onError?.('delete', result.error);
      } catch (e) {
        options.onError?.('delete', e instanceof Error ? e.message : String(e));
      }
    },

    setCitations(next) {
      citations = next;
    },

    async flush() {
      if (!pending) return;
      await writeNow();
    },
  };
}
