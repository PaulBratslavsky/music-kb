# Architecture review — deepening opportunities

Reviewed 2026-05-03 using the [`improve-codebase-architecture`](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture) skill (Matt Pocock, MIT).

The aim is testability and AI-navigability — turning **shallow** Modules (interface nearly as complex as the implementation) into **deep** ones (a lot of behaviour behind a small Interface). See [vocabulary](#vocabulary) at the bottom.

Each candidate below is one file — read it, then grill the design before writing code. **None of these have been grilled yet — they're starting points, not decisions.**

## Candidates

| # | Candidate | One-line problem | Status |
|---|---|---|---|
| 1 | [Retrieval Module](./01-retrieval.md) | Rewrite + multi-query BM25 + RRF are three Modules that always run together | ✅ Shipped 2026-05-03 |
| 2 | [Strapi Query Module](./02-strapi-query.md) | Four call sites build their own `populate=` / `filters=` URL params by hand | ✅ Shipped 2026-05-03 |
| 3 | [Streaming Chat Parser](./03-streaming-chat-parser.md) | Raw SSE parsing + AG-UI event handling lives inline in `VideoChat.tsx` | ✅ Shipped 2026-05-05 |
| 4 | [Background Generation Module](./04-background-generation.md) | The inflight Set, progress Map, and recentFailures Map are one concept pretending to be three | ✅ Shipped 2026-05-03 |
| 5 | [YouTube Player Module](./05-youtube-player.md) | The player protocol leaks via `onSeek` props; needs a real seam before the auto-highlight feature | ✅ Shipped 2026-05-05 |
| 6 | [Citation Grounding Module](./06-citation-grounding.md) | `verifyTimecodes` + `extractCitations` are halves of one workflow with no Interface name | 🅿️ Parking lot — see [plan](../mcp-citation-rewrite-plan.md) |
| 7 | [Transcript pipeline split](./07-transcript-split-skip.md) | Tempting but I'd push back on it — long file ≠ shallow Module | **Skip recommended** |

## Suggested ordering (highest-leverage / smallest-blast-radius first)

1. **#4 Background Generation** — bugs here silently corrupt user-visible state (double-generation, stuck pending). The state-machine shape is the highest-impact rewrite.
2. **#5 YouTube Player** — natural prep for the auto-highlight feature already deferred. Switching to `react-youtube` later only costs anything if we don't do this first.
3. **#1 Retrieval** — cleanest deletion-test answer. The orchestration *is* the concept.
4. **#3 Streaming Chat Parser** — small, gives us a typed contract between server and client.
5. **#2 Strapi Query Module** — pays off as the schema grows; small lift.
6. **#6 Citation Grounding** — nice-to-have; the workflow is already informally one thing.
7. **#7 Transcript split** — I'd skip; see file for why.

## Vocabulary

Used consistently across every candidate file. From [LANGUAGE.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/LANGUAGE.md):

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the Interface. **Deep** = high leverage. **Shallow** = Interface nearly as complex as the Implementation.
- **Seam** — where an Interface lives; where behaviour can be altered without editing in place.
- **Adapter** — concrete thing satisfying an Interface at a Seam.
- **Locality** — change, bugs, knowledge concentrated in one place.
- **Leverage** — what callers get from depth.

**Deletion test**: imagine deleting the Module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.

**Two-adapter rule**: one adapter = hypothetical seam. Two adapters = real seam.

## How to use this

When you want to actually deepen one of these:

1. Open the candidate file.
2. Re-read the Problem and Sketch. Push back if either feels off — the deletion test is the honest check.
3. Drop into a grilling conversation: walk the design tree — constraints, dependencies, the shape of the deepened Module, what sits behind the Seam, what tests survive. *Don't propose final Interfaces until grilled.*
4. As decisions crystallize, append them to the candidate file under a `## Grilling notes` section (or move it to a separate ADR if the answer is "no, and here's why").
