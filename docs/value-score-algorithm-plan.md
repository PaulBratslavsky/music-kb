# Value-score algorithm: programmatic + LLM hybrid

**Status:** Planned. Created 2026-05-06. Triggered by Paul's observation that pure-LLM `valueScore` clusters around mental-anchor values (≈25/50/72/85) regardless of underlying content quality — calibration is unreliable for a single 4B local model.
**Reference:** [`docs/value-score-ui-followups.md`](./value-score-ui-followups.md) for the deferred UI surfaces this would feed into.

## The problem

Today's score is purely model-produced from a rubric-anchored prompt. It works for filtering by band (`>= 56` excludes skip+skim correctly), but **within-bucket ranking is noisy**. Two `worth_it` videos at 73 and 81 may not actually differ in any consistent way — the model picks values around its mental anchors. We have no programmatic signal to ground the number against.

## What the field actually does (web research summary, May 2026)

The dominant pattern for content scoring in production systems is **the "Hybrid Norm"** — combine deterministic programmatic signals with rubric-based LLM judgment, then optionally calibrate against human-rated baselines.

Key findings from research:

- **[Lexical density](https://en.wikipedia.org/wiki/Lexical_density)** (Halliday's measure) — content words / total words. Spoken transcripts typically <40%; dense educational content scores higher. Decades-old, well-validated metric.
- **[Filler word detection](https://ar5iv.labs.arxiv.org/html/2203.15135)** — research datasets exist (PodcastFillers: 35K annotated filler words across 145 hours / 350+ speakers). Production tools like Descript / Riverside use this for auto-edit and quality assessment.
- **[Google's UVQ model](https://research.google/blog/uvq-measuring-youtubes-perceptual-video-quality/)** — for video quality, generates "video diagnostic reports" combining content description, distortion analysis, and compression artifacts. Not directly applicable (it's about pixel quality), but the multi-signal approach is the pattern.
- **[Rulers framework](https://arxiv.org/html/2601.08654)** — three-phase pipeline for robust LLM evaluation: immutable rubric specs, evidence-anchored protocol, post-hoc calibration to human distributions.
- **[LLM-Rubric methodology](https://aclanthology.org/2024.acl-long.745.pdf)** — train a small calibration network to map raw LLM scores to a target distribution. Closes the calibration gap without retraining the LLM.
- **["Hybrid Norm"](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80)** — the explicit industry pattern: deterministic verifiable checks + scalable rubric-based judges + strategic human oversight for calibration.

The signal is consistent: **don't ask one LLM to produce a calibrated number from raw transcript**. Compute objective signals first; let the LLM judge contextual fit; combine.

## Recommended algorithm for yt-kb

Phased so each phase ships independently and pays off on its own.

### Phase 1 — Programmatic signals (cheap, deterministic, no LLM)

Compute these from the cached transcript at index time. All are pure functions, fast (sub-second per video), and deterministic. Each becomes a stored 0–100 sub-metric on the Video row.

| Signal | What it measures | Implementation |
|---|---|---|
| `fillerDensity` | Filler words / total words | Reuse existing `FILLER_PATTERNS` regex in `transcript.ts`. Count matches, divide by total word count. Invert (high filler = low score). |
| `lexicalDensity` | Content words (nouns / verbs / adjectives / adverbs) / total words | Halliday's measure. POS-tagging is overkill for a 4B-local context — approximate via stopword-removal ratio: `(words - stopwords) / words`. We already have STOPWORDS in `transcript.ts`. |
| `compressionRatio` | gzip(transcript).length / transcript.length | High redundancy / repetition → smaller compressed size relative to raw → lower ratio. Detects "the same point made 3 ways." Node has `zlib.gzipSync` built-in. |
| `speakingPace` | Words per minute (avg) | Words / (durationSec / 60). 130–160 wpm is normal. <100 = padded, >180 = rushed. Bell-curve scoring. |
| `topicCoherence` | Embedding similarity between consecutive chunks | Compute cosine similarity between adjacent chunk embeddings; average. Coherent content = high similarity; drifting content = low. We already have chunk embeddings in `passageEmbeddings`. |
| `sponsorPresence` | Estimated sponsor segment as % of runtime | Keyword + position heuristics: scan for "sponsor of today's video", "use code", "go to <url>", "this video is brought to you by". Count seconds in matching chunks. |

**Output:** an object `{ fillerDensity: 87, lexicalDensity: 42, compressionRatio: 71, speakingPace: 65, topicCoherence: 88, sponsorPresence: 95 }` — each 0–100.

**Phase 1 alone is shippable** as a separate `signalScore` field, even before the hybrid combination. Ranking by `signalScore` gives objective ordering without LLM at all.

### Phase 2 — Hybrid combination

Combine programmatic signals + LLM `valueScore` into a single score:

```
finalScore = α × signalScore + β × valueScore
where α, β tunable weights summing to 1.
```

Or weighted-by-confidence: trust the LLM more when its score and verdict band agree, less when they drift (we already log this as a warning in `sanitizeSummary`).

The LLM still adds value here for **subjective contextual judgment** ("is this useful for someone who already knows X?") that programmatic signals can't capture.

### Phase 3 — Calibration

Once you have hundreds of videos with both programmatic signals and LLM scores, calibrate. Approaches:
- **Manual**: pick 20 videos, rate them yourself, fit weights `α, β` to minimize error vs. your ratings. Linear regression. ~20 min.
- **Automated** (per [LLM-Rubric](https://aclanthology.org/2024.acl-long.745.pdf)): train a small calibration network. Overkill for current scale.

This phase is optional. Ship Phase 1+2 first; revisit calibration if rankings still feel off after real use.

## Storage proposal

Add to Strapi schema:

```
signalScores: json  // { fillerDensity, lexicalDensity, compressionRatio,
                    //   speakingPace, topicCoherence, sponsorPresence }
signalScore: integer (0-100)  // composite of the above
finalScore:  integer (0-100)  // hybrid: signalScore + valueScore (LLM)
```

Existing `valueScore` remains as the LLM-only number. `finalScore` becomes the canonical "rank by this" field for UI sorting/filtering.

## Out of scope

- POS tagging (overkill — stopword ratio is good enough).
- Speaker diarization (one speaker assumed for talking-head content).
- Audio-level signals (we only have the transcript).
- Cross-video calibration via embedding clusters (premature).

## Estimate

| Phase | Effort | Outcome |
|---|---|---|
| Phase 1 — programmatic signals | ~3h | Stored sub-metrics + `signalScore`. Sortable independently of LLM. |
| Phase 2 — hybrid combination | ~1h | `finalScore` as the canonical sort field. |
| Phase 3 — calibration | ~1h (manual) | Tuned weights against ground-truth ratings. |
| **Total** | **~5h** | Fully grounded score. |

Phase 1 is the highest-leverage on its own — programmatic objective signals you can sort by even if the LLM is unavailable. Phases 2+3 layer on top.

## Decision points to grill before building

1. **Compute signals at summary-generation time, or lazily on first read?** Generation-time is simpler (one place writes them) and the work is ~100ms per video. Lazy adds caching complexity. Recommend: generation-time, alongside the existing chunk/index work in `learning.ts`.
2. **Recompute on existing videos** — same pattern as the verdict regen: per-video button + Settings bulk. Reuse the existing infrastructure.
3. **Default weights for Phase 2** — start with `α = 0.6, β = 0.4` (programmatic signals slightly dominant) since they're more reliable. Tune in Phase 3 with real data.
4. **Surface signals individually in UI?** E.g. "Filler density: 12%" badge on cards. My take: skip — too much detail. Surface only the composite `finalScore`. Per-signal data is for debugging via the Strapi admin or future research.

## Why this is a real upgrade vs. the current LLM-only path

- **Same-video reproducibility.** Programmatic signals are deterministic. Two runs produce the same score; LLM-only fluctuates ±5–10 points.
- **Honest ranking within buckets.** Two `worth_it` videos with `valueScore: 73` and `81` today might be indistinguishable. With programmatic backing, the one with higher lexical density / lower filler / lower compression ratio actually IS denser.
- **No re-LLM needed for re-tuning.** Want to weight filler density more heavily? Change a constant, recompute composite. No 5–15s-per-video Ollama runs to retune.
- **Defensible to the user.** "Your video scored 67 because filler density was 70th percentile and lexical density was 45th percentile" is more meaningful than "the model said 73."

Sources for the framing:
- [Lexical density (Wikipedia)](https://en.wikipedia.org/wiki/Lexical_density)
- [Filler word detection benchmark (arXiv 2203.15135)](https://ar5iv.labs.arxiv.org/html/2203.15135)
- [Google UVQ for YouTube content quality](https://research.google/blog/uvq-measuring-youtubes-perceptual-video-quality/)
- [LLM-Rubric calibration methodology (ACL 2024)](https://aclanthology.org/2024.acl-long.745.pdf)
- [Rulers framework — robust LLM evaluation](https://arxiv.org/html/2601.08654)
- [Rubric-based evaluations & LLM-as-judge methodologies (Masood, 2026)](https://medium.com/@adnanmasood/rubric-based-evals-llm-as-a-judge-methodologies-and-empirical-validation-in-domain-context-71936b989e80)
