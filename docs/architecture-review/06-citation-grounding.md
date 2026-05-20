# 6. Citation Grounding Module — `verifyTimecodes` + `extractCitations` are halves of one workflow

**Status:** 🅿️ Parking lot 2026-05-05 — premise didn't hold; `verifyTimecodesInText` kept intentionally for the planned MCP tool [`docs/mcp-citation-rewrite-plan.md`](../mcp-citation-rewrite-plan.md).

## Files

- `client/src/lib/services/transcript.ts:812–861` — `verifyTimecodesInText`.
- `client/src/lib/services/transcript.ts:891–982` — `extractCitationsWithEvidence`.
- `client/src/components/VideoChat.tsx` — consumes both indirectly to render the evidence accordion.

## Problem

Two functions that always run on the same input (a chat response + the BM25 index) and produce halves of the same output (corrected text + grounded evidence list). Callers compose them by hand. The "ground a chat response" workflow has no Interface name.

If a third use case appears (e.g. a refinement loop that asks the model to re-cite when too many citations drift, or a digest pipeline that wants to ground a multi-video response), it has to compose the same primitives all over again.

## Sketch

One Module: response in, `{ cleanedText, citations: EvidenceCitation[] }` out. Drift flagging, dedup by grounded `timeSec` (±15s tolerance), and post-hoc correction live behind it.

## Locality / Leverage

- **Locality:** the evidence workflow concentrates. Callers don't need to know the order of `verifyTimecodes` then `extractCitations`, the dedup window, or the drift threshold.
- **Leverage:** smaller win than 1–5. The workflow is conceptually one thing, but the existing primitives are already pretty reusable.

## Test surface change

End-to-end: hand the Module a fake response with a drifted citation, verify the drift flag and the corrected `timeSec`. Today these tests would have to set up both helpers and orchestrate the same pipeline in the test.

## Open questions for grilling

- Is the win big enough to justify the refactor, or are these two functions already a reasonable pair of primitives that callers compose deliberately?
- Where does the Module live? `lib/services/citations.ts`?
- Does the Module own the drift threshold (currently 30s) and dedup window (15s), or are those caller-configurable?
- Does the Module also handle the "Sources" accordion data shape, or stop at `EvidenceCitation[]` and let UI shape it?

## Grilling notes

### Premise didn't hold

The candidate file framed `verifyTimecodesInText` and `extractCitationsWithEvidence` as "two halves of one workflow." Reading the actual code:

| Function | Production callers | Status |
|---|---|---|
| `extractCitationsWithEvidence` | 1 (`getChatResponseEvidence` server fn → chat evidence accordion) | Live, deep-enough on its own |
| `verifyTimecodesInText` | **0** | Dead-code-by-default — only its own self-tests reference it |

They never run together anywhere. The candidate's "one workflow" assumption was wrong.

### Apply the deletion test

- Delete `verifyTimecodesInText` → nothing breaks. Complexity vanishes. Pass-through code.
- Delete `extractCitationsWithEvidence` → its single live caller would have to inline ~50 lines of regex + BM25 walking + dedup. **Already a deep Module on its own** — no extraction needed.

There's no Module to extract.

### Resolution: parking lot

`verifyTimecodesInText` is kept on purpose, not deleted. It's the load-bearing primitive for a planned MCP feature: a `verifyCitations` tool that lets Claude Desktop auto-rewrite drifted citations in drafted notes/responses before saving. See [`docs/mcp-citation-rewrite-plan.md`](../mcp-citation-rewrite-plan.md) for the full plan, decisions to grill, and estimate.

When that feature is built, this candidate's primitive moves into use. Until then, the function and its tests stay as-is — labeled, intentional, not "dead."

### Why not delete now and re-add later?

The function + its tests are ~80 lines, already proven against fixtures. Deleting and re-adding from scratch would mean re-deriving the regex, re-thinking the wrapper-style preservation, re-writing the override audit shape. Cheaper to keep what works.

The risk of keeping unused code is that future readers waste cycles asking "what is this for?" — mitigated by the parking-lot status above and the cross-reference to the plan doc.

### Lessons for future architecture reviews

The candidate file was written from the surface (file structure + function signatures) without checking call-site reality. The "two adapters = real seam" rule needs **production** adapters; tests-only references don't count. A function with zero production callers isn't half of a workflow — it's a planned-but-unbuilt feature, and the architecture surface isn't where it gets resolved.
