# 0015. Two lesson write paths, one set of guarantees

**Status:** Accepted

## Context

A lesson reaches Strapi two ways:

1. **The app's generator** (`/api/lesson-write`). The model writes markdown;
   `parseLessonMarkdown` validates it, and `groundParsedBlocks` decides what a
   citation may say: it BM25-grounds every timecode, widens a fret window that
   hides its own dots, and drops dots that are off the board.
2. **The MCP write tools** (`createLesson` / `updateLesson`). A model — Claude
   in a desktop client, say — composes the blocks as JSON, and
   `server/src/mcp/tools/lesson-blocks.ts` validates them.

The two were validated independently, and the MCP path enforced much less.
It stored `source.timeSec` exactly as the model sent it — a direct breach of
ADR 0004, which says no timecode is ever taken from a model. It accepted a
bass diagram with dots on strings 4 and 5, fret windows that hid every dot
(a blank fretboard), and blocks past every limit the parser enforces.
`docs/lesson-generation-audit.md` called this "an ADR-level decision" and
none was written. The 2026-09 architecture audit filed it as #10.

It mattered more than its size suggests, because lesson generation over MCP
is the point of the project's React Summit demo: Claude writes a lesson from
the library through the MCP tools. On that path, a citation chip that jumps to
the wrong moment and a blank fretboard were the likely defects.

## Decision

**Both paths guarantee the same things about a stored lesson, even though they
cannot share the code that enforces them.**

They cannot share it because of ADR 0010's constraint: `server/` compiles with
`tsc` to CommonJS and cannot import `client/` or `@music-kb/music`. So each
guarantee is implemented on each side and **guarded against drift**, choosing
the guard by what is compared (CLAUDE.md):

| Guarantee | App path | MCP path | Guard |
|---|---|---|---|
| No model-produced timecode is stored | `resolveBlockSource` | `lesson-grounding.ts` — re-derived from the video's **stored** BM25 index (read-only, so ADR 0010's tripwire is untouched) | Both call `findEvidenceForQuote`, already parity-tested under ADR 0010 |
| No dot off the board | `keepOnBoard` drops it | the block `superRefine` rejects it | `lesson-limits-parity.test.ts` (text) |
| Runaway limits | truncate / drop | reject, naming the limit | `lesson-limits-parity.test.ts` (text) |
| A window never hides its own dots | `applyWindowRepair` widens it | `lesson-windows.ts` widens it | `lesson-windows.parity.test.ts` (**behaviour** — the client original lives in the zero-import `neck-window.ts`, and the test asserts it stays import-free) |
| Blocks match what Strapi stores | parser ↔ JSON tests | — | `lesson-schema-parity.test.ts` (fields both ways, enums, string lengths) |

**Where the paths respond differently, that is deliberate.** The parser
truncates or drops, because the reader is waiting on a generation run and a
shorter lesson beats a failed one. The MCP tools **reject** a bad block, with a
message naming the limit, because a model calling a tool can fix its input
and a readable rejection is worth more to it than content silently cut
short. The exceptions are the obvious repairs, which the MCP tools apply and
**report**, following `correctPitchLabels`: a timecode, a clipped window. For
those, forcing a retry would cost a round trip and gain nothing.

A citation to a video that is **not in the library** is rejected, never
repaired: it is a hallucinated source, not a mistake with one right answer.

## Consequences

- A new guarantee on either path needs its twin and its guard in the same
  change. The table above is the checklist.
- **Not covered:** a *theory-mode* diagram's dots are computed by
  `@music-kb/music`, which the server cannot run. So the MCP path cannot check
  that such a diagram's window shows its own dots. A half-set window is still
  rejected. Revisit if theory-mode MCP diagrams render blank in practice.
- **Not covered:** `duration`. The app computes it from the body; the MCP
  path stores what the model sends. It is presentational, and a third
  hand-copied module would grow the surface ADR 0010 accepts only with
  evidence, so it is tracked separately (#30) rather than folded in here.
- Grounding needs the cited video's stored index, which the app builds when it
  generates a summary. A video with no summary yet gets a video-only citation
  from the MCP path — the same honest fallback the app uses.
