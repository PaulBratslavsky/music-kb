# Project Pipeline — Implementation Plan

A per-video "Project" extraction pipeline. One YouTube video → one Project row. Two kinds (`replicate` = build-along tutorial, `concept` = app-idea brief), one discriminator (`kind`), and four read-mostly MCP tools Claude Code uses to execute the build.

## Section 1 — Architectural decisions (load-bearing)

These are fixed constraints the implementation hangs off:

1. **One Strapi collection, `Project`**, discriminated by `kind: 'replicate' | 'concept'` (default `'replicate'`). One video = one Project via `sourceVideo` oneToOne. No multi-video composition.
2. **JSON body is the source of truth.** `body` holds the extracted payload; `projectMarkdown` (richtext) is regenerated from `body` every save for human reading. Never hand-edit markdown expecting it to survive a re-render.
3. **`planVersion` is the shape-invalidation key.** Same idiom as `EMBEDDING_VERSION` / `PASSAGE_EMBEDDING_VERSION` in `client/src/lib/env.ts` — bump on breaking body-shape changes; older rows flag "out-of-date" in the UI and can be re-extracted.
4. **Read-only MCP tools + one append-only write (`addProjectNote`).** No agentic logic server-side.
5. **Kind asymmetry in MCP:** replicate has `stepsIndex` + progressive `getProjectStep(stepIndex)`; concept returns the full `brief` atomically from `getProject` (no per-step endpoint — concepts have features, not ordered steps).
6. **Manual opt-in:** tag the Video `tutorial` → replicate, `idea` → concept; admin button on the video detail page runs extraction. No auto-classifier.
7. **Local Ollama** via `OLLAMA_SYNTHESIS_MODEL` (falls through to `OLLAMA_CHAT_MODEL` → `OLLAMA_MODEL` → `gemma4-kb:latest`) and the existing `chat({ outputSchema })` + `withRetry` plumbing used in `client/src/lib/services/digest.ts`.
8. **`additionalContext` (human override) + `claudeCodeNotes` (automated override)** are ALWAYS surfaced in MCP responses before steps/brief so Claude Code sees overrides before acting.
9. **Same MCP server**, register in `server/src/mcp/tools/index.ts`. Same response-envelope wrapping (`{ content:[{type:'text', text:JSON.stringify(...)}]}`) supplied by `server/src/mcp/server.ts`.

## Section 2 — Data model

### 2.1 Strapi `Project` collection

File: `server/src/api/project/content-types/project/schema.json`

```
attributes:
  title            string,  maxLength 200, required
  slug             uid,     targetField "title"                  (unique auto-generated)
  status           enum ['draft','published'],        default 'draft'
  kind             enum ['replicate','concept'],      default 'replicate', required
  sourceVideo      relation oneToOne → api::video.video (nullable; no inversedBy in v1 — see Note A)
  goal             text,    maxLength 1000
  githubRepo       string,  maxLength 500
  techStack        json                                 (string[])
  prerequisites    json                                 (string[])
  body             json,    required                     (discriminated; see §2.2)
  projectMarkdown  richtext                              (rendered from body on save)
  additionalContext richtext                             (human override)
  claudeCodeNotes  json,    default []                   ([{id, note, stepId?, source, timestamp}])
  planVersion      integer, required, default 1
  extractionModel  string,  maxLength 100
  extractedAt      datetime
options:
  draftAndPublish: false   (matches Digest/Note convention)
```

Factory files (all trivial, match `server/src/api/digest/`):
- `server/src/api/project/controllers/project.ts` → `factories.createCoreController('api::project.project' as never)`
- `server/src/api/project/routes/project.ts` → `factories.createCoreRouter(...)`
- `server/src/api/project/services/project.ts` → `factories.createCoreService(...)`

**Note A — back-relation deferred.** Future `Video.project` back-relation for "does this video have a project" populate is deferred in v1 because it would require editing `server/src/api/video/content-types/video/schema.json`. Projects are queryable by `filters[sourceVideo][documentId][$eq]` without it. Add the `inversedBy` in a follow-up.

### 2.2 Body shape (discriminated union on `kind`)

**`kind: 'replicate'`** → `body = { steps: TutorialStep[] }`

```
TutorialStep {
  id: string                            // stable kebab-case, e.g. "s-scaffold-strapi"
  title: string (max 200)
  intent: string (max 1000)
  action_summary: string (max 1500)     // INTENT, not verbatim commands
  decisions: [{ choice: string, rationale?: string }]
  transcript_range: { startSec: number, endSec: number } | null   // null → dropped
  depends_on?: string[]                 // empty in v1
  variants?: [{ condition: string, body: string }]   // empty in v1
  domain?: 'code'                       // default 'code'
}
```

**`kind: 'concept'`** → `body = { brief: ConceptBrief }`

```
ConceptBrief {
  problem_statement: string (max 1500)
  target_users: string (max 600)
  key_features: [{ id: string, title: string, summary: string, priority?: 'must'|'should'|'could' }]
  architecture_notes: string (max 2000)
  tech_suggestions: [{ category: string, suggestion: string, rationale?: string }]
  design_decisions: [{ decision: string, rationale?: string, certainty: 'stated'|'implied'|'open' }]
  open_questions: string[]
  transcript_range: { startSec, endSec } | null
}
```

### 2.3 `claudeCodeNotes` entry shape

```
{ id: string (uuid), note: string, stepId: string | null, source: 'claude-code'|'mcp'|'manual', timestamp: string (ISO) }
```

## Section 3 — Ordered task list

### Task 1 — Strapi Project collection

Files (new):
- `server/src/api/project/content-types/project/schema.json`
- `server/src/api/project/controllers/project.ts`
- `server/src/api/project/routes/project.ts`
- `server/src/api/project/services/project.ts`

Key decisions:
- Use `'api::project.project' as never` cast in every consumer (client service + MCP tools) because `server/types/generated/contentTypes.d.ts` won't include Project until first `strapi build`. Same workaround used in `server/src/mcp/tools/save-note.ts`.
- `draftAndPublish: false` like Digest/Note.
- No custom logic. Factory-only.
- `sourceVideo` is `oneToOne` without `inversedBy` in v1 (see Note A).

Dependency: none. Must land first; everything else reads or writes this collection.

### Task 2 — Extraction service

Files (new):
- `client/src/lib/services/project.ts`

Mirrors `client/src/lib/services/digest.ts` one-to-one:

Public exports:
- `PROJECT_PLAN_VERSION = 1` (shape invalidation constant; bump to break cache)
- `TutorialStepSchema`, `ConceptBriefSchema`, `ProjectExtractionSchema` (Zod `z.discriminatedUnion('kind', [...])` over `{ kind:'replicate', steps }` and `{ kind:'concept', brief }`)
- `ProjectExtraction` type (inferred)
- `extractProjectPlan(video: StrapiVideo, kind: 'replicate'|'concept'): Promise<ServiceResult<ProjectExtraction>>` — pure; assembles prompt, calls `chat({ adapter: projectAdapter, outputSchema, temperature: 0.2 })` wrapped in `withRetry({ attempts: 2 })`.
- `renderProjectMarkdown(extraction, video): string` — two layouts, one per kind.
- `generateProjectFromVideoId(videoId, kind): Promise<ServiceResult<{extraction, video}>>` — orchestrator (dual-lookup pattern from `generateDigestByIds` in digest.ts: try youtubeVideoId first, fall back to documentId).

Adapter setup (matching digest.ts):
```
const projectAdapter = createOllamaChat(OLLAMA_SYNTHESIS_MODEL, OLLAMA_HOST);
```

Prompt-building strategy (per kind, same helper as `formatVideoForSynthesis` in digest.ts):
- Feed in order: summaryTitle/Description → verdictSummary → summaryOverview → keyTakeaways → sections (with timeSec) → actionSteps → transcript with segment timestamps. Transcript is the anchor for `transcript_range`.

Critical prompt rules (replicate):
- Every step MUST have a non-empty `transcript_range` with both `startSec` and `endSec` inside the video duration. Steps violating this are dropped post-extraction.
- `action_summary` describes INTENT ("install project deps via the speaker's package manager"), not verbatim commands.
- Every speaker choice → `decisions` entry (package manager, framework version, auth provider, etc.).
- 6–15 steps typical; hard cap 40; combine micro-actions into milestones.
- Stable kebab-case ids (`s-scaffold-strapi`), never "Step 1".

Critical prompt rules (concept):
- `tech_suggestions` / `design_decisions` only if speaker explicitly mentions. `certainty: 'stated'` for direct speaker claims, `'implied'` for inferred, `'open'` for things the speaker posed as a question.
- `open_questions` is the richest field.
- `transcript_range` covers the whole concept discussion (from topic-start to topic-end).

Post-extraction validation (`sanitizeReplicate` / `sanitizeConcept`):
- Replicate: filter steps where `transcript_range` is null, degenerate (`start >= end`), or out-of-bounds vs. video duration. If zero valid steps remain → `{success:false, error:'no grounded steps'}`.
- Concept: require non-empty `problem_statement`, `key_features.length >= 1`, valid `transcript_range`.
- Clamp all maxLengths via `clamp(text, max)` helper (digest.ts pattern).
- Use `logPhase` tagging (digest.ts pattern) with tag = youtubeVideoId.

Dependency: Task 1 (for the body JSON schema contract; extraction itself doesn't touch Strapi yet).

### Task 3 — Strapi persistence service

Files (new):
- `client/src/lib/services/projects.ts`

Mirrors `client/src/lib/services/digests.ts` one-to-one. Exports:

- `StrapiProject` type (matches schema attrs + `documentId`, `createdAt`, `updatedAt`, and `sourceVideo` populated as a lightweight video summary).
- `createProjectService({ kind, title, goal, sourceVideoDocumentId, body, projectMarkdown, techStack, prerequisites, githubRepo?, model, planVersion })`
- `fetchProjectBySlugService(slug): Promise<StrapiProject | null>`
- `fetchProjectBySourceVideoService(videoDocumentId): Promise<StrapiProject | null>` — used for create-vs-update decision
- `listProjectsService({ q?, kind?, page?, pageSize? })`
- `updateProjectService({ documentId, ...partial })`
- `appendClaudeCodeNoteService({ documentId, entry })` — reads row, appends to `claudeCodeNotes`, PUTs
- `deleteProjectService(documentId)`

Populate strategy (`projectQueryParams()`): `populate[sourceVideo]=true` with field filters (`youtubeVideoId`, `videoTitle`, `videoAuthor`, `videoThumbnailUrl`). Do not populate `body` — it's JSON, already in the row.

Smallest-viable-first cut (§6): only `createProjectService`, `fetchProjectBySlugService`, `fetchProjectBySourceVideoService`, `appendClaudeCodeNoteService` are required for ship-it. `listProjectsService`, `updateProjectService`, `deleteProjectService` land in the second cut.

Dependency: Task 1.

### Task 4 — Server function layer

Files (new):
- `client/src/data/server-functions/projects.ts`

Exports (TanStack `createServerFn` pattern from `client/src/data/server-functions/videos.ts`):

- `generateProjectForVideo({ videoId, kind?: 'replicate'|'concept' })` — if `kind` omitted, infer from Video's tags (`tutorial` → replicate, `idea` → concept, both → return `{status:'needs_kind'}` so UI prompts). Looks up existing Project by `sourceVideo` → create-vs-update. Runs `generateProjectFromVideoId`, renders markdown, writes via `createProjectService` or `updateProjectService` (bumping `extractedAt` + `extractionModel`; retaining `additionalContext` and `claudeCodeNotes` on update). Returns `{ status:'ok', slug }` on success.
- `fetchProject({ slug })` — loader for the detail route.
- `listProjects({ q?, kind?, page? })` — loader for the list route.

Extraction is awaited synchronously in the server function (matching digest's wait-then-navigate flow). If timing becomes an issue, switch to the kickoff-and-poll pattern from `kickoffSummaryGeneration` in videos.ts.

Mirror the dedupe-by-videoId `Set<string>` pattern from videos.ts if the button could be double-clicked. Not strictly required (Strapi upserts by documentId) but matches the codebase's defensive posture.

Dependency: Tasks 2, 3.

### Task 5 — Admin trigger button

Edit:
- `client/src/routes/video.$documentId.tsx`

Current file is 58 lines and only renders a `<VideoCard>`. Add beneath the card:

- Show a `GenerateProjectButton` when `video.tags` includes a tag named `tutorial` or `idea` (exact match, lowercase, case-insensitive). If both tags present, render a two-button pill group ("Extract as tutorial" / "Extract as idea").
- Disabled state: `summaryStatus !== 'generated'` (with tooltip "Generate summary first").
- On click: confirm, call `generateProjectForVideo({ videoId, kind? })`, on success navigate to `/projects/$slug` using TanStack `useNavigate`. On error, show the error inline.
- Reuse the optimistic running/error state pattern from `RegenerateOnCard` in `client/src/components/VideoCard.tsx`.

If a Project already exists for this video, the button label flips to "Re-extract project" and a "View project" link is shown beside it. Lookup driven by a side-load within the Video loader (add a `fetchProjectBySourceVideo` server fn and call it in the loader).

Dependency: Task 4.

### Task 6 — MCP tools (four new files)

Files (new):
- `server/src/mcp/tools/list-projects.ts`
- `server/src/mcp/tools/get-project.ts`
- `server/src/mcp/tools/get-project-step.ts`
- `server/src/mcp/tools/add-project-note.ts`

Edit:
- `server/src/mcp/tools/index.ts` — import + register all four in a new section ("Project tools").

Each file follows the `ToolDef` shape from `server/src/mcp/registry.ts` (name/description/schema/execute). Access Strapi directly via `strapi.documents('api::project.project' as never)` (the `save-note.ts` cast pattern) rather than going through the client services — the MCP server runs inside Strapi so direct document access is idiomatic (see `save-note.ts`, `save-summary.ts`, `get-video.ts`).

#### 6.1 `listProjects`

Schema:
```
{
  topic?: string,
  kind?: 'replicate' | 'concept',
  limit?: number (default 20, max 50)
}
```

Output: `{ projects: CompactProject[], count, hint? }`

`CompactProject = { slug, title, kind, goal, techStack, stepOrFeatureCount, hasGithubRepo, status, extractedAt }`

`stepOrFeatureCount` derives from body: replicate → `body.steps.length`; concept → `body.brief.key_features.length`. Does NOT return `body` — forces progressive fetch.

Topic filter: `filters[$or][…][title][$containsi]` / `…[goal][$containsi]` (same pattern as `feedQueryParams` in `client/src/lib/services/videos.ts`). Kind filter: `filters[kind][$eq]`.

#### 6.2 `getProject`

Schema: `{ slug: string }`

Output (common fields):
```
{
  slug, title, kind, goal, githubRepo, techStack, prerequisites,
  status, extractedAt, planVersion,
  sourceVideo: {youtubeVideoId, videoTitle, videoAuthor} | null,
  additionalContext, recentClaudeCodeNotes  // last 5, sorted by timestamp desc
}
```

Plus kind-specific fields:
- `kind === 'replicate'`: `stepsIndex: [{id, title, transcript_range}]` only (NOT full step bodies).
- `kind === 'concept'`: `brief: ConceptBrief` — the whole thing atomically.

Populate: `populate[sourceVideo][fields][0]=youtubeVideoId`, etc. Keep payload tight.

#### 6.3 `getProjectStep` (replicate only)

Schema: `{ slug: string, stepIndex: number (int, >= 0) }`

Output:
```
{
  stepIndex, totalSteps, nextStepIndex (null if last),
  step: TutorialStep,
  relatedNotes: ClaudeCodeNote[]   // filtered where note.stepId === step.id
  sourceVideo: {
    youtubeVideoId,
    transcriptRangeUrl: `https://youtu.be/<id>?t=<startSec>`   // built server-side
  }
}
```

If Project is `kind: 'concept'`: return `{ error: "Concept projects don't have stepped plans — use getProject instead." }`. Do NOT silently succeed.

If `stepIndex >= totalSteps`: `{ error: "Step index out of range.", totalSteps }`.

#### 6.4 `addProjectNote`

Schema:
```
{
  slug: string,
  note: string (min 1, max 4000),
  stepId?: string,            // ignored for concept projects
  source?: 'claude-code' | 'mcp' | 'manual'   // default 'claude-code'
}
```

Execute:
1. Fetch project by slug.
2. If `stepId` provided and Project is `kind: 'replicate'`, validate `stepId` exists in `body.steps[].id` (log a warning but still store if it doesn't match — future steps may add `stepId`s we don't yet know about; do NOT silently drop the context).
3. For concept projects, ignore `stepId` and log.
4. Read current `claudeCodeNotes` array (default `[]`), append `{ id: randomUUID(), note, stepId: stepId ?? null, source: source ?? 'claude-code', timestamp: new Date().toISOString() }`, PUT the whole array back.
5. Return `{ noteId, slug, totalNotes }`.

Use Node's `crypto.randomUUID()` (available in the Strapi Node runtime).

Cast pattern: `strapi.documents('api::project.project' as never)` — identical to `save-note.ts`. Data payload cast `as never`.

Dependency: Task 1 only. Can be developed in parallel with everything else after the schema lands.

### Task 7 — Web routes

Files (new):
- `client/src/routes/projects.tsx` — list page
- `client/src/routes/projects.$slug.tsx` — detail page

Edits:
- `client/src/components/Header.tsx` — add `<Link to="/projects">Projects</Link>` between "Digests" and "Search".
- `client/src/components/BottomNav.tsx` — optionally add a Projects tab (non-critical; mobile already cramped — skip in v1).

**List page (`/projects`)**:
- Pattern: `client/src/routes/digests.tsx`.
- Search param schema `{ q?, page?, kind? }` via `validateSearch` + Zod.
- Loader: `listProjects({ q, page: page ?? 1, pageSize: 20, kind })`.
- Filter pill ("All / Tutorials / Concepts") on the kind discriminator — three `<Link>` with `search={{ kind: 'replicate' }}` etc.
- Card: `ProjectCard` component modeled on `DigestCard` with a kind pill (Tutorial green / Concept purple).
- Empty state, pagination identical to digests.

**Detail page (`/projects/$slug`)**:
- Pattern: `client/src/routes/digest.tsx` structure (not the same content, just the layout pattern).
- Loader: `fetchProject({ slug: params.slug })`.
- Header: title, kind pill, goal, status, "extracted from <video>" link to `/learn/$youtubeVideoId`.
- Metadata row: techStack chips (reuse chip styling from `TagChips` in VideoCard.tsx), prerequisites bullets, githubRepo link (external).
- Out-of-date banner when `project.planVersion < PROJECT_PLAN_VERSION` with a "Re-extract" button that calls `generateProjectForVideo({ videoId: project.sourceVideo.youtubeVideoId, kind: project.kind })` and `router.invalidate()`.
- Body: `ReactMarkdown + remarkGfm` over `project.projectMarkdown` — same pattern as the digest Article view in `client/src/routes/digest.tsx`.
- `additionalContext` panel if non-empty: subtly-styled richtext block labeled "Human override".
- `claudeCodeNotes` panel: grouped by `stepId` (null = "Project-level" group); within each group, render `{timestamp · source}` label + note body. Collapsible if many.

Smallest-viable cut: ship the detail page only. List page lands in the second cut (MCP tool already exposes listing; humans can bookmark or type slug).

Dependency: Task 4.

## Section 4 — Dependency graph and parallelism

```
Task 1 (Strapi schema)
  ├── Task 2 (extraction service)       ─┐
  ├── Task 3 (persistence service)       ─┤
  │     └── Task 4 (server functions)    ─┤
  │           ├── Task 5 (admin button)  ─┤
  │           └── Task 7 (web routes)    ─┤
  └── Task 6 (MCP tools)                 ─┘   can run entirely in parallel with 2/3/4/5/7
```

Task 2 and Task 3 are independent after Task 1. Task 6 only needs the Strapi collection to exist.

## Section 5 — Key file references (existing patterns to copy)

| Pattern | Reference file |
|---|---|
| Extraction service shape (adapter, Zod, withRetry, logPhase, clamp, sanitize, two-layer API) | `client/src/lib/services/digest.ts` |
| Strapi CRUD service (headers, query params, ServiceResult, populate strategy) | `client/src/lib/services/digests.ts` |
| Server function (createServerFn, inputValidator, kickoff pattern) | `client/src/data/server-functions/videos.ts`, `client/src/data/server-functions/digests.ts` |
| Detail + list route structure | `client/src/routes/digest.tsx`, `client/src/routes/digests.tsx` |
| Regenerate button optimistic pattern | `client/src/components/VideoCard.tsx` (`RegenerateOnCard`) |
| Strapi collection scaffold | `server/src/api/digest/` (all files) |
| MCP ToolDef + `as never` cast | `server/src/mcp/tools/save-note.ts`, `server/src/mcp/tools/save-summary.ts` |
| MCP tool registration | `server/src/mcp/tools/index.ts` |
| Video lookup with youtubeVideoId-then-documentId fallback | `server/src/mcp/tools/get-video.ts`, `client/src/lib/services/digest.ts` |
| `planVersion`-style invalidation key | `client/src/lib/env.ts` `PASSAGE_EMBEDDING_VERSION` |

## Section 6 — Smallest-viable-first cut (ship this to get end-to-end)

1. Task 1 — schema + factory files.
2. Task 2 — extraction service; both kinds day 1 (discriminator drives schema).
3. Task 3 — only `createProjectService`, `fetchProjectBySlugService`, `fetchProjectBySourceVideoService`, `appendClaudeCodeNoteService`.
4. Task 4 — only `generateProjectForVideo`, `fetchProject`, `fetchProjectBySourceVideo`.
5. Task 5 — the button on the video detail page.
6. Task 6 — ALL FOUR MCP tools (this is the point of the feature).
7. Task 7 — detail page only (`/projects/$slug`).

Second cut: list page (`/projects`), header nav entry, `updateProjectService`, `deleteProjectService`, out-of-date banner UX polish.

## Section 7 — Risks and mitigations

1. **Hallucination of transcript ranges** → primary defense: prompt demands non-null `transcript_range`; post-extraction filter drops steps with null/degenerate/out-of-bounds ranges; whole extraction fails if zero valid steps remain. Concept-kind requires its single top-level `transcript_range` to be valid. (§3 Task 2.)
2. **Source material decay over time (speaker's commands go stale, libraries move)** → `additionalContext` (human) + `claudeCodeNotes` (Claude Code-authored) are both surfaced in every MCP response before steps/brief. Claude Code reads overrides before acting.
3. **Step granularity is model-dependent.** Expect iteration. Soft cap (6–15 target, 40 hard) + "combine micro-actions" prompt rule + post-extraction dedupe of trivially-similar `action_summary`s if needed.
4. **Unbounded `claudeCodeNotes` growth.** Schema is forward-compatible (JSON of objects) so moderation/summarization is additive later. No cleanup in v1.
5. **`planVersion` drift** — the detail page flags "out-of-date" and offers re-extract when `project.planVersion < PROJECT_PLAN_VERSION` (client constant from `client/src/lib/services/project.ts`).
6. **GPU contention** between extraction, summary generation, and chat on single-user local Ollama. Single deliberate-trigger UX means it's single-user's responsibility; no queueing layer in v1.
7. **Concept-kind vagueness** — the `certainty: 'stated'|'implied'|'open'` field on `design_decisions` makes the model commit to a claim-strength level, which Claude Code can surface when deciding whether to follow it. `open_questions` captures what the speaker didn't resolve.
8. **Tag drift / conflicting tags** — if a Video has both `tutorial` and `idea`, the admin button shows a two-button picker. The server function rejects ambiguous calls (both tags + no `kind` param) with `{status:'needs_kind'}`.
9. **Concurrent extraction triggering** — use the `inflight: Set<string>` dedupe pattern from `videos.ts` keyed on `videoId` if the button could be double-fired. Cheap and already idiomatic.

## Section 8 — Open questions (flag for future me)

1. **`Video.project` back-relation.** Deferred (Note A). Add in a follow-up so the feed can cheaply badge which videos have a project without issuing an extra lookup per card.
2. **Slug collisions.** Strapi `uid` auto-suffixes (`-1`, `-2`). Acceptable. But for updates that change the title, the slug stays — verify Strapi behavior on `updateProjectService` title change.
3. **Re-extract preserves notes & additionalContext — where exactly?** Update path reads the existing row first, spreads `additionalContext` + `claudeCodeNotes` into the `data` payload verbatim, then overlays the fresh `body`, `projectMarkdown`, `extractedAt`, `extractionModel`, `planVersion`. Be explicit about this in `updateProjectService` comments.
4. **Should `addProjectNote` noop-on-duplicate?** v1: no — each call appends, idempotency is Claude Code's responsibility. Observed behavior: when Claude Code retries the tool, we may accrue duplicates. Mitigation is a follow-up moderation tool.
5. **Does `getProjectStep` respect 0-based vs 1-based?** 0-based. Enforce in the schema (`z.number().int().min(0)`) and in the description.
6. **Transcript range URL building** — the MCP tool builds `https://youtu.be/<id>?t=<startSec>`. That's fine for the start. If a future consumer needs a duration-aware link, extend to `?t=<start>&end=<end>` (non-standard; YouTube ignores `end` in public URLs) or switch to the embed URL. Not needed in v1.
7. **Step-id stability across re-extractions** — re-extraction may produce different step ids than the previous run. That orphans `claudeCodeNotes[].stepId` references. v1 accepts this: notes with orphaned `stepId` show up in the "Project-level" group on the detail page and as `relatedNotes: []` (never matched) in `getProjectStep`. Document this in the out-of-date banner so users know.

## Section 9 — Out of scope for v1 (explicit)

- Auto-classification of video → kind
- Manual project creation UI (no source video)
- `claudeCodeNotes` moderation/summarization
- Exporting `projectMarkdown` as a downloadable `.md`
- Cross-video composition
- Integration with `/feed`
- BuildSession / props-passing MCP layer
- Separate MCP server
- Server-side agentic logic
- Strapi admin panel injection
- Claude Code-side configuration (persona, `CLAUDE.md`, slash commands) — tracked separately

---

## Critical Files for Implementation

- `/Users/paul/programing/yt-knowledge-base/server/src/api/project/content-types/project/schema.json`
- `/Users/paul/programing/yt-knowledge-base/client/src/lib/services/project.ts`
- `/Users/paul/programing/yt-knowledge-base/client/src/lib/services/projects.ts`
- `/Users/paul/programing/yt-knowledge-base/client/src/data/server-functions/projects.ts`
- `/Users/paul/programing/yt-knowledge-base/server/src/mcp/tools/index.ts`
