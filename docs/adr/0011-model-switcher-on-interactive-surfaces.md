# 0011. A model switcher on interactive surfaces; bulk stays local

**Status:** Accepted (2026-08-27). Amends ADR 0001 and CLAUDE.md's local-first rule.

## Context

ADR 0001 and CLAUDE.md established **local-first with exactly one documented
exception** (lesson generation, 2026-08-21). The rule was mechanised rather than
conventional: `resolveModel`'s parameter type was `LocalSurface` and its return
type `LocalModel`, `lesson-model.ts` was the sole value-importer of
`@tanstack/ai-anthropic`, and `model-policy.test.ts` pinned both with
source-level structural guards.

That worked, and the guarantee it bought — *no surface can reach frontier by
resolving its own model* — was real. But it also made the app's model choice a
deployment-time constant. Every chat turn ran on `OLLAMA_CHAT_MODEL` whether or
not that model was the right tool for the question, and the only way to compare
two local models on the same question was to edit `.env` and restart.

The request that prompted this: a per-conversation model picker, listing every
model actually installed on the Ollama host rather than the three ids pinned in
`env.ts`.

## Decision

**Widen the exception to the four interactive surfaces. Keep everything else.**

`LOCAL_SURFACES` splits in two:

- **`LOCAL_ONLY_SURFACES`** — `summary`, `query-rewrite`, `digest-synthesis`,
  `digest-article`, `music-extraction`, `reader`, `note-summarize`. No override
  path exists. These have no user sitting in front of them and run over the
  whole library unattended.
- **`SWITCHABLE_SURFACES`** — `video-chat`, `digest-chat`, `library-ask`,
  `note-compose`. A request may carry an explicit choice.

The line is **"is a human waiting for this one answer?"**, not "is this feature
important". CLAUDE.md's operative argument for local-first was never privacy or
purity — it was economic: *"the local-first constraint is what makes bulk jobs
like re-embedding the whole library free."* That argument applies with full
force to `LOCAL_ONLY_SURFACES` and not at all to a single chat turn. Splitting
on that axis keeps the reasoning intact instead of overriding it.

## What did not change

1. **Every default.** With no explicit choice, `resolveModel(surface)` returns
   the same local model from the same env constant it always did. A user who
   never touches the picker sees identical behaviour.

2. **One place builds a frontier adapter.** `lesson-model.ts` is renamed to
   `frontier-model.ts` and remains the only module importing
   `@tanstack/ai-anthropic` as a value or reading `ANTHROPIC_API_KEY`. The
   structural test that pinned the old filename now pins the new one. The
   widening changed which surfaces may *ask* for a frontier model; it did not
   add a second place that can *build* one.

3. **Tier-pairing by construction.** `buildFrontierModel` was extracted from
   `resolveLessonModel` so lesson generation and chat share one construction.
   The `toJSON` / `inspect` / `redact` hooks that stop `console.log(model)`
   traversing into the SDK client's live `.apiKey` cannot now drift between two
   copies, because there is only one.

4. **Pinned importers for every frontier entry point.** `resolveChatModel` is a
   second way to obtain a frontier model, so it gets the same treatment
   `resolveLessonModel` has: a test asserting its importer list. The pattern is
   *"every export that can return a frontier model has a pinned importer list"*,
   not *"there is only one such export"*. `chat-model-request.ts` is the single
   allowed importer, so adding a fifth switchable surface is an edit to that
   module's consumers rather than a quietly-longer allow-list.

5. **The key never reaches the browser.** The client sends a **choice token**
   (`'default' | 'local:<id>' | 'frontier'`), never a model id and never a key.
   `local:` tokens are validated against the installed Ollama catalogue before
   an adapter is built — an uninstalled or injected id is refused and the
   request is answered by the surface default with a `notice`, rather than
   silently answered by a different model than the picker displays.

## Consequences

- Comparing two local models on the same question is now a dropdown, not an
  `.env` edit and a restart. This is the main practical win.
- A frontier option appears in the picker only when `ANTHROPIC_API_KEY` is set.
- **System prompts are delivered tier-specifically.** Ollama accepts a
  `{ role: 'system' }` turn in the messages array; Anthropic does not — it takes
  a separate top-level `system` parameter and would otherwise drop the retrieved
  transcript context and skill persona *without failing the request*.
  `api.chat.tsx` branches on `model.tier` for this. Any new switchable surface
  must do the same; this is the sharpest edge the widening introduced.
- The guarantee CLAUDE.md can still make is narrower but still the one that
  matters: **no bulk job can reach a metered model, and the API key lives in
  exactly one module.** The claim that *chat* cannot reach frontier is retired
  deliberately, not eroded.

## Alternatives rejected

- **Leave the rule alone.** Rejected by the owner: the flexibility is wanted and
  the rule is theirs to change. Recording it here is the cost of changing it.
- **Make every surface switchable.** Rejected: it would discard the economic
  argument that motivated local-first, and a mis-set default on a bulk job is
  exactly the failure that argument exists to prevent.
- **Let the client send a model id.** Rejected: it lets any caller POST an
  arbitrary model to the endpoint, and makes the answer's attribution
  unverifiable. The token + catalogue validation costs one indirection.
