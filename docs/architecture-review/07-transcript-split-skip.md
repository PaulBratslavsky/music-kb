# 7. Transcript pipeline split — listed, but I'd push back on it

**Status:** Surfaced for completeness. **Recommendation: skip** unless something below changes.

## Files

- `client/src/lib/services/transcript.ts` — ~700 lines: clean / chunk / BM25 / contextualize.

## The framing the explorer offered

"Four concerns in one Module" — `cleanTranscript`, `prepareSegmentedTranscript`, `chunkForRetrieval` + `chunkForSummary`, `buildBM25Index` + `searchBM25` + the contextualizer. Split into `TranscriptCleaning` / `TranscriptChunking` / `BM25Search`.

## Why I'd push back

The deletion test cuts the other way.

If you split `transcript.ts` into three Modules, the orchestration that currently lives inside it gets pushed up into `learning.ts` (or wherever calls it). You've created three **shallow** Modules whose Interfaces are nearly as large as their Implementations:

- `TranscriptCleaning` — exposes `cleanTranscript`, `prepareSegmentedTranscript`. That's it. The Interface is the Implementation.
- `TranscriptChunking` — exposes `chunkForRetrieval`, `chunkForSummary`. Same shape.
- `BM25Search` — slightly deeper, but the contextualizer's section-anchoring is intertwined with chunk preparation, so the seam is fuzzy.

The current `transcript.ts` is **long**, but the Interface a caller actually uses is small: `prepareSegmentedTranscript`, `chunkForRetrieval`, `buildBM25Index`, `findEvidenceForQuote`. **A deep Module that happens to have a big Implementation.**

Long file ≠ shallow Module. The skill's [LANGUAGE.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/blob/main/LANGUAGE.md) is explicit about this distinction.

## When I'd revisit

- If we add a **second cleaning strategy** (e.g. preserve disfluencies for sentiment work) — then the cleaning module would have a real Interface choice to make, and the seam earns its keep.
- If we **swap BM25 for a dense retriever** (embeddings + ANN) — the search module becomes the natural seam, and the split pays off because we'd want to keep cleaning + chunking shared.
- If chunk-size tuning becomes a per-`Video` concern (e.g. very short videos need different windows) — chunking grows an Interface beyond "give me 150-word chunks."

Until one of those lands, splitting is moving code, not changing the seam shape.

## Open questions

- Is there a third cleaning use case I'm missing (manual transcripts, paste-from-Whisper, podcast feeds)? If yes, this candidate gets stronger.
- Is anyone outside this Module going to call its Implementation details for a reason I haven't anticipated?
