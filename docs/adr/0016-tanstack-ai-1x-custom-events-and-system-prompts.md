# 0016. TanStack AI 1.x: citations travel as a CUSTOM event, system prompts as `systemPrompts`

**Status:** Accepted (2026-11-16). Supersedes ADR 0013's decision that custom
frames are reconciled in the transport, and ADR 0013's consequences about the
capturing fetcher and the `ask-wire-0.52.json` fixture. Supersedes ADR 0011's
consequence that system prompts are delivered tier-specifically. Replaces
`chatParamsFromRequestBody` in ADR 0012 with `chatParamsFromRequest`.

## Context

Commit `36c966a` moved every `@tanstack/ai*` package from 0.x to 1.x, in the
app and in the Strapi server:

| Package | Before | After | Where |
|---|---|---|---|
| `@tanstack/ai` | 0.52.0 | 1.4.0 | `client/`, `server/` |
| `@tanstack/ai-react` | 0.22.4 | 1.0.2 | `client/` |
| `@tanstack/ai-ollama` | 0.10.3 | 1.1.1 | `client/`, `server/` |
| `@tanstack/ai-anthropic` | 0.18.3 | 1.1.1 | `client/` |

The server has used `@tanstack/ai` since commits `cb6487b` and `8a0153d`. Those
commits replaced a raw `fetch` to Ollama's `/api/embeddings` with TanStack AI's
`embed()` and the Ollama embedding adapter (`createOllamaEmbedding`), in both
`client/src/lib/services/embeddings.ts` and
`server/src/mcp/utils/embeddings.ts`.

The docs'
[Upgrade to 1.0](https://tanstack.com/ai/latest/docs/migration/v1) guide set the
scope of the change. It says to update every `@tanstack/ai*` package to 1.0 at
the same time, because "a 1.0 client needs a 1.0 server". It also says that
`threadId` is now required, and that the client does not generate one. So the
app and both of its servers had to move together, and every `useChat()` and
`chat()` call had to gain a `threadId`.

Two mechanisms in the app were written around 0.x limits rather than around the
SDK.

1. **Library chat citations.** `/api/ask` retrieves passages before the model
   writes, so it knows the citations before the answer starts. Under ADR 0013,
   the route wrote a raw `CITATIONS` SSE frame ahead of the AG-UI stream
   (`sse-prepend.ts`). On the client, `<Chat>` swapped `useChat`'s connection
   adapter for a custom fetcher (`createCapturingFetcher` in
   `capture-frames.ts`). That fetcher pulled the frame out of the stream and
   bound it to the next `TEXT_MESSAGE_START`. The docs'
   [Custom Events Reference](https://tanstack.com/ai/latest/docs/protocol/custom-events)
   describes the SDK's own channel for app data: a chat middleware calls
   `emitCustomEvent`, the event goes on the wire as a `CUSTOM` chunk with a
   `name` and a `value`, and the client reads it with `useChat`'s
   `onCustomEvent`. Its "Emit from chat middleware" section covers the case
   this route has.
2. **System prompts.** `withSystem()` in `chat-model-request.ts` branched on
   `model.tier`. On the local tier it put a `{ role: 'system' }` message first
   in `messages`, cast to `never`. On the frontier tier it passed
   `systemPrompts`, because the Anthropic adapter dropped a system message in
   `messages` without failing the request. In 1.x both adapters read
   `systemPrompts`. The Ollama adapter puts them first as one system message.
   The Anthropic adapter sends them as its top-level `system` parameter.

## Decision

**Follow the 1.x docs everywhere, and delete the code that worked around 0.x.**

**Citations are an AG-UI `CUSTOM` event emitted by chat middleware.** In
`routes/api.ask.tsx`, a middleware named `send-citations` watches each chunk in
`onChunk`. On a `TEXT_MESSAGE_START` chunk it calls
`ctx.emitCustomEvent('library-ask:citations', { messageId, citations, model })`,
with `messageId` taken from that chunk. `LibraryChat.tsx` passes an
`onCustomEvent` handler through `<Chat>` to `useChat`, and the handler stores
the citations under that message id. The event name (`CITATIONS_EVENT`), the
value type (`CitationsEventValue`) and the type guard
(`isCitationsEventValue`) are in `services/citations.ts`, which both the route
and the component import. The guard exists because `onCustomEvent` types the
value as `unknown`.

**All three chats use one transport.** `components/chat/Chat.tsx` makes one
call: `useChat({ connection: fetchServerSentEvents(endpoint), threadId,
forwardedProps, persistence, onFinish, onCustomEvent })`.

**Every `chat()` call passes its system prompt as `systemPrompts: [...]`.**
`messages` holds only user, assistant and tool turns. No call site branches on
the tier.

**`threadId` is required.** `<Chat>` takes `threadId` as a required prop, and
each caller passes a stable id: `VideoChat` passes the video id, for example.
The three chat routes pass the request's `threadId` and `runId` to `chat()`.
Calls that have no client thread use a fixed id per job, such as
`summary:<videoId>`, `lesson:<topic>` and `notes-compose:<videoId>`.

**The chat routes read the request with `chatParamsFromRequest(request)`.**
`api.chat.tsx`, `api.digest-chat.tsx` and `api.ask.tsx` call it. It validates
the AG-UI `RunAgentInput` body and throws a 400 `Response` on a bad one, which
TanStack Start returns as-is. Each route's own `try`/`catch` around
`chatParamsFromRequestBody(await request.json())` is gone.

**Call sites read `text` from a `{ text, chunks }` result.** In 1.x,
`chat({ stream: false })` without an `outputSchema` resolves to `{ text, chunks }`,
and `streamToText()` resolves to the same shape. Every such call site
destructures `text`.

## Consequences

Deleted:

- `client/src/components/chat/capture-frames.ts` (157 lines) and its test (193 lines).
- `client/src/lib/services/sse-prepend.ts` (49 lines), which wrote the raw `CITATIONS` frame.
- `client/src/components/chat/__fixtures__/ask-wire-0.52.json`, the captured `/api/ask` stream that ADR 0013's fixture test guarded.
- `withSystem()` in `client/src/lib/services/chat-model-request.ts`, and the `as never` casts on `messages` that came with system messages.
- In `Chat.tsx`, the `Durability` union, which made `threadId` optional when there was no `persistence`, and the four-branch `useChat` call that kept the `fetcher` and `connection` options apart.

The whole commit changed 41 files: 633 lines added and 1,018 deleted.

**The citations event now follows the message start.** Under ADR 0013 the
`CITATIONS` frame came before `TEXT_MESSAGE_START`, and the client bound it to
the next message. Now the server emits the event right after
`TEXT_MESSAGE_START` and names the message itself. The client does no
ordering work. The "nothing matched" reply (`services/ask-empty-answer.ts`)
sends no citations event, because nothing was retrieved.

**The message id comes from `TEXT_MESSAGE_START`, not from `onIteration`.** A
live test against Ollama showed that the `messageId` passed to the middleware's
`onIteration` is not the id the client gives the message. The Ollama adapter
opens its text message under an id of its own. The `TEXT_MESSAGE_START` chunk
carries the id the client uses, so the middleware reads it there. A turn in
which the model calls `load_passages` and then answers writes its text in a
later message, and that message gets its own citations event.

**Two silent `{ text, chunks }` bugs are fixed.** Two call sites read the
result as a string, and neither threw:

- `routes/api.notes.compose.tsx` assigned the `streamToText()` result to
  `markdown` and returned `Response.json({ markdown })`. With 1.x it would have
  sent `{ markdown: { text, chunks } }` to `NoteComposer`.
- `services/lesson-generation.ts` read the write pass and the illustrate pass
  with `typeof raw === 'string' ? raw : ''`. With 1.x the result is an object,
  so both passes would have parsed an empty string, and lesson sections would
  have come out empty.

Both now destructure `const { text: markdown } = …`.

**ADR 0011's sharp edge is gone.** Before 1.x, a system message left in
`messages` on the Anthropic tier was dropped without an error, and every
switchable route had to remember the tier branch. Now each call passes
`systemPrompts`, and both adapters read it. The `ModelMessage` type in
`@tanstack/ai` 1.4.0 has no `'system'` role. CLAUDE.md states the rule: use
`systemPrompts`, and never put a `{ role: 'system' }` message in `messages`.

**What did not change.** `withFriendlyErrors` in `services/stream-errors.ts`
still translates a failed run on the server with the mapper of the model that
answered. `NoteComposer` still posts plain JSON to `/api/notes/compose` rather
than using `useChat`.

Verification: client `tsc` clean and 1359/1359 tests passing; server `tsc` clean
and 352/352 tests passing. The video, digest and library chats were tested
live against Ollama.
