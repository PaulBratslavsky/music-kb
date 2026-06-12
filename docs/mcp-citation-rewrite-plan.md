# MCP tool: auto-rewrite drifted citations

**Status:** Shipped 2026-06-12 — option A (server-side duplicate of `verifyTimecodesInText` in `server/src/services/bm25-search.ts`; tool at `server/src/mcp/tools/verify-citations.ts`, includes `ungrounded` per decision #3).
**Created:** 2026-05-05.
**Origin:** Architecture review candidate [#6 Citation Grounding](./architecture-review/06-citation-grounding.md) — `verifyTimecodesInText` in `client/src/lib/services/transcript.ts:812` was found to be unused production code. Kept on purpose because of this planned feature.

## Why

When authoring content in **Claude Desktop** (notes, summaries, chat replies, drafts) that cites a video by `[mm:ss]`, the model sometimes emits **drifted timecodes** — close to where the topic lives in the transcript, but off by 30s+. The drift is silent: a reader following the link to the video lands at the wrong moment.

The in-app chat surface **detects** drift today (`extractCitationsWithEvidence` flags it; the UI shows a "may drift" badge for the user to verify). But content written outside the in-app chat has no such mechanism — it gets persisted as-is.

The fix already exists as code: `verifyTimecodesInText` runs the same BM25-grounding pipeline and rewrites drifted citations in place. It just isn't exposed anywhere a user (or Claude Desktop) can call it. The MCP tool below closes that loop.

## What

A new MCP tool `verifyCitations` (working name) exposed by the existing MCP server (`server/src/mcp/server.ts`). Claude Desktop calls it before saving a drafted note / chat response; it returns the corrected text plus an audit trail of changes.

```
Input:
  videoId: string         — the YouTube id whose transcript the citations target
  text: string            — the draft text containing `[mm:ss]` / `(mm:ss)` / bare mm:ss citations
  toleranceSec?: number   — drift threshold (default 30)
  minScore?: number       — BM25 minimum match confidence to act on a citation (default 1.5)

Output (JSON):
  text: string                 — the corrected text (citations rewritten in place, wrapper style preserved)
  overrides: Array<{           — audit trail; empty when nothing drifted
    from: string;              — original timecode the model emitted
    to: string;                — corrected timecode (transcript-grounded)
    context: string;           — first 80 chars of the surrounding claim
  }>
```

Behaviour:
- Citations that match the transcript within `toleranceSec` → **untouched**.
- Citations whose grounded location is `> toleranceSec` away **and** the BM25 match confidence is `>= minScore` → **rewritten**.
- Citations with weak BM25 matches (no confident transcript anchor) → **untouched** (better to leave the model's guess than overwrite with noise).
- Wrapper style is preserved — `[12:34]` stays bracketed, `(12:34)` stays parenthesized, bare `12:34` stays bare.

## Where it plugs in

The MCP server scaffold is mature — ~22 tools already registered. Adding a new tool is a 3-step pattern:

1. **`server/src/mcp/tools/verify-citations.ts`** — new file. Mirrors the shape of `search-transcript.ts:36`:
   ```ts
   export const verifyCitationsTool: ToolDef<z.infer<typeof schema>> = {
     name: 'verifyCitations',
     description: '…',
     schema,
     execute: async ({ videoId, text, toleranceSec, minScore }, { strapi }) => {
       // 1. Load video + transcript index from Strapi.
       // 2. If no stored BM25 index, return { text, overrides: [], reason: 'no-index' }.
       // 3. Run verifyTimecodesInText.
       // 4. Return { text: corrected, overrides }.
     },
   };
   ```

2. **`server/src/mcp/tools/index.ts`** — register the tool alongside the existing ones (one-line addition).

3. **`server/src/services/bm25-search.ts`** — needs to grow a server-side `verifyTimecodesInText`. **This is the load-bearing decision.** Two options (see Open decisions below).

## Open decisions to grill before implementing

### 1. Where does `verifyTimecodesInText` live for server-side use?

Currently the function lives in `client/src/lib/services/transcript.ts:812`. The MCP server is in `server/` and can't `import from 'client'` directly. Options:

- **A. Duplicate to `server/src/services/bm25-search.ts`** — same pattern the project already uses for the BM25 search primitive. Tested separately, drifts independently. Simplest path; matches existing precedent.
- **B. Extract both copies into a shared package** — e.g. `packages/bm25/` workspace. Cleaner long-term but introduces a workspace package the project doesn't currently have.
- **C. Generate the server copy from the client copy at build time** — codegen avoids drift but adds tooling.

**Recommendation:** A. The BM25 primitive duplication already exists in this codebase and hasn't drifted since. One more function in the same file is the lowest-friction option. If we ever add a third copy of the same code, that's the signal to revisit.

### 2. Tool name and description

The MCP server's `instructions` block (server.ts:10-38) gives Claude Desktop a decision tree for when to call which tool. The new tool needs a description that triggers the right reflex:

- `verifyCitations` — clear, but might not auto-trigger ("verify" is generic).
- `groundTimecodes` — more domain-specific.
- `correctCitations` — implies more aggressive rewriting than is actually safe.

**Recommendation during grilling:** read the existing tools' descriptions, find a phrasing that matches the project's voice. Likely `verifyCitations` with a strong description: *"Run before saving any text that contains `[mm:ss]` citations into a video-scoped note. BM25-matches each citation against the video's transcript and rewrites drifted ones."*

### 3. Should the tool also surface the citations the model EMITTED but couldn't ground?

Today `verifyTimecodesInText` silently leaves them alone. An MCP-exposed surface might be more useful if it returns:

```ts
{ text, overrides, ungrounded: Array<{ timecode: string; context: string }> }
```

So Claude Desktop can decide whether to retry with a different phrasing or strip the citation entirely.

**Recommendation:** include `ungrounded` from day one. Cheap, more transparent, no risk to existing callers (which is just the MCP tool).

### 4. Idempotency

If Claude Desktop calls the tool twice on the same text, the second call should return `overrides: []`. Today `verifyTimecodesInText` is structurally idempotent (the BM25 ground-truth doesn't change between calls), so this should already work — but worth a test.

### 5. Failure surface

Possible failure modes:
- Video not found → return error.
- Video has no stored BM25 index (summary not generated yet) → return `{ text, overrides: [], reason: 'no-index' }`. **Don't fail** — the caller should still be able to save the draft, just without correction.
- Text has zero `[mm:ss]` citations → return `{ text, overrides: [] }`. No-op.

**Recommendation:** the soft-fail behaviour above. The tool should be safe to chain — call it on every save without surprises.

## Test surface

The core function `verifyTimecodesInText` already has tests at `client/src/lib/services/transcript.test.ts:413` covering:
- Correct citations untouched.
- Drifted citations rewritten with wrapper style preserved.

When porting to server-side per decision #1, copy those tests to `server/src/services/bm25-search.test.ts` (if/when that file exists — server side has no test infrastructure today, separate concern).

The MCP tool wrapper itself can be smoke-tested via `server/scripts/test-mcp.mjs` (the existing manual MCP integration script). Add a fixture: a known video + a draft note with one drifted citation; verify the tool returns the corrected text.

## Cross-references

- **Existing function** kept for this feature: `client/src/lib/services/transcript.ts:812` (`verifyTimecodesInText`).
- **Existing tests** that must port over: `client/src/lib/services/transcript.test.ts:413` (`describe('verifyTimecodesInText')`).
- **Sister function** for the in-app surface (drift detection without rewrite): `client/src/lib/services/transcript.ts:891` (`extractCitationsWithEvidence`). Live; used by the chat evidence accordion.
- **MCP server scaffold:** `server/src/mcp/server.ts`, `server/src/mcp/registry.ts`, `server/src/mcp/tools/`.
- **Tool to mirror in shape:** `server/src/mcp/tools/search-transcript.ts` (also touches transcript BM25, similar Strapi load pattern).
- **Architecture review entry that surfaced this:** [`docs/architecture-review/06-citation-grounding.md`](./architecture-review/06-citation-grounding.md).

## Estimate

- Port `verifyTimecodesInText` to server-side BM25 service: **~30 min** (mirror `searchBM25`'s shape; copy + adapt regex pattern; reuse `findEvidenceForQuote` server-side helper if it exists, else port that too).
- New `verify-citations.ts` MCP tool + register: **~30 min**.
- Smoke-test fixture in `test-mcp.mjs`: **~15 min**.
- Decisions to grill (#1–#5 above): **~15 min** at the start.

**Total:** ~1.5 hours from grill to working tool, assuming no surprises in the server-side BM25 port.

## Out of scope (future enhancements)

- **Refinement loop** — if `ungrounded.length > 0`, ask the model to re-cite. Could live in a higher-level workflow tool, not this primitive.
- **Cross-video citations** — text that cites multiple videos. Today `verifyTimecodesInText` is single-video-scoped (one BM25 index). Multi-video would mean parsing citation source out of the text (e.g. `[video-id 12:34]`).
- **Streaming citation grounding during chat** — emit `CITATIONS_GROUNDED` events on the SSE stream as the model writes, so chips appear inline. Already noted as a follow-up in [`docs/architecture-review/03-streaming-chat-parser.md`](./architecture-review/03-streaming-chat-parser.md).
