# 0010. Duplicated retrieval is guarded, not shared

**Status:** Accepted (2026-08-26).

## Context

`docs/ai-architecture.md` carried a known gap: *"The two tool systems duplicate
retrieval… Merging them wholesale would undo the protocol-free local path,
which is a deliberate choice — but the retrieval core underneath both could be
one module."* This ADR is the result of taking that seriously and measuring it.

### The premise was wrong

The four in-app TanStack AI tools in `client/src/lib/services/library-tools.ts`
(`search_library`, `get_video_details`, `list_videos_by_topic`, `load_passages`)
share **zero lines** of retrieval logic with the six MCP tools they superficially
resemble (`searchVideos`, `getVideo`, `searchTranscript`, `findTranscripts`,
`crossSearchTranscripts`, `relatedVideos`).

They are not two implementations of one algorithm. They are different
algorithms:

- `search_library` is dense-embedding + BM25 passage fusion with
  parent-document grouping, running in the client's Node process over REST.
- `searchVideos` is a SQL `$containsi` AND-filter across six columns, with no
  index, no embedding and no ranking, running in-process against Strapi's
  document service.

Measured during the spike: `list_videos_by_topic` and `searchVideos` return the
same top result for 4 of 12 sample topics, and their result sets overlap **0%**
on "guitar". There is no shared retrieval core beneath them because there is no
shared retrieval.

### The real duplication, measured

Two server files genuinely duplicate client logic. Counting non-comment,
non-blank lines:

| File | Lines | Guarded by |
|---|---|---|
| `server/src/mcp/utils/embeddings.ts` | 139 | `client/src/lib/services/embeddings.parity.test.ts` (718 lines) — holding |
| `server/src/services/bm25-search.ts` | 156 | **nothing** — and already drifted |

The BM25 file's header claimed *"Mirrors the scoring math of `searchBM25` in
transcript.ts so results are identical to what the in-app chat sees."* That
sentence was false. Reproduced on a 60-chunk fixture: at `idf("guitar") = 0.693`
the client returns `[]` and the server returns 5 chunks; at
`idf("arpeggio") = 3.195` both return the same ids in the same order. The cause
is `BM25_MIN_QUERY_IDF = 1.5` in `client/src/lib/services/transcript.ts`, which
the server deliberately omits — along with the `maxQueryTerms` cap, the
`log(1 + qtf)` term weight, and `tokenize`'s alpha-prefix expansion.

The drift is **directional and bounded**: on discriminative queries the two
agree exactly; on low-information queries the client refuses and the server
answers. Neither behaviour is wrong for its own caller. Only the claim of
identity was wrong.

### Why a shared module does not work here

The constraint recorded until now — *"`server/`'s `moduleResolution` can't read
`exports` maps"* — is the smaller wall, and it misattributes the problem.

`packages/music` is `"type": "module"`, its `exports` map points at **raw
`.ts`**, its relative imports are extensionless, and it has **no build step**.
It is consumable **only by a bundler**. Strapi's pipeline is `tsc` → Node, with
no bundler anywhere in it. **No setting in `server/tsconfig.json` fixes that**,
and a new shared package built the same way would hit the same wall.

Measured, on this checkout:

| `server/tsconfig.json` | Result |
|---|---|
| baseline (`module: CommonJS`, default resolution) | `TS2307` on the import — the exports map is invisible |
| `module: "node16"` | `TS1479` before reaching any shared package at all: `youtubei.js` and `vitest/config` are already ESM, and CJS cannot `require` them. Adding `.js` extensions does not fix it; the documented escape hatch — dynamic `import()` — then fails at **runtime** with `ERR_MODULE_NOT_FOUND` on the extensionless relative under Node 24 |
| `module: "CommonJS"` + `moduleResolution: "bundler"` | rejected outright: `TS5095: Option 'bundler' can only be used when 'module' is set to 'preserve' or to 'es2015' or later`. **CJS emit and exports-map resolution are mutually exclusive** |
| `module: "preserve"` + `moduleResolution: "bundler"` | **typechecks 100% clean — 0 errors — and then `strapi build` dies** |

That last row is the trap, and it is why this ADR records the measurements
rather than the conclusion. `preserve` makes `tsc --noEmit` pass completely,
then emits ESM `import` statements into `.js` files inside a package with no
`"type": "module"`. The build fails at:

```
Error: Could not load js config file
server/dist/config/database.js: __dirname is not defined
```

— i.e. in `server/config/database.ts`, the dev-SQLite / prod-Neon router, with
a message naming nothing about module format. A clean typecheck here means
nothing.

### A fifth package WOULD work — it is just not worth it

Verified during the spike: a CJS-first package (a `main` plus an `exports` map
with a `require` condition, emitting `.js` + `.d.ts`) imports cleanly from real
server source under the **completely unmodified** `server/tsconfig.json`,
typechecks, builds, and requires at runtime.

So the decision is **"not worth it", not "impossible"**. The cost:

- It needs a **build step**, which breaks `packages/music`'s live-symlink model
  and reintroduces exactly the staleness CLAUDE.md bans `file:` for, through a
  different door.
- A fifth `package.json` and a fifth lockfile, under a repo whose isolation
  rule already costs four installs.
- A watch process in `yarn dev`, and a pre-push staleness guard so a stale
  `dist/` cannot ship.

It trades two loud places for one quiet place plus four silent ones, to
de-duplicate 156 lines that have exactly one writer.

### The fact that makes duplication cheap

**`buildBM25Index` appears nowhere in `server/src`.** Verified, and now asserted
by a test. The client BUILDS the index and persists it on
`Video.transcriptSegments`; the server only ever READS one. Document-side
tokenization is therefore single-sourced **through the data itself** — the
server can only see what the client built. That makes this a reader/writer
contract, not two competing producers, and a round-trip test pins a
reader/writer contract completely.

The blast radius today is "a query ranks differently", never "a stored artifact
is corrupt".

## Decision

**Duplicate and guard. Do not extract a shared retrieval module.**

1. `server/src/services/bm25-search.ts` keeps its own copy. Its header now
   states what it deliberately omits and what that costs, instead of claiming
   an identity it does not have.
2. The copy is pinned by `server/src/services/bm25-search.parity.test.ts` — 58
   behavioural cases across six groups: equivalence on discriminative queries,
   the intentional divergences, citation grounding, timecode rewriting, the
   stored-index wire format, and a guard-the-guard.
3. **New mechanism, established here:** a cross-package guard that must compare
   *behaviour* rather than *text* is a test in the **`server/` suite** that
   imports the client's module directly. Permitted only for **dependency-free**
   modules — the test asserts that both files still have zero imports, because
   that is the only thing keeping a foreign `node_modules` out of the
   resolution graph.

   Text guards stay where they are: in the client suite, reading server source
   as text. Directionality is not a style preference — `client/tsconfig.json`
   includes `**/*.ts`, so a client-side test importing server source would drag
   server files into the client's `tsc --noEmit` gate, letting a server edit
   break the client's typecheck.

   The honest cost, accepted: `server/tsconfig.json` excludes `**/*.test.*`, so
   the new file is **typechecked by nothing**. Tolerable precisely because it
   *executes* both sides — a signature drift surfaces as a red test, which is
   not true of the text guards.

## Consequences

**What we gain.** The false claim is gone from the header. The drift is
recorded, bounded and pinned, in both directions — re-converging the two sides
turns the test red just as diverging them further does, so the next person
cannot quietly "fix" it in either direction without reading this ADR. And the
guard earned its keep on day one: see the defect below.

**What the guard found immediately.**

- **A silent total-failure bug in three MCP tools.** `buildBM25Index` builds its
  tf/idf tables as `Object.create(null)` maps precisely so a transcript term
  named `constructor` cannot collide with `Object.prototype`.
  `JSON.stringify` → `JSON.parse` — exactly how Strapi stores and returns the
  column — discards the null prototype. The client repairs it: every client call
  site loads through `loadStoredIndex`, whose `sanitizeNumberMap` rebuilds the
  maps. The server has none; `search-transcript.ts` reads
  `video.transcriptSegments.bm25` raw. So `index.idf['constructor']` yields the
  native `Object` function, which is truthy, and `index.tf[i]['constructor']`
  does too for **every** chunk — turning each score into `NaN`, which the
  `score > 0` filter then drops. **Any MCP query containing the word
  "constructor" returns nothing**, silently, from `searchTranscript`,
  `crossSearchTranscripts` and `verifyCitations`. `constructor` is the only
  reachable trigger: `tokenize` lowercases, the other `Object.prototype` members
  are camelCase, and `__proto__` cannot survive the `[a-z0-9][a-z0-9'-]*`
  pattern. Verified: `searchBM25(wire.bm25, 'arpeggio')` → `[23, 7]`;
  `searchBM25(wire.bm25, 'arpeggio constructor')` → `[]`. Pinned in group E and
  labelled `DEFECT, PINNED` — **delete that test when it is fixed**. Not fixed
  here because it changes MCP behaviour and deserves its own decision.

  Note the irony worth keeping: the client's idf floor — the very filter this
  file's header calls an intentional omission — is also what makes the client's
  `searchBM25` immune, because `nativeObjectFunction >= 1.5` is `false`. The
  client's real protection is `loadStoredIndex`, not the floor.

- **An ADR 0004 exposure the prior survey under-sampled.** The client's
  `tokenize` expands `"qwen3"` → `["qwen3", "qwen"]`; the server's does not. On
  a fixture where the exact token sits in a long chunk and the alpha prefix in a
  short one, the two ground the *same* quote at *different* timecodes (client
  270s, server 150s). `verifyCitations` grounds through the server copy, so it
  can return a timecode the canonical in-app path would not. The survey's 0/240
  agreement on real quotes is reassuring but samples long, discriminative
  quotes; versioned product names are the case it misses. Pinned in group B3.

**What we accept.**

- 156 lines stay duplicated, permanently.
- The parity test is 911 lines guarding 156. That ratio is the price of a
  behavioural guard over a text one, and it is what makes it *behavioural*.
- The test is typechecked by nothing (above).
- Deploy skew stays out of reach: the test reads one working tree.

**Recorded separately — real, and none of it is drift.**

- **`relatedVideos` is two algorithms behind one name.** Client
  (`data/server-functions/videos.ts:787`): RRF fusion plus
  `TAG_BOOST_PER_TAG = 0.06` and `TITLE_BOOST_PER_TOKEN = 0.015`. MCP
  (`mcp/tools/related-videos.ts:78`): raw cosine, sort, `>= minScore`.
  **Identical defaults (`limit 6`, `minScore 0.5`), different answers** —
  measured: a different top neighbour for 55 of 75 targets (27% agreement),
  a different top-6 for 75 of 75, mean Jaccard 0.294. The fix is a rename or a
  line in the MCP tool's `title`, not a test and not a module.
- **A third tokenizer exists.** `server/src/mcp/tools/query-helpers.ts` has 25
  stopwords (a strict subset of the 69 the two BM25 copies share), a
  `length >= 2` bound instead of `length > 1`, and no timecode stripping. It
  feeds a Strapi `$containsi` AND-filter, not BM25, and was never meant to
  match. Do not unify it on the strength of a green parity run.
- **Client-internal cleanup, needing none of this.** Nine `formatMmss` /
  `formatTimecode` copies exist; **eight are inside `client/`**, and two
  disagree — `transcript.ts:109` zero-pads (`65s → "01:05"`),
  `ask-library.ts:364` does not (`65s → "1:05"`). `RRF_K = 60` is declared twice
  in `client/` (`retrieval-fusion.ts:25`, `transcript.ts:542`), and a third copy
  of the BM25 scoring loop sits at `transcript.ts:1132`. Ordinary imports inside
  one package fix all of it, at zero architectural risk. A cross-package module
  fixes none of it.
- **`buildPassageContext` in `server/src/mcp/utils/embeddings.ts` is dead** —
  exported, imported by nothing in `server/`. It exists only to satisfy the
  embedding parity test.
- **The client's query-side TF machinery is degenerate.** `tokenize`
  deduplicates, so every query-term frequency is 1 and every *stored* term
  frequency is 1 (measured on real data: 136,152 tf entries across 40 stored
  indexes, maximum value 1). The `log(1 + qtf)` weight is therefore a uniform
  constant that cannot reorder anything, and the tf table is a pure membership
  set. Pinned in group B2 so this stays true. The `maxQueryTerms` cap is *not*
  degenerate — it ranks the deduplicated terms — but with qtf pinned at 1 its
  "TF × IDF" weight is just IDF.

## The one fact that reverses this

**The day `server/` gains a write path over `Video.transcriptSegments`** — i.e.
anything server-side calls `buildBM25Index` or rewrites the stored blob.

Today the server can only read an index the client wrote, which single-sources
document-side tokenization through the data and caps every divergence at "queries
rank differently". A server-side indexer changes the **class** of failure, not
its size: two tokenizers writing the same blob produce a persisted artifact with
two incompatible producers, both labelled `version: 1` — and unlike the embedding
columns, `transcriptSegments` has **no model/version staleness field** to detect
it (`version` is a hardcoded literal that has never been bumped). A parity test
is weak protection on a write path. At that point the wire format needs one
owner, and the CJS-first fifth package earns its build step.

`bm25-search.parity.test.ts` group F asserts this trigger directly: it walks all
of `server/src` and fails if `buildBM25Index` appears in non-comment source.

**Secondary reversals.** Strapi 5 shipping real ESM support, which kills the
CJS↔ESM wall outright; or `packages/music` acquiring a build step for an
unrelated reason, which drops the marginal cost of a CJS-first retrieval package
to near zero.

**Explicitly NOT reversals.** The duplicate growing (156 lines is not the
problem and 400 would not be). A third consumer of retrieval (add the same
test). The two tool systems gaining more tools that answer similar questions —
that appearance is what produced the original recommendation, and it was wrong.
