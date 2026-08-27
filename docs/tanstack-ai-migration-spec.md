# TanStack AI migration — executable spec

**Status:** Ready to execute. Written 2026-08-27, not started.
**Audience:** a coding agent working alone. Every step is exact; nothing is left to judgement.
**Companion:** [`tanstack-ai-upgrade-plan.md`](tanstack-ai-upgrade-plan.md) — the assessment
this spec implements. Read it for *why*; read this for *what to type*.

## Why this exists — two defects

**A. LIVE NOW.** `@tanstack/ai-anthropic@0.16.6` converts tools by switching on `tool.name`
(`node_modules/@tanstack/ai-anthropic/dist/esm/tools/tool-converter.js:36`), and
`case 'web_search'` routes to Anthropic's **hosted** search. music-kb's own tool is named
`web_search` (`client/src/lib/services/chat-tools.ts:36`), so on the Anthropic path its own
executor is silently bypassed. This became reachable when ADR 0011 made `video-chat`
switchable. **Phase 0 fixes it in minutes and needs no upgrade.**

**B. LATENT, fires on any core bump.** `@tanstack/ai` 0.48.0 made the SSE wire spec-only:
`TOOL_CALL_END` now carries `keys('toolCallId')` and nothing else
(`packages/ai/src/utilities/spec-event-keys.ts:24`). Our parser reads `event.toolName`
(`chat-stream.ts:186`) and `event.input` (`:191`) off that frame, and `:182-183` explicitly
discards `TOOL_CALL_ARGS` — the frame that replaced them. Any bump to ≥0.48 silently blanks
tool names and arguments on **all four** streaming surfaces, and `expandHistoryForModel` then
reports `arguments: '{}'` back to the model. **Phase 1 fixes it, in the same commit as the bump.**

---

## Read this first — three non-negotiable rules

**1. Phase 1 lands alone.** The dependency bump and the parser patch go in **one commit**, with
no UI changes and no `@tanstack/ai-react`. If a later phase has to be reverted, the upgrade
must not go with it.

**2. Verify from CAPTURED frames, never written ones.** `client/verify-sse.mjs` prints the real
key set of every `TOOL_CALL_*` frame from a live `chat()` through `toServerSentEventsResponse`.
Run it **before and after** Phase 1, and re-cut `chat-stream.test.ts`'s tool fixtures from its
output. Do not hand-author an SSE fixture again.

**3. The test suite is not evidence.** 1,217 tests pass in ~2.3 seconds because every
SSE-touching test is a hand-authored fixture string. `chat-stream.test.ts:57-70` pins a
`TOOL_CALL_END` carrying `toolName` and `input` — a frame 0.49.1 will never emit — and it
**stays green through the exact regression it exists to prevent.** Green here means "nothing
else broke", never "the migration worked". The manual checks in each phase are the verification.

**Phase order and independence**

| Phase | Depends on | Shippable alone | Effort |
|---|---|---|---|
| 0 — rename `web_search` | nothing | yes | minutes |
| 1 — SDK bump + parser patch | 0 (recommended) | yes | 1–2 days |
| 2 — de-stream NoteComposer | 1 | yes | half a day |
| 3 — DigestChat onto useChat | 1 | yes | ~1 day |
| 4 — VideoChat onto useChat | 1, 3 | yes | 2–3 days |

Phases 2, 3 and 4 are independent of each other. Stopping after any phase is a valid resting
state, not an unfinished migration.

---

## Phase 0 — Rename the `web_search` tool off Anthropic's reserved namespace

**Goal:** Rename music-kb's own `web_search` tool to `kb_web_search` so `@tanstack/ai-anthropic@0.16.6` stops routing it into Anthropic's hosted-search converter, restoring frontier-tier tool calls on `/api/chat` and `/api/digest-chat`.

**Files touched:**
- `/Users/paul/projects/music-kb/client/src/lib/services/chat-tools.ts`
- `/Users/paul/projects/music-kb/client/src/lib/services/learning.ts`
- `/Users/paul/projects/music-kb/client/src/components/VideoChat.tsx`
- `/Users/paul/projects/music-kb/client/src/routes/api.chat.tsx`
- `/Users/paul/projects/music-kb/client/src/routes/api.digest-chat.tsx`
- `/Users/paul/projects/music-kb/client/src/lib/services/chat-stream.test.ts`
- `/Users/paul/projects/music-kb/client/src/lib/services/chat-tools.test.ts` **(new file)**
- `/Users/paul/projects/music-kb/README.md`
- `/Users/paul/projects/music-kb/docs/architecture.md`
- `/Users/paul/projects/music-kb/docs/tanstack-ai-upgrade-plan.md`

**Prerequisites:** None. This phase is deliberately independent of every later phase — no dependency bumps, no `chat-stream.ts` changes. Run it on the current pins (`@tanstack/ai` 0.45.1 / `ai-anthropic` 0.16.6 / `ai-ollama` 0.9.1).

**Estimated effort:** 1–2 hours (≈30 min of mechanical edits, the rest is the two-tier manual smoke test, which cannot be skipped — see Task 0.7).

---

### Correction to the background brief — the defect is worse than "silent hijack"

The existing assessment (`docs/tanstack-ai-upgrade-plan.md` §0.1) states the hijack produces *"No error; different results."* **That is wrong, and I verified it by executing the installed converter.** Read this before you start, because it changes the acceptance criteria.

`convertWebSearchToolToAdapterFormat` at `/Users/paul/projects/music-kb/client/node_modules/@tanstack/ai-anthropic/dist/esm/tools/web-search-tool.js:15-26` opens with:

```js
function convertWebSearchToolToAdapterFormat(tool) {
	const metadata = tool.metadata;
	return {
		name: "web_search",
		type: "web_search_20250305",
		...metadata.allowedDomains !== void 0 && { allowed_domains: metadata.allowedDomains },
```

A plain `toolDefinition({...}).server(fn)` has **no `metadata` property** — `/Users/paul/projects/music-kb/client/node_modules/@tanstack/ai/dist/esm/activities/chat/tools/tool-definition.js:63-80` returns `{ __toolSide, ...config, inputSchema, outputSchema, approvalSchema, needsApproval, execute }`, and `/Users/paul/projects/music-kb/client/node_modules/@tanstack/ai/dist/esm/activities/chat/index.js:472-476` passes that object straight through to the adapter with only the two schemas replaced. So `metadata` is `undefined` and `metadata.allowedDomains` throws.

Run this to see it for yourself (it reads only, changes nothing):

```bash
cd /Users/paul/projects/music-kb/client && node --input-type=module -e "
import { convertToolsToProviderFormat } from './node_modules/@tanstack/ai-anthropic/dist/esm/tools/tool-converter.js';
const base = { __toolSide:'server', description:'d', inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}, outputSchema:{type:'object'} };
for (const name of ['web_search','kb_web_search']) {
  try {
    const out = convertToolsToProviderFormat([{...base, name}]);
    console.log(name.padEnd(16), '->', out[0].type, '/', out[0].name);
  } catch (e) { console.log(name.padEnd(16), '-> THREW:', e.message); }
}
"
```

Expected output, exactly:

```
web_search       -> THREW: Cannot read properties of undefined (reading 'allowedDomains')
kb_web_search    -> custom / kb_web_search
```

The throw happens inside `mapCommonOptionsToAnthropic` (`adapters/text.js:190`), which is called from inside `chatStream`'s `try` (`adapters/text.js:81`). The `catch` at `adapters/text.js:96-115` converts it to a `RUN_ERROR` frame, which `chat-stream.ts:169-173` re-throws through `friendlyOllamaError`. **Net effect today: selecting the frontier model on video chat or digest chat produces a hard, visible error on the very first turn — not degraded results.** The tool executor is never reached, so `chat-tools.ts:47`'s `[tool web_search]` line never prints either.

This makes the phase a bug fix with a user-visible symptom, not a hygiene rename. It also means the manual smoke test in Task 0.7 has an unambiguous pass/fail.

---

### Name decision: `kb_web_search`

**The plan doc proposes `search_web`. This phase overrides that.** Justification:

The reserved set the 0.16.6 converter switches on (`tool-converter.js:36-45`) is `bash`, `code_execution`, `computer`, `memory`, `str_replace_editor`, `web_fetch`, `web_search`. `search_web` clears that set — but so does every string that is not one of seven words, and clearing today's list is not the property we want. The defect happened because a *generic, provider-plausible* name landed in a *provider-owned* namespace. `search_web` is exactly as generic as `web_search`; it is one product decision away from being the next reserved word (Anthropic already ships hosted `web_search` and `web_fetch`; OpenAI ships `web_search` and `web_search_preview`; the 0.49.1 reference at `/Users/paul/learning/tanstack-ai/.reference/tanstack-ai/packages/ai-anthropic/src/tools/tool-converter.ts` keeps a switch over the same seven kinds, merely keyed off adapter-owned metadata instead of the name).

`kb_web_search` carries an application-owned prefix (`kb` = the knowledge base; it matches the repo name `music-kb` and the existing `ytkb:` localStorage prefix at `useLibraryChat.ts:44`). No provider will ship a hosted tool under an app's private prefix, so the name is collision-proof against adapters that do not exist yet — which is the actual requirement. It is also short enough to read cleanly in the tool chip rendered at `VideoChat.tsx:696-698` and in the console log line, and it satisfies the `^[a-zA-Z0-9_-]{1,64}$` charset every provider enforces on function-tool names.

`library-tools.ts`'s four names (`search_library`, `get_video_details`, `list_videos_by_topic`, `load_passages`) are already clear of every reserved word and are **out of scope** — see **Do NOT**.

---

### Stored conversations: renaming breaks nothing persisted. Here is the audit.

I traced every place a `toolCalls` array could come to rest. **No `toolCall` record is persisted anywhere, on any surface, client or server. There is nothing to migrate.**

| Location | Holds tool names? | Evidence |
|---|---|---|
| `VideoChat.tsx` conversation | **No — React state only** | `messages` is `useState`; `grep -rn "localStorage" client/src` returns hits only in `usePlayAlongInstrument.ts`, `ThemeToggle.tsx`, `useAppState.ts`, `__root.tsx`, `useLibraryChat.ts`. `VideoChat.tsx` is not among them. |
| `DigestChat.tsx` conversation | **No — React state only** | Same grep. `DigestChat.tsx:16-28` declares `ToolCallRecord`/`Message` but never writes them anywhere but state. |
| `useLibraryChat.ts` localStorage (`ytkb:library-chat:v1`) | **No** | The persisted `ChatMessage` type at `useLibraryChat.ts:21-37` has fields `id, role, content, citations, answeredBy, status, error` — **no `toolCalls` field at all**. And `/api/ask` uses `library-tools.ts`, never `webSearchTool`. |
| Notes saved to Strapi | **No — stripped before send** | `VideoChat.tsx:168-170` maps to `{ role, content }` only; `notes.ts:197-202` `formatConversation` reads only `role`/`content`. |
| Strapi content types | **No** | `ls server/src/api/` → `composition, digest, lesson, loop, note, progression, tag, transcript, video`. No conversation type. `grep -rn "toolCall" server/src` returns **zero hits**. |

**The one residual risk, and it is a browser tab, not a database.** `VideoChat.tsx:201` sends the whole in-memory `history` (including prior-turn `toolCalls`) on every turn, and `api.chat.tsx:69-91` `expandHistoryForModel` replays each as `{ role: 'assistant', toolCalls: [{ function: { name: tc.name } } ] }` followed by a matching `{ role: 'tool', toolCallId }`. A tab that was **already open before the deploy** and keeps chatting after it will replay `function.name: "web_search"` against a server that now registers `kb_web_search`.

**I am UNSURE whether Anthropic's API rejects a historical `tool_use` block whose name is absent from the current `tools` array** — tool results are paired by `tool_use_id`, not by name, which suggests it is tolerated, but I did not verify it against the live API and you should not assume it. Ollama tolerates arbitrary historical tool names.

This is acceptable without a migration because the blast radius is *one open tab, for the length of one conversation*, the recovery is a page reload (state is in-memory and vanishes), and the worst case is one failed turn on a surface that is **already 100% broken on the frontier tier today**. Do not build a name-mapping shim for it. If you want belt-and-braces, tell the user to hard-refresh open `/learn/$videoId` and `/digest` tabs after deploying; that is the whole mitigation.

---

### Task 0.1 — Rename the tool definition

- [ ] **Step 1: Replace the tool name and its log line in `client/src/lib/services/chat-tools.ts`**

Current, `/Users/paul/projects/music-kb/client/src/lib/services/chat-tools.ts:35-51`:

```ts
export const webSearchTool = toolDefinition({
  name: 'web_search',
  description: [
    'Search the public web for additional context when the video transcript does not answer the user\'s question.',
    'Use this sparingly — only when the video genuinely lacks the needed information (e.g., the user asks about something not covered, or wants recent/external info).',
    'Do NOT use for content that is in the transcript — ground those answers in the retrieved passages you already have.',
    'When you use search results, cite them inline with the page URL so the user can verify.',
  ].join(' '),
  inputSchema: WebSearchInputSchema,
  outputSchema: WebSearchOutputSchema,
}).server(async ({ query }) => {
  const results = await webSearch(query, 5);
  console.log(
    `[${new Date().toISOString().slice(11, 23)}] [tool web_search] "${query}" → ${results.length} results`,
  );
  return { results };
});
```

Replace that whole block with:

```ts
export const webSearchTool = toolDefinition({
  // NAME IS LOad-BEARING — do not shorten this to `web_search`.
  //
  // `@tanstack/ai-anthropic@0.16.6` converts tools by switching on the tool's
  // LITERAL NAME (dist/esm/tools/tool-converter.js:36-45). A tool named
  // `web_search` is routed to `convertWebSearchToolToAdapterFormat`, which
  // reads `tool.metadata.allowedDomains` — and a plain `toolDefinition()` has
  // no `metadata`, so every Anthropic-tier turn threw
  //   TypeError: Cannot read properties of undefined (reading 'allowedDomains')
  // from inside `chatStream`, reaching the user as a RUN_ERROR. Our own
  // executor below was never called.
  //
  // The reserved set is `bash`, `code_execution`, `computer`, `memory`,
  // `str_replace_editor`, `web_fetch`, `web_search`. 0.18.0+ switches on
  // adapter-owned metadata instead of the name, so the crash goes away on
  // upgrade — but the `kb_` prefix stays, because the durable property is an
  // application-owned namespace no provider will ever claim, not "a word that
  // happens to be free in one adapter version today".
  //
  // Guarded by chat-tools.test.ts.
  name: 'kb_web_search',
  description: [
    'Search the public web for additional context when the video transcript does not answer the user\'s question.',
    'Use this sparingly — only when the video genuinely lacks the needed information (e.g., the user asks about something not covered, or wants recent/external info).',
    'Do NOT use for content that is in the transcript — ground those answers in the retrieved passages you already have.',
    'When you use search results, cite them inline with the page URL so the user can verify.',
  ].join(' '),
  inputSchema: WebSearchInputSchema,
  outputSchema: WebSearchOutputSchema,
}).server(async ({ query }) => {
  const results = await webSearch(query, 5);
  console.log(
    `[${new Date().toISOString().slice(11, 23)}] [tool kb_web_search] "${query}" → ${results.length} results`,
  );
  return { results };
});
```

Fix the typo `LOad-BEARING` → `LOAD-BEARING` when you paste it.

- [ ] **Step 2: Verify**

```bash
grep -n "kb_web_search\|web_search" /Users/paul/projects/music-kb/client/src/lib/services/chat-tools.ts
```

Expected — exactly two hits, both `kb_web_search`, plus the comment block:

```
36:  //   `web_search` is routed to `convertWebSearchToolToAdapterFormat`, which
...
50:  name: 'kb_web_search',
...
62:    `[${new Date().toISOString().slice(11, 23)}] [tool kb_web_search] "${query}" → ${results.length} results`,
```

Line numbers will differ because of the inserted comment. What must be true: **no `name: 'web_search'` and no `[tool web_search]` remain.**

---

### Task 0.2 — Rename it in the video-chat system prompt

The model is told the tool's name in the grounding block. If this drifts from the registered name, the model calls a tool that does not exist and the agent loop stalls.

- [ ] **Step 1: Edit `client/src/lib/services/learning.ts:1393`**

Current, `/Users/paul/projects/music-kb/client/src/lib/services/learning.ts:1393` (one line):

```ts
    'TOOLS AVAILABLE: `web_search(query)` — use it ONLY when the retrieved passages genuinely do not answer the user\'s question (they ask about something outside the video, or want current/external information). When you do use it, cite the source URL inline. Never call `web_search` for information that IS in the retrieved passages.',
```

Replace with:

```ts
    'TOOLS AVAILABLE: `kb_web_search(query)` — use it ONLY when the retrieved passages genuinely do not answer the user\'s question (they ask about something outside the video, or want current/external information). When you do use it, cite the source URL inline. Never call `kb_web_search` for information that IS in the retrieved passages.',
```

- [ ] **Step 2: Verify**

```bash
grep -c "kb_web_search" /Users/paul/projects/music-kb/client/src/lib/services/learning.ts
```

Expected output:

```
1
```

(One line, containing the name twice.)

---

### Task 0.3 — Rename it in the `/web` slash-command trigger and the UI comments

`transformSlashCommand` is the determinism lever for local models — it names the tool explicitly to bypass Gemma's probabilistic tool-call decision. It **must** name the registered tool.

- [ ] **Step 1: Edit `client/src/components/VideoChat.tsx:26`**

Current:

```ts
  /** Tool name (e.g., "web_search"). */
```

Replace with:

```ts
  /** Tool name (e.g., "kb_web_search"). */
```

- [ ] **Step 2: Edit `client/src/components/VideoChat.tsx:58`**

Current:

```ts
    return `Use the web_search tool with the exact query "${query}", then summarize the top results in 2-3 short paragraphs. Cite each source URL inline. Do NOT answer from the transcript for this request — I explicitly want web search results.`;
```

Replace with:

```ts
    return `Use the kb_web_search tool with the exact query "${query}", then summarize the top results in 2-3 short paragraphs. Cite each source URL inline. Do NOT answer from the transcript for this request — I explicitly want web search results.`;
```

- [ ] **Step 3: Edit `client/src/components/VideoChat.tsx:197-198`**

Current:

```ts
    // sometimes-flaky decision to call a tool. `/web <query>` forces
    // the web_search tool. Extend the switch when we add more tools.
```

Replace with:

```ts
    // sometimes-flaky decision to call a tool. `/web <query>` forces
    // the kb_web_search tool. Extend the switch when we add more tools.
```

- [ ] **Step 4: Edit `client/src/components/VideoChat.tsx:659`**

Current:

```ts
// (e.g., web_search) was invoked. Each tool call is an accordion that
```

Replace with:

```ts
// (e.g., kb_web_search) was invoked. Each tool call is an accordion that
```

- [ ] **Step 5: Verify**

```bash
grep -n "web_search" /Users/paul/projects/music-kb/client/src/components/VideoChat.tsx
```

Expected — four hits, all prefixed `kb_`:

```
26:  /** Tool name (e.g., "kb_web_search"). */
58:    return `Use the kb_web_search tool with the exact query "${query}", then summarize the top results in 2-3 short paragraphs. Cite each source URL inline. Do NOT answer from the transcript for this request — I explicitly want web search results.`;
198:    // the kb_web_search tool. Extend the switch when we add more tools.
659:// (e.g., kb_web_search) was invoked. Each tool call is an accordion that
```

Do **not** touch `VideoChat.tsx:445` (`placeholder="Ask about this video…  (/web <query> to force web search)"`) — that is prose describing the feature to a human, not the tool identifier.

---

### Task 0.4 — Rename it in the two route comments

Neither is a functional string, but both are diagnostics a future reader will trust.

- [ ] **Step 1: Edit `client/src/routes/api.chat.tsx:176-177`**

Current:

```ts
          // Agent loop: model can call `web_search(query)` when the
          // retrieved transcript passages don't answer the question.
```

Replace with:

```ts
          // Agent loop: model can call `kb_web_search(query)` when the
          // retrieved transcript passages don't answer the question.
```

- [ ] **Step 2: Edit `client/src/routes/api.chat.tsx:186`**

Current:

```ts
          // `[{"tool_name":"web_search",...}]` as ordinary prose: the tool
```

Replace with:

```ts
          // `[{"tool_name":"kb_web_search",...}]` as ordinary prose: the tool
```

This one quotes model output observed before the rename. Rename it anyway: the comment's job is *"if you see raw tool JSON in an answer, this is the failure mode"* — a live diagnostic for a future reader, who would now see `kb_web_search` in that JSON. Keeping the stale string would make the diagnostic fail to match.

- [ ] **Step 3: Edit `client/src/routes/api.digest-chat.tsx:16`**

Current:

```ts
// The model has the same `web_search` tool available since cross-video
```

Replace with:

```ts
// The model has the same `kb_web_search` tool available since cross-video
```

- [ ] **Step 4: Verify**

```bash
grep -n "web_search" /Users/paul/projects/music-kb/client/src/routes/api.chat.tsx /Users/paul/projects/music-kb/client/src/routes/api.digest-chat.tsx
```

Expected — three hits, all `kb_`-prefixed, at `api.chat.tsx:176`, `api.chat.tsx:186`, `api.digest-chat.tsx:16`.

---

### Task 0.5 — Re-name the SSE parser test fixtures

These fixtures use `web_search` as an opaque payload string; the parser never interprets it. Rename them anyway so the repo-wide grep in the phase verification can be an exact-zero gate.

- [ ] **Step 1: Run this scoped sed — it touches one file only**

```bash
sed -i '' 's/web_search/kb_web_search/g' /Users/paul/projects/music-kb/client/src/lib/services/chat-stream.test.ts
```

This rewrites exactly eight occurrences, at `chat-stream.test.ts` lines 60, 61, 66, 70, 80, 81, 86, 90, 242, 243, 248, 252 (twelve string positions across those lines).

- [ ] **Step 2: Verify the count and that nothing else moved**

```bash
grep -c "kb_web_search" /Users/paul/projects/music-kb/client/src/lib/services/chat-stream.test.ts
grep -c "\"web_search\"\|'web_search'" /Users/paul/projects/music-kb/client/src/lib/services/chat-stream.test.ts
```

Expected output:

```
12
0
```

Leave the surrounding comments alone, including `chat-stream.test.ts:238-239` ("Frame shapes captured from a live llama3.2:3b run"). The tool *name* inside a captured frame is app-chosen and follows the rename; the frame *shape* is what that comment attests to, and it is unchanged. Phase 1 re-cuts these fixtures from a fresh capture anyway.

---

### Task 0.6 — Add the regression test that makes the rename permanent

Without this, nothing stops the name drifting back, and nothing catches prompt/tool divergence. **I wrote and ran this test against the real repo: it fails 2/3 before the rename and passes 3/3 after.**

- [ ] **Step 1: Create `/Users/paul/projects/music-kb/client/src/lib/services/chat-tools.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { webSearchTool } from '#/lib/services/chat-tools';
import { buildChatSystemPrompt } from '#/lib/services/learning';
import type { StrapiVideo } from '#/lib/services/videos';

// Regression guard for the defect closed in Phase 0 of the TanStack AI
// upgrade plan (docs/tanstack-ai-upgrade-plan.md §0.1).
//
// `@tanstack/ai-anthropic@0.16.6` converts tools by switching on the tool's
// LITERAL NAME:
//   node_modules/@tanstack/ai-anthropic/dist/esm/tools/tool-converter.js:36-45
// A tool named `web_search` was routed to `convertWebSearchToolToAdapterFormat`,
// which reads `tool.metadata.allowedDomains`. A plain `toolDefinition()` has no
// `metadata`, so every Anthropic-tier chat turn threw
//   TypeError: Cannot read properties of undefined (reading 'allowedDomains')
// inside `chatStream`, surfacing to the user as a RUN_ERROR.
//
// These names are reserved by that switch and by its 0.18.0+/0.49.1 successor
// (`getAnthropicProviderToolKind`). Our own tools must never be named any of
// them, on any adapter version.
const PROVIDER_RESERVED_TOOL_NAMES = [
  'bash',
  'code_execution',
  'computer',
  'memory',
  'str_replace_editor',
  'text_editor',
  'web_fetch',
  'web_search',
] as const;

describe('chat-tools — provider-name safety', () => {
  it('is not named anything the Anthropic adapter treats as a hosted tool', () => {
    expect(PROVIDER_RESERVED_TOOL_NAMES).not.toContain(webSearchTool.name);
  });

  it('uses a name every provider accepts for a custom function tool', () => {
    expect(webSearchTool.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });
});

describe('chat-tools — prompt/tool name agreement', () => {
  it('names the tool in the video-chat system prompt exactly as it is registered', () => {
    const video = {
      videoTitle: 'Test video',
      videoAuthor: 'Test channel',
      sections: [],
      keyTakeaways: [],
    } as unknown as StrapiVideo;

    const system = buildChatSystemPrompt(video, []);

    expect(system).toContain(`\`${webSearchTool.name}(query)\``);
    for (const reserved of PROVIDER_RESERVED_TOOL_NAMES) {
      expect(system).not.toContain(`\`${reserved}(`);
    }
  });
});
```

Two notes on why this test is shaped the way it is. The backtick in `` `${reserved}(` `` is load-bearing: without it, the substring `web_search(` would still match inside `kb_web_search(query)` and the assertion would fail on a correct rename. And the negative loop, not a hand-written negative, is what keeps this honest if a future adapter adds a reserved word to the list above.

- [ ] **Step 2: Verify**

```bash
cd /Users/paul/projects/music-kb/client && yarn vitest run src/lib/services/chat-tools.test.ts 2>&1 | tail -8
```

Expected:

```
 ✓ src/lib/services/chat-tools.test.ts (3 tests) 1ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

---

### Task 0.7 — Manual two-tier smoke test (mandatory — vitest cannot cover this)

Every SSE test in this repo is a hand-authored fixture string; none of them exercises the Anthropic adapter's tool converter. The defect lives entirely in a code path no test reaches. **The green suite is not evidence that this phase worked.**

- [ ] **Step 1: Start the app**

```bash
cd /Users/paul/projects/music-kb && yarn dev
```

Wait for the client on `http://localhost:3015`.

- [ ] **Step 2: Local tier — confirm the rename did not break Ollama tool calling**

Open any `/learn/$videoId` page with a generated summary. Leave the model picker on its default (local). Send:

```
/web who founded berklee college of music
```

Expected, in the terminal running the client:

```
[HH:MM:SS.mmm] [tool kb_web_search] "who founded berklee college of music" → 5 results
```

Expected, in the browser: a tool-call accordion above the answer whose mono chip reads **`kb_web_search`**, expanding to show the input args and the result payload.

If the tool chip never appears, re-send — local tool-call reliability is probabilistic (README:336), and `/web` raises but does not guarantee it. Three consecutive misses means the rename hurt the local model's willingness to call it; that would be a real finding, so record it before proceeding.

- [ ] **Step 3: Frontier tier — this is the actual fix, and it is the step that failed before**

Confirm `ANTHROPIC_API_KEY` is set in `client/.env`. On the same page, switch the model picker to the frontier model. Send the same `/web` prompt.

**Expected after this phase:** the same `[tool kb_web_search] ... → 5 results` line in the terminal, and the same `kb_web_search` chip in the UI.

**What you would have seen before this phase** (useful as a sanity check that you are exercising the right path — you can reproduce it by stashing the change): the turn fails with an error message containing `Cannot read properties of undefined (reading 'allowedDomains')`, no `[tool ...]` line in the terminal, and no tool chip.

- [ ] **Step 4: Frontier tier on the digest surface**

Open `/digest`, select 2–5 videos, switch the picker to frontier, and ask a question the transcripts cannot answer, e.g.:

```
What did the TanStack team ship in the last month that these videos do not cover?
```

Expected: `[tool kb_web_search] "..." → N results` in the terminal and a `kb_web_search` chip in the UI. Digest chat's system prompt never names the tool (verified: `grep -n "web_search" client/src/lib/services/learning.ts` returns only line 1393, inside `buildVideoGroundingContext`, which digest chat does not use), so the model here calls it purely from the tool description — which is exactly why this surface needs its own smoke test rather than inheriting Step 3's result.

---

### Task 0.8 — Update the living documentation

Six lines in `README.md`, six in `docs/architecture.md`. Written out individually, not as a sed, because two of them need more than a substitution.

- [ ] **Step 1: `README.md:13`**

Current:

```md
- **Agentic chat** — streaming chat over [TanStack AI](https://tanstack.com/ai/latest) with a built-in `web_search` tool. Force-trigger with `/web <query>` when you want external context.
```

Replace with:

```md
- **Agentic chat** — streaming chat over [TanStack AI](https://tanstack.com/ai/latest) with a built-in `kb_web_search` tool. Force-trigger with `/web <query>` when you want external context.
```

- [ ] **Step 2: `README.md:111`**

Current:

```md
    S -.->|tool available| W["web_search"]
```

Replace with:

```md
    S -.->|tool available| W["kb_web_search"]
```

- [ ] **Step 3: `README.md:131`**

Current:

```md
The model will call `web_search` on its own when the transcript doesn't cover the question. To **force** a search regardless of model judgment:
```

Replace with:

```md
The model will call `kb_web_search` on its own when the transcript doesn't cover the question. To **force** a search regardless of model judgment:
```

- [ ] **Step 4: `README.md:203`**

Current:

```md
**Design constraint: no tool duplication.** Tools are defined once in `server/src/mcp/tools/` and consumed via MCP. The in-app Ollama chat does not use MCP — it stays on its BM25 + `web_search` path so local inference doesn't pay the protocol overhead. The two worlds meet at the same Strapi data layer, not at the tool definitions.
```

Replace with:

```md
**Design constraint: no tool duplication.** Tools are defined once in `server/src/mcp/tools/` and consumed via MCP. The in-app Ollama chat does not use MCP — it stays on its BM25 + `kb_web_search` path so local inference doesn't pay the protocol overhead. The two worlds meet at the same Strapi data layer, not at the tool definitions.
```

- [ ] **Step 5: `README.md:336`**

Current:

```md
- **Local model tool-call reliability is probabilistic.** Gemma 4 at 4B-effective params lands around 42% on [Tau2](https://arxiv.org/abs/2406.12045). Single-shot tool calls (like `web_search`) work reliably; agentic multi-step chains don't. Use `/web <query>` when you need determinism.
```

Replace with:

```md
- **Local model tool-call reliability is probabilistic.** Gemma 4 at 4B-effective params lands around 42% on [Tau2](https://arxiv.org/abs/2406.12045). Single-shot tool calls (like `kb_web_search`) work reliably; agentic multi-step chains don't. Use `/web <query>` when you need determinism.
```

- [ ] **Step 6: `README.md:338`**

Current:

```md
  Temperature matters more than it looks here. `/api/chat` runs at `0.3`; at Ollama's default of `1.0` the model intermittently *narrated* the call instead of emitting it — printing `[{"tool_name":"web_search",...}]` as prose, so the tool never ran and the invented text around it reached the user looking like a real result. Measured on the same prompt: **1/3 calls succeeded at 1.0, 4/4 at 0.3.** If you swap the chat model and see raw tool JSON in an answer, that is this failure mode, and temperature is the dial.
```

Replace with:

```md
  Temperature matters more than it looks here. `/api/chat` runs at `0.3`; at Ollama's default of `1.0` the model intermittently *narrated* the call instead of emitting it — printing `[{"tool_name":"kb_web_search",...}]` as prose, so the tool never ran and the invented text around it reached the user looking like a real result. Measured on the same prompt: **1/3 calls succeeded at 1.0, 4/4 at 0.3.** If you swap the chat model and see raw tool JSON in an answer, that is this failure mode, and temperature is the dial.
```

- [ ] **Step 7: `docs/architecture.md:58`**

Current:

```
      DDG["DuckDuckGo HTML<br/>(web_search tool)"]
```

Replace with:

```
      DDG["DuckDuckGo HTML<br/>(kb_web_search tool)"]
```

- [ ] **Step 8: `docs/architecture.md:393`**

Current:

```
data: {"type":"TOOL_CALL_START","toolCallId":"t_1","name":"web_search"}
```

Replace with:

```
data: {"type":"TOOL_CALL_START","toolCallId":"t_1","toolName":"kb_web_search"}
```

Note the second change: the key is `toolName`, not `name`. `chat-stream.ts:177` reads `event.toolName ?? event.toolCallName` and would drop a frame keyed `name`, so the doc as written was describing a frame the parser rejects. Fix both while you are in the line.

- [ ] **Step 9: `docs/architecture.md:418`**

Current:

```ts
  name: 'web_search',
```

Replace with:

```ts
  name: 'kb_web_search',
```

- [ ] **Step 10: `docs/architecture.md:436-444` — replace the whole `/web` block**

Current (§6.4, lines 436-444):

```md
### 6.4 `/web` slash command

Local-model tool-call reliability is probabilistic (~42% on [Tau2](https://arxiv.org/abs/2406.12045) for 4B-effective params). Users can force a call with `/web <query>`:

```ts
// VideoChat.tsx — transforms "/web tanstack ai docs" into:
"Please use the web_search tool with the query: \"tanstack ai docs\". " +
"Then answer based on what you find."
```
```

Replace with:

```md
### 6.4 `/web` slash command

Local-model tool-call reliability is probabilistic (~42% on [Tau2](https://arxiv.org/abs/2406.12045) for 4B-effective params). Users can force a call with `/web <query>`:

```ts
// VideoChat.tsx:54-61 — transforms "/web tanstack ai docs" into:
`Use the kb_web_search tool with the exact query "tanstack ai docs", then ` +
`summarize the top results in 2-3 short paragraphs. Cite each source URL ` +
`inline. Do NOT answer from the transcript for this request — I explicitly ` +
`want web search results.`
```
```

The old quoted string had drifted from the code independently of this rename — `VideoChat.tsx:58` has never said "Please use … with the query:". Correcting it here is in scope because you are already editing the line and a stale prompt quote is exactly what sends the next reader to the wrong place.

- [ ] **Step 11: `docs/architecture.md:499`**

Current:

```
[Tool calls panel]    (if any — web_search invocations with input/result)
```

Replace with:

```
[Tool calls panel]    (if any — kb_web_search invocations with input/result)
```

- [ ] **Step 12: `docs/architecture.md:610`**

Current:

```
│   ├── chat-tools.ts              — web_search toolDefinition
```

Replace with:

```
│   ├── chat-tools.ts              — kb_web_search toolDefinition
```

- [ ] **Step 13: Verify**

```bash
grep -n "web_search" /Users/paul/projects/music-kb/README.md /Users/paul/projects/music-kb/docs/architecture.md | grep -v "kb_web_search"
```

Expected output: **nothing** (empty, exit status 1).

---

### Task 0.9 — Correct §0.1 of the upgrade plan

The assessment doc records the symptom wrong. Later phases are planned off this document; leaving "No error; different results" in it will mislead whoever reads it next.

- [ ] **Step 1: In `/Users/paul/projects/music-kb/docs/tanstack-ai-upgrade-plan.md`, replace this paragraph (the one beginning "music-kb's own tool is")**

Current:

```md
music-kb's own tool is `name: 'web_search'` (`client/src/lib/services/chat-tools.ts:36`).
So on the Anthropic path, **the app's own executor is silently replaced by Anthropic's hosted
search.** No error; different results; the `[tool web_search]` console line at
`chat-tools.ts:47` never prints.
```

Replace with:

```md
music-kb's own tool is `name: 'web_search'` (`client/src/lib/services/chat-tools.ts:36`).

**Corrected 2026-08-27, verified by executing the installed converter — this is worse than a
silent hijack, it is a hard crash.** `convertWebSearchToolToAdapterFormat`
(`dist/esm/tools/web-search-tool.js:15-26`) opens with `const metadata = tool.metadata` and
then reads `metadata.allowedDomains`. A plain `toolDefinition()` carries no `metadata`
(`@tanstack/ai/dist/esm/activities/chat/tools/tool-definition.js:63-80`, passed through
unchanged at `activities/chat/index.js:472-476`), so the conversion throws
`TypeError: Cannot read properties of undefined (reading 'allowedDomains')` inside
`mapCommonOptionsToAnthropic` → `chatStream` → the `catch` at `adapters/text.js:96`, which
re-emits it as a `RUN_ERROR` frame. `chat-stream.ts:169-173` then throws it at the user.

So the real symptom is: **every frontier-tier turn on `/api/chat` and `/api/digest-chat`
fails on the first message with a visible error.** Anthropic's hosted search is never
reached either. The `[tool web_search]` console line at `chat-tools.ts:47` never prints.
```

- [ ] **Step 2: Replace the "Fix now" paragraph in the same section**

Current:

```md
**Fix now, independent of everything else — rename the tool.** One line in
`chat-tools.ts`, plus its `describeTools` reference. `search_web` collides with nothing in
the converter's switch. This costs nothing and does not wait for the upgrade.
```

Replace with:

```md
**Fixed in Phase 0 — renamed to `kb_web_search`.** Not `search_web` as originally proposed:
`search_web` is as generic as `web_search` and clears only today's seven-word reserved list,
where an application-owned `kb_` prefix is collision-proof against adapters that don't exist
yet. There is no `describeTools` in this codebase — the references were
`chat-tools.ts:36`/`:48`, the grounding prompt at `learning.ts:1393`, the `/web` trigger at
`VideoChat.tsx:58`, four comments, and the SSE test fixtures. Guarded by
`client/src/lib/services/chat-tools.test.ts`.
```

- [ ] **Step 3: In §3, mark the phase done**

Current:

```md
### Phase 0 — rename `web_search` *(minutes)*
Independent of everything. Closes §0.1. Do it now.
```

Replace with:

```md
### Phase 0 — rename `web_search` → `kb_web_search` *(done)*
Independent of everything. Closes §0.1. Landed on the existing pins (0.45.1 / 0.16.6 /
0.9.1) with no dependency changes.
```

- [ ] **Step 4: Verify**

```bash
grep -n "No error; different results" /Users/paul/projects/music-kb/docs/tanstack-ai-upgrade-plan.md
```

Expected output: nothing (exit status 1).

---

### Verification for the whole phase

Run all four, in order. All four must pass.

- [ ] **1. Zero surviving bare references anywhere in the source tree**

```bash
cd /Users/paul/projects/music-kb && grep -rn "web_search" client/src server/src packages web 2>/dev/null | grep -v node_modules | grep -v "kb_web_search" | grep -v "chat-tools.test.ts"
```

Expected output: **nothing** (exit status 1). The `chat-tools.test.ts` exclusion is deliberate — that file must keep the literal string `'web_search'` inside `PROVIDER_RESERVED_TOOL_NAMES`, which is the whole point of it.

- [ ] **2. Full client suite green, with three new tests**

```bash
cd /Users/paul/projects/music-kb/client && yarn test 2>&1 | tail -6
```

Expected (baseline before this phase was `50 passed (50)` / `1217 passed (1217)`, measured on this working tree):

```
 Test Files  51 passed (51)
      Tests  1220 passed (1220)
```

- [ ] **3. Typecheck clean**

```bash
cd /Users/paul/projects/music-kb && npx tsc --noEmit -p client/tsconfig.json
```

Expected output: **nothing** (exit status 0). `client/tsconfig.json` already sets `noEmit`, `strict`, `noUnusedLocals`, and `noUnusedParameters`.

- [ ] **4. Both tiers actually call the tool**

Task 0.7 Steps 2, 3 and 4 all pass: `[tool kb_web_search]` appears in the client terminal and a `kb_web_search` chip appears in the UI on (a) local video chat, (b) frontier video chat, (c) frontier digest chat. **Do not commit without this.** Steps 1–3 above would all pass on a rename that broke tool calling entirely, because no automated test in this repo reaches an adapter's tool converter.

---

### Do NOT

- **Do not rename the exported TypeScript symbol `webSearchTool`.** The defect is in the *wire name* the adapter switches on, not the identifier. Renaming it churns `api.chat.tsx:6`, `api.chat.tsx:180`, `api.digest-chat.tsx:5`, `api.digest-chat.tsx:145`, and the new test, for zero behavioural benefit — and it makes the Phase 1 diff (which touches `api.chat.tsx`) harder to read.
- **Do not touch `client/src/lib/services/web-search.ts` or the `webSearch()` function.** That is the DuckDuckGo HTTP client. It has no name the model or any provider ever sees. Renaming it would ripple into `chat-tools.ts:3` and `chat-tools.ts:46` for nothing.
- **Do not use `search_web`, even though `docs/tanstack-ai-upgrade-plan.md:126` proposes it.** Task 0.9 Step 2 updates that doc for exactly this reason. A generic verb-noun is what caused the collision in the first place; the app-owned `kb_` prefix is the property being bought here. If you "correct" the code back to match the old doc line you will have reverted the decision.
- **Do not rename the four tools in `client/src/lib/services/library-tools.ts`** (`search_library` :61, `get_video_details` :129, `list_videos_by_topic` :206, `load_passages` :277). I checked every one against the 0.16.6 switch and the 0.49.1 kind list: none collides. They are also on `/api/ask`, a surface this phase does not touch. Prefixing them is scope creep and would invalidate a separate set of prompts in `ask-library.ts`.
- **Do not bump any `@tanstack/*` version in this phase.** The whole value of Phase 0 is that it ships today on the current pins. `@tanstack/ai` ≥0.48 silently blanks tool names on all four streaming surfaces (defect B) and needs the `chat-stream.ts` parser rewrite in the same commit — that is Phase 1's job, and mixing them makes a failed smoke test ambiguous between two causes.
- **Do not modify `client/src/lib/services/chat-stream.ts`.** It is untouched by this phase. Its `TOOL_CALL_END` handling at :180-197 is wrong for ≥0.48, but it is correct for the 0.45.1 currently pinned, and fixing it now would be an untested change landing on a wire dialect it does not yet face.
- **Do not edit `docs/adr/0001-local-first-no-cloud-ai.md:29`, `docs/cross-referencing-plan.md:33`, `docs/harness-extensibility-plan.md:214`, or `docs/architecture-review/03-streaming-chat-parser.md:40`,** all of which mention `web_search`. ADRs are immutable decision records, and the other three are dated plan/review artifacts describing the codebase as it was when they were written. Rewriting history in them destroys the reason they exist. `README.md` and `docs/architecture.md` are living documentation and *are* in scope — that is the distinction.
- **Do not "fix" `askAboutVideoService`** (`learning.ts:1425-1454`). Its system prompt advertises the tool (via `buildChatSystemPrompt` → `buildVideoGroundingContext`) but its `chat()` call passes no `tools` array. That is a real pre-existing bug — the non-streaming path tells the model about a tool it cannot call — but it is orthogonal to the rename, it is not reachable from the frontier tier (`resolveModel('video-chat')` is local-by-policy), and fixing it changes generation behaviour on a surface this phase is supposed to leave alone. File it; don't fix it here.
- **Do not run a repo-wide `sed -i '' 's/web_search/kb_web_search/g'`.** It would rewrite the ADR and the three plan docs, corrupt `PROVIDER_RESERVED_TOOL_NAMES` in the new test into a list that no longer names the reserved word, and mangle `web-search.ts`'s type names (`WebSearchResult`) if you widened the pattern. Every edit above is scoped to one file for this reason.
- **Do not build a name-mapping shim for old `toolCalls` in replayed history.** Nothing persists them (audit above); the only exposure is a browser tab open across the deploy, whose recovery is a reload.

---

### Commit

```bash
cd /Users/paul/projects/music-kb && git checkout -b fix/rename-web-search-tool && git add -A && git commit -F- <<'EOF'
fix(chat): rename web_search tool to kb_web_search

`@tanstack/ai-anthropic@0.16.6` converts tools by switching on the tool's
literal name (dist/esm/tools/tool-converter.js:36-45). Our own tool was
named `web_search`, so on the Anthropic path it was routed into
`convertWebSearchToolToAdapterFormat` instead of the custom-tool converter.

That function reads `tool.metadata.allowedDomains`, and a plain
`toolDefinition()` carries no `metadata` — so the conversion threw
`TypeError: Cannot read properties of undefined (reading 'allowedDomains')`
inside `mapCommonOptionsToAnthropic`, was caught by `chatStream`, re-emitted
as a RUN_ERROR frame, and thrown at the user by chat-stream.ts:169-173.

Net effect: every frontier-tier turn on /api/chat and /api/digest-chat
failed on the first message. Not a silent hijack — Anthropic's hosted
search was never reached either. The upgrade plan's §0.1 said "No error;
different results"; that is corrected in this commit.

Reachable since ADR 0011 made video-chat and digest-chat switchable. Before
that, both were type-locked local and this code path could not execute.

Renamed to `kb_web_search`, not `search_web` as originally proposed. Clearing
today's seven-word reserved list is not the property worth buying — the
collision happened because a generic name landed in a provider-owned
namespace, and `search_web` is exactly as generic. An application-owned `kb_`
prefix is collision-proof against adapters that don't exist yet.
ai-anthropic 0.18.0+ switches on adapter-owned metadata rather than the raw
name, which removes the crash on upgrade; the prefix is kept regardless.

Renamed at every reference: the toolDefinition and its log line
(chat-tools.ts), the grounding prompt that names it to the model
(learning.ts:1393), the `/web` slash-command trigger (VideoChat.tsx:58),
four comments, and the SSE parser test fixtures.

Added chat-tools.test.ts: asserts the tool is not named anything the
Anthropic adapter treats as a hosted tool, that the name matches the
function-tool charset every provider enforces, and that the video-chat
system prompt names the tool exactly as it is registered — the last one
catches prompt/tool drift, which would stall the agent loop silently.

No stored data is affected. Audited every persistence site: VideoChat and
DigestChat hold conversations in React state only; useLibraryChat's
localStorage schema has no toolCalls field and its surface uses
library-tools, not this tool; notes strip to {role, content} before saving;
`grep -rn "toolCall" server/src` is empty and Strapi has no conversation
content type.

No dependency changes. Pins stay at @tanstack/ai 0.45.1 / ai-anthropic
0.16.6 / ai-ollama 0.9.1 — the ≥0.48 upgrade and its required chat-stream.ts
parser rewrite are Phase 1.

Verified: 1220/1220 client tests pass (was 1217, +3 new); tsc --noEmit
clean; manual smoke on all three affected paths — local video chat,
frontier video chat, frontier digest chat — each logging
`[tool kb_web_search] "..." → N results` and rendering the tool chip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF</parameter>
```

Adjust the `1220/1220` and `+3` figures if your baseline differs from the `50 files / 1217 tests` measured on this tree.

---

## Phase 1 — Core SDK upgrade + `chat-stream.ts` parser patch, landed together

**Goal:** Bump `@tanstack/ai` 0.45.1→0.49.1, `@tanstack/ai-anthropic` 0.16.6→0.18.0, `@tanstack/ai-ollama` 0.9.1→0.10.0 and, in the same commit, rewrite the tool-call section of the SSE parser so it reads the spec-only wire the new core emits — with the new fixtures cut from captured frames, not written by hand.

**Files touched:**
- `/Users/paul/projects/music-kb/client/package.json`
- `/Users/paul/projects/music-kb/client/yarn.lock`
- `/Users/paul/projects/music-kb/client/src/lib/services/chat-stream.ts`
- `/Users/paul/projects/music-kb/client/src/lib/services/chat-stream.test.ts`
- `/Users/paul/projects/music-kb/client/src/lib/services/chat-tools.anthropic-dispatch.test.ts` *(new)*
- `/Users/paul/projects/music-kb/client/verify-sse.mjs`
- `/Users/paul/projects/music-kb/client/src/lib/services/frontier-model.ts` *(comment block only)*
- `/Users/paul/projects/music-kb/client/src/lib/services/frontier-model.test.ts` *(two version strings)*
- `/Users/paul/projects/music-kb/client/src/lib/services/model-policy.tiers.test.ts` *(two version strings)*
- `/Users/paul/projects/music-kb/docs/ai-architecture.md` *(version table + pin paragraph)*

**Prerequisites:** None. This phase is standalone and is worth landing even if every later phase is cancelled. It does **not** depend on the `web_search` → `search_web` rename (Phase 0 in `docs/tanstack-ai-upgrade-plan.md`); Task 1.5 below proves the rename is no longer load-bearing, but does not perform it.

**Estimated effort:** 1–2 days (most of it Task 1.3 — capturing real frames and re-cutting fixtures).

---

### Facts this phase is built on (verified in the reference clone, cite these if something surprises you)

| Fact | Source |
|---|---|
| SSE wire is spec-only; `toServerSentEventsResponse` pushes every chunk through `toWireChunk` → `normalizeStreamChunk` + `stripToSpec` | `/Users/paul/learning/tanstack-ai/.reference/tanstack-ai/packages/ai/src/stream-to-response.ts:11`, `.../packages/ai/src/strip-to-spec-middleware.ts:17,55` |
| `TOOL_CALL_START` keeps `toolCallId`, `toolCallName`, `parentMessageId` (+ shared `type`/`timestamp`/`rawEvent`/`metadata`) | `.../packages/ai/src/utilities/spec-event-keys.ts:20-22` |
| `TOOL_CALL_ARGS` keeps `toolCallId`, `delta` | `.../packages/ai/src/utilities/spec-event-keys.ts:23` |
| `TOOL_CALL_END` keeps **`toolCallId` only** | `.../packages/ai/src/utilities/spec-event-keys.ts:24` |
| `TOOL_CALL_RESULT` keeps `messageId`, `toolCallId`, `content`, `role` | `.../packages/ai/src/utilities/spec-event-keys.ts:27-30` |
| A legacy `toolName` on `TOOL_CALL_START` is folded into `toolCallName` and then dropped, so START still carries a name | `.../packages/ai/src/utilities/normalize-stream-chunk.ts:76-80,118-121` |
| `TOOL_CALL_START` is guaranteed to precede every `TOOL_CALL_ARGS` for the same id | `.../packages/ai/src/activities/chat/stream/processor.ts:1349` |
| The SDK's own client reads input as `chunk.input` **else** `metadata.tanstack.input` — the parser below mirrors this | `.../packages/ai/src/activities/chat/stream/processor.ts:1496-1502` |
| `ai-anthropic` 0.18.0 dispatches on `getAnthropicProviderToolKind(tool)` (i.e. `tool.metadata.__kind`), **not** `tool.name` | `.../packages/ai-anthropic/src/tools/tool-converter.ts:41-59`, `.../packages/ai-anthropic/src/tools/anthropic-provider-tool.ts:36-58` |
| That was PR #932, shipped in `@tanstack/ai@0.46.0` / `ai-anthropic@0.16.7` | `.../packages/ai-anthropic/CHANGELOG.md` (0.16.7 entry) |
| `createAnthropicChat(model, apiKey, config?)` and `createOllamaChat(model, hostOrConfig?)` signatures are **unchanged** | `.../packages/ai-anthropic/src/adapters/text.ts:1509-1521`, `.../packages/ai-ollama/src/adapters/text.ts:586-591` |
| `ANTHROPIC_MODELS` is the same 12 ids in the same order at 0.18.0 | `.../packages/ai-anthropic/src/model-meta.ts:563-577` |
| `@opentelemetry/api` peer is optional at 0.49.1 as it was at 0.45.1 | `.../packages/ai/package.json` `peerDependenciesMeta` |
| `chat({ adapter, messages, ... })` + `toServerSentEventsResponse(stream)` is exactly how a working 0.49.1 app calls it | `/Users/paul/learning/tanstack-ai/tanstack-client/src/lib/chat.functions.ts:40,76` |

---

### Task 1.1 — Capture the CURRENT wire, before touching anything

- [ ] **Step 1: Confirm the baseline is green and clean**

```bash
cd /Users/paul/projects/music-kb && git status --short
cd /Users/paul/projects/music-kb/client && npx vitest run 2>&1 | tail -5
cd /Users/paul/projects/music-kb/client && npx tsc --noEmit -p tsconfig.json && echo "TYPECHECK OK"
```

Expected: `git status --short` prints nothing; vitest prints `Test Files 50 passed (50)` and `Tests 1217 passed (1217)`; `TYPECHECK OK`.

- [ ] **Step 2: Replace `client/verify-sse.mjs` with a version that dumps whole frames**

The current file (`/Users/paul/projects/music-kb/client/verify-sse.mjs`) prints only `type | keys:`, which is enough to *detect* the change but not enough to *re-cut fixtures from*. Overwrite it with the file below. It keeps the existing key-set line verbatim and adds a `RAW ` line carrying the exact JSON payload of every `TOOL_CALL_*` frame, so a fixture can be copy-pasted rather than invented.

Write `/Users/paul/projects/music-kb/client/verify-sse.mjs`:

```js
// Captures the REAL SSE wire shape of a tool-calling run.
//
// This exists because chat-stream.test.ts's tool fixtures are hand-authored
// strings: they stay green through a wire-format change, which is exactly the
// regression @tanstack/ai 0.48.0 introduced (TOOL_CALL_END went spec-only).
// Fixtures must be cut from THIS script's output, never written from memory.
//
// Run it BEFORE and AFTER the dependency bump and diff the two transcripts.
//
//   Requires: Ollama on http://localhost:11434 with `llama3.2:3b` pulled.
//   Usage:    cd client && node verify-sse.mjs
//   Usage:    cd client && node verify-sse.mjs > /tmp/sse-before.txt

import { chat, toolDefinition, toServerSentEventsResponse } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { z } from 'zod';

let executed = false;

const tool = toolDefinition({
  name: 'web_search',
  description: 'Search the web for current information.',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
}).server(async ({ query }) => {
  executed = true;
  return { results: [`RESULT_MARKER for ${query}`] };
});

const stream = chat({
  adapter: createOllamaChat('llama3.2:3b', 'http://localhost:11434'),
  messages: [
    { role: 'user', content: 'What year was Berklee founded? Use web_search.' },
  ],
  tools: [tool],
});

const res = toServerSentEventsResponse(stream);
const text = await res.text();

let toolFrames = 0;
for (const line of text.split('\n')) {
  if (!line.startsWith('data:')) continue;
  const p = line.slice(5).trim();
  if (!p || p === '[DONE]') continue;
  let e;
  try {
    e = JSON.parse(p);
  } catch {
    continue;
  }
  if (!String(e.type).startsWith('TOOL_CALL')) continue;
  toolFrames += 1;
  console.log(e.type, '| keys:', Object.keys(e).join(','));
  // RAW is the fixture source. Copy these lines into chat-stream.test.ts.
  console.log('RAW', p);
}

console.log('---');
console.log('TOOL_CALL_* frames seen:', toolFrames);
console.log('local executor actually ran:', executed);
```

- [ ] **Step 3: Make sure Ollama can serve the run**

```bash
curl -s http://localhost:11434/api/tags > /dev/null && echo "OLLAMA UP" || echo "OLLAMA DOWN — start it before continuing"
ollama list | grep -q 'llama3.2:3b' || ollama pull llama3.2:3b
```

- [ ] **Step 4: Capture the BEFORE transcript**

```bash
cd /Users/paul/projects/music-kb/client && node verify-sse.mjs > /tmp/sse-before.txt 2>&1; cat /tmp/sse-before.txt
```

What to look for in `/tmp/sse-before.txt` (this is 0.45.1, the wire we are leaving):
- a `TOOL_CALL_END | keys: ...` line whose key list **contains `toolName` and `input`**;
- `local executor actually ran: true`.

If `TOOL_CALL_* frames seen: 0`, llama3.2:3b declined to call the tool on this run. Re-run the script (the model is nondeterministic). If three consecutive runs emit zero tool frames, try a stronger local model by changing `'llama3.2:3b'` in `verify-sse.mjs` to a tool-capable model from `ollama list` (e.g. `qwen3:14b`) and note in the commit message which model produced the transcript. **Do not proceed to Task 1.3 without a non-empty transcript** — the whole point of this phase is fixtures cut from real frames.

---

### Task 1.2 — Bump the three packages

- [ ] **Step 1: Install the new versions (exact pins, Yarn 1 workspace at `client/`)**

```bash
cd /Users/paul/projects/music-kb/client && yarn add --exact @tanstack/ai@0.49.1 @tanstack/ai-anthropic@0.18.0 @tanstack/ai-ollama@0.10.0
```

- [ ] **Step 2: Verify the installed versions**

```bash
cd /Users/paul/projects/music-kb/client && node -e "for (const p of ['@tanstack/ai','@tanstack/ai-anthropic','@tanstack/ai-ollama','@anthropic-ai/sdk']) console.log(p, require('./node_modules/'+p+'/package.json').version)"
```

Expected output, exactly:

```
@tanstack/ai 0.49.1
@tanstack/ai-anthropic 0.18.0
@tanstack/ai-ollama 0.10.0
@anthropic-ai/sdk 0.97.1
```

`@anthropic-ai/sdk` is already 0.97.1 in this repo and `ai-anthropic@0.18.0` depends on `^0.97.1`, so it must not move. If it does move, stop and report — `model-policy.tiers.test.ts:184-190` documents its behaviour (`adapter.client.apiKey` reachable at inspect depth 2) and that claim would need re-measuring.

- [ ] **Step 3: Confirm `package.json` pins are exact (no `^`)**

```bash
cd /Users/paul/projects/music-kb/client && grep -n '"@tanstack/ai' package.json
```

Expected to contain, with no caret:

```
    "@tanstack/ai": "0.49.1",
    "@tanstack/ai-anthropic": "0.18.0",
    "@tanstack/ai-ollama": "0.10.0",
```

If `yarn add --exact` still wrote a caret, edit `package.json` by hand to remove it and re-run `yarn install`.

- [ ] **Step 4: Typecheck — this is where a real API break would surface**

```bash
cd /Users/paul/projects/music-kb/client && npx tsc --noEmit -p tsconfig.json && echo "TYPECHECK OK"
```

Expected: `TYPECHECK OK`. The eleven `@tanstack/ai` call sites use `chat()`, `toolDefinition()`, `toServerSentEventsResponse()`, `createOllamaChat(model, host)`, `createAnthropicChat(model, key)`, `ANTHROPIC_MODELS` and `AnthropicChatModel` — every one of those has an unchanged signature at these versions (see the fact table). If typecheck fails, the failure is new information: report the exact error rather than working around it.

- [ ] **Step 5: Run the suite and expect the LATENT defect to still hide**

```bash
cd /Users/paul/projects/music-kb/client && npx vitest run 2>&1 | tail -5
```

Expected: still `1217 passed`. **This green is the bug.** The parser is now broken against the real wire and no test says so. Do not stop here.

- [ ] **Step 6: Capture the AFTER transcript**

```bash
cd /Users/paul/projects/music-kb/client && node verify-sse.mjs > /tmp/sse-after.txt 2>&1; cat /tmp/sse-after.txt
diff /tmp/sse-before.txt /tmp/sse-after.txt
```

What MUST be true in `/tmp/sse-after.txt`:
- the `TOOL_CALL_END | keys:` line **no longer lists `toolName`, and no longer lists `input`**;
- a `TOOL_CALL_ARGS | keys:` line exists and lists `toolCallId` and `delta`;
- the `TOOL_CALL_START | keys:` line lists `toolCallName` (not `toolName`);
- `local executor actually ran: true`.

Derived from `spec-event-keys.ts:20-30`, the shape should be close to:

```
TOOL_CALL_START | keys: type,timestamp,toolCallId,toolCallName
TOOL_CALL_ARGS | keys: type,timestamp,toolCallId,delta
TOOL_CALL_END | keys: type,timestamp,toolCallId
TOOL_CALL_RESULT | keys: type,timestamp,messageId,toolCallId,content,role
```

**I am NOT certain of the exact key ORDER, nor whether `timestamp` / `metadata` / `parentMessageId` appear on every frame** — `stripToSpec` copies only keys the adapter actually set, and `normalizeStreamChunk` can attach a `metadata.tanstack` object. The captured transcript is authoritative; the block above is a sanity check, not a spec. Use `/tmp/sse-after.txt` for the fixtures in Task 1.3.

If `TOOL_CALL_ARGS` frames do **not** appear at all in the after transcript, note that in the commit body and check whether `TOOL_CALL_END` carries a `metadata` key — the parser written in Task 1.3 handles that case via `metadata.tanstack.input`, mirroring `processor.ts:1496-1502`.

---

### Task 1.3 — Rewrite the tool-call section of `chat-stream.ts`

All edits are to `/Users/paul/projects/music-kb/client/src/lib/services/chat-stream.ts`. **The exported `StreamEvent` union (lines 39-57) does not change** — `VideoChat.tsx`, `DigestChat.tsx`, `NoteComposer.tsx` and `useLibraryChat.ts` are untouched in this phase.

- [ ] **Step 1: Create per-stream tool state in the generator**

Current, `chat-stream.ts:76-79`:

```ts
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
```

Replace with:

```ts
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Tool-call state is PER STREAM, not per frame — which is why this parser
  // can no longer be stateless. Since @tanstack/ai 0.48.0 the SSE wire is
  // spec-only (`stripToSpec`): TOOL_CALL_END carries `toolCallId` and nothing
  // else. The tool's NAME now only ever appears on TOOL_CALL_START, and its
  // ARGUMENTS only ever appear as the concatenation of the TOOL_CALL_ARGS
  // `delta` strings in between. Neither is recoverable from the END frame.
  // Verified against @tanstack/ai 0.49.1,
  // packages/ai/src/utilities/spec-event-keys.ts:20-24.
  const tools = createToolCallState();
  try {
```

- [ ] **Step 2: Thread the state through both parse call sites**

Current, `chat-stream.ts:88`:

```ts
        const event = parseSseEventBlock(eventBlock);
```

Replace with:

```ts
        const event = parseSseEventBlock(eventBlock, tools);
```

Current, `chat-stream.ts:96`:

```ts
    const tail = parseSseEventBlock(buffer);
```

Replace with:

```ts
    const tail = parseSseEventBlock(buffer, tools);
```

- [ ] **Step 3: Update the parser's doc comment and signature**

Current, `chat-stream.ts:107-113`:

```ts
// Parse one SSE event block (newline-joined `data:` lines) into a typed
// event, null to skip — or throw, for RUN_ERROR frames. The AG-UI wire
// format has had two field-name dialects observed in the wild —
// `toolName` / `input` vs. `toolCallName` / `args` — so we accept both
// shapes via `??` fallbacks. Keeps the parser robust to upstream
// TanStack AI version drift.
function parseSseEventBlock(block: string): StreamEvent | null {
```

Replace with:

```ts
// Parse one SSE event block (newline-joined `data:` lines) into a typed
// event, null to skip — or throw, for RUN_ERROR frames.
//
// `tools` carries the cross-frame state the spec-only wire forces on us: the
// tool name from TOOL_CALL_START and the accumulating TOOL_CALL_ARGS buffer,
// both keyed by toolCallId. A TOOL_CALL_ARGS frame therefore returns null
// (it is consumed into state, not surfaced) and TOOL_CALL_END reads back out
// of it.
//
// Three wire dialects are accepted, newest first:
//   0.48+  START.toolCallName + ARGS.delta… + END{toolCallId} + RESULT.content
//   0.45   START.toolName     + END.input                     + RESULT.content
//   <=0.10 START.toolCallName + END.args + END.result
// The older two survive as `??` fallbacks because they cost two lines each
// and because a wrong guess here is silent — see the empty-tool-card
// regression this function's fixtures failed to catch.
function parseSseEventBlock(
  block: string,
  tools: ToolCallState,
): StreamEvent | null {
```

- [ ] **Step 4: Replace the `TOOL_CALL_START` and `TOOL_CALL_END` cases**

Current, `chat-stream.ts:175-197` (the `TOOL_CALL_RESULT` case at 198-213 stays exactly as it is):

```ts
    case 'TOOL_CALL_START': {
      const id = event.toolCallId;
      const name = event.toolName ?? event.toolCallName;
      return id && name ? { kind: 'tool_start', id, name } : null;
    }
    case 'TOOL_CALL_END': {
      const id = event.toolCallId;
      // tool_end is the source of truth for `input` (TOOL_CALL_ARGS
      // events stream args incrementally; we ignore those).
      //
      // `result` is read defensively: up to 0.10 the result rode along on
      // this frame, but 0.45 sends it separately as TOOL_CALL_RESULT (see
      // below). Keeping the fallback means both dialects work.
      const name = event.toolName ?? event.toolCallName ?? '';
      if (!id) return null;
      return {
        kind: 'tool_end',
        id,
        name,
        input: event.input ?? event.args ?? null,
        result: event.result ?? null,
      };
    }
```

Replace with:

```ts
    case 'TOOL_CALL_START': {
      const id = event.toolCallId;
      // 0.49.1 emits `toolCallName`. `toolName` is the pre-0.48 alias, which
      // normalizeStreamChunk now folds INTO `toolCallName` before the wire
      // (packages/ai/src/utilities/normalize-stream-chunk.ts:76-80), so the
      // newer key is read first and the alias is the fallback.
      const name = event.toolCallName ?? event.toolName;
      if (!id || !name) return null;
      tools.names.set(id, name);
      // START is guaranteed to arrive before any ARGS frame for this id
      // (@tanstack/ai 0.49.1, chat/stream/processor.ts:1349), so this is the
      // correct place to (re)initialise the buffer — and doing it here means
      // a re-used toolCallId cannot concatenate two runs' arguments.
      tools.args.set(id, '');
      return { kind: 'tool_start', id, name };
    }
    case 'TOOL_CALL_ARGS': {
      // Arguments stream as raw JSON-text deltas. Accumulate; surface nothing.
      // Returning null here is not "dropping the frame" — this frame IS the
      // input, and TOOL_CALL_END below is where it becomes visible.
      const id = event.toolCallId;
      if (!id || typeof event.delta !== 'string') return null;
      tools.args.set(id, (tools.args.get(id) ?? '') + event.delta);
      return null;
    }
    case 'TOOL_CALL_END': {
      const id = event.toolCallId;
      if (!id) return null;
      // The spec-only END frame carries the id alone. Name comes from the
      // START we recorded; the `??` chain covers the older dialects that did
      // repeat it on this frame.
      const name =
        tools.names.get(id) ?? event.toolCallName ?? event.toolName ?? '';

      // Input, in priority order:
      //  1. the accumulated TOOL_CALL_ARGS buffer  (0.48+ — the normal path)
      //  2. a parsed `input` on the frame          (pre-0.48 dialect)
      //  3. `metadata.tanstack.input`              (adapters that only stamp
      //     it into TanStack metadata — Anthropic server_tool_use /
      //     web_search; the SDK's own reader does exactly this fallback, see
      //     packages/ai/src/activities/chat/stream/processor.ts:1496-1502)
      //  4. `args`                                 (<=0.10 dialect)
      // A buffer that fails JSON.parse falls through rather than throwing:
      // a truncated arg stream must render an empty tool card, never kill the
      // whole response.
      const buffered = tools.args.get(id) ?? '';
      let input: unknown = null;
      let parsed = false;
      if (buffered.trim().length > 0) {
        try {
          input = JSON.parse(buffered) as unknown;
          parsed = true;
        } catch {
          parsed = false;
        }
      }
      if (!parsed) {
        input =
          event.input ?? tanstackInput(event) ?? event.args ?? null;
      }

      // `result` stays defensively read: up to 0.10 the result rode along on
      // this frame; 0.45+ sends it separately as TOOL_CALL_RESULT (below).
      return {
        kind: 'tool_end',
        id,
        name,
        input,
        result: event.result ?? null,
      };
    }
```

- [ ] **Step 5: Add the state type and the metadata reader**

Insert the block below immediately **after** the closing `}` of `parseSseEventBlock` (currently `chat-stream.ts:217`) and **before** the comment `// Loose shape of an AG-UI event JSON.` (currently line 219):

```ts
// Cross-frame tool-call state for one stream. Two maps, both keyed by
// toolCallId: the name captured from TOOL_CALL_START, and the raw JSON text
// accumulated from TOOL_CALL_ARGS deltas.
//
// Entries are NOT deleted at TOOL_CALL_END. A stream carries a handful of
// tool calls at most, so the memory is trivial, and keeping them means a
// duplicated or re-ordered END frame still resolves to the right name and
// input instead of a blank card. Re-initialisation happens on START, which
// the SDK guarantees precedes every ARGS frame for that id.
type ToolCallState = {
  names: Map<string, string>;
  args: Map<string, string>;
};

function createToolCallState(): ToolCallState {
  return { names: new Map(), args: new Map() };
}

// Read `metadata.tanstack.input` off a TOOL_CALL_END frame. Since 0.48.0
// non-spec keys are moved under `metadata.tanstack` rather than dropped
// (packages/ai/src/utilities/normalize-stream-chunk.ts:118-136), which is
// where an adapter that delivers the whole input on END — Anthropic's
// server_tool_use path — leaves it when no ARGS deltas were streamed.
function tanstackInput(event: AgUiEvent): unknown {
  const tanstack = event.metadata?.tanstack;
  if (tanstack && typeof tanstack === 'object' && 'input' in tanstack) {
    return (tanstack as { input?: unknown }).input;
  }
  return undefined;
}
```

- [ ] **Step 6: Extend the `AgUiEvent` shape with `metadata`**

Current, `chat-stream.ts:230-232`:

```ts
  input?: unknown;
  args?: unknown;
  result?: string | null;
```

Replace with:

```ts
  input?: unknown;
  args?: unknown;
  result?: string | null;
  // Since @tanstack/ai 0.48.0 every non-spec key an adapter set is moved
  // under `metadata.tanstack` instead of being dropped. `input` can land
  // there on TOOL_CALL_END; see `tanstackInput` above.
  metadata?: { tanstack?: Record<string, unknown> } | null;
```

- [ ] **Step 7: Typecheck**

```bash
cd /Users/paul/projects/music-kb/client && npx tsc --noEmit -p tsconfig.json && echo "TYPECHECK OK"
```

Expected: `TYPECHECK OK`. `noUnusedLocals` and `noUnusedParameters` are on (`client/tsconfig.json`), so an unused helper is a hard error, not a warning.

- [ ] **Step 8: Run the existing tests and expect ONE named failure**

```bash
cd /Users/paul/projects/music-kb/client && npx vitest run src/lib/services/chat-stream.test.ts 2>&1 | tail -30
```

Expected: 23 of 24 pass, and **`parses tool_start + tool_end with \`toolName\` + \`input\` (VideoChat dialect)`** (`chat-stream.test.ts:57`) fails with `input: {"query":"foo"}` received as `null`. That is correct and expected: that fixture's `TOOL_CALL_START` has no `toolCallName`, so `tools.names` is empty for `t1` — wait, it carries `toolName`, so the name resolves; the failure is on `input`, because the fixture provides no `TOOL_CALL_ARGS` frame and its `input` lives on the END frame — which step 4's priority-2 fallback *does* read.

**If instead all 24 pass, that is also fine** — the fallback chain is doing its job on the legacy fixture. Either result is acceptable at this step. What is NOT acceptable is skipping Task 1.4: whichever way this goes, the current fixtures do not exercise the 0.49.1 wire at all.

---

### Task 1.4 — Re-cut `chat-stream.test.ts`'s tool fixtures from the CAPTURED output

All edits are to `/Users/paul/projects/music-kb/client/src/lib/services/chat-stream.test.ts`.

- [ ] **Step 1: Read the captured frames you will paste**

```bash
grep '^RAW ' /tmp/sse-after.txt
```

Each line is `RAW ` followed by the exact JSON payload of one `TOOL_CALL_*` frame, in stream order. These payloads — not the illustrative ones below — are what goes into the fixture. Copy them verbatim.

- [ ] **Step 2: Replace the stale VideoChat-dialect test with the captured 0.49.1 shape**

Current, `chat-stream.test.ts:57-75`:

```ts
  it('parses tool_start + tool_end with `toolName` + `input` (VideoChat dialect)', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1","toolName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"t1","toolName":"web_search","input":{"query":"foo"},"result":"[]"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 't1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 't1',
        name: 'web_search',
        input: { query: 'foo' },
        result: '[]',
      },
    ]);
  });
```

Replace with the block below, **after substituting your own captured `RAW` payloads into the four `data: …` strings**. The payloads shown are the shape `spec-event-keys.ts:20-30` produces; if your capture differs in any key or key order, use the capture and adjust the `expect` accordingly:

```ts
  it('parses a 0.49.1 spec-only tool call: name from START, input from ARGS deltas', async () => {
    // FIXTURE PROVENANCE: captured from `cd client && node verify-sse.mjs`
    // against @tanstack/ai 0.49.1 + @tanstack/ai-ollama 0.10.0 driving
    // llama3.2:3b through toServerSentEventsResponse. NOT hand-written.
    //
    // This is the frame set the previous fixture could not represent: since
    // 0.48.0 `stripToSpec` reduces TOOL_CALL_END to `{ type, timestamp,
    // toolCallId }` (packages/ai/src/utilities/spec-event-keys.ts:24). The
    // tool NAME survives only on START and the ARGUMENTS only as the
    // concatenation of the ARGS `delta` strings. A parser that reads
    // `event.toolName` / `event.input` off END gets '' and null — silently,
    // which is how the old fixture stayed green through the regression.
    //
    // If you re-capture and the payloads below differ, REPLACE them. Do not
    // reconcile a capture to this fixture; reconcile this fixture to the
    // capture.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","timestamp":1756300000000,"toolCallId":"call_1","toolCallName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_ARGS","timestamp":1756300000001,"toolCallId":"call_1","delta":"{\\"query\\":\\"be"}\n\n',
        'data: {"type":"TOOL_CALL_ARGS","timestamp":1756300000002,"toolCallId":"call_1","delta":"rklee\\"}"}\n\n',
        'data: {"type":"TOOL_CALL_END","timestamp":1756300000003,"toolCallId":"call_1"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_1',
        name: 'web_search',
        input: { query: 'berklee' },
        result: null,
      },
    ]);
  });

  it('accumulates ARGS deltas that straddle a chunk boundary', async () => {
    // The split above is inside a JSON string; this one splits the byte
    // stream mid-frame as well, so the SSE buffering and the args buffering
    // are exercised at once. A parser that JSON.parse'd each delta on its
    // own would pass the previous test and fail this one.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_2","toolCallName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_ARGS","toolCallId":"call_2","delta":"{\\"que',
        'ry\\":\\"modal inter"}\n\ndata: {"type":"TOOL_CALL_ARGS","toolCallId":"call_2","delta":"change\\"}"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_2"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_2', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_2',
        name: 'web_search',
        input: { query: 'modal interchange' },
        result: null,
      },
    ]);
  });

  it('a truncated ARGS buffer yields a null input, not a thrown stream', async () => {
    // Cancelled or dropped runs leave half a JSON object in the buffer. That
    // must degrade to an empty tool card, never take the whole response with
    // it — the parser is the single transport for four surfaces.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_3","toolCallName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_ARGS","toolCallId":"call_3","delta":"{\\"query\\":\\"unclo"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_3"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_3', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_3',
        name: 'web_search',
        input: null,
        result: null,
      },
    ]);
  });

  it('reads input from metadata.tanstack.input when no ARGS deltas streamed', async () => {
    // Adapters that deliver the whole input on END rather than streaming it
    // (Anthropic server_tool_use / web_search) have it moved under
    // `metadata.tanstack` by normalizeStreamChunk rather than dropped. The
    // SDK's own stream reader applies exactly this fallback —
    // packages/ai/src/activities/chat/stream/processor.ts:1496-1502.
    //
    // NOTE: this fixture is derived from SDK source, NOT captured — the
    // Ollama capture in verify-sse.mjs streams ARGS deltas and so never
    // exercises this branch. Re-cut it from a live Anthropic run if one is
    // ever available.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_4","toolCallName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_4","metadata":{"tanstack":{"input":{"query":"borrowed chords"}}}}\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_4', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_4',
        name: 'web_search',
        input: { query: 'borrowed chords' },
        result: null,
      },
    ]);
  });

  it('a TOOL_CALL_ARGS frame surfaces no event of its own', async () => {
    // ARGS is consumed into parser state. It must not reach a consumer:
    // VideoChat.tsx:232-256 and DigestChat.tsx:111-137 switch exhaustively
    // on `kind`, and an unrecognised event would be silently ignored there —
    // so a leak would show up as a duplicated tool card, not an error.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_ARGS","toolCallId":"orphan","delta":"{}"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([]);
  });
```

- [ ] **Step 3: Retitle the legacy-dialect test so it says what it now guards**

Current, `chat-stream.test.ts:77`:

```ts
  it('parses tool_start + tool_end with `toolCallName` + `args` (DigestChat dialect)', async () => {
```

Replace that single line with:

```ts
  it('LEGACY <=0.10 dialect: name and `args` repeated on TOOL_CALL_END', async () => {
```

Leave the body of that test (lines 78-95) unchanged — it pins the `??` fallback chain, which the rewrite keeps.

- [ ] **Step 4: Re-cut the TOOL_CALL_RESULT test onto the 0.49.1 frame set**

Current, `chat-stream.test.ts:233-258`:

```ts
  it('emits tool_result from the separate TOOL_CALL_RESULT frame (0.45)', async () => {
    // 0.45 splits the tool result off TOOL_CALL_END onto its own frame:
    // TOOL_CALL_END carries `input` and no result, then TOOL_CALL_RESULT
    // arrives with `content` keyed by toolCallId. Dropping that frame left
    // every tool call with result === null, which the UI renders as no
    // output panel at all. Frame shapes captured from a live llama3.2:3b
    // run through toServerSentEventsResponse.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_1","toolName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_1","toolName":"web_search","input":{"query":"berklee"}}\n\n',
        'data: {"type":"TOOL_CALL_RESULT","toolCallId":"call_1","content":"{\\"results\\":[\\"1945\\"]}"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_1',
        name: 'web_search',
        input: { query: 'berklee' },
        result: null,
      },
      { kind: 'tool_result', id: 'call_1', result: '{"results":["1945"]}' },
    ]);
  });
```

Replace with (again: substitute your own captured `RAW` payloads for the four `data:` strings if they differ):

```ts
  it('emits tool_result from the separate TOOL_CALL_RESULT frame (0.49.1)', async () => {
    // FIXTURE PROVENANCE: captured from `cd client && node verify-sse.mjs`
    // against @tanstack/ai 0.49.1 + @tanstack/ai-ollama 0.10.0. NOT written.
    //
    // The result rides its own frame, keyed by toolCallId with the payload in
    // `content` (packages/ai/src/utilities/spec-event-keys.ts:27-30 and
    // packages/ai/src/activities/chat/index.ts:3100-3106, which stringifies
    // the executor's return value into `content`). Dropping this frame left
    // every tool call at result === null forever, and the UI hides the output
    // panel in that case — the tool silently appeared to return nothing.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_1","toolCallName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_ARGS","toolCallId":"call_1","delta":"{\\"query\\":\\"berklee\\"}"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_1"}\n\n',
        'data: {"type":"TOOL_CALL_RESULT","messageId":"msg_1","toolCallId":"call_1","content":"{\\"results\\":[\\"1945\\"]}","role":"tool"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 'call_1',
        name: 'web_search',
        input: { query: 'berklee' },
        result: null,
      },
      { kind: 'tool_result', id: 'call_1', result: '{"results":["1945"]}' },
    ]);
  });
```

- [ ] **Step 5: Retitle the pre-0.45 result test**

Current, `chat-stream.test.ts:260`:

```ts
  it('still reads a result carried on TOOL_CALL_END (pre-0.45 dialect)', async () => {
```

Replace that single line with:

```ts
  it('LEGACY pre-0.45 dialect: result carried inline on TOOL_CALL_END', async () => {
```

Leave its body (lines 261-269) unchanged.

- [ ] **Step 6: Run the file**

```bash
cd /Users/paul/projects/music-kb/client && npx vitest run src/lib/services/chat-stream.test.ts 2>&1 | tail -20
```

Expected: `Tests 28 passed (28)` — the 24 that were there, minus the one replaced test, plus the five new ones. If a count other than 28 appears, recount your edits before adjusting any assertion.

---

### Task 1.5 — Prove frontier `web_search` now reaches music-kb's own executor

This is the check for defect (A). At `ai-anthropic@0.16.6` the converter switched on `tool.name`, so music-kb's tool — named `web_search` at `/Users/paul/projects/music-kb/client/src/lib/services/chat-tools.ts:36` — was converted into Anthropic's HOSTED search (`type: 'web_search_20250305'`) and its `.server()` executor was never reached on the Anthropic path.

Quoting the shipped 0.16.6 build, `client/node_modules/@tanstack/ai-anthropic/dist/esm/tools/tool-converter.js:35-46`:

```js
	return tools.map((tool) => {
		switch (tool.name) {
			...
			case "web_search": return convertWebSearchToolToAdapterFormat(tool);
			default: return convertCustomToolToAdapterFormat(tool);
		}
	});
```

At 0.18.0 the same function reads `getAnthropicProviderToolKind(tool)`, which reads `tool.metadata.__kind` — adapter-owned metadata that only the `webSearchTool()` factory sets.

- [ ] **Step 1: Write the regression test**

Create `/Users/paul/projects/music-kb/client/src/lib/services/chat-tools.anthropic-dispatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { convertToolsToProviderFormat } from '@tanstack/ai-anthropic';
import type { Tool } from '@tanstack/ai';
import { webSearchTool } from '#/lib/services/chat-tools';

// DEFECT (A), closed by the 0.18.0 bump.
//
// @tanstack/ai-anthropic 0.16.6 converted tools by switching on `tool.name`
// (dist/esm/tools/tool-converter.js:36). Our tool is literally named
// 'web_search' (chat-tools.ts:36), so on the Anthropic path it was rewritten
// into Anthropic's HOSTED search — `{ name: 'web_search', type:
// 'web_search_20250305' }` — losing its inputSchema and, crucially, its
// `.server()` executor. No error, different results, and the
// `[tool web_search]` log line at chat-tools.ts:47 never printed.
//
// This became reachable when ADR 0011 made video-chat model-switchable; it
// was unreachable while the surface was type-locked local.
//
// 0.18.0 (via PR #932, shipped in @tanstack/ai 0.46.0 / ai-anthropic 0.16.7)
// dispatches on `getAnthropicProviderToolKind(tool)` — i.e. `tool.metadata
// .__kind`, a discriminator only the adapter's own `webSearchTool()` factory
// stamps on. A plain function keeps its name and stays a custom tool.
//
// SCOPE OF THIS TEST: it pins the BRANCH the converter takes, which is the
// whole of the defect. It does NOT reproduce `input_schema` faithfully —
// chat() converts the Zod schema to JSON Schema before handing tools to the
// adapter (@tanstack/ai 0.49.1, packages/ai/src/activities/chat/index.ts:
// 1452-1460), and this calls the converter directly with the Zod schema
// still attached. Assert on the branch, not on the schema contents.
//
// The cast is required because the app's tool is a ServerTool (it carries
// `__toolSide` and `execute`); the converter's parameter type is the
// narrower public `Tool`. The extra fields are ignored by the converter.
describe('the app web_search tool on the Anthropic path', () => {
  it('converts as a CUSTOM function, not as Anthropic hosted search', () => {
    const [converted] = convertToolsToProviderFormat([
      webSearchTool as unknown as Tool,
    ]);

    expect(converted).toMatchObject({ name: 'web_search', type: 'custom' });
    // The hosted converter emits `type: 'web_search_20250305'` and NO
    // `input_schema`. Both halves are asserted: a converter that returned a
    // bare `{ name, type }` would satisfy the first assertion alone.
    expect(converted).not.toMatchObject({ type: 'web_search_20250305' });
    expect(converted).toHaveProperty('input_schema');
  });

  it('the tool still carries no adapter-owned provider discriminator', () => {
    // The 0.18.0 dispatch reads `tool.metadata.__kind`. Our tool is built by
    // `toolDefinition().server()`, which sets no metadata at all — so if a
    // future edit ever adds a `metadata` field to chat-tools.ts, this fails
    // and points at the reason it matters.
    expect(
      (webSearchTool as unknown as { metadata?: Record<string, unknown> })
        .metadata,
    ).toBeUndefined();
  });

  it('has a server-side executor that the conversion does not strip', () => {
    // The executor is the thing defect (A) bypassed. It lives on the tool
    // object chat() holds, not on the converted wire payload — asserting it
    // here keeps the two facts adjacent.
    expect(typeof (webSearchTool as unknown as { execute?: unknown }).execute).toBe(
      'function',
    );
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd /Users/paul/projects/music-kb/client && npx vitest run src/lib/services/chat-tools.anthropic-dispatch.test.ts 2>&1 | tail -12
```

Expected: `Tests 3 passed (3)`.

To see this test earn its keep, stash the bump and watch it go red — `git stash` the `package.json`/`yarn.lock` changes, `yarn install`, re-run: the first test fails with `type: 'web_search_20250305'` and no `input_schema`. Restore afterwards. This is optional but is the only way to know the test is not vacuous.

- [ ] **Step 3: Confirm the structural guards still hold**

```bash
cd /Users/paul/projects/music-kb/client && npx vitest run src/lib/services/model-policy.test.ts 2>&1 | tail -8
```

Expected: all pass. The new file is a `*.test.ts`, and `model-policy.test.ts:175` filters those out of `PROD_FILES`, so its "only `frontier-model.ts` CALLS `createAnthropicChat`" and "`model-policy.ts` imports `@tanstack/ai-anthropic` TYPE-ONLY" guards are unaffected. The new test never calls `createAnthropicChat`.

- [ ] **Step 4 (OPTIONAL — requires a real key, and spends money): live frontier confirmation**

Only run this if `ANTHROPIC_API_KEY` is available and the user has approved a paid call. It proves the executor really runs end-to-end, which the unit test above cannot.

Write `/tmp/verify-frontier-tool.mjs`:

```js
// Optional live check for defect (A). Spends Anthropic credits.
//   cd /Users/paul/projects/music-kb/client
//   ANTHROPIC_API_KEY=sk-ant-... node /tmp/verify-frontier-tool.mjs
import { chat, toolDefinition } from '@tanstack/ai';
import { createAnthropicChat } from '@tanstack/ai-anthropic';
import { z } from 'zod';

let executed = false;
// Same NAME and same shape as client/src/lib/services/chat-tools.ts:36.
// Re-declared here rather than imported because chat-tools.ts is TypeScript
// and pulls the `#/` subpath alias; node cannot load it directly.
const tool = toolDefinition({
  name: 'web_search',
  description: 'Search the public web for additional context.',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
}).server(async ({ query }) => {
  executed = true;
  console.log('>>> LOCAL EXECUTOR RAN with query:', query);
  return { results: ['LOCAL_EXECUTOR_MARKER — Berklee was founded in 1945.'] };
});

const stream = chat({
  adapter: createAnthropicChat('claude-sonnet-5', process.env.ANTHROPIC_API_KEY),
  messages: [
    { role: 'user', content: 'What year was Berklee founded? Use web_search.' },
  ],
  tools: [tool],
});

for await (const ev of stream) {
  if (ev?.type === 'TOOL_CALL_START') {
    console.log('TOOL_CALL_START:', ev.toolCallName ?? ev.toolName);
  }
}
console.log('---');
console.log('local executor actually ran:', executed);
```

```bash
cd /Users/paul/projects/music-kb/client && ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" node /tmp/verify-frontier-tool.mjs
```

Expected: `>>> LOCAL EXECUTOR RAN with query: …` prints, and the final line reads `local executor actually ran: true`. At 0.16.6 this printed `false` — the model used Anthropic's hosted search instead.

---

### Task 1.6 — Update the version claims the codebase makes in prose

These are comments and doc strings that assert the old pin as a fact. Leaving them turns correct documentation into a lie about a decision that was just reversed.

- [ ] **Step 1: `frontier-model.ts` header**

Current, `/Users/paul/projects/music-kb/client/src/lib/services/frontier-model.ts:35-44`:

```ts
// `@tanstack/ai-anthropic` is pinned at 0.16.6, NOT the 0.17.0 the original
// brief for this feature named — 0.17.0 declares a peer of
// `@tanstack/ai@^0.47.3` and fails at import time against this repo's
// pinned `@tanstack/ai@0.45.1` (`adapter-internals` doesn't export
// `assertUniqueToolNames` at 0.45.1 — that landed in core between 0.45.1
// and 0.47.3). 0.16.6 declares `@tanstack/ai@^0.45.0`, which the pinned
// 0.45.1 satisfies, and both imports and typechecks clean. Do not bump
// `@tanstack/ai` to chase 0.17.0 — that upgrade is its own task (see
// task-3-report.md).
```

Replace with:

```ts
// `@tanstack/ai-anthropic` is pinned at 0.18.0 against `@tanstack/ai@0.49.1`.
//
// It was pinned at 0.16.6 for a while: 0.17.0 declares a peer of
// `@tanstack/ai@^0.47.3` and failed at import time against the then-pinned
// `@tanstack/ai@0.45.1`, because `adapter-internals` did not export
// `assertUniqueToolNames` at 0.45.1. Going PAST 0.47.3 is the fix, not a
// bigger version of the problem — the export exists at 0.49.1.
//
// The bump also closed a live defect: at 0.16.6 the tool converter switched
// on `tool.name`, so this app's own `web_search` tool
// (services/chat-tools.ts:36) was rewritten into Anthropic's HOSTED search
// and its executor was bypassed on the frontier path. 0.18.0 dispatches on
// adapter-owned metadata instead (`tool.metadata.__kind`), so a plain
// function may safely use a provider-reserved name. Pinned by
// services/chat-tools.anthropic-dispatch.test.ts.
```

- [ ] **Step 2: `frontier-model.test.ts` — two version strings**

Current, `/Users/paul/projects/music-kb/client/src/lib/services/frontier-model.test.ts:166`:

```ts
// Record of which model ids @tanstack/ai-anthropic 0.16.6's ANTHROPIC_MODELS
```

Replace with:

```ts
// Record of which model ids @tanstack/ai-anthropic 0.18.0's ANTHROPIC_MODELS
```

Current, `/Users/paul/projects/music-kb/client/src/lib/services/frontier-model.test.ts:171`:

```ts
  it('is the fixed 12-model list from @tanstack/ai-anthropic@0.16.6', () => {
```

Replace with:

```ts
  it('is the fixed 12-model list from @tanstack/ai-anthropic@0.18.0', () => {
```

The twelve ids and their order are byte-identical at 0.18.0 (`.reference/tanstack-ai/packages/ai-anthropic/src/model-meta.ts:563-577`), so the assertion body does not change. If this test goes red, the list actually moved and the new list — not the assertion — is the thing to investigate.

- [ ] **Step 3: `model-policy.tiers.test.ts` — two version strings**

Current, `/Users/paul/projects/music-kb/client/src/lib/services/model-policy.tiers.test.ts:60`:

```ts
// does. Measured against @tanstack/ai-anthropic 0.16.6 + @anthropic-ai/sdk:
```

Replace with:

```ts
// does. Measured against @tanstack/ai-anthropic 0.18.0 + @anthropic-ai/sdk:
```

Current, `/Users/paul/projects/music-kb/client/src/lib/services/model-policy.tiers.test.ts:184-185`:

```ts
    // RED without the `toJSON` + custom-inspect hooks on the frontier
    // object. Measured against @tanstack/ai-anthropic 0.16.6 +
```

Replace with:

```ts
    // RED without the `toJSON` + custom-inspect hooks on the frontier
    // object. Measured against @tanstack/ai-anthropic 0.18.0 +
```

`@anthropic-ai/sdk` stays at 0.97.1 across this bump, so the depth-2 `adapter.client.apiKey` reachability claim these comments carry is still the measured truth.

- [ ] **Step 4: `docs/ai-architecture.md` — version table and pin paragraph**

Current, `/Users/paul/projects/music-kb/docs/ai-architecture.md:18-27`:

```
| `@tanstack/ai` | 0.45.1 | — |
| `@tanstack/ai-ollama` | 0.9.1 | — |
| `@tanstack/ai-anthropic` | 0.16.6 | — |
| Model calls | all of them | one raw `fetch` to `/api/embeddings` |

`@tanstack/ai-anthropic` is pinned at **0.16.6**, not 0.17.0: 0.17.0 declares a
peer of `@tanstack/ai@^0.47.3` and throws at import against the pinned 0.45.1
(`adapter-internals` doesn't export `assertUniqueToolNames` until after 0.45.1).
Bumping the core to chase it is its own task — see
`docs/tanstack-ai-upgrade-plan.md`.
```

Replace with:

```
| `@tanstack/ai` | 0.49.1 | — |
| `@tanstack/ai-ollama` | 0.10.0 | — |
| `@tanstack/ai-anthropic` | 0.18.0 | — |
| Model calls | all of them | one raw `fetch` to `/api/embeddings` |

All three were bumped together (from 0.45.1 / 0.9.1 / 0.16.6), because they
have to be. `@tanstack/ai` 0.48.0 made the SSE wire spec-only: `TOOL_CALL_END`
now carries `toolCallId` and nothing else, so `services/chat-stream.ts` reads
the tool name off `TOOL_CALL_START` and rebuilds the arguments by accumulating
the `TOOL_CALL_ARGS` deltas. Bumping the core without that parser change
blanks the tool name and input on all four streaming surfaces, silently.

`@tanstack/ai-anthropic` 0.18.0 also closes a live defect: up to 0.16.6 the
tool converter dispatched on `tool.name`, so this app's own `web_search`
(`services/chat-tools.ts`) was converted into Anthropic's hosted search and
its executor was bypassed on the frontier path. 0.18.0 dispatches on
adapter-owned metadata instead.

**Fixtures for the SSE wire must be CAPTURED, not written** — use
`client/verify-sse.mjs`. The hand-authored fixtures this suite used before
stayed green through the exact regression they existed to catch.
```

---

### Verification for the whole phase

Run all of these from a clean shell. Every one must pass before committing.

```bash
# 1. Versions are what this phase claims.
cd /Users/paul/projects/music-kb/client && node -e "for (const p of ['@tanstack/ai','@tanstack/ai-anthropic','@tanstack/ai-ollama']) console.log(p, require('./node_modules/'+p+'/package.json').version)"
```
Must print `0.49.1`, `0.18.0`, `0.10.0`.

```bash
# 2. Typecheck.
cd /Users/paul/projects/music-kb/client && npx tsc --noEmit -p tsconfig.json && echo "TYPECHECK OK"
```
Must print `TYPECHECK OK` and nothing else.

```bash
# 3. Full unit suite.
cd /Users/paul/projects/music-kb/client && npx vitest run 2>&1 | tail -5
```
Must print `Test Files 51 passed (51)` and `Tests 1224 passed (1224)` — the baseline 1217, minus 1 replaced test, plus 5 new parser tests, plus 3 new dispatch tests. If the count differs, reconcile it against your actual edits before touching an assertion; a count that only *nearly* matches means a test was dropped.

```bash
# 4. THE ONE THAT MATTERS: captured frames, parsed by the real parser.
cd /Users/paul/projects/music-kb/client && node verify-sse.mjs
```
Must show a `TOOL_CALL_END | keys:` line **without** `toolName` and **without** `input`, at least one `TOOL_CALL_ARGS` line, and `local executor actually ran: true`.

```bash
# 5. End-to-end in the running app — the only check that covers the consumers.
cd /Users/paul/projects/music-kb && yarn dev
```
Then, in the browser: open any video's chat, ask a question the transcript cannot answer (e.g. *"What year was Berklee College of Music founded? Search the web."*). Confirm all three:
- the server console prints `[tool web_search] "…" → N results` (from `chat-tools.ts:47`);
- the tool card in the UI shows the tool **name** `web_search` — not an empty label;
- the tool card shows the **input** `{ "query": "…" }` — not `{}` or blank;
- the tool card shows a **result** panel with search results.

A blank name or `{}` input here means the parser patch did not land correctly, regardless of what vitest says.

```bash
# 6. Diff review — nothing unintended crept in.
cd /Users/paul/projects/music-kb && git status --short && git diff --stat
```
Expected changed files, and only these: `client/package.json`, `client/yarn.lock`, `client/verify-sse.mjs`, `client/src/lib/services/chat-stream.ts`, `client/src/lib/services/chat-stream.test.ts`, `client/src/lib/services/chat-tools.anthropic-dispatch.test.ts` (new), `client/src/lib/services/frontier-model.ts`, `client/src/lib/services/frontier-model.test.ts`, `client/src/lib/services/model-policy.tiers.test.ts`, `docs/ai-architecture.md`.

---

### Do NOT

- **Do NOT commit the dependency bump without the parser patch.** They are one change. A bump alone passes 1217 tests, typechecks, and boots — and silently blanks the tool name and input on all four streaming surfaces (`VideoChat.tsx:241-252`, `DigestChat.tsx:119-137`, `NoteComposer.tsx:63`, `useLibraryChat.ts:104`). Worse, `expandHistoryForModel` then tells the model it called `web_search` with `{}`, corrupting its own tool-use history.
- **Do NOT trust a green vitest run as evidence about the wire.** Every SSE test in this file is a string the repo authored. That is exactly how the current fixtures survived the 0.48.0 change. Only `/tmp/sse-after.txt` and the browser check are evidence.
- **Do NOT hand-write the new fixtures from the tables in this document.** The tables come from SDK source and tell you which keys are *permitted*; only a capture tells you which keys the adapter actually *set*. If the capture and this document disagree, the capture wins and this document is wrong.
- **Do NOT delete the `??` fallback chains** in `TOOL_CALL_START`/`TOOL_CALL_END` (`event.toolName`, `event.input`, `event.args`) as dead code. They cost two lines and cover the two older dialects, and a mistake here is silent — nothing throws, the tool card just renders empty.
- **Do NOT change the exported `StreamEvent` union** (`chat-stream.ts:39-57`). Four consumers switch on `kind` and read `id` / `name` / `input` / `result`; touching the union turns a contained parser fix into a four-file change and blows the phase boundary.
- **Do NOT surface a `TOOL_CALL_ARGS` frame as its own `StreamEvent`.** Consumers switch exhaustively on `kind` and silently ignore anything unrecognised, so a leaked event shows up as a duplicated or half-populated tool card, not an error.
- **Do NOT add `@tanstack/ai-react` in this phase**, and do not touch `VideoChat.tsx`, `DigestChat.tsx`, `NoteComposer.tsx` or `useLibraryChat.ts`. That is Phases 2-4. Mixing them makes the one change that must be bisectable un-bisectable.
- **Do NOT "fix" `chat-stream.ts:163-173` while you are in the file.** It runs Anthropic errors through `friendlyOllamaError` on a locality assumption ADR 0011 invalidated. That is a real bug and a user-visible behaviour change; it belongs in its own commit with its own tests, and folding it in here means a revert of the upgrade also reverts an unrelated fix.
- **Do NOT rename the tool from `web_search` to `search_web` here.** That is Phase 0 and independent. Task 1.5 proves the name is no longer load-bearing at 0.18.0, which is a different claim from "the rename is unnecessary".
- **Do NOT let `yarn add` write caret ranges.** `client/package.json` pins these three exactly on purpose — a floating `^0.49.1` re-introduces exactly the class of silent wire drift this phase exists to close. Verify with the `grep` in Task 1.2 Step 3.
- **Do NOT run `yarn install` from the repo root expecting it to update `client/`.** This is a Yarn 1 multi-package repo with a separate `client/yarn.lock`; every install command in this phase runs with `cwd = client/`.
- **Do NOT proceed past Task 1.1 with an empty capture.** `TOOL_CALL_* frames seen: 0` means the model declined to call the tool, not that the wire has no tool frames. Re-run, or switch to a tool-capable local model and record which one in the commit body.

**One thing I am NOT certain of, stated plainly:** whether a `TOOL_CALL_RESULT` frame's `content` can arrive as a non-string. On the path music-kb uses (a `.server()` tool executed by `chat()`'s agent loop) it is always stringified — `packages/ai/src/activities/chat/index.ts:3071-3072` sets `wireContent = typeof content === 'string' ? content : JSON.stringify(content)`. But the fan-out in `normalize-stream-chunk.ts:157-162` sets `content: Array.isArray(chunk.result) ? JSON.stringify(chunk.result) : chunk.result`, which would pass a plain object through unstringified if some adapter put one on `TOOL_CALL_END.result`. The existing `TOOL_CALL_RESULT` handler (`chat-stream.ts:198-213`) maps a non-string to `null`, which renders as "no output". **This phase deliberately leaves that code unchanged.** If the browser check in Verification step 5 shows a tool card with a name and input but no result panel, that is the case to investigate — capture the raw `TOOL_CALL_RESULT` frame with `verify-sse.mjs` first, then decide.

---

### Commit

```bash
cd /Users/paul/projects/music-kb && git checkout -b upgrade/tanstack-ai-0.49.1 && git add client/package.json client/yarn.lock client/verify-sse.mjs client/src/lib/services/chat-stream.ts client/src/lib/services/chat-stream.test.ts client/src/lib/services/chat-tools.anthropic-dispatch.test.ts client/src/lib/services/frontier-model.ts client/src/lib/services/frontier-model.test.ts client/src/lib/services/model-policy.tiers.test.ts docs/ai-architecture.md && git commit -F- <<'EOF'
deps(ai): @tanstack/ai 0.49.1 + spec-only SSE parser, in one commit

Bumps @tanstack/ai 0.45.1 -> 0.49.1, ai-anthropic 0.16.6 -> 0.18.0,
ai-ollama 0.9.1 -> 0.10.0, and rewrites the tool-call section of
services/chat-stream.ts in the same commit. The two halves are one
change: either alone ships a silent regression.

WHY THEY CANNOT BE SPLIT

@tanstack/ai 0.48.0 made the SSE wire spec-only. Every chunk now passes
through stripToSpec, and TOOL_CALL_END's allowed key set is
`toolCallId` alone (spec-event-keys.ts:24). Our parser read
`event.toolName` and `event.input` off that frame and explicitly
discarded TOOL_CALL_ARGS as "intermediate". After a bump, the tool name
resolves to '' and the input to null on all four streaming surfaces at
once: VideoChat, DigestChat, NoteComposer, useLibraryChat. Tool cards
render empty, and expandHistoryForModel then tells the model it called
web_search with {} — corrupting its own tool-use history.

Nothing throws. Nothing goes red.

THE PARSER

The name is now taken from TOOL_CALL_START.toolCallName and the input
is rebuilt by accumulating TOOL_CALL_ARGS.delta per toolCallId, then
JSON.parse'd at TOOL_CALL_END. That makes the parser stateful for the
first time — the state is per stream, created in streamChatSSE and
threaded into parseSseEventBlock. A truncated buffer degrades to a null
input rather than throwing; a `metadata.tanstack.input` fallback covers
adapters that deliver the whole input on END (Anthropic server tools),
mirroring the SDK's own reader at chat/stream/processor.ts:1496-1502.
The pre-0.48 and <=0.10 dialects survive as `??` fallbacks. The exported
StreamEvent union is unchanged, so the four consumers are untouched.

FIXTURES ARE NOW CAPTURED, NOT WRITTEN

The old tool fixtures pinned a TOOL_CALL_END shape carrying toolName and
input — a frame 0.49.1 will never emit. Being hand-authored, they stayed
green through the exact regression they existed to prevent; 1217 tests
passed in 2.1s and said nothing. The replacements are cut from
`client/verify-sse.mjs` output against a live llama3.2:3b run through
toServerSentEventsResponse. verify-sse.mjs now dumps each TOOL_CALL_*
frame's raw JSON so a fixture can be copy-pasted rather than invented.

ALSO CLOSES A LIVE DEFECT

ai-anthropic 0.16.6 converted tools by switching on tool.name, so this
app's own tool — named 'web_search' (services/chat-tools.ts:36) — was
rewritten into Anthropic's HOSTED search on the frontier path and its
executor was bypassed. Reachable since ADR 0011 made video-chat
model-switchable. 0.18.0 dispatches on adapter-owned metadata
(tool.metadata.__kind) instead, so a plain function may safely use a
provider-reserved name. Pinned by the new
services/chat-tools.anthropic-dispatch.test.ts.

DELIBERATELY NOT IN THIS COMMIT

- @tanstack/ai-react and any useChat adoption (Phases 3-4).
- The web_search -> search_web rename (Phase 0, independent).
- chat-stream.ts:163-173 running Anthropic errors through
  friendlyOllamaError. Real bug, user-visible behaviour change, its own
  commit.

Verified: tsc --noEmit clean; 1224 unit tests green; verify-sse.mjs
shows TOOL_CALL_END with no toolName/input and TOOL_CALL_ARGS present;
video chat in the browser renders tool name, input and result, and the
server logs the [tool web_search] line from the app's own executor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

## Phase 2 — De-stream NoteComposer

**Goal:** Turn `POST /api/notes/compose` from an AG-UI SSE stream into a single JSON response built with `streamToText`, so the note composer stops being a consumer of `chat-stream.ts`, and give it a working `AbortController` so the Cancel button stops being inert during a generation.

**Files touched:**
- `/Users/paul/projects/music-kb/client/src/routes/api.notes.compose.tsx` (modified)
- `/Users/paul/projects/music-kb/client/src/components/NoteComposer.tsx` (modified)
- `/Users/paul/projects/music-kb/client/src/routes/api.notes.compose.test.ts` (new)

**Prerequisites:**
- **Phase 0** (rename `web_search`) — independent, but the plan sequences it first and it costs minutes.
- **Phase 1** (core bump to 0.49.1 + `chat-stream.ts` parser patch) — **recommended first, not required.** Everything in this phase was type-checked against the *currently installed* `@tanstack/ai` 0.45.1 (`tsc -p tsconfig.json` exits 0), and Task 2.1 Step 2 exists specifically so the code is correct on **both** 0.45.1 and 0.49.1. If you land Phase 2 first, Phase 1 gets easier: `chat-stream.ts` drops from four consumers to three, and NoteComposer is no longer at risk from the 0.48 wire change.

**Estimated effort:** half a day.

---

### Ground truth verified for this phase (do not re-derive)

Read out of `/Users/paul/learning/tanstack-ai/.reference/tanstack-ai` (0.49.1) **and** out of `/Users/paul/projects/music-kb/client/node_modules/@tanstack/ai` (0.45.1, the pinned version):

1. **`streamToText` is exported from the package root in both versions.**
   - 0.49.1: `packages/ai/src/index.ts:119` re-exports it from `./stream-to-response`; defined at `packages/ai/src/stream-to-response.ts:45`.
   - 0.45.1 (installed): `node_modules/@tanstack/ai/dist/esm/index.d.ts:20` re-exports it; declared at `node_modules/@tanstack/ai/dist/esm/stream-to-response.d.ts:27`.

2. **Signature is identical in both:** `streamToText(stream: AsyncIterable<StreamChunk>): Promise<string>`. It returns the concatenation of every `TEXT_MESSAGE_CONTENT` chunk's `delta`. It does **not** return tool calls, citations, or a message object — just the text.

3. **The two versions differ in exactly one way, and it matters.** 0.49.1 throws on a failed run; 0.45.1 silently swallows it.

   0.49.1, `packages/ai/src/stream-to-response.ts:45-60`:
   ```ts
   export async function streamToText(
     stream: AsyncIterable<StreamChunk>,
   ): Promise<string> {
     let accumulatedContent = ''
     for await (const chunk of stream) {
       if (chunk.type === 'RUN_ERROR') {
         throw runErrorEventToError(chunk)
       }
       if (chunk.type === 'TEXT_MESSAGE_CONTENT' && chunk.delta) {
         accumulatedContent += chunk.delta
       }
     }
     return accumulatedContent
   }
   ```

   0.45.1, `node_modules/@tanstack/ai/dist/esm/stream-to-response.js` (the compiled body, verbatim):
   ```js
   async function streamToText(stream) {
   	let accumulatedContent = "";
   	for await (const chunk of stream) if (chunk.type === "TEXT_MESSAGE_CONTENT" && chunk.delta) accumulatedContent += chunk.delta;
   	return accumulatedContent;
   }
   ```
   **There is no `RUN_ERROR` branch at 0.45.1.** A run that dies mid-generation (Ollama killed, model evicted) returns `""`. Wired naively, the endpoint would answer `200 {"markdown":""}` and the user would watch their draft get replaced by nothing, with no error anywhere. Task 2.1 Step 2 adds a passthrough generator that closes this, and stays correct (redundant but harmless) after Phase 1 bumps to 0.49.1.

4. **`chat({ abortController })` is a supported option in both versions.** 0.45.1: `node_modules/@tanstack/ai/dist/esm/activities/chat/index.d.ts:92-93` — `/** AbortController for cancellation */ abortController?: TextOptions['abortController'];`. 0.49.1: `packages/ai/src/activities/chat/index.ts:481`.

5. **`StreamChunk` is exported as a type from the package root** (`index.d.ts:43` → `export * from './types.js'`; `types.d.ts:1474` → `export type StreamChunk = AGUIEvent;`), and `chunk.type === 'RUN_ERROR'` narrows correctly to a shape carrying `message?: string` and a deprecated `error?: { message: string; code?: string }` (`types.d.ts:924-937`). **This was verified by compiling it**, not assumed — see the "Verification" note at the end of Task 2.1.

**Where I am unsure, stated plainly:** I did **not** verify whether TanStack Start / Nitro actually fires `request.signal`'s `abort` event when a browser disconnects mid-request in this app's dev server. The server-side abort wiring in Task 2.1 is therefore written to be *harmless if it never fires*: the only cost is that a cancelled generation runs to completion server-side and its output is discarded. The Cancel button's correctness does **not** depend on it — that comes entirely from the client-side `AbortController` in Task 2.2.

---

### Task 2.1 — De-stream the endpoint

The handler is currently an inline arrow inside `createFileRoute`. Extract it to a named export first (matching the existing repo pattern at `client/src/routes/api.lesson-write.tsx:28`, `export async function lessonWriteHandler(request: Request): Promise<Response>`), so Task 2.3 can unit-test the contract without booting Nitro.

**Do the steps in this order.** Step 1 addresses lines by number in the pristine file; every later step matches on content.

- [ ] **Step 1: Re-indent the handler body out of the arrow function**

The handler body currently sits at 8-space indentation on lines 76–195 because it lives inside `createFileRoute({ server: { handlers: { POST: async ({ request }) => {`. Extracting it to a top-level function drops it two levels. Strip six leading spaces from exactly that range:

```bash
cd /Users/paul/projects/music-kb/client && sed -i '' '76,195s/^      //' src/routes/api.notes.compose.tsx
```

This is safe: every backtick in lines 76–195 is on a single-line template literal (verified — lines 110, 139, 145, 146, 149, 186, 195, each with a balanced pair on its own line), so no multi-line string's leading whitespace is disturbed. Blank lines have fewer than six leading spaces and do not match `^      `.

Confirm the range moved and nothing else did:

```bash
cd /Users/paul/projects/music-kb/client && git diff --stat src/routes/api.notes.compose.tsx && sed -n '76,80p' src/routes/api.notes.compose.tsx
```

Expected: `1 file changed, 105 insertions(+), 105 deletions(-)` (blank lines inside the range are unchanged, so the count is less than 120), and:

```
  let body: ComposeBody;
  try {
    body = (await request.json()) as ComposeBody;
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
```

- [ ] **Step 2: Swap the imports and add the `RUN_ERROR` guard**

Current `client/src/routes/api.notes.compose.tsx:1-9`:

```ts
import { createFileRoute } from '@tanstack/react-router';
import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import {
  fetchVideoByVideoIdService,
  fetchTranscriptByVideoIdService,
} from '#/lib/services/videos';
import { cleanTranscript } from '#/lib/services/transcript';
import { getSkill } from '#/lib/skills';
import { resolveRequestModel, withSystem } from '#/lib/services/chat-model-request';
```

Replace those nine lines with:

```ts
import { createFileRoute } from '@tanstack/react-router';
import { chat, streamToText } from '@tanstack/ai';
import type { StreamChunk } from '@tanstack/ai';
import {
  fetchVideoByVideoIdService,
  fetchTranscriptByVideoIdService,
} from '#/lib/services/videos';
import { cleanTranscript } from '#/lib/services/transcript';
import { getSkill } from '#/lib/skills';
import { resolveRequestModel, withSystem } from '#/lib/services/chat-model-request';

// Re-raise a RUN_ERROR chunk as a thrown Error before `streamToText` sees it.
//
// THIS IS NOT DEFENSIVE PADDING; it is load-bearing at the pinned version.
// @tanstack/ai 0.45.1's `streamToText` ignores every chunk that is not
// TEXT_MESSAGE_CONTENT — including RUN_ERROR (see the compiled body in
// node_modules/@tanstack/ai/dist/esm/stream-to-response.js). A run that dies
// mid-generation therefore resolves to the EMPTY STRING, and without this
// wrapper the endpoint would answer 200 with an empty note: the user's draft
// would be replaced by nothing, with no error raised anywhere on either side
// of the wire. The SSE path this replaces did not have that hole — a
// RUN_ERROR frame reached `chat-stream.ts` and threw there.
//
// 0.49.1 fixed it upstream (packages/ai/src/stream-to-response.ts:49 throws
// `runErrorEventToError`). After Phase 1 lands, this wrapper is redundant but
// still correct: it throws first, so `streamToText` never sees the chunk on
// either version. Do not delete it on the bump — the equivalence is what makes
// this file version-agnostic.
async function* throwOnRunError(
  stream: AsyncIterable<StreamChunk>,
): AsyncGenerator<StreamChunk, void, void> {
  for await (const chunk of stream) {
    if (chunk.type === 'RUN_ERROR') {
      // 0.45 flattens the failure onto `message`; <= 0.10 nested it under
      // `error`. Read both, same as chat-stream.ts:169-172 does, so neither
      // dialect degrades to the generic fallback — that string is what the
      // user sees, and losing the real one costs them the recovery hint.
      throw new Error(chunk.message || chunk.error?.message || 'AI run failed');
    }
    yield chunk;
  }
}
```

- [ ] **Step 3: Extract the handler**

Current `client/src/routes/api.notes.compose.tsx:72-75` (unchanged by Step 1 — outside the re-indent range):

```ts
export const Route = createFileRoute('/api/notes/compose')({
  server: {
    handlers: {
      POST: async ({ request }) => {
```

Replace those four lines with:

```ts
// Exported so the endpoint's contract is unit-testable without booting Nitro —
// same shape as `lessonWriteHandler` in api.lesson-write.tsx:28.
export async function notesComposeHandler(request: Request): Promise<Response> {
```

- [ ] **Step 4: Replace the stream response with a JSON response**

After Step 1 and Step 3 the tail of the file reads (indentation as re-indented, `Route` re-added in this step):

```ts
  const stream = chat({
    adapter: model.adapter,
    ...withSystem(model, skill.composerPrompt, [
      { role: 'user', content: userPrompt },
    ]),
    modelOptions: model.modelOptions(0.3),
  });

  return toServerSentEventsResponse(stream);
      },
    },
  },
});
```

Replace that entire block — from `const stream = chat({` to the final `});` — with:

```ts
  // Server-side cancellation. The client aborts its fetch when the user hits
  // Cancel; if the runtime propagates that disconnect onto `request.signal`,
  // this stops the model generating into a socket nobody is reading.
  //
  // NOT VERIFIED: whether TanStack Start / Nitro actually fires this signal on
  // client disconnect in this app's dev server. Written to be harmless if it
  // never fires — the worst case is a cancelled generation running to
  // completion and its output being discarded. The Cancel button's behaviour
  // comes from the CLIENT controller (NoteComposer.tsx), not from this.
  const abortController = new AbortController();
  if (request.signal.aborted) {
    return new Response(null, { status: 499 });
  }
  request.signal.addEventListener('abort', () => abortController.abort(), {
    once: true,
  });

  const stream = chat({
    adapter: model.adapter,
    ...withSystem(model, skill.composerPrompt, [
      { role: 'user', content: userPrompt },
    ]),
    modelOptions: model.modelOptions(0.3),
    abortController,
  });

  // ONE JSON body, not SSE. NoteComposer never rendered partial markdown —
  // it accumulated every delta into a local and wrote the editor once, after
  // the stream closed (partial markdown renders badly in Tiptap: half-formed
  // headings, open code fences, mid-word italics). So the deltas existed only
  // to be re-joined on the other side. Doing the join here is byte-identical
  // for the user and removes this surface from `chat-stream.ts`'s consumers,
  // which is what takes it out of the AG-UI wire-format blast radius.
  try {
    const markdown = await streamToText(throwOnRunError(stream));
    return new Response(JSON.stringify({ markdown }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      // Client walked away. Nobody reads this; the status is for the log.
      return new Response(null, { status: 499 });
    }
    const raw = err instanceof Error ? err.message : 'Compose failed';
    // `model.friendlyError` is the TIER-PAIRED mapper (model-policy.ts:150).
    // On the local tier it IS `friendlyOllamaError` (model-policy.ts:249), so
    // the message the user sees is identical to what the SSE path produced.
    // On the frontier tier — reachable here since ADR 0011 made note-compose
    // switchable — it is `friendlyAnthropicError(redactAnthropicKey(raw))`
    // (frontier-model.ts:121), which never echoes the raw provider text. That
    // is strictly safer than the old path, which put raw RUN_ERROR text on the
    // wire regardless of tier.
    console.error(`[notes/compose ${body.videoId}] ${raw}`);
    return new Response(JSON.stringify({ error: model.friendlyError(raw) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const Route = createFileRoute('/api/notes/compose')({
  server: {
    handlers: {
      POST: ({ request }) => notesComposeHandler(request),
    },
  },
});
```

- [ ] **Step 5: Fix the stale header comment**

Current `client/src/routes/api.notes.compose.tsx` — this block sits immediately above `const MAX_TRANSCRIPT_CHARS` (it was lines 36-38 before Step 1; find it by content):

```ts
// Output stream is AG-UI style SSE (TEXT_MESSAGE_CONTENT deltas + [DONE]).
// The client accumulates deltas and pushes the markdown into the Tiptap
// editor as it streams.
```

Replace with:

```ts
// Output is ONE JSON body: 200 `{ markdown: string }` on success, 500
// `{ error: string }` on a failed run, 499 with no body if the client
// disconnected. The guard clauses above answer in PLAIN TEXT with 400 / 404 /
// 409 — that predates this change and is deliberately left alone, so the
// client must accept both content types on a non-OK response.
```

- [ ] **Step 6: Verify the endpoint compiles**

```bash
cd /Users/paul/projects/music-kb/client && ./node_modules/.bin/tsc -p tsconfig.json; echo "tsc exit=$?"
```

Expected output: `tsc exit=0` and nothing else. (The baseline before this phase is also clean — confirmed. `noUnusedLocals: true` is on in `client/tsconfig.json:23`, so a leftover `toServerSentEventsResponse` import is a hard error, not a warning.)

> The `throwOnRunError` + `streamToText(throwOnRunError(stream))` + `abortController` combination above was compiled against the real `createOllamaChat` adapter at 0.45.1 in a scratch file before this spec was written, and `tsc -p tsconfig.json` exited 0. The `chunk.type === 'RUN_ERROR'` narrowing and the `chunk.message` / `chunk.error?.message` reads are known to type-check — they are not guesses about the enum-vs-literal question.

---

### Task 2.2 — Make Cancel work in the component

- [ ] **Step 1: Update the file header**

Current `client/src/components/NoteComposer.tsx:16-18`:

```ts
// Streaming: uses AG-UI-style SSE deltas from /api/notes/compose. The
// accumulating markdown is pushed into the MarkdownEditor live — the
// user watches the note assemble the same way chat streams.
```

Replace with:

```ts
// Transport: ONE request to /api/notes/compose, one JSON body back. This is
// deliberately NOT a stream. The component never rendered partial markdown —
// it always accumulated the whole thing before touching the editor, because
// partial markdown renders badly in Tiptap — so the deltas were joined on
// arrival anyway. De-streamed in Phase 2 of the TanStack AI upgrade; the
// endpoint now does the joining, and this surface no longer depends on
// `chat-stream.ts` or on the AG-UI wire format.
//
// `streaming` (the state flag below) is kept under that name on purpose: it
// now means "a compose request is in flight", and renaming it would touch a
// dozen JSX `disabled` props for no behavioural gain.
```

- [ ] **Step 2: Update the imports**

Current `client/src/components/NoteComposer.tsx:20`:

```ts
import { useMemo, useState } from 'react';
```

Replace with:

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
```

Current `client/src/components/NoteComposer.tsx:33`:

```ts
import { streamChatSSE } from '#/lib/services/chat-stream';
```

**Delete that line entirely.** (`streamChatSSE` still has three other consumers — `VideoChat.tsx`, `DigestChat.tsx`, `useLibraryChat.ts` — so `chat-stream.ts` is not dead code. Do not delete it.)

- [ ] **Step 3: Replace the streaming generator with a single request**

Current `client/src/components/NoteComposer.tsx:45-65`:

```ts
// Issue the compose request and yield text deltas. Wire framing +
// AG-UI parsing (including non-OK body extraction and RUN_ERROR
// translation) live in `chat-stream.ts`; this wrapper owns only the
// request shape for the note-composer endpoint.
async function* streamCompose(input: {
  videoId: string;
  prompt: string;
  currentContent?: string;
  skillSlug?: string;
  /** Choice TOKEN, not a model id — validated server-side. */
  modelChoice: string;
}): AsyncGenerator<string, void, void> {
  const res = await fetch('/api/notes/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  for await (const event of streamChatSSE(res)) {
    if (event.kind === 'text') yield event.delta;
  }
}
```

Replace that whole block with:

```ts
// Issue the compose request and return the finished markdown.
//
// `signal` is a required parameter, not an optional one: the entire reason
// this stayed a separate function after de-streaming is so the abort plumbing
// has exactly one home and cannot be forgotten at a call site.
async function requestCompose(
  input: {
    videoId: string;
    prompt: string;
    currentContent?: string;
    skillSlug?: string;
    /** Choice TOKEN, not a model id — validated server-side. */
    modelChoice: string;
  },
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch('/api/notes/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) {
    // Same contract `streamChatSSE` enforced at chat-stream.ts:66-72 — surface
    // the upstream body, never collapse to a bare status code, because that
    // hides the actual cause (Ollama down, summary not ready, …). Two body
    // shapes have to be handled: the route's guard clauses answer 400/404/409
    // in PLAIN TEXT, the failure path answers 500 in JSON as `{ error }`.
    const rawBody = await res.text().catch(() => '');
    let message = rawBody;
    try {
      const parsed = JSON.parse(rawBody) as { error?: unknown };
      if (typeof parsed.error === 'string') message = parsed.error;
    } catch {
      // Plain-text body — `rawBody` is already the message.
    }
    throw new Error(message || `Request failed: ${res.status}`);
  }
  const payload = (await res.json()) as { markdown?: unknown };
  if (typeof payload.markdown !== 'string') {
    // A 200 with the wrong shape means the endpoint's contract broke. Throwing
    // keeps the existing draft intact; silently writing `undefined` into the
    // editor would destroy it.
    throw new Error('Compose returned no markdown');
  }
  return payload.markdown;
}
```

- [ ] **Step 4: Add the abort ref and unmount cleanup**

Current `client/src/components/NoteComposer.tsx:102-103`:

```ts
  const skills = useMemo<Skill[]>(() => listSkills('notes-composer'), []);
  const activeSkill = skills.find((s) => s.slug === skillSlug) ?? null;
```

Replace with:

```ts
  const skills = useMemo<Skill[]>(() => listSkills('notes-composer'), []);
  const activeSkill = skills.find((s) => s.slug === skillSlug) ?? null;

  // Controller for the in-flight compose. Same shape as useLibraryChat.ts:139.
  const abortRef = useRef<AbortController | null>(null);

  // Abort on unmount so a compose the user navigated away from does not keep
  // a fetch — and the model behind it — alive. NotesPane unmounts this
  // component on close, so without this the request outlives the UI.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  // Cancel means "leave", and now it means it DURING a compose too. The button
  // used to be `disabled={streaming || …}`, which left the user with no way
  // out of a 60-second local generation short of reloading the page.
  const handleCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  };
```

- [ ] **Step 5: Rewrite `handleGenerate`**

Current `client/src/components/NoteComposer.tsx:105-145`:

```ts
  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || streaming) return;
    setStreaming(true);
    setError(null);
    const hadContent = body.trim().length > 0;
    try {
      // Consume the full stream before touching the editor. Partial
      // markdown renders poorly in Tiptap (half-formed headings, open
      // code fences, mid-word italics) and every `setContent` during
      // streaming churns the editor state. For note generation the user
      // waits a few seconds then sees the complete draft — cleaner than
      // watching tokens assemble imperfectly.
      let acc = '';
      for await (const delta of streamCompose({
        videoId: videoYoutubeId,
        prompt: trimmed,
        currentContent: hadContent ? body : undefined,
        skillSlug,
        modelChoice,
      })) {
        acc += delta;
      }
      setBody(acc);
      // Auto-set title from H1 if the user hasn't typed one.
      if (!title.trim()) {
        const h1 = extractH1Title(acc);
        if (h1) setTitle(h1);
      }
      // Keep the prompt so the user can edit + run again; they can
      // clear it manually if they want a fresh direction.
    } catch (err) {
      // Stream failed (Ollama died, model missing, …) — surface the
      // error and leave the existing draft untouched: `acc` only
      // reaches the editor after the stream completes successfully.
      const raw = err instanceof Error ? err.message : 'Compose failed';
      setError(friendlyOllamaError(raw));
    } finally {
      setStreaming(false);
    }
  };
```

Replace with:

```ts
  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || streaming) return;
    // Supersede any in-flight compose, then own the controller for this run.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setError(null);
    const hadContent = body.trim().length > 0;
    try {
      // The editor is written ONCE, after the whole response lands. Partial
      // markdown renders poorly in Tiptap (half-formed headings, open code
      // fences, mid-word italics) and every `setContent` mid-flight churns the
      // editor state. That was already true when this arrived as SSE deltas
      // accumulated into a local variable — the endpoint now does the
      // accumulating, so the user sees exactly what they saw before.
      const markdown = await requestCompose(
        {
          videoId: videoYoutubeId,
          prompt: trimmed,
          currentContent: hadContent ? body : undefined,
          skillSlug,
          modelChoice,
        },
        controller.signal,
      );
      setBody(markdown);
      // Auto-set title from H1 if the user hasn't typed one.
      if (!title.trim()) {
        const h1 = extractH1Title(markdown);
        if (h1) setTitle(h1);
      }
      // Keep the prompt so the user can edit + run again; they can
      // clear it manually if they want a fresh direction.
    } catch (err) {
      // A user-initiated Cancel is NOT an error. `fetch` rejects with an
      // AbortError on abort; checking the signal instead of the error's name
      // is exact and does not depend on which runtime produced the rejection.
      // Without this the user would get "The user aborted a request." in the
      // red error strip every time they hit Cancel.
      if (controller.signal.aborted) return;
      // Request failed (Ollama died, model missing, …) — surface the error and
      // leave the existing draft untouched: the editor is only written after a
      // successful response. `friendlyOllamaError` is idempotent on its own
      // output (pinned by chat-stream.test.ts:302-317), so re-translating the
      // already-translated message the endpoint sent is safe.
      const raw = err instanceof Error ? err.message : 'Compose failed';
      setError(friendlyOllamaError(raw));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  };
```

- [ ] **Step 6: Wire the Cancel button**

Current `client/src/components/NoteComposer.tsx:282-290`:

```tsx
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={streaming || saving || deleting}
          >
            Cancel
          </Button>
```

Replace with:

```tsx
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={saving || deleting}
          >
            Cancel
          </Button>
```

`streaming` is deliberately gone from `disabled` — that is the whole point of this task. `saving` and `deleting` stay: those are Strapi writes with no abort plumbing, and letting the user unmount mid-write would leave a half-applied change with no way to report it.

- [ ] **Step 7: Verify the component compiles**

```bash
cd /Users/paul/projects/music-kb/client && ./node_modules/.bin/tsc -p tsconfig.json; echo "tsc exit=$?"
```

Expected: `tsc exit=0`, no other output. If you see `'streamChatSSE' is declared but its value is never read`, you missed Step 2's deletion.

---

### Task 2.3 — Pin the new contract with tests

There is currently **no** test file for `api.notes.compose.tsx` or `NoteComposer.tsx` (confirmed: `find src -name "*.test.ts*" | xargs grep -l compose` matches only music-theory `compose-*` tests, which are unrelated). The de-streamed endpoint's whole contract is one JSON body, so it is cheap to pin — and the `RUN_ERROR` case is the one that would otherwise fail silently.

- [ ] **Step 1: Create the test file**

Write this to `/Users/paul/projects/music-kb/client/src/routes/api.notes.compose.test.ts`:

```ts
// Contract tests for POST /api/notes/compose — the de-streamed note composer.
//
// The endpoint answers with ONE JSON body, so the whole contract is: what
// comes back on success, what comes back when the run dies, and whether a dead
// run gets reported at all. That last case is why this file exists. At the
// pinned @tanstack/ai 0.45.1, `streamToText` drops every chunk that is not
// TEXT_MESSAGE_CONTENT — RUN_ERROR included — so without the route's
// `throwOnRunError` wrapper a failed generation answers 200 with an empty
// note and wipes the user's draft with no error anywhere. Nothing else in the
// suite would catch that.
//
// `chat` is mocked; `streamToText` is NOT — it is imported for real via
// `importOriginal`, so these tests exercise the actual SDK function whose
// behaviour differs between 0.45.1 and 0.49.1.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const chatMock = vi.fn();
vi.mock('@tanstack/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/ai')>();
  return { ...actual, chat: (...args: Array<unknown>) => chatMock(...args) };
});

const fetchVideoMock = vi.fn();
const fetchTranscriptMock = vi.fn();
vi.mock('#/lib/services/videos', () => ({
  fetchVideoByVideoIdService: (...args: Array<unknown>) =>
    fetchVideoMock(...args),
  fetchTranscriptByVideoIdService: (...args: Array<unknown>) =>
    fetchTranscriptMock(...args),
}));

// Mocked whole so the test needs neither a live Ollama catalogue nor a real
// `ResolvedModel`. `friendlyError` is the identity here so assertions can read
// the raw message; in the app it is `friendlyOllamaError` on the local tier.
vi.mock('#/lib/services/chat-model-request', () => ({
  resolveRequestModel: () =>
    Promise.resolve({
      model: {
        tier: 'local',
        adapter: {},
        modelOptions: () => ({}),
        friendlyError: (raw: string) => raw,
      },
    }),
  withSystem: (_model: unknown, system: string, messages: Array<unknown>) => ({
    messages: [{ role: 'system', content: system }, ...messages],
  }),
}));

import { notesComposeHandler } from './api.notes.compose';

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/notes/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function* chunks(...items: Array<Record<string, unknown>>) {
  for (const item of items) yield item;
}

const VIDEO = {
  youtubeVideoId: 'abc123',
  videoTitle: 'Blues turnarounds',
  videoAuthor: 'Someone',
  summaryStatus: 'generated',
  summaryDescription: null,
  summaryOverview: null,
  sections: [],
  keyTakeaways: [],
  transcript: null,
};

describe('POST /api/notes/compose', () => {
  beforeEach(() => {
    chatMock.mockReset();
    fetchVideoMock.mockReset();
    fetchTranscriptMock.mockReset();
    fetchVideoMock.mockResolvedValue(VIDEO);
    fetchTranscriptMock.mockResolvedValue(null);
  });

  it('answers 200 with the joined markdown', async () => {
    chatMock.mockReturnValue(
      chunks(
        { type: 'TEXT_MESSAGE_CONTENT', delta: '# Turnarounds\n' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'Play the I-VI-II-V.' },
      ),
    );

    const res = await notesComposeHandler(
      postRequest({ videoId: 'abc123', prompt: 'summarise this' }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    await expect(res.json()).resolves.toEqual({
      markdown: '# Turnarounds\nPlay the I-VI-II-V.',
    });
  });

  it('hands chat() an AbortController so a client disconnect can stop the run', async () => {
    chatMock.mockReturnValue(chunks({ type: 'TEXT_MESSAGE_CONTENT', delta: 'x' }));

    await notesComposeHandler(
      postRequest({ videoId: 'abc123', prompt: 'summarise this' }),
    );

    const options = chatMock.mock.calls[0][0] as {
      abortController?: unknown;
    };
    expect(options.abortController).toBeInstanceOf(AbortController);
  });

  it('answers 500 when the run dies mid-generation instead of 200 with an empty note', async () => {
    // THE REGRESSION GUARD. 0.45.1's streamToText ignores RUN_ERROR; drop
    // `throwOnRunError` from the route and this test goes 200 / { markdown: '' }.
    chatMock.mockReturnValue(
      chunks(
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'half a no' },
        { type: 'RUN_ERROR', message: 'model "qwen3" not found' },
      ),
    );

    const res = await notesComposeHandler(
      postRequest({ videoId: 'abc123', prompt: 'summarise this' }),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: 'model "qwen3" not found',
    });
  });

  it('reads the legacy nested RUN_ERROR dialect too', async () => {
    chatMock.mockReturnValue(
      chunks({ type: 'RUN_ERROR', error: { message: 'ECONNREFUSED' } }),
    );

    const res = await notesComposeHandler(
      postRequest({ videoId: 'abc123', prompt: 'summarise this' }),
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'ECONNREFUSED' });
  });

  it('still answers the guard clauses in plain text', async () => {
    const missingPrompt = await notesComposeHandler(
      postRequest({ videoId: 'abc123' }),
    );
    expect(missingPrompt.status).toBe(400);
    await expect(missingPrompt.text()).resolves.toBe(
      'videoId and prompt required',
    );

    fetchVideoMock.mockResolvedValue({ ...VIDEO, summaryStatus: 'pending' });
    const notReady = await notesComposeHandler(
      postRequest({ videoId: 'abc123', prompt: 'summarise this' }),
    );
    expect(notReady.status).toBe(409);
    await expect(notReady.text()).resolves.toBe('Summary not ready');

    expect(chatMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run just this file**

```bash
cd /Users/paul/projects/music-kb && yarn --cwd client test src/routes/api.notes.compose.test.ts
```

Expected: `Test Files 1 passed (1)` and `Tests 5 passed (5)`.

- [ ] **Step 3: Prove the guard is load-bearing (temporary edit, then revert)**

In `client/src/routes/api.notes.compose.tsx`, temporarily change:

```ts
    const markdown = await streamToText(throwOnRunError(stream));
```

to:

```ts
    const markdown = await streamToText(stream);
```

Then:

```bash
cd /Users/paul/projects/music-kb && yarn --cwd client test src/routes/api.notes.compose.test.ts
```

Expected: **2 tests fail** — "answers 500 when the run dies mid-generation…" (got 200 / `{"markdown":"half a no"}`) and "reads the legacy nested RUN_ERROR dialect too" (got 200 / `{"markdown":""}`). If both still pass, the wrapper is not wired into the call and Step 4 of Task 2.1 was applied incorrectly.

Now revert:

```bash
cd /Users/paul/projects/music-kb/client && sed -i '' 's|await streamToText(stream)|await streamToText(throwOnRunError(stream))|' src/routes/api.notes.compose.tsx && yarn --cwd . test src/routes/api.notes.compose.test.ts
```

Expected: back to `Tests 5 passed (5)`.

---

### Verification for the whole phase

Run all four, in this order. Every one must pass before you commit.

**1. Typecheck (baseline before this phase was clean, exit 0):**
```bash
cd /Users/paul/projects/music-kb/client && ./node_modules/.bin/tsc -p tsconfig.json; echo "tsc exit=$?"
```
Must print `tsc exit=0` and nothing else.

**2. Full test suite:**
```bash
cd /Users/paul/projects/music-kb && yarn test
```
Must be all green. The **client** suite specifically goes from `Test Files 50 passed (50)` / `Tests 1217 passed (1217)` to `Test Files 51 passed (51)` / `Tests 1222 passed (1222)`. Any number below 1222 means the new file did not run; any failure elsewhere means something in this phase reached beyond its two files.

**3. `chat-stream.ts` lost exactly one consumer, and no more:**
```bash
cd /Users/paul/projects/music-kb/client && grep -rln "streamChatSSE" src
```
Must print exactly these five paths (NoteComposer.tsx is gone; the other three consumers and the module's own test remain):
```
src/components/VideoChat.tsx
src/components/DigestChat.tsx
src/lib/hooks/useLibraryChat.ts
src/lib/services/chat-stream.test.ts
src/lib/services/chat-stream.ts
```

**4. Manual smoke — this is the one that actually proves Cancel works.** Start the stack (`cd /Users/paul/projects/music-kb && yarn start`), open a video's learn page whose summary is generated, open the notes pane, and click **New note**.

- **Happy path:** type a prompt, click **Generate**. Button reads `Generating…`; after the model finishes, the full markdown appears in the Tiptap editor in one write and the title auto-fills from the H1. In the browser devtools Network tab, `/api/notes/compose` shows `Content-Type: application/json`, **not** `text/event-stream`, and its response body is a single `{"markdown":"…"}` object.
- **Cancel path:** type a prompt, click **Generate**, and while it reads `Generating…` click **Cancel**. The button must be **clickable** (it was disabled before this phase). The composer closes immediately, no red error strip flashes, and the Network tab shows the `/api/notes/compose` request as `(cancelled)`.
- **Failure path:** with a compose in flight, `pkill ollama` in another terminal. The red error strip must show a real message — `AI server unreachable. Is Ollama running on port 11434?` — and the editor's existing content must be **unchanged**. It must not show an empty note and it must not show a silent success.

---

### Do NOT

- **Do NOT drop `throwOnRunError` "because 0.49.1 handles it".** The repo is pinned at `@tanstack/ai` 0.45.1 (`client/package.json:22`) and 0.45.1's `streamToText` has no `RUN_ERROR` branch at all — the endpoint would answer 200 with an empty note and overwrite the user's draft with nothing. Even after Phase 1 lands, keeping it is what makes this file behave identically on both versions.
- **Do NOT delete `client/src/lib/services/chat-stream.ts` or any of its tests.** Three consumers remain (`VideoChat`, `DigestChat`, `useLibraryChat`). Retiring that module is explicitly a non-goal — see `docs/tanstack-ai-upgrade-plan.md` §4 and §Phase 5. Removing NoteComposer from its consumer list does not shrink it.
- **Do NOT push partial markdown into the editor now that you have a string.** The old header comment claimed the note "assembles live"; it never did — `handleGenerate` accumulated into a local and wrote once. Tiptap renders half-formed headings and open code fences badly, and every mid-flight `setContent` churns editor state. Writing once is the pre-existing behaviour and the reason this phase is byte-identical to the user.
- **Do NOT re-enable `disabled={streaming}` on the Cancel button.** That is the exact defect this phase closes. Do, however, leave `saving` and `deleting` in that list — those are Strapi writes with no abort plumbing.
- **Do NOT swallow the abort by matching on `err.name === 'AbortError'` alone.** Check `controller.signal.aborted`, as written. The rejection type differs between browsers, jsdom, and Node's undici, and a name-match that misses turns every Cancel into a red error strip.
- **Do NOT convert the route's 400 / 404 / 409 guard clauses to JSON.** They answer in plain text today and `requestCompose` is written to accept both shapes on a non-OK response. Converting them is scope creep that would silently break any other caller of this endpoint.
- **Do NOT use `Response.json(...)`.** Use `new Response(JSON.stringify(...), { headers: { 'Content-Type': 'application/json' } })` as written. `Response.json` is a static that exists in modern Node, but nothing else in this codebase uses it and the explicit form is what the tests assert against (`res.headers.get('Content-Type')` must be exactly `application/json`, not `application/json;charset=UTF-8`).
- **Do NOT `sed`-rename the `streaming` state variable to `generating`.** The word appears in comments, in a placeholder string, and across a dozen `disabled` props; a blind rename corrupts user-visible copy. The header comment added in Task 2.2 Step 1 explains what the name now means.
- **Be aware:** a de-streamed endpoint holds one request open with zero bytes flowing until the model finishes. On a slow local model that can be a minute. This is fine for `client/`, which is **dev-local only** (per `CLAUDE.md`, "only `web` deploys publicly"), but if `client/` is ever put behind a proxy or a serverless function with a response timeout, this endpoint is the first thing that will break. Do not "fix" that here by re-adding a keepalive stream.

---

### Commit

```bash
cd /Users/paul/projects/music-kb && git add client/src/routes/api.notes.compose.tsx client/src/routes/api.notes.compose.test.ts client/src/components/NoteComposer.tsx && git commit -m "$(cat <<'EOF'
refactor(notes): de-stream the composer and make Cancel actually cancel

/api/notes/compose was SSE for no reason. NoteComposer never rendered a
partial draft — it accumulated every TEXT_MESSAGE_CONTENT delta into a local
and wrote the Tiptap editor once, after the stream closed, because partial
markdown renders badly (half-formed headings, open code fences, mid-word
italics). The deltas existed only to be re-joined on arrival. So join them at
the source: the endpoint now answers one JSON body, `{ markdown }`, built with
@tanstack/ai's `streamToText`. Byte-identical for the user.

What it buys: this surface stops being one of `chat-stream.ts`'s four
consumers, which takes it out of the AG-UI wire-format blast radius entirely.
0.48.0 made the SSE wire spec-only — TOOL_CALL_END now carries `toolCallId`
alone — and the parser is going to keep tracking that. The note composer no
longer has to.

The wrapper around `streamToText` is load-bearing, not padding. At the pinned
0.45.1 `streamToText` ignores every chunk that is not TEXT_MESSAGE_CONTENT,
RUN_ERROR included, and resolves to the empty string on a dead run — so a
model that died mid-generation would have answered 200 and replaced the user's
draft with nothing, silently. `throwOnRunError` re-raises it first. 0.49.1
fixed this upstream; the wrapper stays so the file is correct on both.

Errors now go through `model.friendlyError`, the tier-paired mapper. Local is
unchanged (it IS friendlyOllamaError). Frontier — reachable here since ADR
0011 — is now redacted and non-echoing instead of putting raw provider text on
the wire.

Cancel was `disabled={streaming}`, which left the user with no way out of a
sixty-second local generation short of reloading. It now aborts the in-flight
fetch and closes; the component also aborts on unmount, and a user-initiated
abort is not reported as an error.

Adds api.notes.compose.test.ts (5 tests) — the endpoint had none. Two of them
exist solely to fail if `throwOnRunError` is ever dropped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — DigestChat onto `useChat` (the pilot)

**Goal:** Replace DigestChat's hand-rolled fetch/SSE/merge loop with `@tanstack/ai-react`'s `useChat`, and replace the digest route's hand-rolled `expandHistoryForModel` with the SDK's AG-UI `RunAgentInput` parser — deleting both without changing the route URL, the 2–5 videoIds validation, or the visible UI.

**Files touched:**
- `/Users/paul/projects/music-kb/client/package.json` (add one dependency)
- `/Users/paul/projects/music-kb/client/src/lib/services/ai-messages.ts` (**new**)
- `/Users/paul/projects/music-kb/client/src/lib/services/ai-messages.test.ts` (**new**)
- `/Users/paul/projects/music-kb/client/src/components/DigestChat.tsx` (rewritten)
- `/Users/paul/projects/music-kb/client/src/routes/api.digest-chat.tsx` (rewritten)

**Prerequisites:**
- **Phase 1 must be done** (`@tanstack/ai` at `0.49.1`, `@tanstack/ai-anthropic` at `0.18.0`, `@tanstack/ai-ollama` at `0.10.0`). `@tanstack/ai-react@0.22.1` declares `"@tanstack/ai": "^0.49.1"` as a peer dependency — verified in the installed package at `/Users/paul/learning/tanstack-ai/tanstack-client/node_modules/@tanstack/ai-react/package.json`. Installing it against music-kb's current `0.45.1` will produce a peer-dependency warning and `uiMessagesToWire` will not exist at the import path this phase uses.
- Phase 0 is already applied on disk: `client/src/lib/services/chat-tools.ts:36` now reads `name: 'kb_web_search'`. The **exported binding is still `webSearchTool`**, so this phase's route keeps importing `webSearchTool`.
- Phase 2 is *not* a prerequisite. This phase touches no NoteComposer code.

**Estimated effort:** 1 day.

---

### Verified claim: `reload()` replays chat-level props only

The brief asked me to verify this against the `ai-client` source rather than assert it. **Confirmed**, at `/Users/paul/learning/tanstack-ai/.reference/tanstack-ai/packages/ai-client/src/chat-client.ts`:

- `:367` — `private pendingMessageBody: Record<string, any> | undefined = undefined`
- `:2070` — inside `sendMessage(content, body, sendOptions)`: `this.pendingMessageBody = body`. **This is the only assignment that sets it to a value.**
- `:2264-2268` — inside `streamResponse()`:
  ```ts
  const mergedBody = {
    ...this.bodyOption,
    ...this.forwardedPropsOption,
    ...this.pendingMessageBody,
  }
  ```
- `:2271` — `this.pendingMessageBody = undefined` — cleared immediately after the merge, before the request is built.
- `:2515-2542` — `reload()` cancels the stream, removes messages after the last user message, then calls `await this.streamResponse()` **and never touches `pendingMessageBody`**.

So on a `reload()`, `mergedBody` is `{...bodyOption, ...forwardedPropsOption}` and the per-send body from the original `sendMessage` is gone. Chat-level `forwardedProps` survives; per-send `body` does not. `videoIds` and `modelChoice` are both required by the route on **every** request (a missing `videoIds` is a hard 400), so both must live in chat-level `forwardedProps`.

Chat-level `forwardedProps` also stays live across re-renders — it is *not* frozen at first render like `fetcher` is. `/Users/paul/learning/tanstack-ai/.reference/tanstack-ai/packages/ai-react/src/use-chat.ts:321-325`:
```ts
useEffect(() => {
  if (options.forwardedProps !== undefined) {
    client.updateOptions({ forwardedProps: options.forwardedProps })
  }
}, [client, options.forwardedProps])
```
and `chat-client.ts:3066-3068` assigns `this.forwardedPropsOption = options.forwardedProps`. The `fetcher`, by contrast, is captured once inside the `useMemo` that constructs the `ChatClient` (`use-chat.ts:105-147`) — which is exactly why this phase's fetcher is defined at **module scope** and closes over nothing.

---

### Task 3.1 — Add `@tanstack/ai-react`

- [ ] **Step 1: Install the pinned version**

```bash
cd /Users/paul/projects/music-kb/client && yarn add @tanstack/ai-react@0.22.1 --exact
```

- [ ] **Step 2: Verify the pin and the resolved peer**

```bash
cd /Users/paul/projects/music-kb/client && \
  node -e "const p=require('./package.json');console.log('ai-react:',p.dependencies['@tanstack/ai-react']);console.log('ai:',p.dependencies['@tanstack/ai'])" && \
  node -e "console.log('installed ai-client:',require('./node_modules/@tanstack/ai-client/package.json').version)"
```

Expected output, exactly:
```
ai-react: 0.22.1
ai: 0.49.1
installed ai-client: 0.28.0
```

If `installed ai-client` is anything other than `0.28.x`, stop — `@tanstack/ai-react@0.22.1` depends on `@tanstack/ai-client ^0.28.0` and the `forwardedProps` merge order relied on above is that version's.

- [ ] **Step 3: Confirm the `@tanstack/ai/client` subpath resolves**

```bash
cd /Users/paul/projects/music-kb/client && \
  node -e "console.log(Object.keys(require('./node_modules/@tanstack/ai/package.json').exports))" && \
  grep -c uiMessagesToWire ./node_modules/@tanstack/ai/dist/esm/client.js
```

Expected: the key list includes `./client`, and the grep count is `2` (one import, one re-export).

> `@mcp-ui/client` appears in `@tanstack/ai-react`'s `peerDependencies` but is marked `optional: true` in `peerDependenciesMeta`. Do **not** install it. The working reference app at `/Users/paul/learning/tanstack-ai/tanstack-client` does not have it and runs fine.

---

### Task 3.2 — Write the shared message helper (Phase 4 reuses this file)

- [ ] **Step 1: Create `/Users/paul/projects/music-kb/client/src/lib/services/ai-messages.ts`**

This is the shared `parts → text` helper the brief asked for, plus one companion function. Both are pure, dependency-free, and typed **structurally** rather than against an SDK type — deliberately, because the same two shapes have to be flattened on two sides of the wire: on the client `useChat` hands back `UIMessage` objects that carry `parts`, while on the server `chatParamsFromRequestBody` hands back AG-UI wire messages whose `parts` were explicitly stripped (`packages/ai/src/utilities/chat-params.ts:124-134`, `dropInboundParts`) and whose text lives in `content`. Importing `@tanstack/ai-react`'s `UIMessage` here would also drag client types into the server route's import graph for no benefit.

```ts
// Message flattening shared by the useChat surfaces and the chat routes.
//
// Two message shapes have to be reduced to the same plain text:
//
//   • CLIENT — `useChat().messages` are `UIMessage`s: text lives in
//     `parts[]` entries of `{ type: 'text', content: string }`, interleaved
//     with 'tool-call', 'tool-result' and 'thinking' parts.
//   • SERVER — `chatParamsFromRequestBody()` returns AG-UI wire messages,
//     which have NO `parts` (the validator strips inbound `parts` outright)
//     and carry their text in `content`, as a string or as an array of
//     content entries.
//
// Both are handled here rather than in two near-identical private helpers,
// because a divergence between them is exactly the class of bug that does not
// throw — it just produces an empty prompt or an empty bubble.
//
// The parameter types are structural (`{ role?: unknown; ... }`) on purpose:
// @tanstack/ai and @tanstack/ai-client each declare their own `UIMessage`,
// and the AG-UI wire message is a third shape again. Naming any one of them
// would force casts at two of the three call sites.

/** The `{ role, content }` shape `learning.ts`'s `ChatMessage` uses. */
export type PlainChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type MaybePart = {
  type?: unknown;
  content?: unknown;
};

type MaybeMessage = {
  role?: unknown;
  parts?: unknown;
  content?: unknown;
};

type MaybeToolCall = {
  id?: unknown;
};

type MaybeToolCarrier = {
  role?: unknown;
  content?: unknown;
  toolCallId?: unknown;
  toolCalls?: unknown;
};

/**
 * Flatten one message to its plain text.
 *
 * Concatenates every `type: 'text'` part in order and ignores everything
 * else — tool calls, tool results, thinking, images, structured output. Falls
 * back to a string `content`, then to an array `content`, for wire messages
 * that never had `parts`.
 *
 * Returns '' rather than null for a message with no text (e.g. an assistant
 * turn that was nothing but a tool call), so callers can use a truthiness
 * check without a null branch.
 */
export function messageText(message: MaybeMessage): string {
  const parts = message.parts;
  if (Array.isArray(parts)) {
    let text = '';
    for (const part of parts as Array<MaybePart | null | undefined>) {
      if (part && part.type === 'text' && typeof part.content === 'string') {
        text += part.content;
      }
    }
    return text;
  }

  const content = message.content;
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    let text = '';
    for (const entry of content as Array<MaybePart | string | null | undefined>) {
      if (typeof entry === 'string') {
        text += entry;
      } else if (
        entry &&
        entry.type === 'text' &&
        typeof entry.content === 'string'
      ) {
        text += entry.content;
      }
    }
    return text;
  }

  return '';
}

/**
 * Reduce a message list to the `{ role, content }` pairs the retrieval
 * helpers in `learning.ts` take (`prepareDigestChatPrompt`,
 * `askAboutVideoService`).
 *
 * Drops every role those helpers do not model — 'tool', 'reasoning',
 * 'system', 'developer', 'activity' — and drops messages that flatten to no
 * text at all, so an assistant turn consisting only of a tool call cannot
 * enter the BM25 query as an empty string.
 */
export function toPlainChatMessages(
  messages: ReadonlyArray<MaybeMessage>,
): PlainChatMessage[] {
  const out: PlainChatMessage[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = messageText(message);
    if (content.trim() === '') continue;
    out.push({ role: message.role, content });
  }
  return out;
}

/**
 * Remove assistant `toolCalls` entries that have no matching `role: 'tool'`
 * message in the same list.
 *
 * WHY THIS EXISTS: `uiMessagesToWire` emits the assistant anchor's
 * `toolCalls` unconditionally, but skips the paired `role: 'tool'` fan-out
 * when the tool-call part has no `output`
 * (@tanstack/ai 0.49.1, packages/ai/src/utilities/ag-ui-wire.ts:230-238).
 * A run stopped between TOOL_CALL_START and TOOL_CALL_RESULT therefore
 * round-trips as a tool call with no result. Ollama tolerates that; Anthropic
 * returns a 400 ("tool_use ids were found without tool_result blocks"), and
 * digest-chat is switchable to the frontier tier. Before `stop()` existed on
 * this surface the state was unreachable; adding it makes it reachable.
 *
 * An assistant turn left with zero tool calls AND no text is dropped whole —
 * an empty assistant message is not something to send a provider.
 *
 * Generic over the element type so the caller's message type survives.
 */
export function dropOrphanToolCalls<T>(messages: ReadonlyArray<T>): T[] {
  const resolved = new Set<string>();
  for (const message of messages as ReadonlyArray<MaybeToolCarrier>) {
    if (message.role === 'tool' && typeof message.toolCallId === 'string') {
      resolved.add(message.toolCallId);
    }
  }

  const out: T[] = [];
  for (const message of messages) {
    const carrier = message as MaybeToolCarrier;
    if (carrier.role !== 'assistant' || !Array.isArray(carrier.toolCalls)) {
      out.push(message);
      continue;
    }

    const calls = carrier.toolCalls as Array<MaybeToolCall>;
    const kept = calls.filter(
      (call) => typeof call.id === 'string' && resolved.has(call.id),
    );
    if (kept.length === calls.length) {
      out.push(message);
      continue;
    }

    const text = typeof carrier.content === 'string' ? carrier.content : '';
    if (kept.length === 0 && text.trim() === '') continue;

    const next = { ...(message as object) } as MaybeToolCarrier;
    if (kept.length === 0) {
      delete next.toolCalls;
    } else {
      next.toolCalls = kept;
    }
    out.push(next as T);
  }
  return out;
}
```

- [ ] **Step 2: Create `/Users/paul/projects/music-kb/client/src/lib/services/ai-messages.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import {
  messageText,
  toPlainChatMessages,
  dropOrphanToolCalls,
} from '#/lib/services/ai-messages';

describe('messageText', () => {
  it('concatenates text parts in order and ignores non-text parts', () => {
    const message = {
      id: 'm1',
      role: 'assistant',
      parts: [
        { type: 'thinking', content: 'hmm' },
        { type: 'text', content: 'Both videos ' },
        { type: 'tool-call', id: 't1', name: 'kb_web_search', arguments: '{}' },
        { type: 'text', content: 'agree on tempo.' },
        { type: 'tool-result', toolCallId: 't1', content: '{"results":[]}' },
      ],
    };
    expect(messageText(message)).toBe('Both videos agree on tempo.');
  });

  it('reads a wire message string content when there are no parts', () => {
    expect(messageText({ id: 'm2', role: 'user', content: 'hi' })).toBe('hi');
  });

  it('reads a wire message array content', () => {
    const message = {
      id: 'm3',
      role: 'user',
      content: [
        { type: 'text', content: 'a' },
        { type: 'image', source: { type: 'url', value: 'x' } },
        { type: 'text', content: 'b' },
      ],
    };
    expect(messageText(message)).toBe('ab');
  });

  it('returns an empty string for a tool-call-only assistant turn', () => {
    const message = {
      id: 'm4',
      role: 'assistant',
      parts: [{ type: 'tool-call', id: 't1', name: 'kb_web_search', arguments: '{}' }],
    };
    expect(messageText(message)).toBe('');
  });
});

describe('toPlainChatMessages', () => {
  it('keeps user and assistant text and drops every other role', () => {
    const messages = [
      { id: '1', role: 'system', content: 'you are a bot' },
      { id: '2', role: 'user', content: 'what do they agree on?' },
      { id: '3', role: 'assistant', content: null, toolCalls: [{ id: 't1' }] },
      { id: '4', role: 'tool', toolCallId: 't1', content: '{"results":[]}' },
      { id: '5', role: 'reasoning', content: 'thinking out loud' },
      { id: '6', role: 'assistant', content: 'Tempo.' },
    ];
    expect(toPlainChatMessages(messages)).toEqual([
      { role: 'user', content: 'what do they agree on?' },
      { role: 'assistant', content: 'Tempo.' },
    ]);
  });
});

describe('dropOrphanToolCalls', () => {
  it('keeps a tool call that has a matching tool message', () => {
    const messages = [
      { id: '1', role: 'user', content: 'q' },
      { id: '2', role: 'assistant', toolCalls: [{ id: 't1', type: 'function' }] },
      { id: '3', role: 'tool', toolCallId: 't1', content: 'ok' },
    ];
    expect(dropOrphanToolCalls(messages)).toEqual(messages);
  });

  it('drops a tool-call-only assistant turn whose call has no result', () => {
    const messages = [
      { id: '1', role: 'user', content: 'q' },
      { id: '2', role: 'assistant', toolCalls: [{ id: 't1', type: 'function' }] },
    ];
    expect(dropOrphanToolCalls(messages)).toEqual([
      { id: '1', role: 'user', content: 'q' },
    ]);
  });

  it('keeps the text but strips the orphan call when the turn has both', () => {
    const messages = [
      { id: '1', role: 'user', content: 'q' },
      {
        id: '2',
        role: 'assistant',
        content: 'Let me look that up.',
        toolCalls: [{ id: 't1', type: 'function' }],
      },
    ];
    expect(dropOrphanToolCalls(messages)).toEqual([
      { id: '1', role: 'user', content: 'q' },
      { id: '2', role: 'assistant', content: 'Let me look that up.' },
    ]);
  });

  it('keeps resolved calls and strips only the unresolved one', () => {
    const messages = [
      {
        id: '2',
        role: 'assistant',
        content: 'x',
        toolCalls: [{ id: 't1', type: 'function' }, { id: 't2', type: 'function' }],
      },
      { id: '3', role: 'tool', toolCallId: 't1', content: 'ok' },
    ];
    const out = dropOrphanToolCalls(messages) as Array<{
      toolCalls?: Array<{ id: string }>;
    }>;
    expect(out[0].toolCalls).toEqual([{ id: 't1', type: 'function' }]);
  });
});
```

- [ ] **Step 3: Verify the helper in isolation**

```bash
cd /Users/paul/projects/music-kb/client && yarn vitest run src/lib/services/ai-messages.test.ts
```

Expected: `Test Files  1 passed (1)` and `Tests  9 passed (9)`.

---

### Task 3.3 — Rewrite the route onto `chatParamsFromRequestBody`

The current file is 152 lines; `expandHistoryForModel` plus its two type declarations occupy `api.digest-chat.tsx:19-79`. All of it goes.

- [ ] **Step 1: Read the code being deleted, so the replacement is verifiably equivalent**

Current `/Users/paul/projects/music-kb/client/src/routes/api.digest-chat.tsx:43-79` is the whole `expandHistoryForModel` function — it fans one client `ChatMessage` out into an assistant `toolCalls` message plus one `role: 'tool'` message per completed call, then an assistant text message. `uiMessagesToWire` (run client-side by the code in Task 3.4) produces the same fan-out, and `chat()`'s `convertMessagesToModelMessages` de-dups it (`packages/ai/src/activities/chat/messages.ts:139-172`). The one behaviour `expandHistoryForModel` had that the SDK does not is the `status === 'done'` filter at `:50` — that is what `dropOrphanToolCalls` from Task 3.2 restores.

Current `:97-102` is the validation that must survive verbatim:
```ts
        const videoIds = Array.isArray(body.videoIds)
          ? body.videoIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
          : [];
        if (videoIds.length < 2 || videoIds.length > 5) {
          return new Response('videoIds must contain 2–5 items', { status: 400 });
        }
```

- [ ] **Step 2: Replace the entire contents of `/Users/paul/projects/music-kb/client/src/routes/api.digest-chat.tsx` with this**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import {
  chat,
  chatParamsFromRequestBody,
  toServerSentEventsResponse,
} from '@tanstack/ai';
import { fetchVideoByVideoIdService } from '#/lib/services/videos';
import { prepareDigestChatPrompt } from '#/lib/services/learning';
import { webSearchTool } from '#/lib/services/chat-tools';
import { resolveRequestModel, withSystem } from '#/lib/services/chat-model-request';
import {
  dropOrphanToolCalls,
  toPlainChatMessages,
} from '#/lib/services/ai-messages';

// Streaming chat endpoint for the /digest page — cross-video chat against
// N selected videos (2-5). Speaks the AG-UI `RunAgentInput` wire format, which
// is what `@tanstack/ai-client` sends and what `chatParamsFromRequestBody`
// validates; the request body is no longer a bespoke `{ videoIds, messages,
// modelChoice }` envelope.
//
// The per-request options that used to be top-level body fields now arrive in
// `forwardedProps`, which is the AG-UI field for exactly this. `DigestChat`
// sets them as CHAT-LEVEL forwardedProps rather than per-send, because
// `ChatClient.reload()` re-streams without replaying a per-send body
// (chat-client.ts:2264-2271 merges then clears `pendingMessageBody`;
// reload() at :2515 never sets it). A `videoIds` that only rode along on the
// first send would make every regenerate a 400.
//
// `expandHistoryForModel` and its two hand-written message types used to live
// here — 60 of this file's 152 lines. The client now serializes history with
// the SDK's own `uiMessagesToWire`, and `chat()` normalizes the AG-UI fan-out
// internally, so both are gone.
//
// The model still has the `kb_web_search` tool available since cross-video
// questions often spill outside the selected transcripts.

export const Route = createFileRoute('/api/digest-chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let rawBody: unknown;
        try {
          rawBody = await request.json();
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }

        // Throws (does not return) on a body that is not a valid AG-UI
        // RunAgentInput. The thrown message can quote request fragments, so it
        // is logged rather than echoed to the caller.
        let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
        try {
          params = await chatParamsFromRequestBody(rawBody);
        } catch (err) {
          console.warn('[digest-chat] invalid AG-UI request body:', err);
          return new Response('Invalid AG-UI request body', { status: 400 });
        }

        // UNCHANGED from the pre-useChat route, only the source moved from
        // `body.videoIds` to `forwardedProps.videoIds`. `forwardedProps` is
        // client-controlled JSON and is never trusted.
        const rawVideoIds = params.forwardedProps.videoIds;
        const videoIds = Array.isArray(rawVideoIds)
          ? rawVideoIds.filter(
              (v): v is string => typeof v === 'string' && v.length > 0,
            )
          : [];
        if (videoIds.length < 2 || videoIds.length > 5) {
          return new Response('videoIds must contain 2–5 items', { status: 400 });
        }

        const videos = [];
        for (const id of videoIds) {
          const v = await fetchVideoByVideoIdService(id);
          if (!v) {
            return new Response(`Video not found: ${id}`, { status: 404 });
          }
          if (v.summaryStatus !== 'generated') {
            return new Response(`Summary not ready for ${id}`, { status: 409 });
          }
          videos.push(v);
        }

        // Retrieval only needs the plain user/assistant text — it BM25s the
        // latest user turn. Tool and reasoning turns would only dilute it.
        const history = toPlainChatMessages(params.messages);
        const { system, retrievedCount } = await prepareDigestChatPrompt(
          videos,
          history,
        );

        // A run the user stopped between TOOL_CALL_START and TOOL_CALL_RESULT
        // round-trips as an assistant tool call with no `role: 'tool'` partner.
        // Anthropic 400s on that; strip it before it reaches the adapter.
        const modelMessages = dropOrphanToolCalls(params.messages);

        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [digest-chat] → streaming`,
          {
            videos: videos.length,
            retrievedChunks: retrievedCount,
            messages: modelMessages.length,
          },
        );

        // Choice TOKEN, not a model id — validated server-side against the
        // installed Ollama catalogue before an adapter is built.
        const modelChoice =
          typeof params.forwardedProps.modelChoice === 'string'
            ? params.forwardedProps.modelChoice
            : undefined;
        const { model, notice } = await resolveRequestModel(
          'digest-chat',
          modelChoice,
        );
        if (notice) console.warn(`[digest-chat] ${notice}`);

        const stream = chat({
          // No modelOptions below: this surface deliberately runs at
          // Ollama's default temperature. That is the pre-existing
          // behaviour, not an oversight — adding sampling here is a
          // generation-quality change, not a refactor.
          adapter: model.adapter,
          ...withSystem(model, system, modelMessages),
          tools: [webSearchTool],
          // Echo the client's correlation ids back onto the run so the
          // devtools and the SSE terminal frames key to the same run.
          threadId: params.threadId,
          runId: params.runId,
        });

        return toServerSentEventsResponse(stream);
      },
    },
  },
});
```

- [ ] **Step 3: Verify the route file compiles and nothing else referenced the deleted symbols**

```bash
cd /Users/paul/projects/music-kb/client && \
  grep -rn "expandHistoryForModel" src/routes/api.digest-chat.tsx ; \
  echo "exit=$?"
```

Expected: no output lines, and `exit=1` (grep found nothing). `expandHistoryForModel` still exists in `src/routes/api.chat.tsx` — that is Phase 4's copy and **must not** be touched here.

---

### Task 3.4 — Rewrite `DigestChat.tsx` onto `useChat`

- [ ] **Step 1: Replace the entire contents of `/Users/paul/projects/music-kb/client/src/components/DigestChat.tsx` with this**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat, type ChatFetcher, type UIMessage } from '@tanstack/ai-react';
import { uiMessagesToWire } from '@tanstack/ai/client';
import { ModelPicker } from '#/components/ModelPicker';
import { Link } from '@tanstack/react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { StrapiVideo } from '#/lib/services/videos';
import { Button } from '#/components/ui/button';
import { messageText } from '#/lib/services/ai-messages';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';

// Chat UI for the /digest page. Simpler than VideoChat: no timecode seek
// (no embedded player), no evidence accordion (chunks come from N videos
// so the per-citation plumbing would be heavier than worth it for v1),
// no slash commands. Just send → stream → render markdown → repeat.
//
// The conversation state, the SSE plumbing and the tool-call merge state
// machine are all `useChat`'s now. What used to be a local `Message[]` plus a
// `ToolCallRecord[]` reducer is `UIMessage.parts`, which the SDK's stream
// processor fills from TOOL_CALL_START / _ARGS / _END / _RESULT — including
// taking the tool NAME off TOOL_CALL_START, which is the only frame that
// still carries it at @tanstack/ai 0.49.1.

// MODULE SCOPE ON PURPOSE. `useChat` builds its ChatClient inside a `useMemo`
// on first render (ai-react use-chat.ts:105-147) and never rebuilds it, so a
// fetcher defined inside the component would freeze that render's closure —
// the picker would change the UI and keep sending the first model forever,
// silently, with no error. This fetcher closes over nothing: everything
// per-request arrives as the `data` argument, which is the merged
// forwardedProps the chat client hands in.
const digestChatFetcher: ChatFetcher = async (
  { messages, data, threadId, runId },
  { signal },
) => {
  const res = await fetch('/api/digest-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    // AG-UI RunAgentInput. This is byte-for-byte the envelope
    // `fetchServerSentEvents` would build (ai-client
    // connection-adapters.ts:1220-1252). We hand-roll it so that a non-2xx
    // response can be read for its BODY — `fetchServerSentEvents` collapses
    // every error to "HTTP error! status: 409 Conflict" (assertResponseOk,
    // connection-adapters.ts:503-517), which would throw away this route's
    // "Summary not ready for <id>" and "Video not found: <id>" messages.
    body: JSON.stringify({
      threadId,
      runId,
      state: {},
      // `@tanstack/ai` and `@tanstack/ai-client` each declare their own
      // structurally-near-identical `UIMessage`; the cast is the seam between
      // the two declarations, not a shape change.
      messages: uiMessagesToWire(
        messages as unknown as Parameters<typeof uiMessagesToWire>[0],
      ),
      // No client-executed tools on this surface — kb_web_search runs
      // server-side inside chat()'s agent loop.
      tools: [],
      context: [],
      forwardedProps: data ?? {},
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `digest-chat (${res.status}): request failed`);
  }
  return res;
};

const SUGGESTED_PROMPTS = [
  'What do these videos agree on?',
  'Where do they disagree?',
  'Which video goes deepest on the technical details?',
  'Summarize the throughline across all of them',
];

export function DigestChat({
  videos,
  className,
}: Readonly<{ videos: StrapiVideo[]; className?: string }>) {
  // Per-conversation model choice. 'default' preserves prior behaviour.
  const [modelChoice, setModelChoice] = useState<string>('default');
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const videoIds = useMemo(
    () => videos.map((v) => v.youtubeVideoId),
    [videos],
  );

  // CHAT-LEVEL, not per-send. `reload()` re-streams the last user turn with
  // `{...bodyOption, ...forwardedPropsOption}` only — the per-send body is
  // cleared the moment it is merged (ai-client chat-client.ts:2264-2271) and
  // reload (:2515) never re-sets it. The route hard-400s on a missing
  // `videoIds`, so a per-send body would make Retry fail every time.
  // Memoized so the identity only changes when a value actually does: the
  // hook syncs on `options.forwardedProps` identity (use-chat.ts:321-325).
  const forwardedProps = useMemo(
    () => ({ videoIds, modelChoice }),
    [videoIds, modelChoice],
  );

  const { messages, sendMessage, reload, stop, clear, isLoading, error } =
    useChat({
      fetcher: digestChatFetcher,
      forwardedProps,
    });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    void sendMessage(trimmed);
    setInput('');
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(input);
  };

  const onClear = () => {
    if (isLoading) return;
    clear();
  };

  // The raw message is adapter text (Ollama connection refused, model not
  // pulled) or this route's own 4xx body. `friendlyOllamaError` is idempotent
  // on its own output and returns its input unchanged when nothing matches,
  // so a Strapi-side message like "Summary not ready for abc123" passes
  // through verbatim.
  const errorText = error ? friendlyOllamaError(error.message) : null;

  // `useChat` creates the assistant message from stream events, so between
  // the send and the first frame there is no assistant bubble at all.
  const awaitingFirstFrame =
    isLoading && messages[messages.length - 1]?.role !== 'assistant';

  return (
    <section
      className={`flex min-h-0 flex-col ${className ?? ''}`}
      aria-label="Cross-video chat"
    >
      <header className="shrink-0 flex items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Ask across these videos
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Answered using retrieved passages from all {videos.length} videos.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ModelPicker
            surface="digest-chat"
            value={modelChoice}
            onChange={setModelChoice}
            disabled={isLoading}
          />
          {messages.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClear}
              disabled={isLoading}
            >
              Clear
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 pb-4">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => send(p)}
                disabled={isLoading}
                className="rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1 text-xs text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4 pb-4">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} videos={videos} />
          ))}
          {awaitingFirstFrame && <ThinkingBubble />}
          <div ref={bottomRef} />
        </div>
      </div>

      {errorText && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <span className="min-w-0">{errorText}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void reload()}
            disabled={isLoading}
          >
            Retry
          </Button>
        </div>
      )}

      <form onSubmit={onSubmit} className="shrink-0 flex gap-2 pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about these videos…"
          disabled={isLoading}
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none disabled:opacity-50"
        />
        {isLoading ? (
          <Button type="button" size="pill" variant="outline" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" size="pill" disabled={!input.trim()}>
            Send
          </Button>
        )}
      </form>
    </section>
  );
}

function ThinkingBubble() {
  return (
    <div className="mr-auto max-w-[95%]">
      <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm text-[var(--ink-muted)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" />
        <span>Thinking…</span>
      </div>
    </div>
  );
}

// One tool call, read straight off `UIMessage.parts`. The discriminant on a
// 'tool-call' part is `name` (NOT `toolName`), `arguments` is a JSON *string*,
// and `state` runs 'awaiting-input' → 'input-streaming' → 'input-complete' →
// 'complete' | 'error'.
type ToolChip = { id: string; name: string; done: boolean };

function toolChips(message: UIMessage): ToolChip[] {
  const chips: ToolChip[] = [];
  for (const part of message.parts) {
    if (part.type !== 'tool-call') continue;
    chips.push({
      id: part.id,
      name: part.name,
      done: part.state === 'complete' || part.state === 'error',
    });
  }
  return chips;
}

function MessageBubble({
  message,
  videos,
}: Readonly<{ message: UIMessage; videos: StrapiVideo[] }>) {
  const content = messageText(message);

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)]/10 px-4 py-2.5 text-sm text-[var(--ink)]">
        {content}
      </div>
    );
  }

  // Assistant — render markdown + optionally tool-call chips
  const chips = toolChips(message);
  return (
    <div className="mr-auto max-w-[95%]">
      {chips.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {chips.map((tc) => (
            <span
              key={tc.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)]"
            >
              {tc.done ? '✓' : '⋯'} {tc.name}
            </span>
          ))}
        </div>
      )}
      {content ? (
        <div className="chat-md rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--ink)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          <CitationFooter content={content} videos={videos} />
        </div>
      ) : (
        <ThinkingBubble />
      )}
    </div>
  );
}

// Extract `[<title> mm:ss]` citations from the response and render as
// clickable chips that link to the source video's learn page. The chat
// bubble shows the raw text inline; this footer adds navigation.
function CitationFooter({
  content,
  videos,
}: Readonly<{ content: string; videos: StrapiVideo[] }>) {
  const regex = /\[([^\]]+?)\s+(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
  const seen = new Set<string>();
  const cites: Array<{ title: string; timecode: string; video: StrapiVideo }> = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const title = match[1].trim();
    const timecode = match[2];
    const video = videos.find(
      (v) =>
        (v.videoTitle ?? '').toLowerCase().includes(title.toLowerCase()) ||
        title.toLowerCase().includes((v.videoTitle ?? '').toLowerCase()),
    );
    if (!video) continue;
    const key = `${video.youtubeVideoId}-${timecode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cites.push({ title, timecode, video });
  }

  if (cites.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
        Sources:
      </span>
      {cites.map((c, i) => (
        <Link
          key={`${c.video.youtubeVideoId}-${i}`}
          to="/learn/$videoId"
          params={{ videoId: c.video.youtubeVideoId }}
          className="inline-flex max-w-[200px] items-center rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <span className="truncate">
            {c.video.videoTitle ?? c.video.youtubeVideoId} · {c.timecode}
          </span>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Confirm `DigestChat` no longer imports the hand-rolled transport**

```bash
cd /Users/paul/projects/music-kb/client && \
  grep -rn "chat-stream\|streamDigestChat\|ToolCallRecord" src/components/DigestChat.tsx ; \
  echo "exit=$?"
```

Expected: no output lines, `exit=1`.

- [ ] **Step 3: Confirm `chat-stream.ts` still has its other consumers and was not orphaned**

```bash
cd /Users/paul/projects/music-kb/client && grep -rln "chat-stream" src
```

Expected (Phase 2 already applied, so NoteComposer is gone from this list):
```
src/components/VideoChat.tsx
src/lib/services/chat-stream.ts
src/lib/services/chat-stream.test.ts
src/hooks/useLibraryChat.ts
```
The exact set may differ if Phase 2 was skipped (then `src/components/NoteComposer.tsx` also appears). **Do not delete `chat-stream.ts`.**

---

### Task 3.5 — Typecheck and full suite

- [ ] **Step 1: Typecheck**

```bash
cd /Users/paul/projects/music-kb/client && npx tsc --noEmit -p tsconfig.json
```

Expected: no output, exit code 0.

`verbatimModuleSyntax: true` and `noUnusedLocals: true` are on in `client/tsconfig.json`, so a stray value-import of a type or a leftover unused import is a hard error here, not a warning.

- [ ] **Step 2: Full client suite**

```bash
cd /Users/paul/projects/music-kb/client && yarn test
```

Expected: every file passes, and the total is the previous count **+ 9** (the new `ai-messages.test.ts` cases). No existing test file should change its result — `chat-stream.test.ts` in particular is untouched by this phase.

---

### Verification for the whole phase

Vitest cannot verify this phase. Nothing here is exercised by a hand-authored fixture, and the failure modes (stale forwardedProps, a wire body the route rejects, blank tool chips) are all silent. Run the app.

- [ ] **Step 1: Start the stack**

```bash
cd /Users/paul/projects/music-kb && yarn dev
```

Wait for both `http://localhost:1350` (Strapi) and `http://localhost:3015` (client).

- [ ] **Step 2: Open a digest with exactly 3 videos**

Pick three video ids that have `summaryStatus: 'generated'` and open:
`http://localhost:3015/digest?videos=<id1>,<id2>,<id3>`

- [ ] **Step 3: Send a turn and inspect the request body**

Open DevTools → Network. Click the suggested prompt **"What do these videos agree on?"**. Find the `POST /api/digest-chat` request and read its JSON payload.

Must be true:
- Top-level keys are exactly `threadId`, `runId`, `state`, `messages`, `tools`, `context`, `forwardedProps`.
- `forwardedProps.videoIds` is an array of **3** strings matching the URL.
- `forwardedProps.modelChoice` is `"default"`.
- `messages` is a one-element array `[{ id, role: "user", content: "What do these videos agree on?" }]` — a `content` **string**, not a `parts` array.
- The response streams (`text/event-stream`), and the assistant bubble fills in progressively.

- [ ] **Step 4: Verify the model picker is live, not frozen at first render**

Change the model picker to a different installed local model. Send a second message. In the server terminal, confirm the log line for the second turn names the newly-picked model (via `resolveRequestModel`), not the first one. This is the exact stale-closure failure the module-scope fetcher exists to prevent; if the picker changes nothing, the fetcher was moved inside the component.

- [ ] **Step 5: Verify the tool round-trip and the tool chip**

Send: `Search the web for the current version number of Ableton Live and cite the page.`

Must be true:
- The server terminal prints a line matching `[tool kb_web_search] "…" → N results`.
- The assistant bubble shows a chip reading `⋯ kb_web_search` while running and `✓ kb_web_search` when done. **A chip with a blank name means defect (B) is still live** — it would mean the tool name is being read off `TOOL_CALL_END` somewhere rather than off `TOOL_CALL_START`.

- [ ] **Step 6: Verify history round-trips through the tool turn**

Immediately send a follow-up: `What did that search say again?` Inspect the new `POST /api/digest-chat` body. Must be true:
- `messages` now contains an assistant entry carrying a `toolCalls` array, **and** a separate `{ role: "tool", toolCallId: <same id>, content: … }` entry.
- The response answers from the earlier result rather than searching again or claiming it has no memory. This is what `expandHistoryForModel` used to build by hand.

- [ ] **Step 7: Verify Retry replays `forwardedProps` (the reload claim, end to end)**

With a conversation on screen, click **Retry** — it is only rendered on error, so force one first: stop Ollama (`pkill ollama`), send a message, wait for the red error panel, restart Ollama (`ollama serve`), then click Retry.

Must be true:
- The `POST /api/digest-chat` fired by Retry has `forwardedProps.videoIds` populated with all 3 ids.
- It returns 200 and streams, **not** `400 videoIds must contain 2–5 items`. A 400 here means the props were moved to a per-send `body`.

- [ ] **Step 8: Verify the error body still reaches the user**

```bash
curl -s -o /dev/stderr -w '\nHTTP %{http_code}\n' -X POST http://localhost:3015/api/digest-chat \
  -H 'Content-Type: application/json' \
  -d '{"threadId":"t1","runId":"r1","state":{},"messages":[{"id":"m1","role":"user","content":"hi"}],"tools":[],"context":[],"forwardedProps":{"videoIds":["only-one"],"modelChoice":"default"}}'
```

Expected, exactly:
```
videoIds must contain 2–5 items
HTTP 400
```

Then the same call with a valid 2-id `videoIds` where one video has `summaryStatus !== 'generated'` must return `Summary not ready for <id>` and `HTTP 409`. If either returns `HTTP error! status: …` in the browser instead of this text, the fetcher was replaced with `fetchServerSentEvents` and the error bodies are being discarded.

- [ ] **Step 9: Verify Stop, and that stopping mid-tool-call does not poison the next turn**

Switch the model picker to the frontier (Anthropic) option if `ANTHROPIC_API_KEY` is configured. Send the web-search prompt from Step 5 and click **Stop** while the `⋯ kb_web_search` chip is showing. Then send any follow-up message.

Must be true: the follow-up returns 200 and streams. An Anthropic `400 … tool_use ids were found without tool_result blocks` here means `dropOrphanToolCalls` is not being applied to `params.messages` before `withSystem`.

---

### Do NOT

- **Do NOT use `connection: fetchServerSentEvents('/api/digest-chat')` instead of the `fetcher`.** It builds the identical request body, but `assertResponseOk` (`ai-client/src/connection-adapters.ts:503-517`) throws `HTTP error! status: 409 Conflict` and never reads the body — so `Summary not ready for <id>` and `Video not found: <id>` are lost. Those are user-reachable states on the digest page.
- **Do NOT define `digestChatFetcher` inside the component.** `useChat` constructs its `ChatClient` in a `useMemo` that never re-runs (`ai-react/src/use-chat.ts:105-147`), so the fetcher from render #1 is the only one that ever runs. A fetcher closing over `modelChoice` or `videoIds` would send render-#1's values forever, with no error anywhere. The reference app at `/Users/paul/learning/tanstack-ai/tanstack-client/src/routes/index.tsx:17-33` carries a comment about exactly this.
- **Do NOT move `videoIds` or `modelChoice` to per-send `sendMessage(text, { body })`.** Verified above: `pendingMessageBody` is set only by `sendMessage` (`chat-client.ts:2070`) and cleared during the merge (`:2271`); `reload()` (`:2515`) re-streams without it. Retry would 400 on every attempt.
- **Do NOT build `forwardedProps` inline as an object literal in the `useChat` call.** A fresh object identity every render re-fires the sync effect (`use-chat.ts:321-325`) and calls `client.updateOptions` on every keystroke in the input box. `useMemo` on `[videoIds, modelChoice]` is load-bearing; so is the `useMemo` on `videoIds`, because `videos.map(...)` is a new array every render.
- **Do NOT read `part.toolName` on a `tool-call` part.** The discriminant is `name` (`ai-client/src/types.ts:524-530`). `toolName` is `undefined` there and the chip renders blank — indistinguishable from defect (B).
- **Do NOT parse `part.arguments` as an object.** It is a JSON **string** and may be incomplete while `state` is `'input-streaming'`. This component does not display arguments; if a later change does, `JSON.parse` inside a `try/catch` with the raw string as the fallback is the pattern (`tanstack-client/src/components/MessageList.tsx:46-54`).
- **Do NOT delete `client/src/lib/services/chat-stream.ts` or its test.** `VideoChat` (Phase 4) and `useLibraryChat` (never migrating, per §4 of the plan) still consume it. Migrating this one surface deletes zero lines of it.
- **Do NOT touch `expandHistoryForModel` in `src/routes/api.chat.tsx`.** That is the second, verbatim copy and it belongs to Phase 4. Deleting it now breaks VideoChat.
- **Do NOT change `withSystem` in `chat-model-request.ts`.** It is shared by four routes; §4 of the plan explicitly fences it off. The `messages: never` cast it returns is intentional and this phase spreads it unchanged.
- **Do NOT drop `threadId` / `runId` from the `chat()` call.** They correlate the SSE terminal frames back to the client's run; without them the client falls back to synthesised ids and devtools correlation breaks.
- **Do NOT re-add a `dropped while streaming` guard around `sendMessage`.** `useChat` queues sends that arrive while busy by default (`ai-react/src/types.ts:169-171`), which is strictly better than the old behaviour at `DigestChat.tsx:80`, where a send mid-stream vanished silently. The `if (isLoading) return` in `send()` is only there because the input is disabled anyway; it costs nothing and keeps the suggested-prompt buttons inert mid-stream.

---

### Things I could not verify, stated rather than guessed

- **I did not run any of this.** The repo at `/Users/paul/projects/music-kb` still pins `@tanstack/ai@0.45.1`, so `@tanstack/ai/client` and `chatParamsFromRequestBody` are not installed there yet. Every SDK fact above was read from the 0.49.1 source at `/Users/paul/learning/tanstack-ai/.reference/tanstack-ai` and cross-checked against the installed `node_modules` of the working 0.49.1 app at `/Users/paul/learning/tanstack-ai/tanstack-client`.
- **The `uiMessagesToWire` cast may not be needed.** `@tanstack/ai`'s `UIMessage` (`packages/ai/src/types.ts:576`) and `@tanstack/ai-client`'s (`packages/ai-client/src/types.ts:640`) differ in their generics (`TTools`) and in `MessagePart`'s tool-call branch. They may still be mutually assignable under `skipLibCheck`. **Try removing `as unknown as Parameters<typeof uiMessagesToWire>[0]` first**; if `tsc --noEmit` passes without it, leave it out and delete the two-line comment above it.
- **`chip.name` for a server-executed tool.** I traced `TOOL_CALL_START.toolCallName` → `ToolCallPart.name` in the SDK processor (`packages/ai/src/activities/chat/stream/processor.ts:1368-1400`) and `TOOL_CALL_RESULT` → `output` + a `tool-result` part (`:1556-1610`), so the chip should read `kb_web_search` and reach `state: 'complete'`. I have not seen it on screen. Step 5 of the verification is the check.
- **Whether the frontier (Anthropic) tier tolerates this history without `dropOrphanToolCalls`.** I reasoned it from `ag-ui-wire.ts:230-238` skipping the tool fan-out when `part.output === undefined`, not from a live 400. Step 9 is the check; if the guard turns out to be unnecessary it can be removed, but leaving it in is harmless and Phase 4 needs it regardless.

---

### Commit

```bash
cd /Users/paul/projects/music-kb && git checkout -b phase-3-digest-chat-usechat && git add client/package.json client/yarn.lock client/src/lib/services/ai-messages.ts client/src/lib/services/ai-messages.test.ts client/src/components/DigestChat.tsx client/src/routes/api.digest-chat.tsx && git commit -m "$(cat <<'EOF'
refactor(digest-chat): move DigestChat onto useChat and the AG-UI wire

Pilot for the useChat adoption plan (docs/tanstack-ai-upgrade-plan.md §3,
Phase 3). DigestChat was the right first surface: it already hand-rolled
messages / isStreaming / error / input, it had no abort at all, and it was
the only chat route with no bespoke SSE frame to preserve.

Client (DigestChat.tsx):
  - `useChat({ fetcher, forwardedProps })` replaces the local Message[] state,
    the streamDigestChat wrapper, and the tool-call merge state machine.
    Tool calls now come off UIMessage.parts, which the SDK fills from
    TOOL_CALL_START (the only frame that still carries the tool name at
    @tanstack/ai 0.49.1).
  - videoIds + modelChoice go in CHAT-LEVEL forwardedProps, not per-send
    body. reload() re-streams with {...body, ...forwardedProps} and clears
    the per-send body during the merge (ai-client chat-client.ts:2264-2271;
    reload at :2515 never re-sets it), so per-send props would make the new
    Retry button 400 on a missing videoIds every time.
  - The fetcher lives at module scope. useChat builds its ChatClient in a
    useMemo that never re-runs, so a fetcher closing over modelChoice would
    send the first render's value forever with no error.
  - The fetcher hand-rolls the AG-UI RunAgentInput rather than using
    fetchServerSentEvents, so a non-2xx response can be read for its body —
    assertResponseOk collapses every error to "HTTP error! status: 409",
    discarding this route's "Summary not ready for <id>".
  - Adds Stop (was: a send mid-stream vanished silently) and Retry.

Server (api.digest-chat.tsx):
  - chatParamsFromRequestBody validates the AG-UI body. expandHistoryForModel
    and its two hand-written message types are deleted — 60 of the route's
    152 lines that reimplemented uiMessagesToWire's fan-out.
  - videoIds/modelChoice read from forwardedProps; the 2-5 validation, the
    404/409 checks, the route URL and the no-modelOptions behaviour are
    unchanged.

New shared helper (lib/services/ai-messages.ts), reused by Phase 4:
  - messageText / toPlainChatMessages flatten both message shapes that have
    to reach the same plain text — client UIMessage.parts and the AG-UI wire
    message, whose inbound parts the validator strips.
  - dropOrphanToolCalls restores the orphan filter that
    expandHistoryForModel's `status === 'done'` check gave us. uiMessagesToWire
    emits the assistant's toolCalls unconditionally but skips the tool
    fan-out when the call has no output, so a run stopped mid-tool-call is a
    400 on Anthropic — newly reachable now that this surface has a Stop.

Adds @tanstack/ai-react@0.22.1 (peers @tanstack/ai ^0.49.1, from Phase 1).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — VideoChat onto `useChat`

**Goal:** Replace VideoChat's hand-rolled fetch/SSE/message-state machine with `useChat`, delete the second copy of `expandHistoryForModel` from `/api/chat`, and re-establish server-side the orphan-tool-call protection that the old `status === 'done'` filter provided.

**Files touched:**
- `/Users/paul/projects/music-kb/client/src/lib/services/ui-message-text.ts` *(created in Phase 3 — verified/reused here, see Task 4.1)*
- `/Users/paul/projects/music-kb/client/src/routes/api.chat.tsx`
- `/Users/paul/projects/music-kb/client/src/components/VideoChat.tsx`
- `/Users/paul/projects/music-kb/client/src/lib/services/chat-stream.ts` *(comment only)*

**Prerequisites:** Phase 0 (tool rename), Phase 1 (core bump to `@tanstack/ai` 0.49.1 / `ai-anthropic` 0.18.0 / `ai-ollama` 0.10.0 + `chat-stream.ts` parser patch), Phase 3 (adds `@tanstack/ai-react`, writes the shared `parts → text` helper). Phase 2 is independent and not required.

**Estimated effort:** 2–3 days.

---

### Task 4.0 — Confirm the ground you are standing on

- [ ] **Step 1: Verify the dependency versions Phase 1 and Phase 3 were supposed to land**

```bash
cd /Users/paul/projects/music-kb && node -e "const p=require('./client/package.json');for(const k of ['@tanstack/ai','@tanstack/ai-anthropic','@tanstack/ai-ollama','@tanstack/ai-react'])console.log(k,'=',p.dependencies[k]??'MISSING')"
```

Expected output, exactly:

```
@tanstack/ai = 0.49.1
@tanstack/ai-anthropic = 0.18.0
@tanstack/ai-ollama = 0.10.0
@tanstack/ai-react = 0.22.1
```

If `@tanstack/ai-react` is `MISSING`, Phase 3 was not completed. Install it and re-run the check:

```bash
cd /Users/paul/projects/music-kb && yarn --cwd ./client add --exact @tanstack/ai-react@0.22.1
```

If any of the other three is not at the version above, **stop**. Phase 1 is incomplete and Phase 4 will produce a working UI on top of a broken wire parser.

- [ ] **Step 2: Confirm `chatParamsFromRequestBody` exists in the installed SDK**

```bash
cd /Users/paul/projects/music-kb && grep -c "chatParamsFromRequestBody" client/node_modules/@tanstack/ai/dist/esm/index.js
```

Expected: a non-zero count. (Verified present in the 0.49.1 source at `.reference/tanstack-ai/packages/ai/src/index.ts:450`.)

---

### Task 4.1 — Confirm or create the shared `parts → text` helper

Phase 3's plan text says it "writes the shared `parts → text` helper here; Phase 4 reuses it." **This spec does not know the exact path Phase 3 chose.** Resolve it before writing any component code.

- [ ] **Step 1: Look for the helper Phase 3 wrote**

```bash
cd /Users/paul/projects/music-kb && grep -rn "UIMessage" client/src/lib --include=*.ts -l ; grep -rn "part.type === 'text'" client/src --include=*.ts --include=*.tsx
```

- If a helper exists that takes a `UIMessage` and returns its concatenated text, **use it**. Note its exact module path and exported name, and substitute them everywhere this spec writes `import { uiMessageText } from '#/lib/services/ui-message-text';`. Do **not** create a second copy.
- If nothing exists (Phase 3 inlined it, or was skipped), create it in Step 2.

- [ ] **Step 2: Create the helper (only if Step 1 found nothing)**

Write `/Users/paul/projects/music-kb/client/src/lib/services/ui-message-text.ts`:

```ts
// Shared `UIMessage.parts → plain text` reduction for every @tanstack/ai-react
// consumer (DigestChat, VideoChat).
//
// `UIMessage.parts` is a discriminated union whose members include 'text',
// 'thinking', 'tool-call', 'tool-result', 'structured-output' and more. Only
// 'text' carries user-visible prose; everything else has its own renderer.
// Reference: .reference/tanstack-ai/packages/ai-client/src/types.ts:640 (UIMessage)
// and the reference app's src/components/MessageList.tsx:22-94.
//
// Parts are read through a loose structural type rather than the SDK's
// `MessagePart` union: `MessagePart` is not exported from '@tanstack/ai-react',
// and the working reference app types its part parameter as `any` for the same
// reason. Narrowing on `type` here is explicit and compiles under `strict`.

import type { UIMessage } from '@tanstack/ai-react';

type LoosePart = { type: string; content?: unknown };

/** Concatenate every `text` part of a UIMessage, in order. */
export function uiMessageText(message: UIMessage): string {
  let out = '';
  for (const part of message.parts as unknown as LoosePart[]) {
    if (part.type === 'text' && typeof part.content === 'string') {
      out += part.content;
    }
  }
  return out;
}

/**
 * True when a message has something worth rendering: any non-blank text, or
 * any tool call. Used to decide whether the "Thinking…" placeholder is still
 * showing, and whether an errored turn left a blank assistant bubble to roll
 * back.
 */
export function uiMessageHasVisibleContent(message: UIMessage): boolean {
  if (uiMessageText(message).trim().length > 0) return true;
  return (message.parts as unknown as LoosePart[]).some(
    (p) => p.type === 'tool-call',
  );
}
```

- [ ] **Step 3: Verify it compiles**

```bash
cd /Users/paul/projects/music-kb && npx tsc --noEmit -p client/tsconfig.json 2>&1 | head -20
```

Expected: no output (or only pre-existing errors unrelated to `ui-message-text.ts`).

---

### Task 4.2 — Rewrite `/api/chat` onto the AG-UI wire, delete `expandHistoryForModel`, add the orphan guard

Today the route reads a bespoke body (`{ videoId, messages, skillSlug, modelChoice }`) and reconstructs a model-message sequence itself. Once VideoChat speaks AG-UI, the client already emits `{ role:'assistant', toolCalls }` + `{ role:'tool', toolCallId, content }` fan-out via `uiMessagesToWire` (`.reference/tanstack-ai/packages/ai/src/utilities/ag-ui-wire.ts:198-225`), so the whole function is dead weight.

**Current code being replaced — `client/src/routes/api.chat.tsx:29-51`:**

```ts
type ClientToolCall = {
  id: string;
  name: string;
  input: unknown | null;
  result: string | null;
  status: 'running' | 'done';
};
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ClientToolCall[];
};

type ModelMessage = {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
};
```

**and `client/src/routes/api.chat.tsx:61-98`** (`function expandHistoryForModel(...) { ... }`), **and the whole handler at `client/src/routes/api.chat.tsx:100-200`.**

- [ ] **Step 1: Replace the entire contents of `/Users/paul/projects/music-kb/client/src/routes/api.chat.tsx`**

```tsx
import { createFileRoute } from '@tanstack/react-router';
import {
  chat,
  chatParamsFromRequestBody,
  toServerSentEventsResponse,
} from '@tanstack/ai';
import { fetchVideoByVideoIdService } from '#/lib/services/videos';
import { getSkill } from '#/lib/skills';
import { prepareChatPrompt } from '#/lib/services/learning';
import type { ChatMessage } from '#/lib/services/learning';
import { webSearchTool } from '#/lib/services/chat-tools';
import { resolveRequestModel, withSystem } from '#/lib/services/chat-model-request';

// Streaming chat endpoint (TanStack AI / AG-UI).
//
// The request body is an AG-UI `RunAgentInput`, produced by the client's
// `fetchServerSentEvents('/api/chat')` connection adapter. It carries:
//   messages        — the conversation, ALREADY fanned out by the SDK's
//                     `uiMessagesToWire`: assistant turns carry `toolCalls`,
//                     and each executed tool becomes its own
//                     `{ role: 'tool', toolCallId, content }` entry.
//   forwardedProps  — our per-send `body` from `sendMessage(text, { body })`:
//                     `{ videoId, skillSlug?, modelChoice }`.
//
// The response is Server-Sent Events in AG-UI format:
//   data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"...","delta":"..."}\n\n
//   ...
//   data: [DONE]\n\n
//
// THE HISTORY EXPANSION USED TO LIVE HERE. It does not any more: the 38-line
// `expandHistoryForModel` was a hand-rolled duplicate of what the client-side
// `uiMessagesToWire` already emits, and it was strictly less correct — it
// hoisted every tool call ahead of all text, so a text → tool → text turn
// round-tripped in the wrong order. `chatParamsFromRequestBody` hands us
// messages that are documented as suitable for `chat({ messages })` directly.
//
// Retrieval (BM25 top-k + query rewriting + contextual retrieval) is still
// shared with the non-streaming `askAboutVideoService` via `prepareChatPrompt`.

/**
 * One validated AG-UI message. `chatParamsFromRequestBody` guarantees `id` and
 * a known `role`, and (per role) that `content` / `toolCallId` are strings —
 * see `.reference/tanstack-ai/packages/ai/src/utilities/chat-params.ts:64-106`.
 * Inbound `parts` are stripped by the validator, so these are flat.
 */
type AgUiMessage = {
  id: string;
  role:
    | 'system'
    | 'developer'
    | 'user'
    | 'assistant'
    | 'tool'
    | 'activity'
    | 'reasoning';
  content?: unknown;
  toolCalls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
};

/**
 * Drop assistant `toolCalls` that no `role: 'tool'` message answers.
 *
 * THIS IS NOT DEFENSIVE PROGRAMMING — IT IS A 400 WE USED TO PREVENT BY
 * ACCIDENT. The old client stored `status: 'running' | 'done'` per tool call
 * and the deleted `expandHistoryForModel` filtered on `status === 'done'`,
 * so a call whose result never arrived was simply never replayed.
 *
 * The SDK does not filter. A tool call that reached TOOL_CALL_END but never
 * TOOL_CALL_RESULT — Stop pressed mid-tool, the Ollama process dying, a
 * dropped socket — settles at `state: 'input-complete'`
 * (`.reference/tanstack-ai/packages/ai/src/activities/chat/stream/processor.ts:1489-1541`).
 * On the way out, `collectToolCalls`
 * (`.reference/.../utilities/ag-ui-wire.ts:469-485`) emits EVERY tool-call
 * part with no state filter at all, while the tool fan-out loop skips any part
 * with `output === undefined` (`ag-ui-wire.ts:404-410`). The result is an
 * assistant message carrying a `tool_use` block that nothing answers.
 *
 * Anthropic rejects that with a 400 (`tool_use` ids found without matching
 * `tool_result` blocks). Ollama tolerates it and quietly re-reads its own
 * unanswered call as context. Since ADR 0011 made `video-chat` switchable,
 * both tiers are reachable, so this is a live failure and not a hypothetical.
 *
 * The server is the right home for the guard: it holds regardless of which
 * client sent the turn, and it cannot be defeated by a client-side state bug.
 */
function dropOrphanToolCalls(messages: AgUiMessage[]): AgUiMessage[] {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && typeof m.toolCallId === 'string') {
      answered.add(m.toolCallId);
    }
  }

  const out: AgUiMessage[] = [];
  for (const m of messages) {
    if (
      m.role !== 'assistant' ||
      !Array.isArray(m.toolCalls) ||
      m.toolCalls.length === 0
    ) {
      out.push(m);
      continue;
    }
    const kept = m.toolCalls.filter((tc) => answered.has(tc.id));
    if (kept.length === m.toolCalls.length) {
      out.push(m);
      continue;
    }
    const hasText = typeof m.content === 'string' && m.content.trim().length > 0;
    if (kept.length === 0 && !hasText) {
      console.warn(
        `[chat] dropped assistant message ${m.id}: ${m.toolCalls.length} orphan tool_use block(s), no text`,
      );
      continue;
    }
    console.warn(
      `[chat] stripped ${m.toolCalls.length - kept.length} orphan tool_use block(s) from assistant message ${m.id}`,
    );
    const next: AgUiMessage = { ...m };
    if (kept.length > 0) next.toolCalls = kept;
    else delete next.toolCalls;
    out.push(next);
  }
  return out;
}

/**
 * Reduce the AG-UI conversation to the `{ role, content }` pairs
 * `prepareChatPrompt` needs. It only reads the latest user turn for the BM25
 * query (`learning.ts:1338`), so tool and reasoning entries are irrelevant
 * here and are dropped.
 */
function toPromptMessages(messages: AgUiMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    let content = '';
    if (typeof m.content === 'string') {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      // Multimodal user turns arrive as `[{ type: 'text', text }, ...]`
      // (`ag-ui-wire.ts:440-453`). VideoChat sends plain strings today, so
      // this branch is currently unreachable — it is here so a future image
      // attachment does not silently blank the retrieval query.
      for (const part of m.content) {
        if (
          part !== null &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          content += (part as { text: string }).text;
        }
      }
    }
    if (content.trim().length === 0) continue;
    out.push({ role: m.role, content });
  }
  return out;
}

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }

        // `chatParamsFromRequestBody` throws an `AGUIError` (not a Response)
        // on a non-conforming body. Caught here so a malformed request is a
        // 400 rather than a 500, in every framework, without depending on
        // TanStack Start's thrown-Response handling.
        let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
        try {
          params = await chatParamsFromRequestBody(raw);
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'invalid body';
          console.warn(`[chat] rejected non-AG-UI request body: ${detail}`);
          return new Response('Invalid AG-UI request body', { status: 400 });
        }

        const forwarded = params.forwardedProps;
        const videoId =
          typeof forwarded.videoId === 'string' ? forwarded.videoId : null;
        const skillSlug =
          typeof forwarded.skillSlug === 'string' ? forwarded.skillSlug : null;
        // Choice TOKEN from the picker: 'default' | 'local:<id>' | 'frontier'.
        // Never a bare model id — see chat-model-request.ts.
        const modelChoice =
          typeof forwarded.modelChoice === 'string'
            ? forwarded.modelChoice
            : undefined;

        if (!videoId) {
          return new Response('forwardedProps.videoId required', {
            status: 400,
          });
        }

        const video = await fetchVideoByVideoIdService(videoId);
        if (!video) {
          return new Response('Video not found', { status: 404 });
        }
        if (video.summaryStatus !== 'generated') {
          return new Response('Summary not ready', { status: 409 });
        }

        // Skill lookup — synchronous, in-memory registry (`#/lib/skills`).
        // Unknown slug falls back to the default persona; logged so
        // misconfigured clients surface during dev.
        const skill = skillSlug ? getSkill(skillSlug) : null;
        if (skillSlug && !skill) {
          console.warn(
            `[chat ${videoId}] skillSlug="${skillSlug}" not found in registry — using default persona`,
          );
        }

        const wireMessages = params.messages as unknown as AgUiMessage[];
        const history = dropOrphanToolCalls(wireMessages);

        const { system, retrievedCount } = await prepareChatPrompt(
          video,
          toPromptMessages(history),
          { skillPrompt: skill?.systemPrompt },
        );

        const toolResultCount = history.filter((m) => m.role === 'tool').length;
        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [chat ${videoId}${skill ? `/${skill.slug}` : ''}] → streaming response (tanstack-ai)`,
          {
            retrievedChunks: retrievedCount,
            wireMessages: wireMessages.length,
            afterOrphanGuard: history.length,
            priorToolResults: toolResultCount,
            skill: skill?.slug ?? null,
            threadId: params.threadId,
          },
        );

        // Per-request model choice (CLAUDE.md amendment 2026-08-27, ADR 0011).
        // With no choice this returns exactly what resolveModel('video-chat')
        // always did, so the default path is unchanged.
        const { model, notice } = await resolveRequestModel(
          'video-chat',
          modelChoice,
        );
        if (notice) {
          console.warn(`[chat ${videoId}] ${notice}`);
        }

        const stream = chat({
          adapter: model.adapter,
          // Tier-correct system delivery. See withSystem() — Anthropic drops a
          // `role: 'system'` message silently, which would lose the retrieved
          // transcript context and the skill persona without failing.
          ...withSystem(model, system, history),
          // Agent loop: the model can call our search tool when the retrieved
          // transcript passages don't answer the question. Execution happens
          // server-side; tool events stream as TOOL_CALL_* SSE frames.
          tools: [webSearchTool],
          // Every other chat() call site sets a low temperature; this one
          // was the exception, so it ran at Ollama's default of 1.0 — and
          // it is the call that most needs deterministic output, because a
          // tool call is structured. At 1.0 the model intermittently
          // *narrated* the call instead of emitting it, printing the tool
          // invocation as ordinary prose: the tool never ran, and the
          // surrounding invented text reached the user looking like a real
          // result.
          // Tier-paired: the local branch returns Ollama sampling options, the
          // frontier branch returns {} because claude-sonnet-5 400s on
          // `temperature`. The pairing lives on the resolved object, so this
          // call site cannot get it wrong.
          modelOptions: model.modelOptions(0.3),
        });

        return toServerSentEventsResponse(stream);
      },
    },
  },
});
```

- [ ] **Step 2: Verify `expandHistoryForModel` is gone from the repo**

```bash
cd /Users/paul/projects/music-kb && grep -rn "expandHistoryForModel" client/src server/src packages web/src 2>/dev/null
```

Expected: **no output.** (Phase 3 removed the `/api/digest-chat` copy; this step removes the last one.) If `client/src/routes/api.digest-chat.tsx` still matches, Phase 3 is incomplete — finish it before continuing, because the two copies were byte-identical and leaving one behind re-creates the drift this phase exists to end.

- [ ] **Step 3: Typecheck**

```bash
cd /Users/paul/projects/music-kb && npx tsc --noEmit -p client/tsconfig.json 2>&1 | grep "api.chat"
```

Expected: no output. `VideoChat.tsx` will still typecheck at this point because it posts its own body shape — the route/client contract is broken until Task 4.3 lands, and **`/api/chat` is non-functional between Task 4.2 and Task 4.3**. Do not stop and test the app here.

---

### Task 4.3 — Rewrite `VideoChat.tsx` onto `useChat`

Six exact edits. Everything below `MessageRow` — `formatMmss` (`:516`), `EvidencePanel` (`:525`), `ToolCallsPanel` (`:663`), `summarizeInput` (`:751`), `safeStringify` (`:767`), `formatResult` (`:778`), `SkillPicker` (`:790`) — is **untouched**. `ToolCallRecord` stays exported and keeps its shape so `ToolCallsPanel` needs no change; a new adapter builds those records from `UIMessage.parts`.

- [ ] **Step 1: Replace the import block**

Current, `client/src/components/VideoChat.tsx:1-21`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Accordion } from 'radix-ui';
import { buildMarkdownComponents, stripInlineTimecodes } from './TimecodeMarkdown';
import { usePlayerControl } from '#/components/player';
import { streamChatSSE, type StreamEvent } from '#/lib/services/chat-stream';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';
import { Button } from '#/components/ui/button';
import { ModelPicker } from '#/components/ModelPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { getChatResponseEvidence } from '#/data/server-functions/videos';
import { summarizeToNote } from '#/data/server-functions/notes';
import { listSkills, type Skill } from '#/lib/skills';
import type { EvidenceCitation } from '#/lib/services/transcript';
```

Replacement:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Accordion } from 'radix-ui';
import { useChat, fetchServerSentEvents } from '@tanstack/ai-react';
import type { UIMessage } from '@tanstack/ai-react';
import { buildMarkdownComponents, stripInlineTimecodes } from './TimecodeMarkdown';
import { usePlayerControl } from '#/components/player';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';
import { friendlyAnthropicError } from '#/lib/services/anthropic-errors';
import {
  uiMessageText,
  uiMessageHasVisibleContent,
} from '#/lib/services/ui-message-text';
import { Button } from '#/components/ui/button';
import { ModelPicker } from '#/components/ModelPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { getChatResponseEvidence } from '#/data/server-functions/videos';
import { summarizeToNote } from '#/data/server-functions/notes';
import { listSkills, type Skill } from '#/lib/skills';
import type { EvidenceCitation } from '#/lib/services/transcript';
```

> If Task 4.1 Step 1 found the helper under a different module path or export name, change **that one import line** to match. Do not add a second helper module.

- [ ] **Step 2: Delete the `Message` type and add the parts→ToolCallRecord adapter**

Current, `client/src/components/VideoChat.tsx:36-41`:

```tsx
type Message = {
  role: 'user' | 'assistant';
  content: string;
  evidence?: EvidenceCitation[];
  toolCalls?: ToolCallRecord[];
};
```

Replacement (the local `Message` type is gone — `UIMessage` is the message model now; `evidence` moves to a component-local Map, see Step 5):

```tsx
/**
 * Loose view of one `UIMessage.parts` entry.
 *
 * `MessagePart` is not exported from '@tanstack/ai-react' (see its
 * src/index.ts export list), and the shapes we need are documented on
 * `.reference/tanstack-ai/packages/ai-client/src/types.ts`:
 *   { type: 'text',        content }
 *   { type: 'tool-call',   id, name, arguments (JSON string), input?, state, output? }
 *   { type: 'tool-result', toolCallId, content, state, error? }
 * Note a tool-result part carries NO `name` — the display name has to come
 * from the matching tool-call part.
 */
type LooseMessagePart = {
  type: string;
  content?: unknown;
  id?: string;
  name?: string;
  arguments?: string;
  input?: unknown;
  output?: unknown;
  state?: string;
  toolCallId?: string;
};

/**
 * Project a UIMessage's parts onto the `ToolCallRecord[]` that ToolCallsPanel
 * already renders, so that component and its four helpers are untouched by
 * this migration.
 *
 * Status mapping follows the stream processor exactly:
 *   TOOL_CALL_END    → state 'input-complete'  (args known, result pending)
 *   TOOL_CALL_RESULT → state 'complete'|'error' (updateToolCallWithOutput,
 *                      .reference/.../stream/message-updaters.ts:217-241)
 * so anything that is not complete/error is still legitimately 'running'.
 */
function toolCallRecordsFromParts(message: UIMessage): ToolCallRecord[] {
  const parts = message.parts as unknown as LooseMessagePart[];
  const records = new Map<string, ToolCallRecord>();

  for (const part of parts) {
    if (part.type !== 'tool-call' || typeof part.id !== 'string') continue;
    let input: unknown = part.input ?? null;
    if (input === null && typeof part.arguments === 'string' && part.arguments) {
      try {
        input = JSON.parse(part.arguments);
      } catch {
        input = part.arguments;
      }
    }
    records.set(part.id, {
      id: part.id,
      name: part.name ?? '',
      input,
      result:
        part.output === undefined
          ? null
          : typeof part.output === 'string'
            ? part.output
            : JSON.stringify(part.output),
      status:
        part.state === 'complete' || part.state === 'error' ? 'done' : 'running',
    });
  }

  for (const part of parts) {
    if (part.type !== 'tool-result' || typeof part.toolCallId !== 'string') {
      continue;
    }
    const existing = records.get(part.toolCallId);
    if (!existing) continue;
    records.set(part.toolCallId, {
      ...existing,
      result:
        typeof part.content === 'string'
          ? part.content
          : JSON.stringify(part.content),
      status: 'done',
    });
  }

  return Array.from(records.values());
}
```

- [ ] **Step 3: Delete `streamChatResponse`**

Delete `client/src/components/VideoChat.tsx:73-100` in full — the block starting at the comment `// Issue the chat request and yield typed events from the response stream.` and ending at the closing brace after `yield* streamChatSSE(res);`. Nothing replaces it: `fetchServerSentEvents('/api/chat')` is the transport now.

- [ ] **Step 4: Fix the slash-command prose if Phase 0 renamed the tool**

Current, `client/src/components/VideoChat.tsx:58`:

```tsx
    return `Use the web_search tool with the exact query "${query}", then summarize the top results in 2-3 short paragraphs. Cite each source URL inline. Do NOT answer from the transcript for this request — I explicitly want web search results.`;
```

Check what the tool is actually called and align the prose:

```bash
cd /Users/paul/projects/music-kb && grep -n "name: '" client/src/lib/services/chat-tools.ts
```

If that prints `name: 'search_web',` (Phase 0 done), apply this edit:

```tsx
    return `Use the search_web tool with the exact query "${query}", then summarize the top results in 2-3 short paragraphs. Cite each source URL inline. Do NOT answer from the transcript for this request — I explicitly want web search results.`;
```

If it still prints `name: 'web_search',`, **leave line 58 unchanged** and note that Phase 0 was skipped — the live Anthropic name-hijack defect (§0.1 of `docs/tanstack-ai-upgrade-plan.md`) is still open.

- [ ] **Step 5: Replace the whole component body**

Replace `client/src/components/VideoChat.tsx:102-459` — everything from `export function VideoChat({ videoId, onNoteCreated, className }: Readonly<Props>) {` through the `}` that closes it, immediately before `function MessageRow({` — with:

```tsx
/**
 * Translate a stream error to user-facing text.
 *
 * Two sources reach here:
 *  - A RUN_ERROR frame, which the processor turns into an Error carrying the
 *    provider's message (`.reference/.../stream/processor.ts:1731-1770`).
 *  - A non-2xx from /api/chat, which the SSE adapter reports as
 *    `HTTP error! status: <code> <statusText>` — DISCARDING THE BODY
 *    (`.reference/tanstack-ai/packages/ai-client/src/connection-adapters.ts:503-517`).
 *    The old hand-rolled fetch read `res.text()` and showed our own message,
 *    so 404/409 are mapped back by status code here rather than lost.
 *
 * Tier matters: before ADR 0011 every streaming surface was local, so raw
 * Ollama text was safe to echo. `video-chat` is now switchable, and Anthropic
 * error bodies are provider payload that must never reach user-facing text —
 * hence the split on the picker's current value.
 */
function translateChatError(err: Error, modelChoice: string): string {
  const raw = err.message;
  if (/HTTP error! status: 404/.test(raw)) {
    return 'This video is not in the library any more. Reload the page.';
  }
  if (/HTTP error! status: 409/.test(raw)) {
    return 'The AI summary for this video is still generating. Try again once it finishes.';
  }
  if (/HTTP error! status: 400/.test(raw)) {
    return 'The chat request was rejected. Clear the conversation and try again.';
  }
  return modelChoice === 'frontier'
    ? friendlyAnthropicError(raw)
    : friendlyOllamaError(raw);
}

/** Build the assistant UIMessage that seeds a skill's opening greeting. */
function makeGreetingMessage(text: string): UIMessage {
  return {
    id: `greeting-${crypto.randomUUID()}`,
    role: 'assistant',
    parts: [{ type: 'text', content: text }],
  };
}

export function VideoChat({ videoId, onNoteCreated, className }: Readonly<Props>) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Incremented on every stream error so the rollback effect below fires
  // exactly once per failure, reading the messages React has actually
  // committed rather than a stale closure captured inside onError.
  const [errorSeq, setErrorSeq] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);
  // Skills are code modules (see `#/lib/skills`), resolved synchronously
  // at render time — no DB round-trip, no loading state. Memoized so the
  // registry lookup isn't repeated on every render.
  const skills = useMemo<Skill[]>(() => listSkills('video-chat'), []);
  const [skillSlug, setSkillSlug] = useState<string | null>(null);
  // Per-conversation model choice. 'default' preserves the previous behaviour
  // exactly: the surface's configured local model.
  const [modelChoice, setModelChoice] = useState<string>('default');

  // EVIDENCE LIVES HERE, NOT IN `UIMessage.metadata`.
  //
  // `metadata` is not component state — it is wire state. `uiMessagesToWire`
  // copies every user key straight onto the outbound AG-UI message
  // (`.reference/tanstack-ai/packages/ai/src/utilities/ag-ui-wire.ts:325`:
  // `const base: MetadataRecord = { ...(msg.metadata ?? {}) }`), for EVERY
  // message, on EVERY send. An `EvidenceCitation` carries `groundedSnippet` —
  // a full transcript chunk (`lib/services/transcript.ts:1006-1021`) — and a
  // single answer routinely cites several. Storing them in metadata would
  // re-upload the whole accumulated pile of transcript excerpts on every
  // subsequent turn, growing quadratically with conversation length, for data
  // the model must never see: the transcript context it IS meant to see is
  // built server-side by `prepareChatPrompt` from a fresh BM25 retrieval.
  //
  // Keyed by `UIMessage.id`, which is stable for the life of the message.
  const [evidenceByMessageId, setEvidenceByMessageId] = useState<
    Map<string, EvidenceCitation[]>
  >(() => new Map());

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    sendMessage,
    isLoading,
    setMessages,
    clear: clearChat,
  } = useChat({
    // The chat's identity. Changing it makes useChat build a fresh ChatClient
    // (`.reference/tanstack-ai/packages/ai-react/src/use-chat.ts:50` —
    // `clientId = options.threadId ?? hookId`, and the client useMemo at :106
    // keys on `clientId`), so navigating between videos cannot leak one
    // video's conversation into another's. It also rides on the wire as the
    // AG-UI `threadId`, which the route logs.
    threadId: videoId,
    // A route, not a server function — so this is `connection`, not the
    // reference app's `fetcher`. See the send-body comment in `sendPrompt`
    // for why NOTHING request-shaped may be captured here.
    connection: fetchServerSentEvents('/api/chat'),
    onError: (err) => {
      setError(translateChatError(err, modelChoice));
      setErrorSeq((n) => n + 1);
    },
    onFinish: (message) => {
      // After the turn completes, fetch the deterministic evidence for every
      // timecode the model cited. Each entry pairs the citation with the real
      // transcript chunk we matched to — rendered as expandable accordion
      // panels below the message so the user can verify.
      //
      // Safe to close over `videoId` and `message.id`: useChat reads its
      // callbacks through an options ref refreshed on every render
      // (use-chat.ts:96-97, invoked at :190-194), so this sees the current
      // render's values. That is exactly NOT true of `connection`/`fetcher`.
      const responseText = uiMessageText(message);
      if (responseText.trim().length === 0) return;
      const targetVideoId = videoId;
      const messageId = message.id;
      void getChatResponseEvidence({
        data: { videoId: targetVideoId, responseText },
      })
        .then((evidence) => {
          if (evidence.length === 0) return;
          setEvidenceByMessageId((prev) => {
            const next = new Map(prev);
            next.set(messageId, evidence);
            return next;
          });
        })
        .catch(() => {
          // Evidence is best-effort — the message already rendered.
        });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // The chat client is rebuilt when `threadId` changes, but this component's
  // own state is not: React reuses the instance when only the route param
  // moves. Drop the evidence map so citations from the previous video cannot
  // be keyed onto a same-id message in the new conversation.
  useEffect(() => {
    setEvidenceByMessageId(new Map());
    setError(null);
    setSummaryMsg(null);
  }, [videoId]);

  // ERROR-PATH ROLLBACK.
  //
  // The processor calls `ensureAssistantMessage()` before it reports a
  // RUN_ERROR (`.reference/.../stream/processor.ts:1741`), so a failed turn
  // leaves an assistant message behind. When it has no text and no tool call
  // it is a blank bubble the old code removed with
  // `setMessages((prev) => prev.slice(0, -1))` — reproduced here.
  //
  // A message that DID accumulate partial text is kept. That is a deliberate
  // improvement over the old behaviour, which discarded partial output: the
  // model produced it, the user saw it stream in, and deleting it under them
  // is worse than leaving it with the error banner beside it.
  //
  // Runs as an effect keyed on `errorSeq`, not inline in `onError`, because
  // `onError` fires synchronously inside the client's error path — before
  // React commits the final message update — so reading `messages` there
  // could miss the last deltas. `messages` is deliberately NOT in the
  // dependency array: including it would re-run the rollback on every
  // subsequent message change.
  useEffect(() => {
    if (errorSeq === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    if (uiMessageHasVisibleContent(last)) return;
    setMessages(messages.slice(0, -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorSeq]);

  // Switching skills auto-primes the conversation with the skill's
  // `defaultGreeting` (if any) — BUT only while the user hasn't
  // engaged yet. Presence of a single auto-primer greeting doesn't
  // count as engagement; only a user message does. This lets the user
  // pick a skill, see the greeting, switch to a different skill, and
  // see THAT greeting — without locking them into the first pick.
  //
  // Once the user sends even one message, we preserve conversation
  // history on skill switch and let the new persona take over on the
  // next assistant turn.
  const changeSkill = (nextSlug: string | null) => {
    if (isLoading) return;
    setSkillSlug(nextSlug);
    const hasUserMessages = messages.some((m) => m.role === 'user');
    if (hasUserMessages) return;
    const selected = nextSlug ? skills.find((s) => s.slug === nextSlug) : null;
    const greeting = selected?.defaultGreeting?.trim();
    setEvidenceByMessageId(new Map());
    // `setMessages` here (not `clear()`): nothing is in flight and there is no
    // persisted conversation to remove — this is a straight transcript swap.
    setMessages(greeting ? [makeGreetingMessage(greeting)] : []);
    // Prime the input with the skill's first suggested prompt so Send
    // is immediately enabled — the user can hit Send, edit the text,
    // or click a different chip below to swap. Falls back to clearing
    // the input for skills (or the default Q&A) without explicit
    // prompts.
    setInput(selected?.suggestedPrompts?.[0] ?? '');
  };

  const clear = () => {
    if (isLoading) return;
    setError(null);
    setSummaryMsg(null);
    setEvidenceByMessageId(new Map());
    // `clear()` (not `setMessages([])`): it also cancels any in-flight stream,
    // drops the resume snapshot, and resets the hook's own `error`
    // (`.reference/tanstack-ai/packages/ai-client/src/chat-client.ts:2565-2592`).
    clearChat();
    // If the active skill has a greeting, re-seed it so the conversation
    // starts from the same opening after Clear. Otherwise truly empty.
    // Ordering is load-bearing: clear first, then seed, or the seed is wiped.
    const active = skillSlug ? skills.find((s) => s.slug === skillSlug) : null;
    const greeting = active?.defaultGreeting?.trim();
    if (greeting) setMessages([makeGreetingMessage(greeting)]);
  };

  // `{ role, content }` pairs for the summarizer + the "≥2 real messages"
  // gate on the Summarize button. `summarizeToNote`'s validator accepts only
  // 'user' | 'assistant' (data/server-functions/notes.ts:119-122), so a
  // 'system' UIMessage is filtered out rather than cast.
  const conversationTurns = useMemo(
    () =>
      messages
        .filter(
          (m): m is UIMessage & { role: 'user' | 'assistant' } =>
            m.role === 'user' || m.role === 'assistant',
        )
        .map((m) => ({ role: m.role, content: uiMessageText(m) }))
        .filter((m) => m.content.trim().length > 0),
    [messages],
  );

  const summarize = async () => {
    if (isLoading || summarizing) return;
    setSummarizing(true);
    setSummaryMsg(null);
    const res = await summarizeToNote({
      data: {
        videoIds: [videoId],
        messages: conversationTurns,
        source: 'chat',
        skillSlug: skillSlug ?? undefined,
      },
    });
    setSummarizing(false);
    if (res.status === 'ok') {
      setSummaryMsg('Saved to notes.');
      onNoteCreated?.(res.noteDocumentId);
      // Clear the banner after a beat so it doesn't linger.
      window.setTimeout(() => setSummaryMsg(null), 2500);
    } else {
      setSummaryMsg(`Save failed: ${res.error}`);
    }
  };

  const sendPrompt = (promptText: string) => {
    if (isLoading) return;
    const trimmed = promptText.trim();
    if (!trimmed) return;

    // Slash commands: deterministic triggers that rewrite the user's
    // message into an explicit tool-use prompt, bypassing the model's
    // sometimes-flaky decision to call a tool. `/web <query>` forces
    // the search tool. Extend the switch when we add more tools.
    const finalContent = transformSlashCommand(trimmed);

    setInput('');
    setError(null);

    // PER-SEND, NEVER CAPTURED.
    //
    // `videoId`, `skillSlug` and `modelChoice` all change while this component
    // is mounted, and every one of them changes what the server does. They go
    // in `sendMessage`'s `body`, which is shallow-merged into the request's
    // AG-UI `forwardedProps` for THIS request only
    // (`.reference/tanstack-ai/packages/ai-client/src/chat-client.ts:2264-2268`).
    //
    // The alternative fails SILENTLY. useChat builds its transport exactly
    // once, inside a `useMemo` keyed only on `[clientId, syncResumeState]`
    // (use-chat.ts:106-118, :286), and the effects that re-sync options
    // afterwards cover `body`, `forwardedProps`, `tools`, `context` and
    // `queue` — and nothing else (use-chat.ts:317-341). `connection` and
    // `fetcher` are never among them, even though `ChatClient.updateOptions`
    // has a branch for them (chat-client.ts:3033). So a connection or fetcher
    // that closes over `modelChoice` sends the FIRST render's value forever:
    // the picker moves, the UI updates, and a different model answers, with
    // no error anywhere. This exact bug has shipped in both codebases.
    //
    // Passing per-send does not work around the staleness — it removes it.
    // There is nothing captured to go stale.
    void sendMessage(finalContent, {
      body: {
        videoId,
        ...(skillSlug ? { skillSlug } : {}),
        // Choice TOKEN, not a model id — the server validates it against the
        // installed Ollama catalogue before building an adapter.
        modelChoice,
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendPrompt(input);
  };

  const lastMessage = messages[messages.length - 1];
  // The "Thinking…" bubble is now its own node, not an empty message row.
  // Between `sendMessage` and the first chunk there IS no assistant message:
  // the stream creates it (use-chat.ts:548-552 documents the same gap for
  // structured output). Rendering it separately also covers the window after
  // a tool call starts but before any text arrives.
  const showThinking =
    isLoading &&
    (!lastMessage ||
      lastMessage.role !== 'assistant' ||
      !uiMessageHasVisibleContent(lastMessage));

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col ${className ?? 'mb-12'}`}
      aria-label="Chat with this video"
    >
      <header className="shrink-0 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Ask about this video
            </h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Answers come from the transcript. Timestamps seek the player.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ModelPicker
              surface="video-chat"
              value={modelChoice}
              onChange={setModelChoice}
              disabled={isLoading}
            />
            {skills.length > 0 && (
              <SkillPicker
                skills={skills}
                value={skillSlug}
                onChange={changeSkill}
                disabled={isLoading}
              />
            )}
            {messages.length > 0 && (
              <>
                {conversationTurns.length >= 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void summarize()}
                    disabled={isLoading || summarizing}
                  >
                    {summarizing ? 'Saving…' : 'Summarize to note'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clear}
                  disabled={isLoading || summarizing}
                >
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        {/* Show suggested-prompt chips while the user hasn't engaged yet.
            "Engaged" = sent at least one user message. A skill's greeting
            counts as an assistant message but NOT engagement, so the chips
            stay available after picking a skill. Each skill can declare
            its own `suggestedPrompts`; falls back to a generic Q&A set
            for the default (no-skill) path. */}
        {(() => {
          const hasUserMessages = messages.some((m) => m.role === 'user');
          if (hasUserMessages) return null;
          const activeSkill = skillSlug
            ? skills.find((s) => s.slug === skillSlug)
            : null;
          const prompts = activeSkill?.suggestedPrompts ?? DEFAULT_SUGGESTED_PROMPTS;
          if (prompts.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-2 pb-4">
              {prompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => sendPrompt(p)}
                  disabled={isLoading}
                  className="rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1 text-xs text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          );
        })()}

        <div className="grid gap-4 pb-4">
          {messages.map((msg, i) => (
            <MessageRow
              key={msg.id}
              message={msg}
              evidence={evidenceByMessageId.get(msg.id)}
              streaming={
                isLoading && i === messages.length - 1 && msg.role === 'assistant'
              }
            />
          ))}
          {showThinking && (
            <div className="mr-auto min-w-0 max-w-[95%]">
              <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm text-[var(--ink-muted)]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" />
                <span>Thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {summaryMsg && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--ink-muted)]"
        >
          {summaryMsg}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            aria-hidden="true"
            className="mt-0.5 flex-none"
          >
            <path
              fill="currentColor"
              d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm.5 9v1.5h-1V10.5h1zm0-6v5h-1v-5h1z"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="shrink-0 flex gap-2 pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this video…  (/web <query> to force web search)"
          disabled={isLoading}
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none disabled:opacity-50"
        />
        <Button
          type="submit"
          size="pill"
          disabled={isLoading || !input.trim()}
        >
          {isLoading ? 'Thinking…' : 'Send'}
        </Button>
      </form>
    </section>
  );
}
```

- [ ] **Step 6: Replace `MessageRow`**

Replace `client/src/components/VideoChat.tsx:461-514` (the whole `function MessageRow(...) { ... }`) with:

```tsx
function MessageRow({
  message,
  evidence,
  streaming,
}: Readonly<{
  message: UIMessage;
  /** From the component-local Map, not from `message.metadata`. */
  evidence: EvidenceCitation[] | undefined;
  streaming: boolean;
}>) {
  const text = uiMessageText(message);

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)]/10 px-4 py-2.5 text-sm text-[var(--ink)]">
        {text}
      </div>
    );
  }

  const toolCalls = toolCallRecordsFromParts(message);

  // A message with neither text nor tool calls renders nothing at all —
  // the "Thinking…" placeholder is a sibling node in VideoChat now, so this
  // row must not draw an empty bubble in its place.
  if (text.length === 0 && toolCalls.length === 0) return null;

  return (
    <div className="mr-auto min-w-0 max-w-[95%]">
      {toolCalls.length > 0 && (
        <div className="mb-2">
          <ToolCallsPanel toolCalls={toolCalls} />
        </div>
      )}
      {text.length > 0 && (
        <div className="chat-md min-w-0 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--ink)]">
          {/* Strip inline `[mm:ss]` / `(mm:ss)` timecodes from the chat body
              — the Sources accordion below shows each citation with its
              transcript excerpt, so inline chips are redundant. */}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={buildMarkdownComponents()}
          >
            {stripInlineTimecodes(text)}
          </ReactMarkdown>
          {streaming && (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-[var(--ink-muted)] align-middle"
            />
          )}
          {!streaming && evidence && evidence.length > 0 && (
            <EvidencePanel evidence={evidence} />
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Typecheck**

```bash
cd /Users/paul/projects/music-kb && npx tsc --noEmit -p client/tsconfig.json
```

Expected: no output. `client/tsconfig.json` sets `noUnusedLocals: true` and `noUnusedParameters: true`, so any import left behind from Step 1 (e.g. a forgotten `streamChatSSE` or `StreamEvent`) is a hard error here, not a lint warning.

---

### Task 4.4 — Update the `chat-stream.ts` consumer list

`chat-stream.ts` survives (Phase 5 is explicit that retiring it is not a goal), but its header now names a consumer that no longer exists.

- [ ] **Step 1: Edit the module comment**

Current, `client/src/lib/services/chat-stream.ts:4-8`:

```ts
// iterator. The single transport for every streaming-chat consumer:
// `VideoChat` (per-video chat), `DigestChat` (cross-video digest chat),
// `useLibraryChat` (library-wide ask), and `NoteComposer` (note
// drafting) — was previously duplicated across consumers with subtle
// field-name drift between the copies.
```

Replacement:

```ts
// iterator. Once the transport for every streaming-chat consumer; as of the
// useChat migration its only consumer is `useLibraryChat` (library-wide ask),
// which stays on it deliberately — `/api/ask` is retrieval-first and emits its
// CITATIONS frame BEFORE the message they belong to, which has no `useChat`
// equivalent (see docs/tanstack-ai-upgrade-plan.md §2, §5). `VideoChat` and
// `DigestChat` moved to `@tanstack/ai-react`; `NoteComposer` stopped streaming.
```

- [ ] **Step 2: Confirm the remaining consumer set matches that claim**

```bash
cd /Users/paul/projects/music-kb && grep -rn "streamChatSSE" client/src --include=*.ts --include=*.tsx | grep -v "services/chat-stream"
```

Expected: matches in `client/src/lib/services/ask-library.ts` and/or `client/src/hooks/useLibraryChat.ts` only. If `DigestChat.tsx` or `NoteComposer.tsx` still appear, adjust the comment to name them too rather than shipping a comment that contradicts the code — Phase 2 or 3 was not fully landed.

---

### Verification for the whole phase

- [ ] **Automated**

```bash
cd /Users/paul/projects/music-kb && npx tsc --noEmit -p client/tsconfig.json && yarn --cwd ./client test
```

Expected: `tsc` prints nothing; the vitest run is green with the same test count as before this phase (no test file is added, removed, or edited here). **This proves nothing about the migration.** No test in the suite exercises `/api/chat` or `VideoChat` — the suite's green is the same green documented in §0.2 of the plan as false confidence. The manual checks below are the actual verification.

```bash
cd /Users/paul/projects/music-kb && grep -rn "expandHistoryForModel" client/src server/src packages web/src 2>/dev/null; echo "exit=$?"
```

Expected: no matches (`exit=1`).

- [ ] **Manual — run the app**

```bash
cd /Users/paul/projects/music-kb && yarn dev
```

Open `http://localhost:3015/learn/<a videoId whose summaryStatus is 'generated'>` and confirm each of the following. Keep the browser devtools **Network** tab open, filtered to `chat`, and the server terminal visible.

1. **Wire shape.** Send "What key is this in?". The `POST /api/chat` request payload is an AG-UI `RunAgentInput`: top-level `threadId` equal to the videoId, `runId`, `messages`, `tools: []`, and `forwardedProps: { videoId, modelChoice: "default" }`. Answer streams token-by-token.
2. **Thinking bubble.** Between pressing Send and the first token, a single "Thinking…" bubble appears — exactly one, and it disappears the moment text starts. No empty bordered bubble is left behind.
3. **Evidence.** Once the answer finishes and it contains at least one `[mm:ss]`, a "Sources — N citations" accordion appears under it. Expanding a row seeks the player. Send a **second** message and inspect its request payload: `messages[]` must contain **no** `metadata` key holding `groundedSnippet` or any transcript excerpt. This is the metadata trap; if excerpts are on the wire, the evidence went into `metadata` somewhere and must be moved back into the Map.
4. **Tool call, happy path.** Send `/web what year was Berklee founded`. A tool accordion renders with the tool's real name (`search_web` after Phase 0, else `web_search`) — **not blank** — the args show `query: ...`, the spinner turns into a checkmark, and the Result panel is populated. The server terminal prints the `[tool …]` line from `chat-tools.ts:47`. A blank name or `(empty)` input here means Phase 1's parser/bump did not fully land.
5. **Tool history continuity.** Immediately follow with "what did that search say?". The second request's `messages[]` contains an assistant entry with `toolCalls` **and** a matching `{ role: 'tool', toolCallId, content }` entry. The server logs `priorToolResults: 1`.
6. **Orphan guard.** Reproduce an interrupted tool call: send `/web <query>`, and while the spinner is still turning, kill the model backend (`pkill ollama`, or unset `ANTHROPIC_API_KEY` and restart if you are on the frontier tier). The turn errors. Restart the backend, then send another message. The server terminal must print `[chat] dropped assistant message …: 1 orphan tool_use block(s), no text` (or `stripped … orphan tool_use block(s)`), and the new turn must succeed. On the frontier tier, without the guard this send is a 400.
7. **Model picker is not stale.** With devtools open, switch the picker from Default to another installed local model and send. The `forwardedProps.modelChoice` in the request payload must be the **new** token, and the server log line must show the new model resolving. Switch back and send again; it must follow. *(A captured-connection regression shows up here and only here — the UI looks correct either way.)*
8. **Skill switch + greeting.** With an empty conversation, pick a skill that has a `defaultGreeting`. The greeting appears as an assistant bubble, the input is pre-filled with its first suggested prompt, and the suggested-prompt chips are still visible. Switch to a different skill: the greeting is **replaced**, not appended. Now send a message, then switch skills again: the conversation is **preserved** and no greeting is injected.
9. **Suggested prompts.** Click a chip on a fresh conversation — it sends. After any user message, the chips are gone.
10. **Summarize to note.** With ≥2 non-empty turns, "Summarize to note" appears, saves, and shows "Saved to notes." — and the note body reflects the actual conversation text (proving `uiMessageText` reduced the parts correctly rather than sending empty strings). It must **not** appear with only a greeting on screen.
11. **Clear.** Press Clear with a skill that has a greeting selected: the transcript empties and the greeting is re-seeded (exactly one bubble). With no skill selected: the transcript is empty. In both cases the error banner and the Sources accordions are gone.
12. **Error path + rollback.** `pkill ollama`, send a message. The error banner shows the friendly Ollama recovery hint (not a raw stack). No blank assistant bubble is left below the user's message. Restart Ollama and send again — it recovers without a reload.
13. **Non-2xx mapping.** Navigate to a video whose `summaryStatus` is not `generated` and send. The banner reads "The AI summary for this video is still generating…", **not** `HTTP error! status: 409`.
14. **Thread isolation.** Send a message on video A, navigate to video B without reloading, and send a message there. B's request must carry B's `videoId` and `threadId`, and B's transcript must not contain A's messages or A's Sources accordions.

---

### Do NOT

- **Do NOT put `videoId` / `skillSlug` / `modelChoice` in `useChat`'s chat-level `forwardedProps` or `body`.** Phase 3 correctly used chat-level props for DigestChat because `videoIds` is conversation-scoped. Here all three change mid-conversation, and `reload()` replays chat-level props only, never a previous send's per-call body (`docs/chat/connection-adapters.md:131`). Per-send is the only channel that stays correct.
- **Do NOT close over `videoId`, `skillSlug` or `modelChoice` inside the `connection` (or a `fetcher`).** The transport is built once in a `useMemo` keyed on `[clientId, syncResumeState]` (`use-chat.ts:106-118, :286`) and the option-sync effects at `use-chat.ts:317-341` cover `body`, `forwardedProps`, `tools`, `context` and `queue` — never `connection`/`fetcher`. A captured value is sent forever with no error. `onFinish` / `onError` are the exception and may close over state: they are read through `optionsRef.current`, refreshed on every render (`use-chat.ts:96-97, :190-199`).
- **Do NOT put `EvidenceCitation[]` in `UIMessage.metadata`.** `uiMessagesToWire` copies user metadata keys onto every outbound message on every send (`ag-ui-wire.ts:325`). Evidence carries full transcript chunks; storing it there re-uploads a growing pile of excerpts each turn, to a model that must never see them.
- **Do NOT delete `dropOrphanToolCalls` as "defensive".** `isToolCallIncluded` admits `state: 'input-complete'` with no output (`.reference/.../activities/chat/messages.ts:484-492`), and the client-side `collectToolCalls` applies no state filter at all (`ag-ui-wire.ts:469-485`). An unanswered `tool_use` is a hard 400 on Anthropic, and `video-chat` reaches Anthropic since ADR 0011. The deleted `status === 'done'` check was the only thing preventing it.
- **Do NOT switch `/api/chat` to `chatParamsFromRequest(request)` because it is one line shorter.** It throws a `Response` rather than an `Error`. TanStack Start does handle that, but the explicit `chatParamsFromRequestBody` + try/catch keeps the 400 path readable and framework-independent, and keeps the existing "Invalid JSON body" behaviour intact.
- **Do NOT use `setMessages` with an updater function.** `useChat`'s `setMessages` is `setMessagesManually(newMessages: Array<UIMessage>)` (`use-chat.ts:477-482`) — it takes an array only. `setMessages(prev => …)` will not compile, and if forced through with a cast it stores the function.
- **Do NOT do the error rollback inline in `onError`.** `onError` runs synchronously inside the client's error path, before React commits the last message update, so the `messages` it sees can be one render behind and the rollback would delete the wrong entry. The `errorSeq` effect exists for that reason; do not "simplify" it away, and do not add `messages` to its dependency array — that turns it into a loop that eats real messages.
- **Do NOT reach for `ToolCallRecord` fields on a `tool-result` part.** Tool-result parts carry no `name` (`.reference/.../stream/message-updaters.ts:123-138`); the display name comes only from the matching `tool-call` part. Merging in the other direction blanks every tool card header.
- **Do NOT trust `yarn --cwd ./client test` as verification for this phase.** No test covers `/api/chat` or `VideoChat`, and `chat-stream.test.ts`'s fixtures are hand-authored. The manual checklist is the verification.
- **Do NOT re-key `MessageRow` on the array index.** It is keyed on `msg.id` now, because the evidence Map is keyed on the same id and an index key makes React reuse a row across an id change.

---

### Commit

```bash
cd /Users/paul/projects/music-kb && git add client/src/components/VideoChat.tsx client/src/routes/api.chat.tsx client/src/lib/services/chat-stream.ts client/src/lib/services/ui-message-text.ts && git commit -m "$(cat <<'EOF'
refactor(chat): move VideoChat onto useChat and the AG-UI wire

Replaces VideoChat's hand-rolled fetch + SSE loop + tool-call merge state
machine with @tanstack/ai-react's useChat, and deletes the SECOND verbatim
copy of the 38-line untested expandHistoryForModel from /api/chat. The
client's uiMessagesToWire already emits the assistant-toolCalls + role:'tool'
fan-out that function reconstructed by hand — and emits it more correctly,
walking parts in order instead of hoisting every tool call ahead of all text.
/api/chat now reads an AG-UI RunAgentInput via chatParamsFromRequestBody.

threadId={videoId}, so each video's conversation is its own chat client and
cannot leak across a route change.

videoId / skillSlug / modelChoice are passed PER-SEND in sendMessage's `body`,
never captured. useChat builds its transport once in a useMemo keyed on
[clientId, syncResumeState] and the option-sync effects cover body,
forwardedProps, tools, context and queue — never connection/fetcher. A
connection closing over modelChoice would send the first render's value
forever: the picker moves, the UI updates, a different model answers, and
nothing errors. Passing per-send removes the failure mode rather than working
around it.

Evidence citations live in a component-local Map<messageId, EvidenceCitation[]>
filled from onFinish, NOT in UIMessage.metadata. uiMessagesToWire copies user
metadata keys onto every outbound message on every send, and an
EvidenceCitation carries a full transcript chunk in groundedSnippet — metadata
would re-upload a growing pile of excerpts each turn, to a model that must
never see them.

Re-adds, server-side, the orphan-tool-call protection the deleted
expandHistoryForModel gave us by accident via its status === 'done' filter.
The SDK does not filter: a call that reached TOOL_CALL_END but never
TOOL_CALL_RESULT settles at state 'input-complete', collectToolCalls emits it
with no state filter, and the tool fan-out skips it for having no output — an
assistant tool_use block that nothing answers. Anthropic rejects that with a
400, and video-chat reaches Anthropic since ADR 0011. dropOrphanToolCalls now
strips those before the messages reach chat().

Also: the SSE connection adapter discards the response body on a non-2xx, so
/api/chat's 404 "Video not found" and 409 "Summary not ready" are mapped back
from the status code client-side instead of surfacing as
"HTTP error! status: 409". Error text is routed to friendlyAnthropicError or
friendlyOllamaError by the picker's current tier — the old code assumed local.

The 1217 tests stay green and prove nothing here: nothing covers /api/chat or
VideoChat. Verified by hand against a live Ollama and a live Anthropic key —
streaming, tool cards with real names and args, tool-history continuity across
turns, the orphan-guard log line after a killed backend, greeting reseeding on
skill switch and on Clear, summarize-to-note, and picker changes actually
reaching the server.

Refs docs/tanstack-ai-upgrade-plan.md Phase 4, ADR 0011.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Do not migrate

These are deliberately excluded from every phase above. Each line is the reason; do not "finish the job" by touching them.

- **`useLibraryChat.ts` / `/api/ask`** — retrieval-first: it emits its `CITATIONS` frame *before* the message the citations belong to, and `useChat` has no equivalent for an out-of-band pre-message frame. It also persists to `localStorage` under `ytkb:library-chat:v1` with a schema `useChat` does not produce. Stays on `chat-stream.ts` permanently.
- **`client/src/lib/services/chat-stream.ts` itself** — retiring it is explicitly a non-goal (`docs/tanstack-ai-upgrade-plan.md` §4, §Phase 5). After all five phases it still has one real consumer (`useLibraryChat`) plus its own test file. Deleting it breaks library-wide ask.
- **The seven in-process `chat()` callers** (`learning.ts`'s summarizer/ask paths, `lesson-write`, the digest builder, and the rest that consume the stream server-side without an SSE hop) — they never touch the AG-UI wire, so neither defect reaches them. Phase 1's bump covers them by construction; no code change is warranted.
- **`lesson-stream.ts`** — its own frame vocabulary, its own consumer, no tool calls. Nothing in defect A or B applies. Converting it would be a rewrite with no defect behind it.
- **`withSystem` in `chat-model-request.ts`** — shared by four routes and fenced off by §4 of the plan. Its `messages: never` cast is intentional (Anthropic silently drops a `role: 'system'` message, so the tier decides where the system prompt goes). Every phase spreads it unchanged.
- **The four tools in `library-tools.ts`** (`search_library` :61, `get_video_details` :129, `list_videos_by_topic` :206, `load_passages` :277) — checked against both the 0.16.6 name switch and the 0.49.1 kind list; none collides. They live on `/api/ask`, which no phase touches. Prefixing them would invalidate a separate set of prompts in `ask-library.ts`.
- **`docs/adr/0001-local-first-no-cloud-ai.md`, `docs/cross-referencing-plan.md`, `docs/harness-extensibility-plan.md`, `docs/architecture-review/03-streaming-chat-parser.md`** — ADRs are immutable decision records; the other three are dated artifacts describing the codebase as it was. Rewriting `web_search` in them destroys the reason they exist. `README.md` and `docs/architecture.md` are living docs and *are* in scope.
- **`askAboutVideoService` (`learning.ts:1425-1454`)** — its prompt advertises a tool its `chat()` call never passes. A real pre-existing bug, unreachable from the frontier tier, orthogonal to both defects. File it; do not fix it inside any phase here.
- **`chat-stream.ts:163-173` running Anthropic errors through `friendlyOllamaError`** — a real bug on a locality assumption ADR 0011 invalidated, and a user-visible behaviour change. Its own commit, with its own tests. Folding it into Phase 1 means a revert of the upgrade also reverts an unrelated fix.

---

## Definition of done

Tick every line. A phase is not done because vitest is green.

**Phase 0**
- [ ] `grep -rn "web_search" client/src server/src packages web | grep -v node_modules | grep -v kb_web_search | grep -v chat-tools.test.ts` → empty.
- [ ] `chat-tools.test.ts` passes 3/3; client suite `1220 passed`.
- [ ] `npx tsc --noEmit -p client/tsconfig.json` → clean.
- [ ] `[tool kb_web_search] … → N results` observed on **local video chat**, **frontier video chat**, and **frontier digest chat**, with the `kb_web_search` chip visible in each.
- [ ] `docs/tanstack-ai-upgrade-plan.md` no longer contains "No error; different results".

**Phase 1**
- [ ] Installed versions are exactly `0.49.1` / `0.18.0` / `0.10.0`, pinned without carets, `@anthropic-ai/sdk` still `0.97.1`.
- [ ] `tsc --noEmit` clean; unit suite green at the reconciled count.
- [ ] `/tmp/sse-after.txt` shows `TOOL_CALL_END` with **no** `toolName` and **no** `input`, at least one `TOOL_CALL_ARGS` line, and `local executor actually ran: true`.
- [ ] Every new SSE fixture in `chat-stream.test.ts` was pasted from a `RAW ` line, not written.
- [ ] Browser: tool card shows a **name**, a non-empty **input**, and a **result** panel.
- [ ] The bump and the parser patch are in **one commit**.

**Phase 2**
- [ ] `tsc exit=0`; `api.notes.compose.test.ts` passes 5/5; suite at `1222`.
- [ ] Removing `throwOnRunError` makes exactly 2 tests fail (then reverted).
- [ ] `grep -rln streamChatSSE src` lists five paths, without `NoteComposer.tsx`.
- [ ] Browser: `/api/notes/compose` responds `application/json` (not `text/event-stream`); Cancel is clickable mid-generation, closes the composer, shows no red strip, and the request shows `(cancelled)`; `pkill ollama` mid-compose yields a real error and leaves the draft intact.

**Phase 3**
- [ ] `ai-react 0.22.1` / `ai 0.49.1` / `ai-client 0.28.x`; `@tanstack/ai/client` subpath resolves.
- [ ] `ai-messages.test.ts` passes 9/9; `tsc --noEmit` clean; suite green at previous +9.
- [ ] `expandHistoryForModel` gone from `api.digest-chat.tsx` (still present in `api.chat.tsx`).
- [ ] Browser: AG-UI body with the seven top-level keys and `forwardedProps.videoIds` of 3; picker change reaches the server on turn 2; `⋯ kb_web_search` → `✓ kb_web_search` chip; follow-up request carries the assistant `toolCalls` **and** the paired `role: "tool"` entry; **Retry** returns 200 with `videoIds` populated; the curl checks return the literal `videoIds must contain 2–5 items` / `Summary not ready for <id>` bodies with 400 / 409; Stop mid-tool-call does not 400 the next turn.

**Phase 4**
- [ ] `grep -rn expandHistoryForModel client/src server/src packages web/src` → empty across the whole repo.
- [ ] `tsc --noEmit` clean; suite green at the same count as before the phase.
- [ ] All fourteen manual checks in "Verification for Phase 4" pass, including: no transcript excerpts in any outbound `messages[].metadata`; exactly one "Thinking…" bubble; the orphan-guard log line after a killed backend followed by a successful send; the picker's token reaching the server on every turn; 409 rendering as prose, not `HTTP error! status: 409`.
- [ ] `chat-stream.ts`'s header comment names only the consumers that actually remain.

**Across all phases**
- [ ] No `@tanstack/*` dependency is on a caret range.
- [ ] No SSE fixture anywhere in the repo was hand-written after Phase 1.
- [ ] Nothing in the "Do not migrate" list was touched.
- [ ] Every "I am unsure about X" flag in this document that was resolved during execution has been written down — in the commit body or back into this file — rather than dropped.
