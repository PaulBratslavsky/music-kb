# 0013. One `<Chat>` component across all three surfaces

**Status:** Accepted (2026-08-29). Supersedes ADR 0012's decision to keep
library-ask on the hand-rolled parser.

## Context

ADR 0012 moved two chat surfaces onto `useChat` and kept the third — library-ask
— on the hand-rolled AG-UI parser. Its stated reason:

> `/api/ask` sends the citations for its passages *before* the answer they
> support ... `useChat` has nowhere to put a citation that arrives before its
> message, and the custom-event channel carries no message id to correlate one
> with.

The first half is true and remains true: `/api/ask` retrieves before it
generates, so its `CITATIONS` frame genuinely precedes the message it grounds.
The second half was wrong, and wrong in a specific way worth recording. It was
inferred from the type of `onCustomEvent`, whose context carries a `toolCallId`
and nothing else. That is accurate *about that channel* and says nothing about
the stream as a whole. Capturing a live stream showed the correlation key
sitting in plain view:

```json
{"type":"TEXT_MESSAGE_START","messageId":"msg-1787953861329-vrjqya9xcfp",
 "role":"assistant","metadata":{"tanstack":{"model":"gemma4-kb:latest"}}}
```

Separately, ADR 0012 was itself the product of executing the wrong plan.
`docs/unified-chat-component.md` said explicitly that a shared component
**replaces** the two per-surface migrations rather than following them, because
doing them first means "writing the plumbing twice and then deleting both."
That is what happened. This ADR records the deletion.

## Decision

**All three chat surfaces render one `<Chat>` component.**

It owns everything structural: the `useChat` wiring, chat-level
`forwardedProps`, the header and model picker, suggested prompts, the
transcript, the error banner, the composer, and the message bubble with its
tool-call derivation.

Callers supply only what is genuinely theirs, through render props. Presentation
is deliberately **not** unified — a citation is a router link on the digest
page, a player seek on the video page, and an expandable source card in the
library drawer. Three real UIs, so `renderBelowBody` is a render prop and not a
flag.

**Custom frames are reconciled in the transport.** `createCapturingFetcher`
reads the stream once on the way through: matching frames are pulled aside, the
next `TEXT_MESSAGE_START` names the message they belong to, and everything else
passes through byte-for-byte. `/api/ask` keeps its wire format; no server change
was needed to make its citations reachable.

**`/api/ask` speaks AG-UI** like the other two. This deleted the bespoke
`history` field and the hand-written `sanitizeHistory` that validated it —
history is now just the message array, validated by the SDK.

## Consequences

The AG-UI parser is gone. `useLibraryChat.ts` (274 lines), `streamChatSSE` and
its block parser are deleted; `chat-stream.ts` is 111 lines holding the two
things that outlived it, and says so in its header. Its filename is now wider
than its contents — a mechanical rename, deliberately left out of the change
that emptied it.

Component sizes, before this work and after:

| | before | after |
|---|---|---|
| VideoChat | 855 | 547 |
| DigestChat | 348 | 118 |
| LibraryChat | 411 | 326 |
| useLibraryChat | 274 | *deleted* |
| chat-stream | 241 | 111 |
| `<Chat>` + interceptor | — | 548 |

**A custom fetcher gives up a conversion the connection adapter does for you.**
`useChat` hands the fetcher `UIMessage`s, whose content lives in `parts`; the
AG-UI wire carries `content`. Posting them raw is a 400 that surfaces as an
empty answer bubble and no error anywhere. The unit test did not catch it
because it passed `messages: []`, which serialises identically either way — a
test that could not fail. It now sends a real message and asserts the converted
shape.

**Fixtures stay captured, not written.** `__fixtures__/ask-wire-0.52.json` is a
real `/api/ask` stream, and one test guards the fixture itself: that `CITATIONS`
really does precede `TEXT_MESSAGE_START`. A re-capture that reversed them would
otherwise leave the binding test passing while proving nothing.

**On the SDK's difficulty.** Across the whole migration, three things it did not
do for us: orphan tool-call filtering, the `UIMessage | ModelMessage` split, and
pre-message custom frames. Only the last is a real design mismatch — AG-UI
assumes data hangs off a message, and this app emits grounding before the
message exists — and it cost ~150 lines in the transport. Everything else the
SDK absorbed, more correctly than the code it replaced.
