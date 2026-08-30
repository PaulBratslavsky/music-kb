<!-- Design proposal. Supersedes phases 3-5 of tanstack-ai-migration-spec.md. -->

# One chat component

## The answer in three sentences

Build one in-repo `<Chat>` component on `useChat` — do **not** adopt `@tanstack/ai-react-ui` — and give it seven props plus one render-prop; `VideoChat`, `DigestChat` and `LibraryChat` become three call sites of it, and LibraryChat's FAB/drawer becomes a shell *around* it rather than a variant *of* it. The one blocker that made the earlier "do not migrate library-ask" verdict look right (`docs/tanstack-ai-upgrade-plan.md`, §2 table row 3) is the bespoke pre-text `CITATIONS` frame; it dissolves once citations move to `TEXT_MESSAGE_START.metadata` as **pointers, not payloads**, and `answeredBy` turns out to need no work at all because it already arrives as `metadata.tanstack.model`. `/api/ask` also has to start accepting `messages[]` — not as a concession to the component, but because it is a shipped bug: `useLibraryChat.ts:95` posts only `{question, modelChoice}`, so every follow-up in a threaded UI is answered cold.

`NoteComposer` stays out of this entirely, and that is the right call.

---

## What varies, and how each axis is handled

Legend: **prop** = a value the caller passes; **slot** = a `ReactNode`/render-prop; **server** = not a client axis at all; **delete** = varies today by accident, converges to one behaviour.

| Axis | How | Why |
|---|---|---|
| Endpoint | **prop** (derived from `surface`) | Four hand-written fetch wrappers (`VideoChat.tsx:77-100`, `DigestChat.tsx:34-51`, `useLibraryChat.ts:80-97`, `NoteComposer.tsx:48-65`) collapse to `connection: { api }`. |
| Model picker key | **prop** (same `surface` token) | Already identical at all four call sites — `<ModelPicker surface value onChange disabled />`, `model-policy.ts:114-119`. This axis is the proof the rest can collapse. |
| Per-request context | **prop** `scope: { videoIds: string[] }` | `videoId` vs `videoIds` is an accident; nothing in `prepareChatPrompt` (`learning.ts:1459-1470`) needs the singular, it just doesn't loop. |
| Tools (server) | **server** | Already a server-side array (`api.chat.tsx:180`, `api.digest-chat.tsx:145`, `api.ask.tsx:151`). Correct home; stays. |
| Tool **rendering** | **delete** → one shared accordion | Three renderings for no reason: full accordion (`VideoChat.tsx:663-747`), bare chips that don't appear until text streams (`DigestChat.tsx:99-110, 268-279`), and **nothing at all** in LibraryChat (`useLibraryChat.ts:104-125`) while `/api/ask` runs four tools. That last one is a defect. |
| System prompt | **server, invisible** | Four genuinely different retrieval contracts (`learning.ts:1459`, `learning.ts:1541`, `ask-library.ts:187`, `skill.composerPrompt`). Do not unify them — and the component never needs to know a system prompt exists. |
| Citation **extraction** | **delete** → one wire model | Post-stream re-parse (`VideoChat.tsx:272-274`), client regex + fuzzy title match (`DigestChat.tsx:304-321`), server `CITATIONS` frame (`api.ask.tsx:166-170`). See "Where citations live". |
| Citation **rendering** | **slot** `renderSources` | The one genuinely irreducible axis: player `seekTo` on `/learn/$videoId`, router `<Link>` on digest, deep-link + `<details>` disclosure on library. |
| Persistence | **prop** `threadId?` | Only `useLibraryChat` persists (`ytkb:library-chat:v1`, `useLibraryChat.ts:39-70`). SDK gives `{ persistence, threadId }` (`ai-client/src/types.ts:748-762`). Absent → ephemeral. |
| History semantics | **delete** → all routes take `messages[]` | `expandHistoryForModel` is duplicated character-for-character (`api.chat.tsx:61-98` vs `api.digest-chat.tsx:43-79`); `/api/ask` takes none at all (`api.ask.tsx:51-55`). |
| Skills / greeting | **prop** `skillContext` | `SkillContext` declares `'library-chat' \| 'digest-chat' \| 'project-chat'` (`lib/skills/types.ts:15-20`) and eight of nine skills claim them, but `listSkills` is called in exactly two places — `VideoChat.tsx:112` and `NoteComposer.tsx:102`. Three enum members are dead. |
| Suggested prompts | **prop**, defaulting to the active skill's | Three implementations, one of which renders a non-clickable `<ul>` of stale off-topic examples in a music app (`LibraryChat.tsx:197-208`). |
| Extra actions | **prop** `actions: {clear, retry, summarizeToNote}` | `summarizeToNote` already takes `videoIds: string[]` and its handler comments explicitly anticipate digest (`data/server-functions/notes.ts:153-180`). No surface has retry; `useChat` gives `reload` free. |
| Error handling | **delete** → one path | All four end at `friendlyOllamaError`, but VideoChat (`:95-98`) and DigestChat (`:46-49`) pre-empt the parser's own non-OK branch, making `chat-stream.ts:64-71` dead code for two of four consumers. Only `useLibraryChat` aborts (`:139, 163-165`). `useChat` supplies `error`/`onError`/`stop`. |
| Error **placement** | **delete** → in-bubble | LibraryChat's `status: 'error'` inside the assistant bubble (`LibraryChat.tsx:254-259`) is the better one — it survives in scrollback. Adopt it everywhere. |
| Empty state | **slot** `emptyState?` | Two surfaces have none, one has a stale one. |
| Header / copy | **prop** `chrome` | Pure strings. |
| Slash commands | **prop** `transformInput?` | `transformSlashCommand` is 8 lines (`VideoChat.tsx:54-61`) and exists because Gemma's tool-calling is probabilistic — equally true on `/api/digest-chat`, same tool. Default it on wherever `kb_web_search` is registered. |
| Message body transform | **slot** (inside `renderSources`' sibling) | `stripInlineTimecodes` + `buildMarkdownComponents` (`VideoChat.tsx:495-500`) is real and player-coupled; `annotateCitations` (`LibraryChat.tsx:345-364`) is a different transform. Both are one prop on the shared markdown renderer. |
| Drawer chrome (FAB, ⌘K, Esc, backdrop) | **not a prop** | `LibraryChat.tsx:20-35, 120-139` wraps the component; it does not parameterise it. |
| Temperature | **server** | `0.3` / unset / `0.4` / `0.3`. Digest runs the same `kb_web_search` tool at Ollama's default while `api.chat.tsx:181-192` documents at length why 1.0 broke that exact tool. Fix separately. |

Everything not marked **prop** or **slot** is duplication.

---

## The component

`client/src/components/chat/` — roughly 350 lines total, replacing ~1,600.

```ts
// client/src/components/chat/types.ts
import type { ReactNode } from 'react'
import type { UIMessage } from '@tanstack/ai-client'
import type { SkillContext } from '~/lib/skills/types'
import type { SwitchableSurface } from '~/lib/services/model-policy'

/**
 * A pointer, never a payload. ~100 bytes vs the ~900 that toCitationPayload
 * ships today (api.ask.tsx:33-45 includes `text`). Everything renderable —
 * title, thumbnail, excerpt — is looked up client-side from data the app
 * already has, or fetched on expand.
 */
export type SourceRef = {
  youtubeVideoId: string
  videoDocumentId: string
  startSec: number
  endSec: number
  /** Optional server-supplied label; omit to look up from cached video list. */
  label?: string
}

export type ChatScope = { videoIds: string[] }

export type ChatChrome = {
  title: string
  subtitle?: string
  placeholder: string
  submitLabel: string
}

export type ChatProps = {
  /** Single token: selects the endpoint AND the ModelPicker policy key. */
  surface: SwitchableSurface

  /** Conversation-scoped context. Rides chat-level forwardedProps, memoized. */
  scope: ChatScope

  /** Drives skill picker + greeting + first-prompt prefill + Clear re-seed.
   *  `null` = no skill affordances (today's DigestChat/LibraryChat behaviour). */
  skillContext?: SkillContext | null

  /** Presence enables SDK persistence. Absent = ephemeral. */
  threadId?: string

  chrome: ChatChrome

  /** Defaults to the active skill's suggestedPrompts. Always clickable. */
  suggestedPrompts?: string[]

  emptyState?: ReactNode

  actions?: {
    clear?: boolean
    retry?: boolean
    summarizeToNote?: boolean
  }

  /** e.g. the `/web <q>` rewriter. Defaults on for tool-bearing surfaces. */
  transformInput?: (raw: string) => string

  /**
   * For surfaces where sources are a PURE FUNCTION of the finished text plus
   * local context (DigestChat's regex; VideoChat's evidence resolver).
   * Never called when the server stamped metadata.sources.
   */
  deriveSources?: (message: UIMessage, scope: ChatScope) => SourceRef[]

  /** The one real render-prop. Extraction is unified; presentation is not. */
  renderSources?: (args: {
    message: UIMessage
    sources: SourceRef[]
  }) => ReactNode

  /** Body transform before markdown, e.g. stripInlineTimecodes. */
  transformMarkdown?: (text: string, sources: SourceRef[]) => string

  className?: string
}
```

The one seam that hides the citation split from every caller:

```ts
// client/src/components/chat/sources.ts
import type { UIMessage } from '@tanstack/ai-client'
import type { ChatScope, SourceRef } from './types'

/** Validate metadata at exactly one boundary — `metadata` is Record<string, any>
 *  (packages/ai/src/types.ts:587), so never scatter `metadata?.sources` around. */
export function sourcesFor(
  message: UIMessage,
  scope: ChatScope,
  derive?: (m: UIMessage, s: ChatScope) => SourceRef[],
): SourceRef[] {
  const stamped = message.metadata?.sources
  if (Array.isArray(stamped)) return stamped.filter(isSourceRef)
  return derive?.(message, scope) ?? []
}

export function answeredBy(message: UIMessage): string | undefined {
  // Arrives free: chat() stamps chunk.model (activities/chat/index.ts:5011-5027)
  // → normalize-stream-chunk.ts:90-97 → mergeMessageMetadata on
  // TEXT_MESSAGE_START (processor.ts:908). Zero server changes.
  return message.metadata?.tanstack?.model
}
```

And the internal wiring, so the `forwardedProps`-vs-`body` decision is explicit:

```tsx
// client/src/components/chat/Chat.tsx (excerpt)
const forwardedProps = useMemo(
  () => ({ videoIds: scope.videoIds, skillSlug: activeSkill?.slug, modelChoice }),
  [scope.videoIds, activeSkill?.slug, modelChoice],
)

const chat = useChat({
  connection: { api: CHAT_ENDPOINTS[surface] },
  forwardedProps,                 // chat-level, NOT per-send body
  threadId,
  persistence: threadId != null,
  onError: (e) => setBanner(friendlyOllamaError(e)),
})
```

Chat-level `forwardedProps` rather than per-send `sendMessage(text, { body })`, deliberately: `reload()` replays chat-level props only (`docs/tanstack-ai-upgrade-plan.md:149`), and `retry` is now a shared action, so per-send body would silently retry with an empty scope. `UseChatOptions.body` is the thing that recreates the ChatClient (`packages/ai-react/src/types.ts:80-81`); `forwardedProps` is not, so the memo above is safe even when `videoIds` is a user-editable digest selection.

### VideoChat

```tsx
// client/src/routes/learn.$videoId.tsx (sidebar)
<Chat
  surface="video-chat"
  scope={{ videoIds: [video.youtubeVideoId] }}
  skillContext="video-chat"
  threadId={`video:${video.youtubeVideoId}`}
  chrome={{
    title: 'Ask about this video',
    subtitle: video.title,
    placeholder: 'Ask anything about this video…',
    submitLabel: 'Send',
  }}
  actions={{ clear: true, retry: true, summarizeToNote: true }}
  deriveSources={useVideoEvidence(video.youtubeVideoId)}
  transformMarkdown={stripInlineTimecodes}
  renderSources={({ sources }) => <EvidencePanel sources={sources} onSeek={seekTo} />}
/>
```

`useVideoEvidence` is `getChatResponseEvidence({ videoId, responseText })` (`VideoChat.tsx:272-274`) moved into `useQuery({ queryKey: ['evidence', videoId, message.id], staleTime: Infinity })`. It is *already* a pure function of the finished text, so this is a fit, not a stretch — and it's strictly better than today, where `VideoChat.tsx:283-285` swallows the failure in a bare `catch {}` ("best-effort — the message already rendered"), making a broken resolver invisible.

### DigestChat

```tsx
// client/src/routes/digest.tsx (aside)
<Chat
  surface="digest-chat"
  scope={{ videoIds: selected.map((v) => v.youtubeVideoId) }}
  skillContext="digest-chat"
  chrome={{
    title: 'Ask across these videos',
    subtitle: `${selected.length} videos`,
    placeholder: 'Ask across this digest…',
    submitLabel: 'Send',
  }}
  actions={{ clear: true, retry: true, summarizeToNote: true }}
  deriveSources={(m) => matchTitleTimecodes(m, selected)}
  transformMarkdown={stripInlineTimecodes}
  renderSources={({ sources }) => <DigestSourceChips sources={sources} />}
/>
```

Three things change for free here: `skillContext="digest-chat"` finally activates the skills that already declare it (`tutor.ts:14`, `social-post.ts:14`, `qa.ts:13`), `summarizeToNote: true` turns on a capability whose handler was written for the multi-video case and never wired up, and `transformMarkdown` stops the double-render where the raw `[Title 04:12]` stays in the body *and* a chip is added.

### LibraryChat

```tsx
// client/src/components/LibraryDrawer.tsx — the shell, not a variant
export function LibraryDrawer() {
  const { open, setOpen } = useLibraryDrawer()   // FAB, ⌘K, Esc, backdrop
  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <Chat
        surface="library-ask"
        scope={{ videoIds: [] }}                  // whole library
        skillContext="library-chat"
        threadId="library"                        // SDK persistence
        chrome={{
          title: 'Ask your library',
          placeholder: 'Ask across everything you\'ve watched…',
          submitLabel: 'Ask',
        }}
        suggestedPrompts={LIBRARY_EXAMPLES}       // clickable, and on-topic
        emptyState={<LibraryEmptyState />}
        actions={{ clear: true, retry: true }}
        // no deriveSources — the server stamps metadata.sources
        renderSources={({ message, sources }) => (
          <SourceDisclosure sources={sources} referenced={referencedIndices(message)} />
        )}
      />
    </Drawer>
  )
}
```

Same component, three prop sets. The only structural difference between the three is which of `deriveSources` / stamped metadata supplies the refs — and `sourcesFor()` makes even that invisible to the renderer.

---

## What has to change server-side

### `/api/chat` (`client/src/routes/api.chat.tsx`, 200 lines)
- Delete the local `expandHistoryForModel` (`:61-98`) → import the shared one.
- Accept `videoIds: string[]`, use `videoIds[0]` initially; `prepareChatPrompt` (`learning.ts:1459-1470`) needs no change to keep working.
- Stamp `metadata.sources` on `TEXT_MESSAGE_START` only if you want VideoChat's evidence server-side. **Don't** — evidence there is a post-hoc grounding check with drift flags, and it is legitimately a client-side derived query. Leave `/api/chat` emitting no sources.
- Keep temperature `0.3` and the comment at `:181-192` that explains why.

### `/api/digest-chat` (152 lines)
- Delete the second verbatim copy of `expandHistoryForModel` (`:43-79`) — that's 60 of 152 lines.
- Add `skillSlug` to the body and append `getSkill(slug).systemPrompt`, mirroring `api.chat.tsx:135-146`.
- **Set `temperature: 0.3`.** The current comment says the unset default is "the pre-existing behaviour, not an oversight" — but it registers the same `kb_web_search` tool that `api.chat.tsx:181-192` documents breaking at higher temperature. The comment asserts intent without a reason.

### `/api/ask` (201 lines) — the one that actually changes

Three edits, in this order:

1. **Accept `messages[]`.** Read the AG-UI body via `chatParamsFromRequest` (`utilities/chat-params.ts:204-282`); `videoIds`/`skillSlug`/`modelChoice` arrive in `forwardedProps`. Derive the retrieval query from the last user turn exactly as `prepareChatPrompt` already does via `extractLatestUserQuery` (`learning.ts:1464, 1545`). Pass the expanded history into `chat()`. This fixes a user-visible bug: today `useLibraryChat.ts:228-231` renders a threaded transcript and persists it (`:44`), while the server never sees turn N−1.

2. **Keep retrieval-first and keep it server-internal.** Retrieval still runs *before* the model call, and the seed passages still go into the prompt (`api.ask.tsx:135-139`). Do **not** convert the seed to a plain tool the model must choose to call — the repo's own numbers say ~42% Tau2 tool-call reliability at 4B-effective params (`docs/adr/0001-local-first-no-cloud-ai.md:29`, `docs/architecture.md:438`), and `api.ask.tsx:147-150` already documents the seed as the safety net. Keep the four `buildLibraryTools` registrations (`api.ask.tsx:151`) as *optional* re-call paths — and now they finally render, because the shared component has tool UI.

3. **Delete the `CITATIONS` frame.** Replace the hand-built `ReadableStream` that splices raw bytes ahead of `toServerSentEventsResponse` (`api.ask.tsx:167-189`) with an async-generator map over `chat()`'s chunks that attaches `metadata.sources` to `TEXT_MESSAGE_START`:

```ts
async function* withSources(chunks, sources: SourceRef[]) {
  for await (const chunk of chunks) {
    if (chunk.type === 'TEXT_MESSAGE_START') {
      yield { ...chunk, metadata: { ...(chunk.metadata ?? {}), sources } }
    } else {
      yield chunk
    }
  }
}
return toServerSentEventsResponse(withSources(stream, toSourceRefs(passages)))
```

`toServerSentEventsResponse` takes any `AsyncIterable<StreamChunk>` (`packages/ai/src/stream-to-response.ts:702`), and `metadata` is in the `SHARED` spec-key set, so it survives normalization untouched (`utilities/spec-event-keys.ts:3-8`, `normalize-stream-chunk.ts:64-72`).

4. **Keep the zero-results empty state** (`api.ask.tsx:84-105`) but emit it through `chat()`'s normal machinery instead of three hand-written `data:` strings.

### Shared
- Extract `expandHistoryForModel` to one module regardless of any client work.
- Add `/api/passages?refs=…` to fetch excerpt text on citation expand (see the trade below).
- Delete `client/src/lib/chat-stream.ts` (241 lines) and its test once the last consumer goes.

---

## Where citations and answeredBy live

**One rule: message metadata carries only what the client cannot recompute. Everything else is derived at render.**

**`answeredBy` needs zero work.** Verified chain: `chat()` reads `adapter.model` (`activities/chat/index.ts:4753`) and stamps it on every emitted event (`:5011-5027`); `normalizeStreamChunk` moves `chunk.model` into `metadata.tanstack.model` for every event except `TEXT_MESSAGE_CONTENT`/`TOOL_CALL_ARGS` (`normalize-stream-chunk.ts:90-97`), so `TEXT_MESSAGE_START` carries it; `restoreInboundChunk` keeps it in `metadata` (`restore-inbound-chunk.ts:60-65`); `handleTextMessageStartEvent` deep-merges it onto the `UIMessage` (`processor.ts:908`, impl `:812-851`). It survives re-send by name (`ag-ui-wire.ts:322-323`, ~30 bytes) and it is exactly the semantic `useLibraryChat.ts:26-34` documents — "the model that ACTUALLY answered… cannot drift from the answer." The earlier plan cited losing typed `answeredBy` as a reason not to migrate; it is not lost, it is free. *(One grep to confirm: that `ResolvedModel.adapter.model === ResolvedModel.model` in `model-policy.ts`. If the app's label ever diverges from the adapter id, stamp it explicitly.)*

**Citations become `SourceRef[]` pointers in `TEXT_MESSAGE_START.metadata.sources`.** Ordering is right — merged on `TEXT_MESSAGE_START`, which precedes the first delta.

Rejected alternatives, with the concrete reason each:

- **`onCustomEvent`.** The context is typed `{ toolCallId?: string }` and built as literally `chunk.value?.toolCallId` (`processor.ts:101-105, :2103-2109`; `ai-client/src/types.ts:1005-1018`). No `messageId`. It also doesn't persist — fire-and-forget, so a localStorage reload loses everything. This was the earlier plan's stated blocker and the rejection is correct; the fix is a different mechanism, not a better workaround.
- **`metadata.tanstack.<custom>`.** Tempting because it's the only home that persists client-side *and* is auto-pruned on send. But the `tanstack` bag is rebuilt from a 6-key whitelist (`ag-ui-wire.ts:319-360`), and `types.ts:584-586` says plainly that TanStack owns that key and user keys stay top-level. Depending on an undocumented whitelist for correctness breaks silently on an SDK bump.
- **Tool-result parts carrying the citations** (the "pre-executed tool call" design). This is the most elegant-looking option and I am rejecting it on a verified cost: `ag-ui-wire.ts:200-263` fans every `tool-result` part out as a full `role: 'tool'` wire message with `content` intact, so the passage text goes back to **the model**, not just the server, on every subsequent turn. `/api/ask` retrieves up to 25 passages (`api.ask.tsx:68-76`) and `toCitationPayload` includes `text` (`:33-45`) — a ~150-word chunk, ≈900 chars (`transcript.ts:174`). That's ≈22 KB re-fed as context per turn, on a 4B-effective local model, duplicating text the per-turn seed prompt already contains. Retrieval-as-a-tool remains right for `load_passages`; it is wrong for citations.
- **Top-level `metadata` with full payloads.** Same 22 KB, re-uploaded rather than re-fed: `uiMessagesToWire` copies every top-level user key verbatim (`ag-ui-wire.ts:317-320`, asserted by first-party test `packages/ai/tests/ag-ui-wire.test.ts:789-808`), unconditionally, for the whole array, every request (`connection-adapters.ts:1230`). There is no prune hook — `FetchConnectionOptions` is `{headers, credentials, signal, body, fetchClient, reconnect}` (`connection-adapters.ts:1194-1202`), so stripping requires writing your own `ConnectionAdapter`. Pointers make this ~100 bytes each: 25 citations = 2.5 KB, not 22 KB.

**And for the other two surfaces, nothing is stored at all.** DigestChat already derives from `content` + the `videos` prop with zero per-message state (`DigestChat.tsx:297-322`) — keep that exactly. VideoChat's evidence resolver is already pure (`VideoChat.tsx:272-274`) — move it to `useQuery`, don't stamp it.

### What this gives up, plainly

1. **Excerpt text is no longer pushed.** Expanding a citation chip costs a fetch that today is free. That is the trade: one bounded fetch on expand, versus 22 KB re-uploaded per turn forever with no SDK hook to stop it.
2. **LibraryChat's persisted citations become pointers**, so a reload refetches excerpts. Today `ytkb:library-chat:v1` renders them offline. VideoChat and DigestChat persist nothing today, so no regression there.
3. **Chips render a beat later on tool-calling turns.** Today the frame is byte #1 of the response (`api.ask.tsx:179`). Now they arrive on `TEXT_MESSAGE_START`, which still precedes the first text delta — but `/api/ask` registers tools, so a tool round emits `TOOL_CALL_*` first. **UNVERIFIED / inferred:** hundreds of ms later on those turns. If it matters, add a data-free `CUSTOM` "retrieval started" event purely as a skeleton trigger, so the missing `messageId` never bites.
4. **The 2.5 KB of pointers still re-uploads every turn.** Accepted, not solved.
5. **`metadata` is untyped** (`Record<string, any>`, `packages/ai/src/types.ts:587`) — `UIMessage` is generic over structured output, not metadata. That's why every read goes through `sourcesFor()`.

---

## Build it, or use `@tanstack/ai-react-ui`?

**Build it.** The package is real, published, and version-compatible (`0.8.21` peers `ai-react ^0.22.1`), but three findings settle it:

1. **`ChatInput` owns its value** — `chat-input.tsx:67` is `useState('')` and `ChatInputProps` (`:20-31`) has no `value`/`onChange`/`defaultValue`. There is no way to set the input from outside, which kills skill-switch prefill (`VideoChat.tsx:149`) and suggested-prompt chips (`:365-377`). It also calls `sendMessage(value)` with no second argument (`:74`), so per-send options are unreachable. You replace it 100%.
2. **`Chat` is leaky.** It forwards 8 of `UseChatOptions`' fields (`chat.tsx:77-86`), silently dropping `tools` (declared at `:51`, never destructured), `threadId`, `fetcher`, `persistence`, `interrupts`, `context`, `forwardedProps`. It passes an `id` prop (`:83`) that `ChatClientOptions` doesn't have (`ai-client/src/types.ts:753,761`). Its JSDoc advertises a `<Chat.Messages />` namespace that nothing assigns. `threadId` and `forwardedProps` are exactly the two this design depends on.
3. **The team doesn't use it for anything complex.** Zero of 624 doc pages mention it. The flagship 901-line example imports only `ThinkingPart` (`examples/ts-react-chat/src/routes/index.tsx:39`) and hand-rolls the rest on raw `useChat` (`:503`); `threads.tsx:5` does the same. Only the small `examples/ag-ui/src/App.tsx:283-300` uses the compound. "As the TanStack team intended" means **`useChat` + your own components.**

Add to that: you'd override all four `ChatMessage` renderers anyway; `thinking-part.tsx:66-77` and `chat-input.tsx:118-168` hardcode grays and `rgb(249,115,22)` against music-kb's 78 `var(--…)` references; and `chat-messages.tsx:47-51` forces scroll-to-bottom with no "user scrolled up" guard, which is actively worse than a hand-rolled anchor for long grounded answers.

**Take two things from it, as source:** copy `markdown-plugins.ts` (48 lines, MIT) verbatim next to `TimecodeMarkdown.tsx` — the `rehypeRaw → rehypeHighlight → [user] → rehypeSanitize` ordering with sanitize forced last (`:41-46`) is the one non-obvious thing in the package. And copy `chat.tsx`'s context pattern, but *actually* assign the namespace and pass full `UseChatOptions` through. **Add zero dependencies now.**

---

## What this does NOT unify

- **`NoteComposer` stays out, permanently.** It renders no conversation: it fires one request, throws away every delta, and paints finished markdown into Tiptap once — deliberately (`NoteComposer.tsx:112-117`). Forcing it into `<Chat>` would mean calling `clear()` before every send to suppress the hook's entire purpose. It should go the *other* direction and stop streaming altogether (`Response.json({ markdown })`), which is already Phase 2 of the existing plan. It keeps its own skill picker via `composerPrompt`.
- **The four system-prompt builders.** `prepareChatPrompt` / `prepareDigestChatPrompt` / `ASK_LIBRARY_SYSTEM` / `skill.composerPrompt` encode genuinely different retrieval contracts — single-video BM25 top-8 vs 3-per-video-labelled vs summary-first candidates with `[Video N]` indices. Do not unify. The component never learns a system prompt exists.
- **Citation *presentation*.** Player seek, router `<Link>`, and deep-link disclosure are three real UIs. That's why `renderSources` is a render-prop and not a boolean.
- **LibraryChat's drawer chrome.** FAB, ⌘K, Esc, backdrop, `__root.tsx:61` mounting. That's a container. It wraps `<Chat>`; it is not a mode of it.
- **VideoChat's evidence grounding.** Even unified into `SourceRef`, the "may drift" badge class exists only where there's a single authoritative transcript to ground against. It's a `renderSources` concern, and it stays VideoChat's.
- **Retrieval strategy per route.** Server-side, invisible, and correctly divergent.

So the honest count is: **one chat component, one drawer shell, and NoteComposer left alone.** Not one component for everything — but one component for all three *chat* surfaces, which is what was asked.

---

## Sequencing

Against `docs/tanstack-ai-upgrade-plan.md` §3:

| Phase | Status under this proposal |
|---|---|
| **0** — rename `web_search` | Unchanged. Already done (`migration-spec.md:861`). |
| **1** — core upgrade + parser patch | **Unchanged, and still a prerequisite.** Land alone. Worth doing even if everything below is cancelled. One note: the plan verified "`/api/ask`'s CITATIONS frame needs no work" — true, and it becomes moot, since the frame is deleted in 5′. |
| **2** — de-stream NoteComposer | **Unchanged.** Independent of all of this, and it removes a `chat-stream.ts` consumer. |
| **3** — DigestChat onto `useChat` | **Replaced by 3′.** |
| **4** — VideoChat onto `useChat` | **Replaced by 4′.** |
| **5** — stop | **Replaced by 5′.** |

**This replaces phases 3 and 4 rather than following them.** Building the shared component *after* two bespoke `useChat` migrations means writing DigestChat's and VideoChat's message plumbing twice and then deleting both — which is the exact failure the owner is trying to stop.

- **Phase 3′ — build `<Chat>`, land DigestChat on it (~2 days).** DigestChat is still the right pilot for the same reason the plan gave: it's the only chat route with no custom SSE frame, so there is no bespoke wire contract to preserve. Ship the component, `sourcesFor()`, the shared tool accordion, the shared error-in-bubble, and the extracted `expandHistoryForModel`. Turn on `skillContext="digest-chat"` and `summarizeToNote` here — both are one-line wins on already-built server code.
- **Phase 4′ — VideoChat as the second call site (~2–3 days).** Move evidence to `useQuery`. `threadId={video.youtubeVideoId}`. Keep the plan's two warnings, both still live: the fetcher-closure staleness trap (which is why context rides `forwardedProps`, not a closure), and **re-add the orphan-tool-call filter** that `api.chat.tsx:69`'s `status === 'done'` check gives today — `isToolCallIncluded` admits `state: 'input-complete'` with no output, and an orphan `tool_use` is a 400 on Anthropic.
- **Phase 5′ — converge `/api/ask`, land LibraryChat, delete the parser (~3–4 days).** History fix first and ship it alone if you like — it's a bug fix with no client dependency. Then metadata sources, then delete `useLibraryChat.ts` (256), `chat-stream.ts` (241) and its test, and rework LibraryChat's citation layer (~180 of 411 lines). Version-bump `ytkb:library-chat:v1` and drop old history rather than writing a migration.

The plan's Phase 5 said "do not migrate library-ask to force its retirement — revisit only if `ai-client` later puts a `messageId` in the `onCustomEvent` context." That condition was the right *test* for the wrong *mechanism*. It never has to be met, because `TEXT_MESSAGE_START.metadata` is a supported, verified channel that carries a `messageId` by construction.

---

## Honest cost

**Effort: ~8–10 engineer-days**, against ~3–4 for the plan's phases 3+4 as written. The extra ~5 days buy the deletion of `chat-stream.ts` (241), `useLibraryChat.ts` (256), ~180 lines of `LibraryChat.tsx`, two copies of `expandHistoryForModel` (~80), and roughly 900 lines of triplicated message/tool/error plumbing — plus five shipped defects fixed as a side effect (no library history, invisible library tools, dead skill contexts, non-clickable stale suggestions, no abort on two surfaces).

**What could go wrong:**

1. **`renderSources` becomes a leak.** If a fourth surface needs a fifth slot, the props interface starts growing back toward three components. Mitigation: the rule is *one* render-prop. If a second one is ever needed, that's the signal to split, and splitting is cheap once the transport is shared.
2. **The `/api/ask` history change is a product decision, not a transport one.** Library ask becomes genuinely multi-turn. Retrieval on turn 3 keys off the last user turn ("tell me more about the second one" retrieves badly) — the same limitation `/api/chat` has today. The four library tools are the escape hatch, and they now render, but this is a real behaviour change the owner should sign off on rather than inherit.
3. **Context growth on the local model.** Multi-turn `/api/ask` replays history into a 4B-effective context on `gemma4-kb:latest` (`lib/env.ts:39-46`). The pointer model keeps passages out of history, which is most of the defence — but **measure at turn 4 with 5 candidate videos before merging 5′.** This is the one number I'd want before committing. *(Inferred risk, not measured.)*
4. **`metadata` is untyped and `metadata.sources` is a convention, not a contract.** A future SDK version could start round-tripping or reshaping top-level metadata. `sourcesFor()` is the single place that breaks, and one integration test asserting `metadata.sources` survives `TEXT_MESSAGE_START` → `UIMessage` covers it.
5. **The citation-expand fetch is new surface area.** `/api/passages?refs=…` has to exist, be fast, and degrade gracefully when a video is deleted from the library.
6. **Peer-version drift.** Pin `@tanstack/ai-client` and `@tanstack/ai-react` exactly. Nothing here depends on undocumented `StreamProcessor` internals — that was a property of the tool-call-seed design, which this proposal rejects — but the metadata merge chain is still four SDK internals deep, so one integration test asserting sources and text land on a single message is cheap insurance.
7. **Big-bang risk on 5′.** It touches a route, a hook, a component, and a localStorage key at once. Split it: history fix ships first and independently; metadata sources second; deletions last, after verifying no `chat-stream.ts` consumer remains (`lesson-stream.ts` parses our own vocabulary and is unaffected).
