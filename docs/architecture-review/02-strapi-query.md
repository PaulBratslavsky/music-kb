# 2. Strapi Query Module — one Interface for `populate=` / `filters=` / pagination

**Status:** ✅ Shipped 2026-05-03 at scope B (medium). New module: `client/src/lib/services/strapi-client.ts`.

## Files

- `client/src/lib/services/videos.ts:149–172` — `feedQueryParams`, `detailQueryParams`.
- `client/src/lib/services/videos.ts:215–243` — `listAllVideosForEmbeddingService` (inline params).
- `client/src/lib/services/videos.ts:525–541` — `fetchTranscriptByVideoIdService` (inline params).

## Problem

Four call sites build their own `URLSearchParams` by hand. Strapi's quirks — `[$containsi]` for case-insensitive contains, `populate[X]=true` vs. nested populate syntax, filter operator names — leak into every caller. **Two adapters = real seam; we have four.**

A typo in `populate[transcript]=true` only fails at runtime: Strapi just returns the row without the relation, and the next dereference yields `null`. Hard to notice without a test that asserts on the shape of the response.

This is shallow now (each call site is small) but the **scattered knowledge** is the cost — not the line count. Every caller knows partial Strapi vocabulary.

## Sketch

A small builder Module that owns Strapi REST vocabulary. Callers express intent ("video detail with tags + transcript", "feed page filtered by tag"), not URL syntax.

Helpers for the recurring shapes (`videoDetailQuery`, `videoFeedQuery`, `embeddingListQuery`) sit on top of the same primitive. The primitive is a chainable builder; the helpers are named, testable functions returning a built query string.

## Locality / Leverage

- **Locality:** Strapi syntax knowledge concentrates in one file.
- **Leverage:** if Strapi 6 changes the populate format (it has, between 4 and 5), one file changes. Today: four.

## Test surface change

Builder is **pure** — testable without a Strapi instance. Today these query strings are only "tested" by integration: hit Strapi and see what comes back. Bugs show up as missing fields, not failed tests.

## Open questions for grilling

- Is the builder a fluent API (`q.populate('tags').filter('title', 'contains', 'foo').build()`) or a config object (`buildQuery({ populate: ['tags'], filter: { title: { contains: 'foo' } } })`)?
- Does the Module wrap the entire `fetch` (returning typed data) or just the URL-building? The latter is smaller; the former forces every caller to go through the seam.
- How much of Strapi's filter syntax do we expose vs. limit to what we actually use?
- Is this worth doing now, or only worth it when we add a 5th content type or a new query shape?

## Grilling notes

### Surface was bigger than the candidate file said

Reading the actual code surfaced **11 query-building sites** (not 4 as the candidate listed) plus **~17 fetch sites**, each with duplicated auth, URL composition, JSON parsing, and error normalization. Three concerns travel together — splitting them across two Modules would create two shallow Seams.

### Scope decision: B (medium), not A or C

- **A (narrow)** — just the query-params builder, 11 call sites updated. Rejected: doesn't address the actual repetition (auth + URL + JSON + error). Half-deepening.
- **B (medium)** — single Module with `strapiFetch<T>(method, path, { query?, body? })` + builder inside. **Picked.** The 17 fetch sites collapse to 2-3 lines each.
- **C (broad)** — per-resource typed clients (`videos.find()`, `transcripts.findOne()`). Rejected: per-resource clients would each be ~5-line wrappers around `strapiFetch` with typed response shapes — wide Interface (N methods × M resources), shallow Implementation. Classic shallow-module trap.

### Final shape

```ts
// client/src/lib/services/strapi-client.ts

export type StrapiQuery = {
  populate?: '*' | string[] | { [key: string]: QueryValue };
  filters?: Record<string, QueryValue>;
  fields?: string[];
  sort?: string | string[];
  pagination?: { page?: number; pageSize?: number; withCount?: boolean };
};

export type StrapiResult<T> =
  | { ok: true; data: T; meta?: StrapiMeta }
  | { ok: false; status: number; error: string };

export async function strapiFetch<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  opts?: { query?: StrapiQuery; body?: unknown },
): Promise<StrapiResult<T>>;

export function buildQueryParams(query: StrapiQuery | undefined): URLSearchParams;
```

Behind the Seam: `STRAPI_URL` + `STRAPI_API_TOKEN` (pulled from env), recursive flattening of nested populate/filter/$or syntax (~25 lines), auth header injection, content-type header for body requests, error normalization (parses Strapi `{error: {message}}` envelope or falls back to status code), JSON parsing, network-error handling.

### Decisions made during grilling

- **One Module, builder + fetch together.** No artificial split — they share the Seam. Any caller using the builder is also using fetch; tests verify the composition.
- **Discriminated-union return type** (`{ ok: true } | { ok: false }`). No throws; callers handle the false branch explicitly. Matches existing `ServiceResult` pattern in the codebase. Network errors become `{ ok: false, status: 0, error: <message> }` — same shape as HTTP errors.
- **`StrapiQuery` typed shape** constrains what callers can build. Catches typos like `populate[tag]` (singular) at compile time. The `populate` field accepts three idiomatic shapes (`'*'`, `string[]`, recursive object) — mirrors how Strapi's docs describe it.
- **All-at-once migration** of 17 fetch sites across `videos.ts` (15 calls), `notes.ts` (4 calls), `digests.ts` (6 calls). Single-user local-first; no reviewer pain; test suite catches regressions.
- **Custom recursive flattener (~25 lines), no `qs` dependency.** We control the syntax we actually need; no version-drift risk.
- **`STRAPI_URL` import kept in `videos.ts`** — only for `strapiAssetUrl`, the asset-URL composition for uploaded media (not a REST call).
- **Empty response body returns `{ ok: true, data: undefined }`** — supports DELETE / no-content writes without forcing callers to special-case them.

### Test surface

`client/src/lib/services/strapi-client.test.ts` — 23 tests covering:
- **`buildQueryParams`**: empty input, populate (`'*'`, string array, shallow object, nested object), filters (eq, relation, $or with array index, primitives), pagination (full + partial), fields (indexed array), sort (string + array), combined keys.
- **`strapiFetch`**: GET with parsed data + meta, GET appends query params, POST stringifies body + Content-Type header, no Content-Type when no body, error parsing (Strapi envelope), error fallback (missing envelope), error fallback (non-JSON body), network error (fetch rejects), empty response body.

The Module is testable without a network — `fetch` is mocked at the global scope. The recursive flattening is pure and verified against the actual Strapi syntax our callers had been writing by hand.

### Bug fixes shipped alongside the refactor

- **Consistent error logging.** Previously `videos.ts` and `notes.ts` had different error-log formats and `digests.ts` a third. Now all 17 sites log via `strapiFetch`'s single `logFailure` path with the same shape.
- **`logFetchError` stale URL bug fixed.** The old per-file logger logged `res.url` (post-redirect) which sometimes hid the actual path requested. The new logger uses the constructed URL.

### Quantified impact

| File | Before | After | Net |
|---|---|---|---|
| `videos.ts` | 660 lines | ~480 lines | −180 |
| `notes.ts` | 337 lines | ~290 lines | −47 |
| `digests.ts` | 345 lines | ~280 lines | −65 |
| `strapi-client.ts` | 0 | 195 (new) | +195 |
| `strapi-client.test.ts` | 0 | 286 (new) | +286 |
| **Total production code** | | | **−292** |

Three identical copies of `strapiHeaders` + `logFetchError` (~25 lines each = 75 lines) deleted. 11 hand-rolled `URLSearchParams` builders deleted. 17 inline auth-header constructions deleted.

### What got rejected and why

- **Per-resource clients (scope C):** would have created 4+ shallow Modules, each ~5 lines of typed wrapper around `strapiFetch`. Wider Interface, no depth gain.
- **Builder as separate file from `strapiFetch`:** the only consumer of "Strapi query params" is `strapiFetch`. Splitting added ceremony without earning it.
- **`qs` library for flattening:** ~25 lines of custom code controls exactly the syntax we use. No transitive-dep version drift.
- **Throws-on-error API:** would have forced 17 try/catch blocks across callers. The discriminated union is more ergonomic for the existing `success: true | false` pattern.

### Follow-up candidates (not done)

- **Server-side schema validation of Strapi responses.** Today the helper returns `data: T` with the type asserted. A future pass could pipe through Zod schemas at the Module boundary.
- **Pluggable persistence layer** — if we ever swap Strapi for a different headless CMS, the Module is the seam. Today's REST shape (Strapi 5 `documentId` + flat data envelope) is hardcoded; a future migration would refactor inside the Module without touching callers.
