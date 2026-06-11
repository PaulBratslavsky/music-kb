# Data model

The Strapi schemas in `server/src/api/*/content-types/*/schema.json` are authoritative. This doc explains the **non-obvious fields** — what they mean, when they're set, what invalidates them, and which other fields they relate to. It's a reading guide, not a redefinition.

## Entity overview

```
Video ─── 1:1 ──► Transcript    (cached caption data, shared by youtubeVideoId)
  │
  ├── M:N ─► Tag                 (lowercase-normalized, deduped on `name`)
  ├── M:N ─► Note                (markdown, four sources)
  └── M:N ─► Digest              (cross-video synthesis, upserted by videoSetKey)

Components (embedded on Video / Digest, not collection types):
  Video.keyTakeaways   → content.takeaway      (repeatable)
  Video.sections       → content.section       (repeatable, with timeSec)
  Video.actionSteps    → content.action-step   (repeatable)
  Digest.sharedThemes      → content.digest-shared-theme   (repeatable)
  Digest.uniqueInsights    → content.digest-unique-insight (repeatable)
  Digest.contradictions    → content.digest-contradiction  (repeatable)
  Digest.viewingOrder      → content.digest-viewing-order  (repeatable)
```

## Video

The central entity. One row per share. Dedupe key: `youtubeVideoId` (unique).

### Identity & source metadata

| Field | Notes |
|---|---|
| `youtubeVideoId` | The 11-char YouTube video id. Unique. Extracted from any URL form (`/watch?v=`, `/shorts/`, `/embed/`, `/live/`, `youtu.be/`) by `extractYouTubeVideoId` in `client/src/lib/validations/post.ts`. |
| `url` | The original URL the user pasted. May be a `/live/` URL — once the stream ends, YouTube canonicalizes to `/watch?v=`, but the original is preserved. |
| `videoTitle` / `videoAuthor` / `videoThumbnailUrl` | Pulled from YouTube oEmbed at share time. **Authoritative for the UI** — `Transcript.title/author` are advisory. |
| `caption` | User-authored note at share time. Optional. |

### Summary state machine

```
pending ──► generated      (LLM run succeeds)
   │   ╲
   │    ╲► failed          (LLM run errored; `markSummaryFailed`)
   │
   ▲ (regenerateSummary clears failure marker, flips back to pending)
```

| Field | Notes |
|---|---|
| `summaryStatus` | `pending` / `generated` / `failed`. Drives the learn page's loader branch. The `/learn/$videoId` polling hook invalidates every 3s while pending. |
| `summaryGeneratedAt` | Set on transition to `generated`. |
| `aiModel` | The Ollama model used for *this* summary. Distinct from the current `OLLAMA_MODEL` env — useful when you've changed models and want to know which generation is stale. |

### Summary content

| Field | Notes |
|---|---|
| `summaryTitle` / `summaryDescription` / `summaryOverview` | LLM-produced summary header. `summaryOverview` is markdown. |
| `keyTakeaways` (component repeatable) | One bullet per takeaway. Capped at ~280 chars each. |
| `sections` (component repeatable) | Structured walkthrough — heading + body + **`timeSec`**. The `timeSec` is BM25-grounded against the cached transcript chunks; **the model is forbidden from emitting it directly** (see ADR 0004). |
| `actionSteps` (component repeatable) | Numbered "do this" plan. Empty for non-actionable videos. |
| `readableArticle` | Long-form article version of the transcript, generated on-demand on first click of the Read tab. Cached after first generation. |
| `readableArticleGeneratedAt` / `readableArticleModel` | Same staleness pattern as the summary. |

### Verdict + score triple

See ADR 0005 for the why. Three score fields per video:

| Field | Source | Range | Notes |
|---|---|---|---|
| `valueScore` | LLM judgement, set during summary generation | 0–100 | Tagged via `valueScoreSource: 'model' \| 'derived'`. UI never displays `'derived'` placeholders as if they were real ratings. |
| `signalScores` (json) | Programmatic, per-signal breakdown | `{ fillerDensity, lexicalDensity, compressionRatio, speakingPace, sponsorPresence }` each 0–100 | Computed from the transcript by `computeSignalScores` in `content-signals.ts`. Stored as JSON for transparency / later tuning. |
| `signalScore` | `aggregateSignalScore(signalScores)` — weighted mean of the per-signal values | 0–100 | The composite of `signalScores`. |
| `finalScore` | `computeFinalScore(valueScore, signalScore)` — `0.6 × signalScore + 0.4 × valueScore` (`FINAL_SCORE_WEIGHTS`) | 0–100 | **The canonical user-visible "Content score".** Card chip, learn page primary chip, feed sort, threshold filter all key on this. |

| Verdict field | Notes |
|---|---|
| `watchVerdict` | `skip` / `skim` / `worth_it`. LLM categorical judgement; consistent with `valueScore` (high score → worth_it). |
| `verdictSummary` | One-sentence "is this worth your time" line, ≤280 chars. Shown on cards and at the top of the learn page. |
| `verdictReason` | Longer rationale, ≤1000 chars. |

**Three writers update these fields:** summary save (`learning.ts`), verdict-only re-rate (`regenerateVideoVerdict`), signal-only recompute (`regenerateVideoSignals`). All three must write `finalScore` consistently — see `content-signals.test.ts`.

### Retrieval & embeddings (two tiers)

The Video row carries two independent embedding artifacts at different granularities:

#### Tier 1: per-video topical embedding

| Field | Notes |
|---|---|
| `summaryEmbedding` (json) | `number[]` — single vector per video, ~768-dim from `nomic-embed-text`. Built from `(title + summaryOverview + keyTakeaways + section headings + tags)`. Powers Related Videos and library-wide semantic search on `/feed`. |
| `embeddingModel` | The Ollama model that produced `summaryEmbedding`. Compound invalidation key with `embeddingVersion`. |
| `embeddingVersion` | Integer version of the **text-builder** in `client/src/lib/services/embeddings.ts`. **Bump alongside any change to which fields feed the embedder.** Without a bump, old vectors silently survive a meaning change. |
| `embeddingGeneratedAt` | Mostly admin-facing. |

A row is "stale" when stored `embeddingModel ≠ env.OLLAMA_EMBEDDING_MODEL` OR stored `embeddingVersion ≠ env.EMBEDDING_VERSION`. The Settings panel offers backfill scoped to `missing` / `stale` / `all`.

#### Tier 2: per-passage embeddings (moment search)

| Field | Notes |
|---|---|
| `passageEmbeddings` (json) | Self-contained blob: `{ model, version, generatedAt, chunks: [{ text, startSec, endSec, embedding }] }`. Independent invalidation from `summaryEmbedding` — different chunker, different version key. |

Used for moment-level semantic search (e.g. "find the exact moment they explain X across all videos"). Powered by `client/src/lib/services/ask-library.ts` retrieval.

### BM25 retrieval index

| Field | Notes |
|---|---|
| `transcriptSegments` (json) | Coalesced chunks of the transcript with metadata + BM25 stats. Built at summary-generation time. **This is the per-video chat retrieval index** (see ADR 0003), not a copy of the raw transcript. Raw segments live on `Transcript.rawSegments`. |

### Music extraction (music-kb fork)

| Field | Notes |
|---|---|
| `musicExtraction` (json) | AI-extracted music data, self-contained versioned blob: `{ version, model, generatedAt, key, chords, techniques, songs }`. `key` / chord `{ root, quality }` shapes match the Loop collection's `key`/`progression` JSON so the theory panel seeds from either. `timeSec` values are BM25-grounded against `transcriptSegments` (ADR 0004 — never model-emitted). Written only by `updateVideoMusicExtractionService`; `MUSIC_EXTRACTION_VERSION`/model mismatch ⇒ stale. An empty blob means "analyzed, no music found" (prevents re-running the model every regeneration). |

### Relations

| Relation | Notes |
|---|---|
| `transcript` | One-to-one. Two Video rows for the same `youtubeVideoId` are impossible (unique constraint), so the relation is effectively a foreign key. |
| `tags` | Many-to-many. |
| `notes` | Many-to-many — a single note can attach to multiple videos (most useful for `digest-chat` notes spanning the videos in the digest). |
| `digests` | Many-to-many — a Video appears in every Digest that synthesizes it. |

## Transcript

Cached YouTube caption data. **Immutable** — created once per `youtubeVideoId`, reused across regenerations. Detached from Video so two regenerations of the same video share one transcript.

| Field | Notes |
|---|---|
| `youtubeVideoId` | Unique. The dedupe key. |
| `title` / `author` / `thumbnailUrl` | From YouTube at fetch time. **Advisory** — Video.videoTitle/Author are authoritative for UI. |
| `language` | Caption track language (default `en`). |
| `durationSec` | Full video duration. |
| `rawSegments` (json) | The caption-level chunks: `{ text, startMs, durMs }`. **The source of truth for timecodes.** Section `timeSec` and chat `[mm:ss]` chips ultimately resolve back here via BM25 grounding. |
| `rawText` (richtext) | Joined `rawSegments` text, no cleaning. Stored as a convenience for admin inspection — derivable from `rawSegments`. |
| `fetchedAt` | When `youtubei.js` last fetched this. The cache is otherwise eternal. |

The transcript fetch only runs again on share or on `forceRefetch=true`. Once cached, regenerating a summary does **not** re-hit YouTube.

## Note

Markdown text attached to one or more videos. Many-to-many because chat-summary notes spanning multiple videos (`digest-chat` source) need to appear under each source video.

| Field | Notes |
|---|---|
| `title` | Optional, ≤200 chars. |
| `body` (richtext) | Markdown. Renders timecode chips back into the video player on the learn page. |
| `source` | `chat` / `digest-chat` / `mcp` / `manual`. **Drives display** — Notes pane sub-groups by source. |
| `author` | Free-form label — the MCP client name (e.g. `claude-desktop`) for `mcp` notes, `chat`/`you` for in-app, etc. Optional. |
| `videos` | Many-to-many. The "primary" video isn't a separate field — UI just shows the note under every related video. |

### Source semantics

- `chat` — produced by clicking "Summarize to note" on a per-video chat. Single video.
- `digest-chat` — produced by clicking "Summarize to note" on a `/digest` chat. Multiple videos.
- `mcp` — written by an external MCP client via the `saveNote` tool. May span multiple videos.
- `manual` — user-authored scratchpad in the Notes pane. Single video typically.

## Digest

A saved cross-video synthesis. See ADR 0006 — identity is the source-video set, not a serial id.

| Field | Notes |
|---|---|
| `videoSetKey` | **Unique.** `sort(youtubeVideoIds).join(',')`. Upsert key — same selection ⇒ same row, even across reorderings. |
| `title` / `description` | LLM-produced summary header. |
| `overallTheme` (richtext) | One or two paragraphs on the throughline. |
| `bottomLine` | "If you read nothing else" TL;DR, ≤800 chars. |
| `sharedThemes` / `uniqueInsights` / `contradictions` / `viewingOrder` (components) | Structured synthesis facets. The `/digest` route renders these as separate panels. |
| `articleMarkdown` (richtext) | Optional long-form prose variant. Generated on first click of the Article toggle, cached. |
| `videos` | Many-to-many. The actual source set for this digest. |
| `model` | The Ollama model that produced this synthesis. |

Digest components live in `server/src/components/content/digest-*.json`. Notable: `digest-contradiction` carries `digest-contradiction-position` repeatables (one per position in the disagreement); `digest-viewing-order` carries `digest-video-title` to give the position a label.

## Tag

Lowercase-normalized labels. Created on the fly when a Video is shared with new tags.

| Field | Notes |
|---|---|
| `name` | **Unique.** Server-side normalization (Strapi lifecycle) lowercases and trims so dedupe works. |
| `slug` | Strapi `uid` field, derived from `name`. The URL filter on `/feed?tag=<slug>` matches on this. |
| `videos` | Many-to-many. |

`parseTagInput(raw)` in `client/src/lib/validations/post.ts` handles user input — splits on commas, lowercases, deduplicates, caps at 8.

## Components reference (Video)

The three repeatable components on Video.

| Component | Fields |
|---|---|
| `content.takeaway` | `text` (≤280 chars). |
| `content.section` | `heading` (≤200), `body` (≤2000), `timeSec` (optional integer). `timeSec` is BM25-grounded post-generation — see ADR 0004. |
| `content.action-step` | `title` (≤120), `body` (≤600). Empty array if the video isn't actionable. |

## Components reference (Digest)

| Component | Fields | Notes |
|---|---|---|
| `content.digest-shared-theme` | `title`, `body`, `videoTitles` (`digest-video-title` repeatable) | Themes that show up in multiple source videos. |
| `content.digest-unique-insight` | `title`, `body`, `videoTitle` (`digest-video-title`) | Per-video standout. |
| `content.digest-contradiction` | `topic`, `positions` (`digest-contradiction-position` repeatable) | Each `position` has `summary` + `videoTitle`. |
| `content.digest-viewing-order` | `videoTitle` (`digest-video-title`), `reason` | Suggested ordering with rationale. |
| `content.digest-video-title` | `videoTitle`, `youtubeVideoId` | Internal link target — lets the UI render a clickable link to the source video. |

## Field-set quick reference

When you need to know "what do I populate for X?", the conventional field sets:

| Use case | Populate |
|---|---|
| Feed list view | `tags` only. Summary fields are read but not the heavy components. |
| Video detail (learn page) | `tags`, `keyTakeaways`, `sections`, `actionSteps`, `transcript` |
| Embedding rebuild | Just the source fields: `videoTitle`, `summaryOverview`, `keyTakeaways`, `sections`, `tags`. The vector itself is in `summaryEmbedding`. |
| Score backfill | `valueScore`, `signalScores`, `signalScore`, `finalScore`, plus `transcript.rawSegments` for the signal-density inputs. |
