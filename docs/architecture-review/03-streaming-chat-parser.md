# 3. Streaming Chat Parser Module — turn raw SSE into a typed event stream

**Status:** ✅ Shipped 2026-05-05. New module: `client/src/lib/services/chat-stream.ts`.

## Files

- `client/src/components/VideoChat.tsx:67–173` — `streamChatResponse`, inline SSE parsing, tool-call accumulation.
- `client/src/routes/api.chat.tsx:62–99` — `expandHistoryForModel` + tool-call framing.
- `client/src/routes/api.chat.tsx:159–182` — chat stream setup + TanStack AI tool-call handling.

## Problem

The route emits AG-UI-format SSE; the component parses raw `data: …` lines and accumulates tool calls into UI state. The Interface between server and client is "SSE bytes" — there is no named Seam.

Adding a new event type (e.g. `SOURCES_FOUND`, `STEP_PROGRESS`, `CITATIONS_GROUNDED`) means coordinated edits in two files with no shared contract. The mapping from `TOOL_CALL_START` + `TOOL_CALL_END` SSE frames to a UI `ToolCallRecord` is buried in the streaming parser inside `VideoChat.tsx` (~lines 100–145).

## Sketch

A parser Module exposing `AsyncGenerator<StreamEvent>` over a fetch response. The component depends on the typed union (`TextDelta | ToolStart | ToolEnd | Done`) and never sees raw SSE.

The Seam **is** the union type. Server emits in terms of it; client consumes in terms of it.

## Locality / Leverage

- **Locality:** SSE protocol knowledge gets a home (one module). UI logic in `VideoChat` becomes "react to events", not "parse a wire format and react."
- **Leverage:** new event types only require extending the union — server and client agree on the shape via the type.

## Test surface change

- Parser tested with fixture SSE strings (no React, no `fetch`).
- Component tested with a hand-built event sequence (no SSE, no network).

Today: the only validation is "send a chat, watch the panel render" — no automated test of the parser path.

## Open questions for grilling

- Should the parser also handle reconnection / backpressure, or is that out of scope (TanStack Start's SSE handling already covers it)?
- Where does `[mm:ss]` extraction sit — inside the parser (each text delta yields citation hints) or after the stream completes (current behaviour)?
- Does the union live alongside the parser, or in a `lib/chat/protocol.ts` that both server and client import?
- The `/web` slash-command transformation in `VideoChat.tsx` (`/web foo` → "Please use the web_search tool…") — does it belong on the same Seam, or stay UI-side?

## Grilling notes

### Two adapters confirmed (the candidate file undersold this)

The candidate file framed this as one consumer (VideoChat) and an inline server emitter. Reading the actual code surfaced **two consumers** with near-identical SSE parsing:

- `VideoChat.tsx` — `streamChatResponse` + `parseSseEventBlock` for `/api/chat`.
- `DigestChat.tsx` — `streamDigestChat` + a duplicated `parseSseEventBlock` for `/api/digest-chat`.

Both spelled out the same TextDecoder + buffer + `\n\n` split logic, the same `data:` line concatenation, the same StreamEvent union. **With subtle drift between them**: VideoChat's parser used `event.toolName` + `event.input`, DigestChat's used `obj.toolCallName` + `obj.args`. That drift is exactly the silent-bug pattern — both worked for text deltas (their primary case), but tool-event parsing was inconsistent. A future TanStack AI version that emitted only one of the field-name dialects would have broken one consumer silently.

That made the seam real, not hypothetical: **two adapters = real seam.**

### Scope decision: medium

- **A (narrow): extract just the union type.** Rejected — wouldn't address the duplicated parser logic.
- **B (medium): extract `streamChatSSE(response)` + `StreamEvent` union, both consumers import.** Picked.
- **C (broad): make the protocol bidirectional, server has typed event emitters too.** Rejected — server uses TanStack AI's `toServerSentEventsResponse`. The wire framing is library-owned, not ours. Reaching across the wire boundary would couple us to a library we already wrap.

### Final shape

```ts
// client/src/lib/services/chat-stream.ts

export type StreamEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'tool_start'; id: string; name: string }
  | {
      kind: 'tool_end';
      id: string;
      name: string;
      input: unknown;
      result: string | null;
    };

export async function* streamChatSSE(
  response: Response,
): AsyncGenerator<StreamEvent>;
```

Behind the seam: TextDecoder + buffer + `\n\n` block split + a private `parseSseEventBlock` that handles AG-UI events and silently drops the ones the UI doesn't surface (RUN_STARTED, TEXT_MESSAGE_START/END, STEP_*, TOOL_CALL_ARGS).

Each consumer keeps a tiny ~15-line wrapper for its own URL/body shape:

```ts
async function* streamChatResponse(...) {
  const res = await fetch('/api/chat', { ... });
  if (!res.ok) throw new Error(...);
  yield* streamChatSSE(res);
}
```

### Decisions made during grilling

- **Helper takes a `Response`, not a URL/body.** Each consumer issues its own fetch (different paths, bodies, abort signals). Cleaner separation: parser is pure with respect to networking. Tests can construct fake Response objects and verify parsing without a real fetch.
- **Liberal field parsing** for tool name (`toolName ?? toolCallName`) and tool input (`input ?? args`). Defensive against the observed drift between the two pre-existing parsers AND against future TanStack AI version changes. One Module, one consistent behaviour for both.
- **Server side untouched.** `api.chat.tsx` and `api.digest-chat.tsx` produce SSE via TanStack AI's `toServerSentEventsResponse(stream)` — the wire framing is library-owned. Reimplementing it on our side would just create a second source of truth.
- **Async generator pattern preserved.** Both consumers were already iterating with `for await (const event of …)`. Keeping the shape lets the consumer code change be purely the import line.

### Test surface

`client/src/lib/services/chat-stream.test.ts` — 10 tests covering:
- Text deltas yield in order.
- Non-surfaced event types (RUN_STARTED, TEXT_MESSAGE_START/END, STEP_FINISHED) are silently dropped.
- Tool-call parsing in BOTH dialects (`toolName`+`input`, `toolCallName`+`args`).
- Frame split across multiple `Response` body chunks (parser must buffer correctly).
- Multiple frames inside one chunk (parser must split on `\n\n` correctly).
- Invalid JSON in a `data:` line — skipped, parser keeps going.
- Events missing required fields — skipped, no crash.
- Empty body throws.
- Trailing block without final `\n\n` is flushed.

The fixture-based tests were impossible before — both parsers were inline functions inside React components, with no separable seam to test against. Today this is the kind of regression net you want around a wire-format adapter.

### Quantified impact

| File | Before | After | Net |
|---|---|---|---|
| `VideoChat.tsx` | parser inline (~106 lines: type + generator + helper) | 17-line fetch wrapper | −89 |
| `DigestChat.tsx` | parser inline (~80 lines: type + helper + generator) | 14-line fetch wrapper | −66 |
| `chat-stream.ts` | 0 | 137 (new) | +137 |
| `chat-stream.test.ts` | 0 | 152 (new, 10 tests) | +152 |
| **Net production code** | | | **−18** |

Production code shrinks slightly. The bigger win is that the parser now has a name, a home, and a test surface. Adding a new event type (e.g. `SOURCES_FOUND`, `STEP_PROGRESS`, `CITATIONS_GROUNDED`) is a one-place change in the union + its parser branch, with a fixture test added in the same PR.

### Bug fixes shipped alongside the refactor

- **Silent field-name drift between the two parsers** is gone. Both consumers now use the same liberal parser that accepts either dialect.
- **Defensive flushing** of trailing event blocks — both old parsers had a flush in their `finally`, but the new one is tested for the no-final-`\n\n` case explicitly.

### What got rejected and why

- **Pure functional parser (no async generator):** considered exposing a `parseSseChunk(buffer): { events, remaining }` function so consumers handle the loop themselves. Rejected — every consumer would re-implement the same TextDecoder + read-loop logic, defeating the purpose. Async generator IS the right interface for a stream-of-events.
- **Strict field-name validation (only one dialect):** considered failing fast on unexpected dialects. Rejected — TanStack AI version drift is a real risk and the cost of liberal parsing is one extra `??` per field. The Module is the place to absorb upstream churn so consumers don't see it.
- **Combine fetch + parse in one helper:** considered `streamChatSSE(url, body): AsyncGenerator<StreamEvent>` instead of taking a Response. Rejected — would couple the helper to a fetch shape, force consumers through it for things like AbortController, and make tests need to mock `fetch` rather than just construct a Response.

### Follow-up candidates (not done)

- **Typed wire-format module shared with the server.** If we ever stop using TanStack AI's `toServerSentEventsResponse` and emit our own SSE, the union type defined here can move to a shared `lib/chat/protocol.ts` consumed by both. Today, the server isn't writing SSE bytes by hand — refactor would be premature.
- **Streaming citation events** (`CITATIONS_GROUNDED` deltas during the response, vs. one batch lookup at end-of-stream). Today citation grounding is a single round-trip after the stream finishes (via `getChatResponseEvidence`). Streaming citations would let chips appear inline as the model generates them. The Module's union is the natural place to add a `citations` event type when the time comes.
