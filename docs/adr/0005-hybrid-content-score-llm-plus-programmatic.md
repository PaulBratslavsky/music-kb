# 0005. Hybrid Content score: LLM judgement + programmatic signals

**Status:** Accepted (supersedes the earlier pure-LLM `valueScore` approach)

## Context

Each video gets a 0–100 "Content score" that drives sort order on the feed (Score mode), the threshold filter (`?minScore=70`), and the score chip on cards / learn page.

The first version of this feature was a single LLM-produced `valueScore` from the summary-generation prompt. Two problems became apparent in use:

1. **Local-model anchor clustering.** The 4B Gemma model clusters scores around a small set of mental anchors (≈25 / 50 / 72 / 85) regardless of underlying content quality. A genuinely great deep-dive and a clickbait listicle could both come back at "72". Calibration is unreliable for a single small model.
2. **Subject-matter strength is real.** Pure programmatic signals — filler-word density, lexical density (Halliday), gzip compression ratio (information density proxy), speaking pace, sponsor presence — capture *production quality* well, but they can't tell you whether the video is *worth your time on the topic you care about*. The LLM does have that context; we just can't trust its absolute number.

Pure programmatic also has a problem: a polished but vapid video can score high on filler/lexical/compression even though the LLM would correctly call it shallow.

Industry pattern (Reddit content quality, news-item ranking, Stack Overflow): combine numeric-canonical (programmatic) with categorical-derived (model judgement) — the numeric anchor smooths model variance while the model contributes contextual judgement.

## Decision

**Three score fields on every video row:**

- `valueScore` (0–100) — LLM judgement, set during summary generation. The model gets a rubric prompt and outputs a number alongside the categorical `watchVerdict` (worth_it / skim / skip). Source-tagged via `valueScoreSource: 'model' | 'derived'` so backfilled placeholders never silently get treated as real ratings.
- `signalScore` (0–100) — programmatic composite of five sub-signals (`SIGNAL_WEIGHTS` in `content-signals.ts`):
  - filler density (25%)
  - lexical density (20%)
  - compression ratio (20%)
  - speaking pace (10%)
  - sponsor presence (25%)
- `finalScore` (0–100) — `computeFinalScore(valueScore, signalScore)` in `client/src/lib/services/videos.ts`. Default weights `FINAL_SCORE_WEIGHTS = { signal: 0.6, value: 0.4 }`.

**`finalScore` is the canonical user-visible "Content score".** The Card chip, Learn page primary chip, feed sort, and feed threshold filter all key on `finalScore`. The two component scores are surfaced as small "Signals" / "LLM" sub-chips on the Learn page for transparency, but the primary number is `finalScore`.

## Consequences

**What we gain.**

- The numeric anchor (signalScore) smooths LLM variance — a model run that produced 72 for a marginal video gets pulled toward whatever the programmatic signals say, and vice versa.
- Each component is independently debuggable. If `signalScore` is wrong for a known-good video, that's a signal-weight tuning question. If `valueScore` is wrong, that's a prompt question. Hybrid `finalScore` doesn't conflate the two.
- New videos get all three scores at generation time. Older rows get backfill via the Settings panel.

**What we accept.**

- Three score fields = three writers (summary save in `learning.ts`, verdict-only re-rate in `regenerateVideoVerdict`, signal-only recompute in `regenerateVideoSignals`). All three must write `finalScore` consistently — guarded by tests in `content-signals.test.ts`.
- Backfill is a real operational concern. The Settings panel's "Refresh content scores" button covers it; the per-card "Score —" chip covers individual rows.
- Weight tuning is a single-line change (`FINAL_SCORE_WEIGHTS`) but means re-running the backfill to recompute every row's `finalScore` against the new weights.

**What's enforced in code.**

- `valueScoreSource` distinguishes `'model'` (real LLM rating) from `'derived'` (placeholder backfilled from `watchVerdict` thresholds). UI never displays derived values as if they were real ratings.
- All three writers go through the score services in `videos.ts`; don't bypass them.

**Deferred.**

- Phase 3 calibration: build a tiny "rate this video manually" UI on the Learn page, store human scores, use them to tune `FINAL_SCORE_WEIGHTS` and `SIGNAL_WEIGHTS` against ground truth. Useful but research-flavored; not built.
- A 6th programmatic signal (topic coherence) was considered and deferred — marginal ROI without the calibration data.
