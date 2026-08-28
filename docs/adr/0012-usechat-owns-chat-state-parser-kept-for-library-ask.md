# 0012. useChat owns chat state; the AG-UI parser is kept for library-ask

**Status:** Accepted (2026-08-28). Supersedes the hand-rolled stream reducers.
Builds on ADR 0011 (per-request model choice).

## Context

Three chat surfaces — `VideoChat`, `DigestChat`, `NoteComposer` — each kept
their own reducer that folded AG-UI frames into a local
`{ role, content, toolCalls }` record, and two routes (`/api/chat`,
`/api/digest-chat`) each kept their own `expandHistoryForModel` to rebuild
assistant tool-call turns and tool results from that bespoke payload. The
copies had already drifted: field names, the tool-result merge, and the
empty-placeholder cleanup differed between them.

The immediate forcing function was not tidiness. `@tanstack/ai` 0.48 made the
SSE wire **spec-only**: `TOOL_CALL_END`'s spec key set is `toolCallId` alone,
so the parser's `event.toolName` and `event.input` would become `''` and `null`
on every streaming surface at once — blank tool cards, and
`expandHistoryForModel` telling the model it had called a nameless tool with
`{}`. Nothing throws. The 1,258-test suite stayed green, because every SSE
fixture was hand-authored against the dialect the SDK had abandoned.

So the upgrade was mandatory work, and roughly half of it *was* the useChat
migration.

## Decision

**Three surfaces move to `useChat`; `/api/ask` does not.**

`useChat` owns the transcript as `UIMessage.parts`, and
`chatParamsFromRequestBody` owns the history reconstruction. Both replaced code
we maintained, and the SDK's fan-out is more correct than ours was.

`/api/ask` (library-ask) stays on the hand-rolled parser deliberately. It is a
retrieval-first one-shot whose `CITATIONS` frame is enqueued as raw bytes
*outside* `toServerSentEventsResponse` and **precedes** the message it belongs
to. `useChat` has no place to put a citation that arrives before its message,
and `onCustomEvent` carries no `messageId` to correlate one. Migrating it would
trade typed per-message state for a file deletion that never arrives — the
parser survives either way, since `NoteComposer` was de-streamed rather than
migrated.

**Options are chat-level `forwardedProps`, not per-send `body`.** The written
plan called for per-send, reasoning that a fetcher closes over first-render
values and goes stale silently — the exact bug this codebase shipped once
already. With the `fetchServerSentEvents` connection adapter there is no
closure: `useChat` re-reads `forwardedProps` through an effect
(`use-chat.js:203`), and chat-level props are the ones `reload()` replays. A
retry that dropped `skillSlug` would answer in the wrong persona, silently.

**Evidence is held outside the message.** `VideoChat` keeps
`Map<messageId, EvidenceCitation[]>` filled from `onFinish`. In message
metadata it would round-trip every prior answer's transcript excerpts back to
the model on every later turn.

## Consequences

`chat-stream.ts` survives at reduced scope with exactly one parser consumer
(`useLibraryChat`); the migrated components import only its error translator.
Net: ~250 lines of reducer and history-expansion deleted.

Two guards had to be **re-added** because the SDK does not provide them:

1. **Orphan tool calls.** `isToolCallIncluded` admits `state:'input-complete'`
   (`messages.js:303`) while a tool result is only emitted for
   `'complete'`/`'error'` (`:369`), so a run stopped mid-tool leaves an
   assistant `tool_use` nothing answers — verified to survive
   `uiMessagesToWire` → `chatParamsFromRequestBody` → `chat()` intact.
   Anthropic 400s on it; Ollama tolerates it, which is worse, because the bug
   would lie dormant on the default tier and fire only for users who had
   switched to frontier. `dropOrphanToolCalls` guards both chat routes.

2. **Two message shapes.** `chatParamsFromRequestBody` returns
   `Array<UIMessage | ModelMessage>` and yields the latter for a plain text
   turn — the wire carries `content`, not `parts`. Reading `.parts` behind an
   `as UIMessage[]` cast typechecked and threw on the first real request.
   `ui-message.ts` handles both, and the cast is gone.

**Fixtures are now captured, not written.** `__fixtures__/tool-call-wire-0.52.json`
comes from a real `chat()` through `toServerSentEventsResponse`, with the SDK
versions recorded, and one test guards the fixture itself. A fixture you write
proves the parser matches your belief; a fixture you capture proves it matches
the SDK. Re-capture with `client/verify-sse.mjs` on every bump.

The capture also corrected the plan: the plan asserted `TOOL_CALL_END` carries
"the id and nothing else". It does not — the name and input survive under the
vendor extension `metadata.tanstack`. The parser prefers that (already parsed)
but keeps delta accumulation as the floor, since a vendor extension can be
stripped and the spec keys cannot.

Verification is no longer only vitest. Two Playwright specs drive the migrated
components against a real model in a real browser, because neither component
nor either route had any test before, and the failure mode here is a chat that
posts and then silently shows nothing.
