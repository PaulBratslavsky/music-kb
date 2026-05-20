# 0004. Timecodes are deterministically grounded, never LLM-generated

**Status:** Accepted

## Context

Summaries and chat answers reference moments in the video (e.g. "the speaker introduces the architecture at 12:34"). Citations like these are the highest-value feature of the app — but only if they're correct.

Local 4B–8B models *will* hallucinate timecodes. They'll happily produce `[12:34]` chips that don't correspond to anything in the transcript. Even when given the transcript with timecodes, the model will round, drift, or fabricate. Wrong timecodes destroy trust in summaries and chat answers — once a user clicks a chip and it goes to the wrong moment, they stop trusting any chip.

The transcript itself is authoritative. We have caption segments with real `startMs` values, cached on the Transcript row in Strapi. There's no reason to ask the model to do something the data already encodes deterministically.

## Decision

**The model is explicitly instructed to NOT emit timecodes** in summary output. The system prompt forbids `[mm:ss]` chips in section content.

**Timecodes are recovered post-hoc by BM25:**

- For each summary section: BM25 the section title + first-sentence text against the transcript chunks; the top-match chunk's first caption-segment `startMs` becomes the section's `timeSec`.
- For chat answers: when the model emits an `[mm:ss]` chip, we check whether transcript content actually exists at that timestamp. If it doesn't, or the surrounding text doesn't share n-grams with the chip's nearby prose, drift is flagged in the Sources accordion.
- For walkthrough-style sections: the user can right-click a chip and override the timecode manually. Override persists on the Video row.

## Consequences

**What we gain.**

- Citations correspond to real transcript moments. The "click a chip → seek the player" UX is reliable enough to lean on.
- Anchor quality is bounded by **BM25 match quality**, not by model attention or context-window position.
- Drift is observable. The Sources accordion tells the user "this chip's surrounding text doesn't match what's actually at that moment" — instead of silently being wrong.

**What we accept.**

- When the model paraphrases heavily (no shared n-grams with the transcript), BM25 anchoring picks a "best" chunk that may be approximately right but not exact. The Sources accordion makes this visible; the manual override is the escape hatch.
- We pay BM25 retrieval cost on every section/chip post-process. At per-video scale this is fast (single-digit ms per chunk lookup).

**What's enforced in code.**

- Generation prompts in `client/src/lib/services/learning.ts` explicitly instruct: "do not emit timecodes". Don't relax this.
- **Don't add a code path that trusts a timecode the model produced.** Any `[mm:ss]` from the model gets validated against the transcript before being rendered as a clickable chip.
- BM25 grounding logic lives in `client/src/lib/services/transcript.ts` (chunking + indexing) and the section/chat post-processing in `learning.ts`. Changes to chunking shape will affect anchor quality — re-test on a known-good video after touching that code.
