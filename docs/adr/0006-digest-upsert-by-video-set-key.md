# 0006. Digest identity is the source-video set, not a serial id

**Status:** Accepted

## Context

A digest is a structured cross-video synthesis (shared themes, contradictions, unique insights, viewing order, bottom line) of 2–5 videos. The user picks the videos on `/feed`, lands on `/digest?videos=A,B,C`, and the synthesis runs.

The natural question: when the user clicks "Save digest", what does that mean if they later revisit the same selection?

- **Option 1 (serial id):** every save creates a new row with a fresh id. Two saves of the same video selection produce two rows, with potentially different LLM output (the prompt is non-deterministic). Listing digests at `/digests` shows duplicates that look identical from the outside.
- **Option 2 (upsert by content):** identity is the *set of source videos*. Re-saving updates the existing row in place. The URL `/digest?videos=A,B,C` always maps to the same row regardless of when it was saved.

Option 2 matches the user's mental model — "this digest is the synthesis of A, B, C" — and avoids the pile-of-near-duplicates UX in `/digests`.

## Decision

**Digest identity = `videoSetKey = sort(youtubeVideoIds).join(',')`.**

- `videoSetKey` is computed at every save. The Strapi unique constraint (or service-level upsert in `client/src/lib/services/digests.ts`) ensures one row per key.
- Re-saving the same selection updates the existing row's structured components and `articleMarkdown`. Original `createdAt` is preserved.
- The `/digest?videos=A,B,C` loader checks `videoSetKey` first — if a row exists, render its cached structured data without re-running the LLM. If not, run the synthesis.
- Regenerate is **explicit**: the user clicks the regenerate button to re-run the LLM and replace the row's content.

Sort-before-join means input order doesn't matter — `?videos=A,B,C` and `?videos=C,B,A` produce the same key.

## Consequences

**What we gain.**

- `/digests` listing is clean — one row per logical synthesis, no near-duplicates.
- Revisiting a saved digest URL is fast (cached structured data renders immediately, no LLM round-trip).
- Saving is idempotent.

**What we accept.**

- Adding a 6th video to a saved 5-video digest creates a *new* row, not an update — that's the right behavior because it's a different synthesis, but worth being aware of.
- Two users running the same workflow on different machines would produce different LLM output; collapsing them by `videoSetKey` would lose information. Single-user app, so this isn't a current concern.
- Manual edits to a saved digest are blown away on regenerate. Acceptable because regenerate is opt-in; not acceptable as silent behavior.

**What's enforced in code.**

- All save paths go through the upsert helper in `client/src/lib/services/digests.ts`. Don't construct `Digest` rows directly via `strapiFetch` POST.
- `videoSetKey` is normalized (sort + join with comma, no spaces). Don't change the format without a migration — existing keys would no longer match.

**Deferred.**

- Versioning: keeping prior digest content on regenerate (so you can compare today's synthesis to last month's). Not built — single-user app, low demand. If added, it should be opt-in per regenerate, not automatic.
