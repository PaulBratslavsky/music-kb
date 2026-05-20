# Harness extensibility plan

**Status:** Draft. Created 2026-05-05.
**Reference vocabulary:** [`docs/agent-harness-reference.md`](./agent-harness-reference.md) — the nine-component model used throughout this plan (Tools, Skills, Hooks, Compaction, Sub-agents, Permissions, etc.).
**Companion:** [`docs/architecture-review/`](./architecture-review/) — the five Modules already deepened (Retrieval, Strapi Query, Background Generation, YouTube Player, Streaming Chat Parser). Extensibility builds on top of those.

## Goal

Take yt-knowledge-base from "purpose-built YouTube knowledge agent" to "extensible harness where new features plug in along well-named seams without rewriting plumbing."

Concretely, after this plan ships, each of these should be a one-file change:

| Action | Today | Target |
|---|---|---|
| Add a new skill (e.g. "Twitter thread") | One file under `client/src/lib/skills/` + registration line + optional Strapi seed | One declarative file. Surface affordances (greeting, suggested prompts, persona, output format) all live in the Skill record |
| Add a new tool exposed to both chat and MCP | Define twice: `chat-tools.ts` for the agent loop, `server/src/mcp/tools/<name>.ts` for MCP | Define once. Both surfaces consume the same registry entry |
| Add a new chat surface (e.g. "tag-page chat") | Touch `SkillContext` union, retrieval orchestration, prompt assembly, SSE wiring | Implement a minimal chat-surface adapter; library handles the rest |
| Add a new generation pipeline (e.g. "re-summarize with bigger model", "fact-check pass") | Edit the monolithic `generateVideoSummary` | Compose existing stages (fetch → clean → chunk → AI → ground → save) with one or more swapped |
| Run a long Tutor / digest session without context overflow | Fails when history exceeds model's context | Compaction kicks in transparently; agent keeps running |

## Mapping to the nine harness components

From the [reference doc](./agent-harness-reference.md), yt-kb's current harness coverage:

- **Live & mature:** while loop, skills/tools, built-in skills, content persistence, system prompt assembly.
- **Gaps:** **(2)** context compaction, **(4)** sub-agent management, **(8)** tool-loop lifecycle hooks, **(9)** MCP permission tiering.

This plan closes gap (2) directly, opens the design space for gap (4), and makes (8) and (9) cheap to add later when there's concrete demand.

## Phase 1 — Unified Tool Registry (chat + MCP from one definition)

**Why first:** highest leverage / lowest blast radius. Adding the planned `verifyCitations` MCP tool ([`docs/mcp-citation-rewrite-plan.md`](./mcp-citation-rewrite-plan.md)) is an immediate forcing function — without unification, we'll write the rewrite tool twice. Doing this now means every future tool (citation rewrite, transcript correction, related-videos suggestion, etc.) is defined once.

### Current state

- **Chat tools:** `client/src/lib/services/chat-tools.ts` defines `webSearchTool` via TanStack AI's `toolDefinition` builder. The agent loop in `api.chat.tsx` consumes it via `tools: [webSearchTool]`.
- **MCP tools:** `server/src/mcp/tools/*.ts` — ~22 tools, each exporting a `ToolDef<...>` with `{ name, description, schema, execute }`. Registered in `server/src/mcp/registry.ts`.
- The two registries are **completely independent**. Same conceptual operation (e.g. "search this transcript") would need to be defined twice with different shapes.

### Sketch

A single tool-definition shape that both surfaces consume:

```ts
// shared (lib/agent/tools.ts)
type AgentTool = {
  name: string;                       // canonical id, kebab-case
  description: string;                // surfaced to both LLMs
  inputSchema: z.ZodType;             // shared zod schema
  permission: 'read' | 'write';       // gates MCP exposure (closes gap #9)
  execute: (args, ctx) => Promise<...>;  // single implementation
  surfaces: Array<'chat' | 'mcp'>;    // which surfaces expose this tool
};
```

- `chat-tools.ts` registers tools with `surfaces: ['chat']` (or `['chat', 'mcp']`).
- MCP registry filters by `surfaces.includes('mcp')`.
- `webSearchTool` becomes `surfaces: ['chat']` (already chat-only).
- Existing MCP tools become `surfaces: ['mcp']` (today they're MCP-only).
- New tools that should be both: declare both, write once.

### Decisions to grill before implementing

1. **Live in `client/` or `server/` or a shared package?** Today client and server are separate workspaces with separate `node_modules`. Tools that need `strapi` (server-only) can't live in client. Tools that need browser-only deps can't live in server. Likely answer: shared registry definition lives in a place both can import, but each tool's `execute` implementation lives where its dependencies are.
2. **How does context get passed?** Today MCP tools receive `{ strapi }`; chat tools receive nothing. The shared shape needs a typed `ctx` that varies by surface, or a single union type covering both.
3. **Permission tier names.** Closes gap (9) cheaply if we get them right now: `read | write` is the simplest; `read | workspace | full` matches the reference doc; `read | mutate | system` is more precise to our domain. Cosmetic but locks the schema.
4. **Migration strategy.** Big-bang rewrite of all 22 MCP tools, or incremental? Incremental is safer; new tools use the new shape, old ones migrate as they're touched.

### Test surface

- Schema validates against existing tool shapes (round-trip every existing tool through the new type, verify no regression).
- Filter-by-surface produces the right tool set for each consumer.
- Permission gate: a `surfaces: ['mcp']` tool with `permission: 'write'` is callable from MCP only when permissions allow.

### Estimate

**~3 hours** including grilling decisions, schema design, migrating 1-2 tools as proof, writing tests. The remaining 20+ MCP tool migrations happen lazily.

## Phase 2 — Context compaction for long chat sessions

**Why second:** closes harness gap (2). Long Tutor sessions or back-and-forth refinement loops break today when history exceeds the model's context. Real user-facing failure mode.

### Current state

- `prepareChatPrompt` in `learning.ts` sends the full message history every turn, plus the grounding context (sections, takeaways, retrieved chunks).
- No truncation, no summarization, no awareness of the model's context window.
- For local quants (8K–32K context), this hits a wall after roughly 15–25 exchanges depending on response length.

### Sketch

A `Compactor` Module that the chat surface invokes before sending each turn:

```ts
compactIfNeeded(
  history: ChatMessage[],
  model: { contextTokens: number },
  budget: { headroomTokens: number }  // reserve for system prompt + retrieval + response
): ChatMessage[]
```

Behavior:
- Estimate token usage (4 chars/token approximation already exists as `estimateTokens` in `transcript.ts`).
- If under budget → return history unchanged.
- If over → keep the most recent N turns verbatim, summarize older ones into a single synthesized "earlier in this conversation: …" assistant message. Threshold-based (e.g. 80% utilization triggers).

### Decisions to grill

1. **Where does the summary come from?** Quick options: (a) call the same Ollama model with a "summarize the conversation so far" prompt — slow but local. (b) Truncate aggressively without summarization — lossy but instant. (c) Hybrid: keep last 6 turns verbatim, drop older (no LLM call).
2. **Per-skill compaction policy?** Tutor sessions have long reasoning chains worth preserving; YouTube Script sessions are mostly drafts where older versions can drop. Could be a `Skill.compactionPolicy?` field.
3. **Visibility to the user.** Show a "session compacted" badge in the UI so the user knows older context is summarized? Or silent?

### Test surface

- Below-budget history returns unchanged.
- Above-budget history: latest N turns preserved, older summary present, total tokens under budget.
- Round-trip: compact → send to model → verify model can still reference compacted history's gist.

### Estimate

**~4 hours** for option (c) (no LLM call, simple truncation). **~6 hours** for option (a) with a summarizer call.

## Phase 3 — Skill metadata as a declarative surface

**Why third:** scales the skill system from "5 skills, hand-written code" to "many skills, all surfaces auto-adapt." Removes the friction we hit during the YouTube Script work where each new skill needed updates to multiple files.

### Current state

- `Skill` type ([`client/src/lib/skills/types.ts`](../client/src/lib/skills/types.ts)) has fields: `slug`, `name`, `description`, `systemPrompt`, `composerPrompt`, `notePrompt`, `defaultGreeting`, `suggestedPrompts`, `applicableContexts`, `sortOrder`, `icon`.
- Each chat surface (`VideoChat`, `DigestChat`, `NoteComposer`) knows which fields to read.
- Adding a new skill: write the file, register in `index.ts`, optionally seed in Strapi for editable copies.
- Adding a new affordance (e.g. "skill-specific input placeholder", "skill-specific tool subset") requires touching every consumer.

### Sketch

Promote `Skill` to own its full UI affordance contract:

```ts
type Skill = {
  // ... existing fields ...

  // New: per-skill UI affordances (all optional, fall back to surface defaults)
  inputPlaceholder?: string;          // chat input placeholder when active
  enabledTools?: string[];            // restrict tool subset (sub-agent flavor)
  emptyStateMessage?: string;         // shown when no messages + no greeting
  noteFormat?: 'markdown' | 'json';   // hint for downstream rendering
  compactionPolicy?: CompactionPolicy; // ties into Phase 2
};
```

Each chat surface becomes a thin renderer over the skill's metadata. New affordances added at the type level, surfaces inherit automatically.

### Decisions to grill

1. **Where does the line between "skill" and "tool" sit?** A skill that disables `webSearch` and exposes only `searchTranscript` is reaching toward sub-agent territory. Worth naming explicitly.
2. **MCP exposure.** Should skills be exposed to Claude Desktop too (not just in-app chat)? E.g. an MCP tool `useSkill(slug, prompt)` that returns the skill's response. Could pair nicely with Phase 1.
3. **Editable skills via Strapi.** Today some skills are seeded into Strapi for user editing. As Skill grows richer fields, what stays code-defined vs. user-editable?

### Estimate

**~3 hours** for the type extension + threading the new fields through 3 chat surfaces.

## Phase 4 — Composable generation pipeline

**Why fourth:** opens the design space for new content types (podcasts, articles, alternate transcript sources) without forking `generateVideoSummary`.

### Current state

`learning.ts:generateVideoSummary` is a monolithic 200+ line function: fetch transcript → clean → chunk → BM25 index → call AI (single-pass or map-reduce) → ground → save. Reusing pieces (e.g. "re-embed an existing video" or "alternate-model summarization") requires either copy-paste or feature-flagging the monolith.

### Sketch

Stages as composable functions:

```ts
type PipelineStage<In, Out> = {
  name: string;
  run: (input: In, ctx: GenerationCtx) => Promise<Out>;
};

const summaryPipeline = compose([
  fetchTranscriptStage,
  cleanTranscriptStage,
  chunkStage,
  bm25IndexStage,
  aiSummarizeStage,
  groundSectionsStage,
  saveSummaryStage,
]);

// Re-embedding pipeline reuses some stages, swaps others
const reembedPipeline = compose([
  loadExistingTranscriptStage,
  embedStage,
  saveEmbeddingStage,
]);
```

The orchestrator (`Background Generation Module` from [#4](./architecture-review/04-background-generation.md)) gets a generic "run pipeline" interface; the pipelines themselves are data.

### Decisions to grill

1. **How tightly typed are stage I/O contracts?** Strict typing ensures stages compose correctly but adds verbosity. Loose typing (everything is `unknown`) is flexible but error-prone.
2. **Progress reporting.** Today `setStep` knows about three stages: `transcript | ai | saving`. Composable pipelines may have arbitrary stage counts; the progress UI needs to adapt.
3. **Failure semantics.** Each stage can fail; the pipeline composer needs to define retry, fallback, partial-success behaviors.

### Estimate

**~6–8 hours.** Larger refactor with real risk of subtle bugs in the generation path. Defer until concrete demand (a second real pipeline) — extracting the abstraction speculatively is exactly the trap the [skill warned about](./architecture-review/07-transcript-split-skip.md).

## Phase 5 — Lifecycle hooks, sub-agents, permission tiering

**Why last:** these are gaps from the harness reference doc but each is currently hypothetical for our threat model and feature set. Defer until concrete need surfaces.

- **Tool-loop lifecycle hooks (gap #8):** instrument tool-call latency, audit inputs/outputs, block dangerous calls. Today no demand because we have one tool (`web_search`) and trust it. Becomes load-bearing when MCP tools grow write capabilities.
- **Sub-agents (gap #4):** unlock real cross-video reasoning for digest chat (today's digest fans out at retrieval, not at agent layer). High value for content creators doing multi-video research, but a real refactor.
- **Permission tiering for MCP (gap #9):** matters when MCP write-tool surface grows. Phase 1's `permission` field makes this cheap to add later.

Each of these becomes a focused architecture-review pass when its forcing function arrives.

## Sequencing rationale

```
P1 (Unified Tools) ──┬─── unblocks ───→ verifyCitations MCP tool (planned)
                      └─── unblocks ───→ P5 permission tiering (cheap once tools have a `permission` field)

P2 (Compaction) ──── unblocks ───→ longer Tutor sessions, multi-video digest chat

P3 (Skill metadata) ── enables ───→ rapid skill iteration; new chat surfaces

P4 (Pipelines) ──── unblocks ───→ alternate-model summaries, re-embedding without resummary
                                  podcast support, article support, fact-check passes

P5 (Hooks/sub-agents/permissions) ── deferred until forcing function
```

P1, P2, P3 are the immediate value. P4 is conditional on a second pipeline emerging. P5 is conditional on threat model or feature growth.

## Total estimate

| Phase | Effort | Cumulative |
|---|---|---|
| P1 Unified Tools | ~3h | 3h |
| P2 Compaction | ~4h | 7h |
| P3 Skill metadata | ~3h | 10h |
| P4 Pipelines | ~6–8h (when needed) | 16–18h |
| P5 Hooks/sub-agents/permissions | ~10h+ (when needed) | 26h+ |

Phases 1–3 alone (~10 hours) close the most-hit friction points and don't require speculative work.

## Open questions to align on before starting

1. **Order:** P1 first matches the planned `verifyCitations` MCP tool. Push back if you'd rather do P2 first (compaction) because Tutor sessions are bothering you.
2. **Scope of P1:** big-bang migration of all 22 MCP tools, or incremental? Incremental is my recommendation.
3. **Stop-at point:** ship P1+P2+P3 (10h), then evaluate? Or commit to all five phases? My recommendation: P1+P2+P3, then re-evaluate based on what feature work emerges.
4. **Documentation:** each phase will produce its own `docs/<phase>-plan.md` with grilling notes (matching the architecture-review pattern). OK to keep that cadence?
