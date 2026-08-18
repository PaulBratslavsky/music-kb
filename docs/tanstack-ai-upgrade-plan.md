# Upgrade plan: TanStack AI 0.10.3 → 0.45.0

**Status:** Proposed, not started
**Date:** 2026-08-18
**Scope:** `client/` only. The Strapi `server/` does not use TanStack AI at all.

## Why

| Package | Installed | Latest | Gap |
|---|---|---|---|
| `@tanstack/ai` | **0.10.3** | **0.45.0** | 35 minor versions |
| `@tanstack/ai-ollama` | **^0.6.6** | **0.9.1** | 3 minor versions |

On a pre-1.0 line, **minor releases may contain breaking changes** — semver's major-zero
clause means `0.10 → 0.45` carries no compatibility promise whatsoever. This is not a
routine bump; treat every minor as potentially breaking.

The upgrade is worth doing anyway:

- The gap only widens. Thirty-five versions of drift is already near the practical limit
  for reading release notes; at seventy it becomes a rewrite.
- A parallel audit of TanStack AI 0.45.0 (see
  `strapi-plugin-ai-sdk/docs/superpowers/specs/2026-08-18-tanstack-vs-vercel-decision.md`)
  found real improvements landed since 0.10 — notably `coerceStrictSchema()`, which widens
  `required` and unions `null` onto optional fields before calling strict structured
  output. That removes a class of schema failure by itself.
- Security and provider-compatibility fixes accrue upstream. Ollama's own API moves.

## What makes this tractable

The client depends on a **very small surface** — four symbols across 16 files:

| Symbol | Package | Files |
|---|---|---|
| `chat` | `@tanstack/ai` | most |
| `toolDefinition` | `@tanstack/ai` | `chat-tools.ts`, `library-tools.ts` |
| `toServerSentEventsResponse` | `@tanstack/ai` | `routes/api.chat.tsx` |
| `createOllamaChat` | `@tanstack/ai-ollama` | the API routes + services |

Four symbols is a bounded blast radius. The risk is concentrated in `chat()`'s options and
its stream chunk shape, not spread across a wide API.

Consumers, for reference:

```
src/lib/services/   chat-stream.ts  chat-retrieval.ts  chat-tools.ts  library-tools.ts
                    learning.ts  notes.ts  reader.ts  digest.ts  music-extraction.ts
src/routes/         api.chat.tsx  api.ask.tsx  api.digest-chat.tsx  api.notes.compose.tsx
src/components/     MusicExtractionPanel.tsx (type-only)
```

**There are 14 test files under `src/lib/services/`**, including `chat-stream.test.ts` and
`chat-retrieval.test.ts`, which already assert on stream behaviour (one test references
`RUN_ERROR`, emitted when Ollama dies). That suite is the safety net this upgrade depends
on — run it before touching anything to establish a green baseline.

## Known risk areas

Ordered by likelihood of breaking, based on what changed in the library between these
versions.

**1. Stream chunk shape.** `chat()` returns `AsyncIterable<StreamChunk>` of AG-UI events.
Event names and payloads are the most likely thing to have moved. `chat-stream.ts` and its
tests consume these directly. Verify `TEXT_MESSAGE_CONTENT`, `TOOL_CALL_END`, and
`RUN_ERROR` still carry the same names and field shapes.

Note a subtlety confirmed in the 0.45.0 audit: `TOOL_CALL_END` fires **twice per tool
call** — once for input, once for output — and an answered tool call requires a separate
`tool-result` sibling part. If the 0.10 code assumes one event per call, it is already
subtly wrong or the semantics changed underneath it.

**2. `toolDefinition()` builder.** In 0.45.0 the shape is
`toolDefinition({ name, description, inputSchema, outputSchema, needsApproval, metadata })`
followed by `.server(fn)` / `.client(fn)`. Confirm `chat-tools.ts` and `library-tools.ts`
still match; `needsApproval` and `metadata` may not have existed at 0.10.

**3. Adapter construction.** `createOllamaChat` signature and config keys. The 0.45.0 audit
found the sibling `anthropicText()` cannot take a runtime API key while
`createAnthropicChat()` can — evidence that this family of functions has been reorganised.
Check whether `createOllamaChat`'s options moved.

**4. Agent-loop options.** Iteration bounds moved to
`agentLoopStrategy: maxIterations(n)`. If the 0.10 code passes a differently-named option
it may now be silently ignored rather than rejected — **a silent behaviour change is worse
than a compile error**, so grep for any loop/iteration/step option explicitly.

**5. Model options nesting.** In 0.45.0, temperature and token limits live in
`modelOptions`, keyed by **provider-native** names (`num_predict` for Ollama, not
`maxOutputTokens`). If 0.10 accepted top-level values, they may now be dropped without
warning — same silent-failure risk.

**6. Structured output.** `coerceStrictSchema()` is new-ish. It should *fix* things, not
break them — but if any code compensates by hand for the old strict-mode behaviour (for
instance stripping `.default()` from a Zod field), that workaround is now redundant and may
conflict.

## Plan

### Phase 0 — Baseline

Establish what "working" means before changing anything, so regressions are attributable.

1. `cd client && npm test` — record the result. **If the suite is not green now, stop and
   fix that first.** Upgrading on top of a red suite makes every later failure ambiguous.
2. Manually exercise the live chat path against Ollama and record: a plain answer, a
   tool-calling answer, and a streaming answer. Note timings.
3. Commit any incidental drift so the upgrade diff is clean.

### Phase 1 — Read before upgrading

4. Read `node_modules/@tanstack/ai/skills/` **after** installing 0.45.0 — the package ships
   agent-readable guides (`chat-experience`, `tool-calling`, `adapter-configuration`), each
   with a "Common Mistakes" section. The 0.45.0 audit found these more reliable than the
   docs site.
5. Diff the `.d.ts` for the four symbols between installed 0.10.3 and 0.45.0. That is the
   authoritative changelog for our usage:
   ```bash
   cp -r client/node_modules/@tanstack/ai/dist /tmp/tsai-0.10
   # then upgrade, and diff /tmp/tsai-0.10 against the new dist
   ```
6. Skim the repo's release notes for the four symbols only. Do not read 35 changelogs in
   full; search them for `chat(`, `toolDefinition`, `StreamChunk`, `createOllamaChat`.

### Phase 2 — Upgrade

7. `npm install @tanstack/ai@0.45.0 @tanstack/ai-ollama@0.9.1`
8. Type-check. Fix every error, recording each one and its cause — that list is the real
   changelog for this codebase and belongs in the final report.
9. Run the test suite. **Any test that now fails is a finding, not an inconvenience** —
   decide deliberately whether the test or the code is wrong, and write down which.

### Phase 3 — Verify what types cannot catch

Type-checking will not catch renamed stream events or silently-ignored options. These must
be exercised live against Ollama:

10. Plain chat — streams tokens, completes.
11. Tool-calling chat — the tool is invoked, and the result renders (this is where a
    `TOOL_CALL_END` semantic change surfaces).
12. Structured output — `music-extraction.ts` / `learning.ts` still parse.
13. Error path — kill Ollama mid-stream and confirm the `RUN_ERROR` handling still fires,
    since a test already depends on that event name.
14. Compare timings against the Phase 0 baseline.

### Phase 4 — Land

15. Update `docs/` where the TanStack version or API is described.
16. Commit with the type-error list and the behavioural findings in the message body.

## Rollback

`git revert` the upgrade commit and `npm install`. The lockfile pins the old versions, so
recovery is one command — **provided the upgrade is a single isolated commit**. Do not mix
it with feature work.

## Out of scope

- The Strapi `server/` — it does not use TanStack AI.
- Migrating music-kb toward the Vercel AI SDK. The decision doc recommends against it: this
  is an ESM TanStack Start app, which is TanStack AI's native environment, and the
  `moduleResolution` problem that rules it out for Strapi plugins does not apply here.
- Adopting new 0.45.0 features. Get to parity first; add capability in a separate change.
