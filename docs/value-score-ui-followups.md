# Value-score UI follow-ups

**Status:** Deferred. Created 2026-05-06.
**Context:** The `valueScore` field (0–100) is now shipped end-to-end — model-produced for new videos, AI-regenerable for existing ones via `/settings`. With real varied scores in the DB, these UI surfaces become useful but were intentionally not built yet (no concrete use case had been picked).

Pick these up when you have a specific browsing/decision pattern in mind. Don't build all four — pick the one that solves the friction you're actually hitting.

## Candidates

### 1. Sort feed by `valueScore` descending
Show the highest-signal videos first by default. Or as an opt-in sort toggle alongside the existing recency sort. Sketch:

- `feedQuery()` in `videos.ts` adds an optional `sort: 'createdAt:desc' | 'valueScore:desc' | 'valueScore:asc'` parameter.
- URL state on the feed: `?sort=value` flips the order.
- Sort dropdown / toggle in the feed header.

**Highest-leverage of the four** — directly improves "what should I watch?" browsing. Single-file changes (`feed.tsx`, `videos.ts`).

### 2. Filter feed / search by `valueScore >= threshold`
Hide videos below a chosen quality bar. Two surfaces:

- **Feed:** a slider or dropdown ("Hide skip-tier" / "Worth-it only").
- **Search results:** filter the result set by `valueScore`.

URL state via `?minScore=56` (matches the natural threshold for `worth_it`-and-above).

The Strapi query layer already handles this — just add `filters: { valueScore: { $gte: minScore } }`.

### 3. Gradient color on the score chip
Today the chip is neutral grey. Color-code it:

- 80–100: green
- 56–79: emerald-soft / blue
- 26–55: amber
- 0–25: muted grey

Reinforces the watchVerdict band visually without needing to read the number. One-line CSS variant on the chip's existing className.

Apply both to the Learn-page chip (`learn.$videoId.tsx`) and the VideoCard chip (`VideoCard.tsx`).

### 4. Score badge on every feed card
**Already shipped** in `VideoCard.tsx` as part of the value-score work. Just confirm it looks right in the catalog view once you have real (non-placeholder) scores across the library. If the chip placement or sizing is off in the card layout, tune at that point.

## Order of operations (when picking up)

If/when this list resurfaces:

1. **Test with real scores first.** Run the Settings AI regenerate, look at the feed. The visual gap will make one of these obviously highest-leverage.
2. **Don't build all four.** Each is small, but adding all four at once is feature-creep. Pick the one that solves the friction you actually hit while browsing.
3. Sort (#1) and gradient color (#3) are the cheapest and most immediately satisfying. Filter (#2) is the most "powerful" but also the easiest to over-tune ("what's the right threshold?" — fiddly).

## Out of scope for this followup doc

- Per-axis scoring (`density`, `fluffPercent`, etc.) — would be a new feature entirely.
- Strapi admin UI for editing scores by hand.
- Trend analysis / time-series view of score quality.

These are future-future and not connected to the current `valueScore` rollout.
