# Architecture audit — 2026-06-10

Follow-up to the [2026-05-09 audit](./architecture-audit.md). Two jobs:
re-check that audit's candidates against a month of drift (the theory
companion / Progression Composer layer, the music routes, and the
dev-SQLite / prod-Neon split all landed since), and sweep the new
subsystems it never saw. Findings were produced by parallel subsystem
reviews and every one was adversarially verified before acceptance —
21 raw findings, 10 survived, 11 rejected (recorded below so they don't
get re-proposed).

**Unlike the May audit, this one was executed immediately.** Every item
in "Shipped" landed the same day, verified by typecheck + the full
vitest suite.

---

## Prior candidates — status at re-check, and disposition

| # | Candidate (2026-05-09) | Status found | Disposition |
|---|---|---|---|
| 1 | `finalScore` recomputed at seven sites | open | **Shipped** — unified writer |
| 2 | dense+BM25+RRF implemented three times inline | open (a 4th copy existed in `ask-library.ts`) | **Shipped** — fusion primitive |
| 3 | `generateVideoSummary` 400-line spine, no seams | open | **Shipped** — three named steps |
| 4 | verdict/signal re-rate mini-orchestrators | partially addressed | **Collapsed** as a consequence of #1 + #3 |
| 5 | `useLibraryChat` bypasses `chat-stream.ts` | open (plus a 3rd parser in `NoteComposer`) | **Shipped** — single transport |
| 6 | `*WithStatus` doubling | open | Deferred again, by design (weak; revisit on a third loader) |

## Shipped

### 1. Unified score writer (candidate 1 + 4)

`applyVideoScoreUpdateService` in `client/src/lib/services/videos.ts` is
now the only partial-score write surface, with four update kinds
(`verdict`, `value`, `signals`, `rederive`). It derives `finalScore`
internally — from the update plus the row's untouched component (passed
as `prior` or re-fetched). `updateVideoSummaryService` derives it the
same way for the full-summary PUT. `updateVideoVerdictService` and
`updateVideoSignalScoresService` are gone; `computeFinalScore` is no
longer referenced outside `videos.ts`. The invariant ADR 0005 used to
delegate to code-review discipline is pinned by
`videos.score-writer.test.ts`.

**Latent bug found and fixed by the port:** `backfillValueScores`
fetched only `['documentId', 'watchVerdict']`, so its
`computeFinalScore(score, row.signalScore)` always saw `undefined` and
wrote `finalScore = valueScore`, silently discarding the signal
component on any row that had one — exactly the drift class the May
audit predicted. The backfill now fetches `signalScore` and routes
through the writer.

### 2. Retrieval-fusion primitive (candidate 2)

`client/src/lib/services/retrieval-fusion.ts` owns the hybrid ranking
math: cosine leg, BM25 leg over per-candidate text, RRF merge,
`RRF_K=60` / `BM25_WEIGHT=2.5` and their tuning rationale. Four
surfaces now call `fuseHybridRankings` and keep only their own
concerns at the call site:

- `relatedVideos` — doc-as-query (`maxQueryTerms: 15`) + tag/title
  boosts layered onto the returned score map, re-ranked via
  `rankByFusedScore`.
- `semanticSearchVideos` — query over video summary surfaces.
- `searchLibraryPassages` — query over flattened passages, per-video cap.
- `ask-library.ts` `retrievePassagesForQuery` — the fourth copy the May
  audit missed; its "keep in sync with server-functions" comment is now
  structural fact instead of a plea.

Fusion math is hermetically tested in `retrieval-fusion.test.ts` (the
live-Ollama ranking behavior stays in `embeddings.ranking.test.ts`).

### 3. Generation spine seams (candidate 3)

`generateVideoSummary` now composes three named steps in
`learning.ts`:

- `resolveTranscriptForGeneration` — the relation / by-id / fresh-fetch
  triage, case-3 persist-before-AI ordering, and video↔transcript
  linking. Takes the caller's in-flight oEmbed promise so meta and
  transcript still load in parallel.
- `saveSummaryWithScores` — signal computation + the single canonical
  summary write (no `finalScore` in sight; the writer derives it).
- `refreshVideoEmbeddings` — the Tier-1 + Tier-2 best-effort
  ("log but never fail") embedding refresh.

The verdict-only and signal-only paths now consist of: fetch → compute
→ one writer call. Their mini-orchestrators are gone (candidate 4
collapsed as predicted).

### 4. Single SSE transport (candidate 5, extended)

`chat-stream.ts` gained a `citations` StreamEvent variant, owns the
"non-OK response → throw with upstream body detail" behavior (was
private to `useLibraryChat`), and **surfaces `RUN_ERROR` frames as
thrown, `friendlyOllamaError`-translated errors** — previously the
parser's default branch silently dropped them, so an Ollama death
mid-stream produced an empty assistant bubble (VideoChat/DigestChat) or
a wiped draft (NoteComposer `setBody('')`), violating ADR 0007's
"don't swallow errors into empty data". All four streaming consumers
(`VideoChat`, `DigestChat`, `useLibraryChat`, `NoteComposer`) parse
through the one transport. `friendlyOllamaError` was verified idempotent
(friendly output re-translates to itself), so consumer-level catch
sites that re-translate are harmless.

### 5. Static gates repaired

Both gates were red before any of the above:

- **Typecheck:** 6 pre-existing errors in `vite.config.ts` — vite 8
  (rolldown) plugin types fed to `defineConfig` from `vitest/config`,
  which type-checks against vitest's bundled vite 7. Fixed by splitting
  a deliberately plugin-free `vitest.config.ts` (vitest prefers it and
  does not merge). Side effect: the "Vite server won't exit / close
  timed out" vitest hang is gone — nitro/devtools servers no longer
  boot under the unit suite.
- **Tests:** `embeddings.ranking.test.ts`'s semantic assertion ("gemma
  in dense top-2") is a model-judgment near-tie among four AI docs and
  had gone red. Re-asserted as the durable signal: gemma in the top 4
  **and** above every filler/unrelated doc — the regression it guards
  (task prefix dropped → relevance collapses into the filler cluster)
  still fails loudly; embedding-model mood swings don't.

### 6. Smaller verified findings

- **Docs port drift (fork inheritance):** `operations.md`, `mcp.md`,
  and ADR 0007's quoted example said `1340`/`3005`; real ports are
  `1350`/`3015`. All fixed — the MCP setup snippets users copy-paste
  pointed at a dead endpoint.
- **Neon pooler guard:** `server/config/database.ts` now throws at
  config load if `DATABASE_HOST` contains `-pooler.` (PgBouncer breaks
  Strapi boot migrations; the error names the fix). The vestigial,
  undocumented `connectionString: env('DATABASE_URL')` line was
  removed.
- **Outbound-fetch timeouts:** `web-search.ts` DDG fetch got
  `AbortSignal.timeout(8000)` (a stalled DDG stalled the whole chat
  tool call); `embedText`'s Ollama fetch got a deliberately generous
  60s timeout (batch paths legitimately queue behind map-reduce under
  `OLLAMA_NUM_PARALLEL=1`).
- **Dead code:** `url-metadata.ts` deleted — zero references anywhere;
  its `HealthAppLinkBot/1.0` user-agent revealed it predates even the
  parent project's purpose.
- **Env/docs accuracy:** README no longer presents client
  `EMBEDDING_VERSION` as a `.env` knob (it's a code constant in
  `client/src/lib/env.ts`); `OLLAMA_SYNTHESIS_MODEL` documented in
  `.env.example` + README.
- **Test gap closed:** `ask-library.test.ts` adds black-box contract
  tests for `retrievePassagesForQuery` (caps, cosine floor,
  stale-passage exclusion, grouping/citation-index order) plus pure
  tests for `groupPassagesByVideo` / `formatSeedForPrompt`.

---

## Inspected and rejected (don't re-propose)

Each of these was claimed by a subsystem review and killed by an
adversarial verifier with the cited code open. One-line reasons here;
the pattern to remember is in bold.

- **Composer persistence e2e tests** — the only nontrivial logic
  (schema migration/validation) is already covered by
  `compose-schema.test.ts`; mocked round-trip tests would only verify
  the mock. **Don't test glue against mocks.**
- **`pickDegree` cursor-boundary test** — the feared edge case is a
  benign, already-tested no-op (`freeGapAt` on occupied ticks);
  empirically disproven.
- **`moveNote` re-sort "inefficiency"** — every span mutation sorts by
  module contract; a 128-tick lane sort is sub-microsecond and the drag
  hook dispatches per pointermove anyway. **Perf findings need a hot
  path.**
- **Game-mode result computation shared across instrument views** /
  **shared highlight predicates** / **shared SVG constants** — the
  per-instrument variation is deliberate (documented divergence, e.g.
  bass PC-only matching, intentionally different fret widths); a shared
  abstraction would encode the union of differences for ~zero net
  lines. **Closed three-member union + intentional divergence ≠
  duplication.**
- **`reader.ts` inflight Set "leak"** — `try/finally` semantics make
  the claimed stranding impossible; verified empirically.
- **`saveDigest` "mutation during async iteration"** — semantically
  impossible race on a single-threaded runtime; `Promise.all` settles
  after all pushes.
- **`digest.tsx` CSV-parsing placement** — route-side param adaptation
  IS the existing convention (`search.tsx`, `feed.tsx` do the same).
- **API routes don't translate Ollama errors** — wrong mechanism: the
  SSE response returns 200 before any Ollama I/O; the library emits
  `RUN_ERROR` frames. The real bug (frames dropped client-side) was
  fixed under candidate 5 above.
- **Unit tests for `loops.ts`/`compositions.ts` CRUD wrappers** —
  repo convention deliberately tests logic modules, the shared
  transport once, and live contracts via smoke/e2e; mocked
  query-shape assertions are tautological.
- **Shared position-key module for instrument views** — `posKey`
  /`padKey` serialize different position spaces with one or two
  callers each. (The guitar `"string-fret"` key *is* a cross-module
  contract — `resolve.ts`, `voicings/guitar.ts`, `builder.tsx`,
  `GuitarView` — noted as a watch item, not worth a module yet.)
- **`EMBEDDING_VERSION` "update the number in CLAUDE.md"** — the doc
  drift was real but the proposed fix preserved a false premise (it's
  not an env var); fixed with the corrected shape instead.

## Watch items (recorded, no action)

- `*WithStatus` doubling (May candidate 6) — act if a third
  loader-facing lookup appears.
- Guitar position-key string contract (above).
- `embeddings.ranking.test.ts` remains a live-Ollama integration suite
  inside `yarn test`; it auto-skips when Ollama is down and its soft
  assertion was hardened, but if it flakes again the next step is an
  explicit opt-in env gate.

## Verification

- `npx tsc --noEmit`: 0 errors (baseline before this audit: 6).
- `yarn --cwd client test`: all green, including the new
  `retrieval-fusion.test.ts`, `videos.score-writer.test.ts`,
  `ask-library.test.ts`, and 9 new `chat-stream.test.ts` cases
  (baseline: 1 failing + a 10s hang on exit; now exits clean in ~3s).
- Strapi boot check against dev SQLite after the `database.ts` guard.
