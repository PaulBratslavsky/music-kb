# 5. YouTube Player Module — a real Seam for `seekTo` (and future `getCurrentTime`)

**Status:** ✅ Shipped 2026-05-05. New module: `client/src/components/player/`. Auto-highlight in TranscriptPane shipped alongside the refactor.

## Files

- `client/src/routes/learn.$videoId.tsx:209–231` — the only `postMessage` site today (`seekTo`).
- Consumers via `onSeek` prop: `client/src/components/TimecodeMarkdown.tsx`, `client/src/components/NotesPane.tsx`, `client/src/components/TranscriptPane.tsx`, `client/src/components/VideoChat.tsx`.

## Problem

The route owns the iframe ref and the postMessage protocol, then threads `onSeek` down through every consumer. **Two adapters today, more coming** — the auto-highlight feature needs `getCurrentTime`, and we already discussed swapping to `react-youtube`.

Right now there's *one* place that knows the YouTube IFrame API — but the Seam isn't **named**. It's a function called `seekTo` defined inline in a route. The "two adapters = real seam" rule fires here: TimecodeMarkdown and TranscriptPane (and others) are adapters; the seam wants to be born.

Switching to `react-youtube` later means changing every consumer's prop wiring or re-implementing the same `onSeek` shape.

## Sketch

A Module exposing a hook (or context) — `usePlayerControl()` returns `{ seekTo, play, pause }` and, eventually, a reactive `currentSeconds`. Consumers stop receiving `onSeek` props and pull from the hook.

The route still owns the iframe element; the Module owns the protocol and the message format.

## Locality / Leverage

- **Locality:** YouTube IFrame API knowledge (postMessage protocol, frame origin, command format) lives in one Module.
- **Leverage:** when we swap to `react-youtube` (or Vimeo, or anything else), *one* Module changes. Consumers don't get re-touched.

## Test surface change

Hook testable with a fake iframe. Today the seek protocol has no test — its only validation is "click a chip, watch the video jump."

## Open questions for grilling

- Hook + provider, or React Context with a typed value? The trade-off is hook ergonomics vs. the ability to share `currentSeconds` reactively without a re-render storm.
- Where does the iframe element actually live? Today on the route. Does the Module own a `<YouTubePlayer />` component too, or just the controller?
- What's the Interface for `currentSeconds` — a React state, a subscribable observable, a polling function? Auto-highlight needs reactive updates without thrashing.
- Do we install `react-youtube` (Paul mentioned having an example) or stay on raw iframe + postMessage? The Module's Interface should be agnostic enough that either works.
- Do we expose `play()` / `pause()` now, or only `seekTo()` + `currentSeconds`? YAGNI vs. completeness.
- The `?t=<sec>` deep link handling at the iframe `src` level — does that move into the Module too, or stay a route concern?

## Grilling notes

### Surface was bigger than the candidate file suggested

Reading the actual code surfaced a second IFrame-API site beyond the inline `seekTo` in `learn.$videoId.tsx`: `SectionTimecodeEditor.tsx:78-97` ran its own `postMessage({event: 'listening'})` handshake to receive `infoDelivery` events for the "Use current video time" button. **Two places** knew the YouTube IFrame protocol, not one. Both migrated.

### Decision: use `react-player` (not raw iframe abstraction, not `react-youtube`)

User's reference (`coding-after-thirty-next/src/components/custom/media-player.tsx`) uses `react-player`. Picked it for consistency with that pattern. v3 exposes HTML5-video-element semantics (`ref.currentTime = sec`, `ref.play()`, `onTimeUpdate` event) — clean abstraction over YT's postMessage protocol.

### Final shape

```ts
// client/src/components/player/index.tsx

<PlayerProvider>
  <YouTubePlayer videoId={...} startSec={...} />
  {/* anything inside can call usePlayerControl() */}
</PlayerProvider>

// Hook
const { seekTo, play, pause, currentSeconds, isPlaying, isReady } =
  usePlayerControl();

// Pure helper for transcript auto-highlight
findActiveRowIndex(rows, currentSeconds): number
```

Behind the Seam: `react-player` v3 with an `HTMLVideoElement` ref. Provider holds the ref + reactive state. Two contexts internally: public `PlayerControlContext` (consumers) and private `InternalsContext` (only the YouTubePlayer component writes to it via `refSetter`, `notifyTimeUpdate`, `notifyPlay`, `notifyPause`).

### Decisions made during grilling

- **Library: `react-player`.** Matches user's reference. ~30KB gzipped. Multi-source (YT + Vimeo + native) gives future flexibility free.
- **Single shared Context, not split control + state contexts.** Considered splitting because `currentSeconds` updates ~4×/sec and re-renders every consumer. Rejected: VideoChat / NotesPane re-renders are cheap, and splitting adds Interface ceremony without a measured perf concern. Easy to split later if it bites.
- **Inline `<TimecodeChip>` component.** The chip-rendering helpers used to take `onSeek` as a parameter. Refactored the chip into its own React component that calls `usePlayerControl()` directly — eliminates the `onSeek` plumbing through `renderWithTimecodes`, `processChildren`, `buildMarkdownComponents`, `TimecodeMarkdown`.
- **Auto-highlight + auto-scroll shipped in this round.** The reason for deferring the original transcript work was needing this Module. Now that we have it, two-line addition: `findActiveRowIndex` + `scrollIntoView({ block: 'nearest', behavior: 'smooth' })`.
- **`isReady` exposed.** Lets consumers (like `SectionTimecodeEditor`'s "Use current video time" button) suppress UI that depends on a working player.
- **`?t=<sec>` deep-link via `onLoadedMetadata`.** Old code baked `start=` into the iframe URL. New code applies `currentTime = startSec` once on metadata load — cleaner, no URL-state coupling.

### Bug-equivalent fixes alongside the refactor

- **Old `seekTo` did manual mobile-scroll-into-view fallback.** Removed — the new player wrapper sits in the same sticky aside as before; mobile stacking still works without manual intervention.
- **Old `SectionTimecodeEditor` ran a window-level message listener while the popover was open.** Removed — `currentSeconds` comes from the Module's reactive state, no listener leak risk.

### Quantified impact

| File | Before | After | Net |
|---|---|---|---|
| `learn.$videoId.tsx` | (had iframe, seekTo, buildEmbedSrc, threading) | thin route | −~75 lines |
| `SectionTimecodeEditor.tsx` | window listener + postMessage handshake | reads from hook | −~30 lines |
| `TimecodeMarkdown.tsx` | onSeek param threaded through 3 functions | chip component | ~same line count, better shape |
| `NotesPane.tsx`, `VideoChat.tsx`, `TranscriptPane.tsx` | `onSeek` prop threaded | hook-call internal | −~20 lines |
| `client/src/components/player/index.tsx` | 0 | 197 (new) | +197 |
| `client/src/components/player/index.test.ts` | 0 | 53 (new) | +53 |
| **Net production code** | | | roughly flat |

The win isn't line count — it's **the shape**. The IFrame API protocol now lives in **one file**. Auto-highlight is a 2-line feature in `TranscriptPane`. Adding a new seekable component (e.g. a chapter list) is `usePlayerControl()` + click handler — zero prop wiring.

### Test surface

`client/src/components/player/index.test.ts` — 7 tests for `findActiveRowIndex` (the binary-search helper that powers auto-highlight): empty corpus, before-first-row, exactly-on-boundary, between-rows, past-last-row, single-row corpus, large corpus.

The Provider/Component/hook are React Context plumbing — best verified by visual smoke test in the dev server, not by mocking React + react-player.

### What got rejected and why

- **Two-context split (`PlayerControlContext` + `PlayerStateContext`):** considered for perf isolation since `currentSeconds` updates frequently. Rejected — no measured perf issue today; YAGNI; the split is straightforward to add later.
- **`react-youtube` instead of `react-player`:** considered (smaller, YouTube-specific, more direct mapping to YT IFrame events). Rejected to match user's existing reference pattern. Library swap is one-file change inside the Module if priorities change.
- **Keep raw iframe + abstract behind a ref:** would have been zero-dep, but the SectionTimecodeEditor's `infoDelivery` listener stays awkward and we'd reimplement what `react-player` already gives us.
- **Per-component imperative ref API (`playerRef.seekTo(...)`):** rejected — context + hook is the more idiomatic React pattern and avoids prop-drilling refs.

### Follow-up candidates (not done)

- **Lazy-load `react-player` via dynamic import** if the bundle-size cost shows up in the page-load budget. Today the player loads with the route — fine for the local-first single-user case.
- **Expose buffer / duration / playback-rate** on the hook surface if a feature ever needs them (UI for buffering state, scrubber, etc.). Today `react-player` exposes these internally — adding them to `PlayerControl` is straightforward.
