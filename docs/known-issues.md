# Known issues

Real defects, verified against the code, deliberately **not** fixed inside a larger change.
Each entry says why it was deferred and what "fixed" looks like.

Nothing here is speculative — every claim below was reproduced or read directly from source
at the cited line.

---

## 1. `askAboutVideoService` advertises a tool it never passes

**Severity:** low (degraded answers, no crash) · **Found:** 2026-08-27 · **Status:** FIXED 2026-08-28

`buildVideoGroundingContext` — reached from `buildChatSystemPrompt` — tells the model it has a tool:

```ts
// client/src/lib/services/learning.ts:1393
'TOOLS AVAILABLE: `web_search(query)` — use it ONLY when the retrieved passages genuinely
 do not answer the user\'s question ...'
```

But `askAboutVideoService`'s `chat()` call passes **no `tools:` option at all**:

```ts
// client/src/lib/services/learning.ts:1436-1446
chat({
  adapter: model.adapter,
  messages: [{ role: 'system', content: system }, ...messages] as never,
  stream: false,
})
```

`buildChatSystemPrompt` is **shared**. The streaming twin in `api.chat.tsx` reaches it through
`prepareChatPrompt` and *does* pass `tools: [webSearchTool]`, so the prompt is correct there
and wrong here. The non-streaming ask path can only narrate a tool call it has no way to make
— which is the failure mode `chat-tools.ts` already documents for a different cause: the model
prints `[{"tool_name":"web_search",...}]` as prose and the surrounding invented text reaches
the user looking like a real result.

**Why deferred:** pre-existing, orthogonal to the TanStack AI migration, and fixing it inside
a migration commit would hide it in a diff about something else.

**Fix — pick one, deliberately:**
- Pass `tools: [webSearchTool]` here too, so the prompt becomes true; or
- Take a `tools` parameter into `buildChatSystemPrompt` and omit the TOOLS AVAILABLE block
  when the caller passes none, so the prompt cannot drift from the call again.

The second is better: it makes the class of bug unrepresentable rather than fixing this one
instance.

**Interaction with the migration:** Phase 0 of `tanstack-ai-migration-spec.md` renames the
tool to `kb_web_search`. **The prompt string at `:1393` must be renamed in the same change**,
or it will advertise a name that no longer exists.

---

## 2. Anthropic stream errors are mapped by the Ollama translator

**Severity:** medium (wrong user-facing recovery advice) · **Found:** 2026-08-27 · **Status:** open

`chat-stream.ts` runs every `RUN_ERROR` through the **local** error mapper:

```ts
// client/src/lib/services/chat-stream.ts:173
throw new Error(friendlyOllamaError(raw));
```

The comment above it explains why that was safe, and predicts exactly how it would stop being
safe (`:162-168`):

> Hardcoding the LOCAL mapper here is correct BY CONSTRUCTION, not by luck: every streaming
> surface that reaches this parser (`/api/chat`, `/api/ask`, `/api/digest-chat`,
> `/api/notes/compose`) is a `LocalSurface` in model-policy.ts, and `resolveModel`'s return
> type cannot be frontier — so a RUN_ERROR crossing this wire is always Ollama text.
> **If a frontier surface ever streams through here, this line becomes wrong and needs a tier
> on the wire; nothing else would notice.**

**That "if" happened on 2026-08-27.** [ADR 0011](adr/0011-model-switcher-on-interactive-surfaces.md)
made `video-chat`, `digest-chat`, `library-ask` and `note-compose` switchable — all four of the
routes the comment names. An Anthropic failure now reaches a mapper that only knows how to
translate Ollama, so a user on the frontier tier gets Ollama recovery advice ("is `ollama serve`
running?") for a problem that has nothing to do with Ollama.

The comment was right, including about the detection problem: **nothing else would notice.**
No test covers it, because the mapper is idempotent on text it does not recognise, so a
mismapped Anthropic error passes through looking like a plausible message.

**Why deferred:** it is a user-visible behaviour change and belongs in its own commit with its
own tests. Folding it into the SDK upgrade (Phase 1) would mean a revert of the upgrade also
silently reverts this fix.

**Fix:** put the tier on the wire. The resolved model already knows it
(`ResolvedModel.tier`), and it already carries its own correctly-paired mapper
(`model.friendlyError`) — the pairing exists precisely so this cannot be got wrong. Options,
cheapest first:

1. Emit the tier as a `CUSTOM` frame at stream start and have `handleRunErrorEvent` pick the
   mapper from it.
2. Map the error **server-side** with `model.friendlyError(raw)` before it reaches the wire,
   and let the parser pass the text through unchanged. This removes the tier from the client's
   concerns entirely and reuses the pairing that already exists.

Option 2 is the smaller change and the more honest one: the server is the only place that
knows which model actually answered.

**Note:** `frontier-model.ts`'s `friendlyError` is deliberately non-echoing (it runs
`redactAnthropicKey` first). Whichever option is taken, do **not** route frontier errors
through `friendlyOllamaError`, which echoes raw text — that pairing exists to stop an API key
reaching a user-visible string.
