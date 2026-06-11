# 0007. Boundary-layer error translation for Strapi + Ollama

**Status:** Accepted

## Context

Both major dependencies (Strapi and Ollama) can be down or misconfigured. Without specific handling, failures looked like this in the UI:

- Strapi unreachable on `/feed` → empty state ("Nothing here yet · Share the first video"). Indistinguishable from a genuinely empty library.
- Strapi unreachable on `/learn/$videoId` → "you haven't shared this video yet" prompt. Indistinguishable from an actually-unshared row.
- Ollama unreachable during library chat → "Couldn't complete: Request failed: 500". The user has no idea Ollama is involved.
- Ollama model not pulled → cryptic stack-trace fragment.
- Generation failure on a long video → raw error string from the chat adapter, no recovery hint.

The pattern was the same everywhere: services and route loaders swallowed failures into the same shape as "no data" — a row of `null` or an empty array — destroying the signal that a dependency was broken.

## Decision

**Two boundary-layer error helpers translate raw failures into recovery hints. They run at the points where failures cross from "infrastructure" to "user-visible".**

### Strapi: `friendlyBackendError(status, raw)` in `client/src/lib/services/videos.ts`

- `status === 0` → `"Backend unreachable. Check that Strapi is running on port 1350."`
- `status >= 500` → `"Backend error. Strapi is up but rejected the request — check its console for details."`
- otherwise → raw message passes through.

Service helpers expose `*WithStatusService` siblings (`fetchVideoByVideoIdWithStatusService`, `fetchVideoByDocumentIdWithStatusService`) that return `{ video, error }` instead of `StrapiVideo | null`. Route loaders use these so they can render the shared `BackendErrorPanel` component (a card with a Retry button) instead of falling back to "empty" / "not found". `PaginatedVideos` likewise carries an optional `error` field.

Used by: `/feed` loader, `/learn/$videoId` loader, `/video/$documentId` loader.

### Ollama: `friendlyOllamaError(raw)` in `client/src/lib/services/ollama-errors.ts`

Pattern-matches:

- host-unreachable (`fetch failed`, `ECONNREFUSED`, `11434`, `NetworkError`, `Failed to fetch`) → `"AI server unreachable. Is Ollama running on port 11434?"`
- model-not-found → `"Ollama can't find the configured model. Run \`ollama pull <model>\` for it, or update OLLAMA_MODEL."`
- timeout → `"AI request timed out. The model may be loading or the prompt is too long."`
- otherwise → raw message passes through.

Used by: `useLibraryChat` (after reading response body to surface server-side detail), `VideoChat` catch site, `DigestChat` catch site, `FailedState` on the learn page.

## Consequences

**What we gain.**

- Empty states and dead-backend states are now visually distinct. Retry button is one click away from any failed loader.
- Errors that don't match a known pattern pass through unchanged, so genuine unfamiliar failures stay legible (we don't hide useful detail behind a generic message).
- Adding a new chat surface or route loader has a clear template: pipe caught errors through the right translator.

**What we accept.**

- Two helpers, two surfaces. Adding a third dependency (e.g. youtubei.js) would warrant a third translator — `friendlyTranscriptError` for the "captions disabled / video private / live in progress" cases.
- Pattern matching on string contents is brittle to upstream message changes. The 16 unit tests in `ollama-errors.test.ts` lock in the current patterns; if Ollama / Node ever change their error wording, tests fail loudly.
- The translators are language-only (English). Internationalization is out of scope for this app.

**What's enforced in code.**

- New chat or AI surfaces should pipe caught errors through `friendlyOllamaError` before `setError`. New route loaders that lookup a Strapi row should use the `*WithStatusService` siblings and render `BackendErrorPanel` on failure.
- Don't swallow errors into empty data. The point of these helpers is that failures and emptiness are now separable; collapsing them again undoes the work.
