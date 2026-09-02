# 0014. Chat transcripts live in Strapi, not localStorage

**Status:** Accepted

## Context

Library-ask was the only chat surface with a durable transcript, and it was
durable per *browser*: `<Chat>` was handed `localStoragePersistence()` and a
constant key. Open the library on a second machine and the conversation was
gone. Citations had a second problem on top — they are not part of a
`UIMessage` (deliberately, so retrieved transcript excerpts are never replayed
to the model on later turns), so they were persisted separately under a sibling
localStorage key, with the two halves free to fall out of step.

Three facts made a server-backed transcript worth doing now:

1. **The SDK already allows it.** `@tanstack/ai-client`'s `ChatClientPersistence`
   is `{ getItem, setItem, removeItem }` over a `ChatPersistedState`, and every
   method may return a promise (`types.d.ts:482-486`, verified against the
   installed 0.29.2). `<Chat>` forwards `persistence`/`threadId` straight to
   `useChat`, so the whole change fits inside an adapter.
2. **Strapi is already the store for everything else** — videos, transcripts,
   notes, digests, loops. Chat was the anomaly.
3. **The SDK addresses records by `threadId`**, which is exactly the shape of an
   upsert key, and this repo already has that pattern in Digest's `videoSetKey`
   (ADR 0006).

## Decision

**A `ChatConversation` collection type keyed by a unique `threadId`, written
through server functions by a `ChatClientPersistence` adapter.** `<Chat>` is
unchanged.

**Citations live in the same row as the transcript, not a sibling one.** They
are still kept out of the `UIMessage` — that invariant is what stops excerpts
being replayed to the model, and it is untouched. But the *storage* split
existed only because the SDK owns its own localStorage key and there was no way
into it. A row we define has no such constraint, so transcript and sources are
written and restored together. The bug the old split shipped with — prose
restored, sources silently missing — is now unrepresentable.

**Writes are debounced.** Measured, not assumed. Driving the real `ChatClient`
headlessly against a **captured live `/api/ask` answer** (318 text deltas):

| | un-debounced |
|---|---|
| `setItem` calls for one answer | **956** |
| bytes written | **2.46 MB** |
| writes still landing after the stream ended | **~19 s** (at the measured 8 ms Strapi write latency, ×2 round trips per save) |

`ChatPersistor.runOperation` *chains* writes onto an ordered queue rather than
coalescing them, so every one of those executes. The adapter uses a trailing
debounce with a max-wait ceiling, plus a flush when a run completes. The capture
is checked in as a fixture with a guard test, so if a future SDK starts
coalescing, the tests say so and the debounce can be revisited.

**It fails closed. There is no localStorage fallback.** When Strapi is
unreachable the conversation is memory-only and the UI says so.

**Identity is a per-surface constant (`library-ask:v1`).** This app has no user
accounts — no `userId` anywhere in the client, and one app-level Strapi token —
so the honest scope for a conversation today is "the library".

## Consequences

**What we gain.** One conversation across devices. Transcript and citations
that cannot drift apart. Chat state visible in the Strapi admin like every
other row, and reachable over MCP if that is ever wanted.

**What we accept.**

- **"Across devices" means "across browsers pointed at the same Strapi."** For
  a laptop-only install that is one machine, and the feature is really "survives
  a profile wipe". It becomes literal the moment Strapi is reachable on the LAN.
  Nothing in the design changes at that point.
- **One conversation per surface, shared by whoever reaches the backend.** Same
  trust boundary every other row in this app already has. `conversationThreadId()`
  in `LibraryChat.tsx` is the single place that changes when accounts arrive —
  `${userId}:${surface}:v1` — and both the unique column and the adapter treat
  the value as opaque.
- **A window where the last turn can be lost.** The debounce means a reload in
  the first moments after a run completes can miss it. `onFinish` closes this
  for the normal case; a hard unload mid-stream still loses the tail, because an
  unload kills the in-flight request. Checkpointing at `MAX_WAIT_MS` bounds how
  much.
- **Every write is two round trips** (find, then create-or-update). The unique
  constraint means a lost insert race is a 400 rather than a duplicate row, and
  the service retries it as an update.
- **e2e specs now share one row.** A browser context is no longer an isolation
  boundary for chat state, so `library-chat.spec.ts` deletes the row in
  `beforeEach`. Without that, a leftover conversation satisfies the next test's
  assertions and the suite goes green having proved nothing.

**Why this does not weaken [ADR 0001](./0001-local-first-no-cloud-ai.md).**
Local-first there is about inference and data egress: no transcript should leave
the laptop to be processed by someone else's model. Strapi is the *local* store
— SQLite on `localhost:1350`, the same place transcripts and notes already live.
This moves chat state from one local store to the one the rest of the app uses.
Nothing new leaves the machine, and no inference path changed.

**Deferred.** Multiple named conversations per surface (the schema supports it —
it is a `threadId` and a UI away). Adopting the same adapter on video-chat and
digest-chat, which are still ephemeral; both would need a `threadId` scoped to
their video(s) rather than a constant. Server-authoritative persistence
(`persistence: true`), which would let a run be rejoined from another device
mid-stream but needs a `hydrate` handler on the connection.
