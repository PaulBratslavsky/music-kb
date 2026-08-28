# TanStack AI upgrade + useChat adoption plan

**Status:** Proposed, 2026-08-27. Not started.
**Prompted by:** "would music-kb benefit from useChat — especially when the goal is to take
advantage of TanStack AI?"

The honest answer turned out to be *partially*, and the investigation surfaced two defects
that matter more than the question did. Both are recorded first, because one of them is
live right now.

---

> **OUTCOME (2026-08-28).** All five phases are done; see
> [ADR 0012](./adr/0012-usechat-owns-chat-state-parser-kept-for-library-ask.md).
> Two things below turned out to be wrong once measured against a live SDK,
> and are corrected in place:
>
> - **§0.2's claim that `TOOL_CALL_END` carries "the id and nothing else" is
>   wrong.** The spec keys are stripped, but the name and input survive under
>   the vendor extension `metadata.tanstack`. Captured, not inferred.
> - **Phase 4's "per-send `body`" is wrong for this codebase.** It assumed a
>   custom fetcher. With the connection adapter there is no closure to go
>   stale, `useChat` re-reads chat-level `forwardedProps` through an effect,
>   and only chat-level props are replayed by `reload()`.
>
> Shipped against 0.52.0, not the 0.49.1 named below.

## 0. Read this first: two defects

### 0.1 LIVE TODAY — `web_search` is name-hijacked on the frontier tier

`@tanstack/ai-anthropic@0.16.6` converts tools by switching on the **tool's name**:

```js
// node_modules/@tanstack/ai-anthropic/dist/esm/tools/tool-converter.js:36
switch (tool.name) {
  case 'web_search': return convertWebSearchToolToAdapterFormat(tool)
  //  ^ becomes Anthropic's HOSTED web search, type: 'web_search_20250305'
  default: return convertCustomToolToAdapterFormat(tool)
}
```

music-kb's own tool is `name: 'web_search'` (`client/src/lib/services/chat-tools.ts:36`).
So on the Anthropic path, **the app's own executor is silently replaced by Anthropic's hosted
search.** No error; different results; the `[tool web_search]` console line at
`chat-tools.ts:47` never prints.

**This became reachable today.** Before the 2026-08-27 model-switcher change (ADR 0011),
`video-chat` was type-locked local and this code path could not execute. Widening the policy
made it live.

**Fix now, independent of everything else — rename the tool.** One line in
`chat-tools.ts`, plus its `describeTools` reference. `search_web` collides with nothing in
the converter's switch. This costs nothing and does not wait for the upgrade.

`@tanstack/ai-anthropic@0.18.0` fixes the root cause — it switches on
`getAnthropicProviderToolKind(tool)`, adapter-owned metadata rather than the raw name — but
the rename is worth doing regardless, because a name that means something to a provider is a
trap for the next adapter too.

### 0.2 LATENT — any core upgrade silently blanks every tool call

`@tanstack/ai` 0.48.0 made the SSE wire **spec-only**. Every chunk passes through
`stripToSpec`, and:

```ts
// @tanstack/ai 0.49.1 — packages/ai/src/utilities/spec-event-keys.ts:23-24
[EventType.TOOL_CALL_ARGS, keys('toolCallId', 'delta')],
[EventType.TOOL_CALL_END,  keys('toolCallId')],
```

`TOOL_CALL_END` now carries **the id and nothing else**. Our parser reads two fields that no
longer exist, and explicitly discards the frame that replaced them:

```ts
// client/src/lib/services/chat-stream.ts:182-195
// "tool_end is the source of truth for `input` (TOOL_CALL_ARGS
//  events stream args incrementally; we ignore those)."
const name = event.toolName ?? event.toolCallName ?? ''   // → ''
input: event.input ?? event.args ?? null,                  // → null
```

After any bump to ≥0.48, **all four streaming surfaces lose tool names and arguments at
once**: `VideoChat.tsx:99`, `DigestChat.tsx:50`, `NoteComposer.tsx:62`,
`useLibraryChat.ts:104`. Tool cards render empty. Worse, `expandHistoryForModel` then tells
the model it called `web_search` with `{}` — corrupting its own tool-use history.

Nothing crashes. Nothing goes red.

**And the test suite will not catch it.** 1,217 tests pass in ~2.3 seconds; that speed is the
tell. Every SSE test is a **hand-authored fixture string**, and
`chat-stream.test.ts:57-75` pins a `TOOL_CALL_END` shape carrying `toolName` and `input` — a
frame 0.49.1 will never emit. The fixture was written, not captured, so it stays green
through the regression it exists to prevent.

The fix is ~15 lines in one function: accumulate `TOOL_CALL_ARGS.delta` per `toolCallId`,
take the name from `TOOL_CALL_START`, `JSON.parse` the buffer on `TOOL_CALL_END`. It must
land **in the same commit as the bump**.

---

## 1. What this reframes

The question was "should we adopt useChat?". The finding is that **the deferred core upgrade
is now mandatory work on its own merits**, and roughly half of that upgrade *is* the useChat
migration done by hand.

That changes useChat from *a new dependency* into *the cheaper way to absorb an upgrade you
already have to do*.

`frontier-model.ts:34-44` fenced this off as "its own task", correctly, when the attempted
target was 0.17.0/0.47.3. The specific failure it documents — `adapter-internals` not
exporting `assertUniqueToolNames` — **is resolved at 0.49.1**; going *past* 0.47.3 is the
fix, not a bigger version of the problem. Verified in the reference clone at
`packages/ai/src/adapter-internals.ts:49`.

---

## 2. Per-consumer verdicts

| Surface | Verdict | Why |
|---|---|---|
| **DigestChat** | **Adopt — make it the pilot** | Already shaped like `useChat`: hand-rolls `messages`/`isStreaming`/`error`/`input`, and has **no abort at all** — a send mid-stream is silently dropped (`DigestChat.tsx:80`). Server-side, `expandHistoryForModel` + its two type decls are 60 of the route's 152 lines reimplementing what `uiMessagesToWire` already emits. It is the only chat route with no custom SSE frame, so there is no bespoke wire contract to preserve. `videoIds` is a non-issue — it is conversation-scoped and belongs in chat-level `forwardedProps`. |
| **VideoChat** | **Adopt — second** | Biggest payoff. `UIMessage.parts` models everything it stores except `evidence`. `buildAssistantMessages` is *strictly more correct* than our fan-out: it walks parts in order and flushes at each tool-result, so a text→tool→text turn round-trips as it happened, where `api.chat.tsx:70-95` always hoists every tool call ahead of all text. Deletes the second verbatim copy of the 38-line untested `expandHistoryForModel`, plus ~70 lines of Map-and-push plumbing. `threadId={videoId}` gives per-video persistence we have no answer for today. |
| **useLibraryChat** | **Do not migrate** | `/api/ask` is not a chat endpoint. It takes `{question, modelChoice}`, runs retrieval **first**, bakes seed passages into a one-shot prompt, and never receives or replays history — the conversation is a client-side illusion. Two needs have no SDK home: citations are emitted **before** the stream, and `onCustomEvent`'s context is `{toolCallId?}` with no `messageId`, so there is no assistant message to attach them to; and per-message `status`/`error`/`answeredBy` would move from a typed union into `metadata?: Record<string, any>` — a direct regression against the invariant `answeredBy`'s doc comment exists to guarantee. |
| **NoteComposer** | **Not applicable — and it should stop streaming** | Renders no conversation. It fires one request, throws away every delta, and paints finished markdown into Tiptap exactly once — deliberately, per the comment at `:112-117`. Adopting `useChat` would mean calling `clear()` before every send to suppress the hook's whole purpose. |

---

## 3. Phased plan

Each phase leaves the app shippable. **Phase 1 is worth doing even if every later phase is
cancelled.**

### Phase 0 — rename `web_search` *(minutes)*
Independent of everything. Closes §0.1. Do it now.

### Phase 1 — core upgrade + parser patch, landed alone *(1–2 days)*
Bump `@tanstack/ai` 0.45.1→0.49.1, `ai-anthropic` 0.16.6→0.18.0, `ai-ollama` 0.9.1→0.10.0.
**No UI changes, no `ai-react` yet.** Patch `chat-stream.ts` per §0.2.

**Verification must not come from vitest.** Drive it from `client/verify-sse.mjs`, which
prints the real key set of every `TOOL_CALL_*` frame from a live `chat()` through
`toServerSentEventsResponse`. Run it before and after, then **re-cut
`chat-stream.test.ts`'s tool fixtures from that captured output.** The current fixtures pin a
dialect the SDK has abandoned.

Also while the file is open: `chat-stream.ts:163-168` runs **Anthropic** errors through
`friendlyOllamaError`, on a locality assumption ADR 0011 invalidated.

Verified as needing no work: `/api/ask`'s CITATIONS frame (enqueued as raw bytes *outside*
`toServerSentEventsResponse`, so `stripToSpec` never sees it), `lesson-stream.ts` (parses our
own event vocabulary), and all seven in-process `chat()` callers (0.48.0 stripped the **wire**
only — the in-process path still yields `toolName` and `input`).

### Phase 2 — de-stream NoteComposer *(half a day)*
Replace `toServerSentEventsResponse` with `Response.json({ markdown: await streamToText(stream) })`.
User-visible behaviour is byte-identical because the component already waits for the whole
stream. Add the `AbortController` so Cancel stops being inert. Removes one of the parser's
four consumers.

### Phase 3 — DigestChat onto useChat *(~1 day, the pilot)*
Add `@tanstack/ai-react`. Delete `expandHistoryForModel` and the tool-call merge state
machine. Put `videoIds` + `modelChoice` in **chat-level** `forwardedProps` memoized on
`videos` — *not* per-send `body`, because `reload()` replays chat-level props only. Write the
shared `parts → text` helper here; Phase 4 reuses it.

### Phase 4 — VideoChat onto useChat *(2–3 days)*
Delete the second copy of `expandHistoryForModel`. `threadId={videoId}`. Pass
`videoId`/`skillSlug`/`modelChoice` **per-send in `body`** — the fetcher closes over
first-render values and goes stale **silently**; this is the exact failure mode both
codebases already shipped once. Keep `evidence` in a component-local
`Map<messageId, EvidenceCitation[]>` filled from `onFinish`, not in `metadata`, or you
re-upload transcript excerpts every turn. **Re-add the orphan-tool-call filter** that
`api.chat.tsx:69`'s `status === 'done'` check gives us today — `isToolCallIncluded` admits
`state: 'input-complete'` with no output, and an orphan `tool_use` is a 400 on Anthropic.

### Phase 5 — stop
`chat-stream.ts` survives at reduced size with one consumer. **Do not migrate library-ask to
force its retirement** — that trades typed per-message state for a file deletion that never
arrives. Revisit only if `ai-client` later puts a `messageId` in the `onCustomEvent` context.

---

## 4. Do not migrate

- **NoteComposer** — not a chat. Go the other direction (§Phase 2).
- **useLibraryChat / api.ask** — retrieval-first one-shot; citations precede the message they
  belong to.
- **`chat-stream.ts` itself** — retiring it is not a goal. Migrating one surface deletes zero
  lines of it.
- **The seven in-process `chat()` service callers** — they never iterate frames; 0.48.0
  stripped the wire only.
- **`lesson-stream.ts`** — parses our own `LessonProgressEvent` vocabulary, not AG-UI.
- **`withSystem` (`chat-model-request.ts`)** — shared by four routes; changing it is its own
  decision and does not belong in a UI migration.

---

## 5. Effort and risk

**~1.5 focused weeks**, front-loaded on verification rather than code. Net line change is
favourable but not dramatic: ~250 lines deleted against ~60 added. The real return is that
`buildAssistantMessages` is *more correct* than the hand-rolled fan-out, and that four
surfaces stop being hand-tuned against a wire format the SDK has stopped speaking.

**Biggest risk: the test suite will produce false confidence about the exact thing that
changed.** A team that bumps the deps, sees 1,217 green, and ships will ship a silent
regression where every tool card is empty and the model's own history says it called
`web_search` with `{}`. The mitigation is specific and cheap, and it is the whole reason
Phase 1 is sequenced alone: **verify from captured frames, not from written ones.**
