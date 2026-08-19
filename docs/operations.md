# Operations runbook

Things that go wrong and how to fix them. Organized by symptom — when something breaks, search for what you're seeing.

The general escalation pattern: check Strapi (`http://localhost:1350`), check Ollama (`http://localhost:11434/api/version`), check the client console, then start invalidating caches / backfilling. Don't reach for `rm -rf .tmp/data.db` until you've ruled out everything else.

## Symptom: "Backend unreachable" panel everywhere

**What you're seeing.** The amber "Can't reach Strapi" card on `/feed`, `/learn/*`, or `/video/*`. (See ADR 0007.)

**Diagnose:**

```bash
curl -sf http://localhost:1350/_health || echo "Strapi down"
lsof -ti :1350                                # is something holding the port?
```

**Likely causes & fixes:**

- **Strapi just hasn't started.** `yarn dev` starts it asynchronously; the client may have loaded before the wait-on completed. Wait 10–20s, hit Retry.
- **Orphan node process holding :1350.** A previous run didn't clean up. `start.sh` kills these pre-flight; if you're running `yarn dev` directly, do it yourself:
  ```bash
  lsof -ti :1350 | xargs kill -9
  ```
- **SQLite file locked.** `yarn seed` was run while Strapi was up (it shouldn't be — see "Seed corrupted DB" below).
- **Strapi crashed during boot.** Check the terminal for stack traces. Usually a schema validation error after editing a `schema.json` or component without restarting.

## Symptom: chat shows "AI server unreachable. Is Ollama running on port 11434?"

This is the friendly-translated message from `friendlyOllamaError` (ADR 0007). It means `fetch failed` / `ECONNREFUSED 11434` was caught.

**Diagnose:**

```bash
curl -sf http://localhost:11434/api/version || echo "Ollama down"
launchctl getenv OLLAMA_KEEP_ALIVE          # macOS env check
launchctl getenv OLLAMA_NUM_PARALLEL
```

**Fixes:**

- **Ollama not running.** macOS: `open -a Ollama` (menubar app) or `nohup ollama serve > /tmp/ollama.log 2>&1 &`. `start.sh` handles this — use `yarn start` instead of `yarn dev` if you want it auto-launched.
- **Just changed `OLLAMA_NUM_PARALLEL`.** The running Ollama process won't pick up a new value — restart with `yarn start:fresh` (which `pkill -9 ollama` first).
- **Wrong host.** Check `client/.env` `OLLAMA_BASE_URL` — default is `http://localhost:11434/v1` (note the `/v1`, stripped internally for the TanStack adapter).

## Symptom: chat shows "Ollama can't find the configured model"

`friendlyOllamaError` matched a `model not found` pattern.

```bash
ollama list                                  # what's actually pulled
echo $OLLAMA_MODEL $OLLAMA_CHAT_MODEL $OLLAMA_EMBEDDING_MODEL
```

**Fix:** `ollama pull <model>` for whatever's missing. Defaults are `gemma4-kb:latest` (chat/summary) + `nomic-embed-text` (embeddings). The `gemma4-kb` is a custom Modelfile variant — if you don't have a Modelfile for it, swap to a stock model in `client/.env`:

```
OLLAMA_MODEL=gemma3:4b
```

## Symptom: Claude Desktop / Code can't reach the MCP server

The knowledge base is exposed over MCP by the **official Strapi MCP
server** (built into Strapi 5.47+; we're on 5.52.1) at
`http://localhost:1350/mcp`, Streamable HTTP, gated by **admin API
tokens**. See `docs/mcp.md` and ADR 0008. (The old hand-rolled server at
`/api/mcp` was retired — that endpoint no longer exists.)

**Diagnose:**

```bash
curl -sf http://localhost:1350/_health || echo "Strapi down"
# Unauthenticated hit should be rejected (401), proving the route is live:
curl -si http://localhost:1350/mcp | head -1
```

**Likely causes & fixes:**

- **`MCP_ENABLED` is off.** The server is enabled by `server.mcp.enabled`
  in `server/config/server.ts` (env `MCP_ENABLED`, default on). If you set
  `MCP_ENABLED=false` in `server/.env`, `/mcp` won't be served — unset it
  and restart Strapi.
- **Wrong token kind.** The official server only accepts **admin** API
  tokens (`kind: 'admin'`), *not* content-API tokens. A "Full access"
  token minted from Settings → API Tokens is rejected. Mint an admin token
  via `strapi console` — full snippet in `docs/mcp.md` ("Mint an admin
  token"). Stop the dev server first (SQLite single-writer), then re-run:
  ```bash
  cd server
  printf '%s\n' \
    "const u=(await strapi.db.query('admin::user').findMany({populate:['roles']}))[0]; const t=await strapi.service('admin::api-token-admin').create({name:'claude-'+Date.now(), description:'MCP', lifespan:null, adminUserOwner:u.id, adminPermissions:[{action:'api::music-kb-mcp.read'},{action:'api::music-kb-mcp.write'},{action:'api::music-kb-mcp.maintenance'}]}, u); console.log('TOKEN='+t.accessKey);" \
    ".exit" | npx strapi console
  ```
- **Missing tools / "tool not found".** A token only sees the tools its
  permissions allow — the three custom actions are
  `api::music-kb-mcp.read` (16 read tools), `.write` (4: `saveSummary`,
  `tagVideo`, `untagVideo`, `saveNote`), and `.maintenance` (4 expensive /
  external: `addVideo`, `fetchTranscript`, `reindexEmbeddings`,
  `generateDigest`). 24 custom domain tools total. Re-mint with the
  actions you need.
- **Claude Desktop won't connect at all.** Its built-in client speaks
  stdio, not Streamable HTTP — bridge it with `mcp-remote` (see the
  `claude_desktop_config.json` example in `docs/mcp.md`). Claude Code can
  connect directly: `claude mcp add music-kb --transport http
  http://localhost:1350/mcp -H "Authorization: Bearer <admin-token>"`.

## Symptom: a video is stuck on "Generating…" forever

The learn page polls every 3 s while `summaryStatus = 'pending'`. If the loader sees `pending` for >10 minutes, polling stops (cap is 200 attempts × 3s).

**Diagnose:**

1. Open `/learn/<videoId>` and watch the live step list (Fetch transcript → Run local model → Save). Which step is stuck?
2. Check the terminal — `learning.ts` logs each step. If you see `[learning] map chunk 8/16` ticking, it's just slow (long video, map-reduce). Wait.
3. If no progress in the terminal, Ollama is probably stuck. `ollama ps` to see currently-running models.

**Fixes:**

- **Click "Force retry"** on the pending screen. This clears the recent-failure marker and restarts.
- **Stuck Ollama generation.** `pkill -9 ollama` then `yarn start:fresh`. The generation will be marked failed; click Regenerate.
- **Generation crashed without flipping to `failed`.** Single-node assumption breakdown — the in-process `generationInflight` Set still thinks it's running, but the process is gone (e.g. you `Ctrl-C`'d the dev server mid-generation). Restart the client; `markVideoFailedHook` runs as a safety net on next access.

**Don't:** `regenerateSummary` won't help if `summaryStatus` is already `pending` — use `Force retry` from the UI which clears the failure marker first.

## Symptom: generation fails with "fetch failed" or transcript error

The transcript fetch (youtubei.js) didn't succeed.

**Likely causes:**

- **YouTube bot wall.** Your IP is hitting captcha. Set `TRANSCRIPT_PROXY_URL` in `client/.env` to a residential proxy.
- **Live URL during stream.** YouTube hasn't auto-generated captions yet. `/live/<id>` will fail until the stream ends. Wait, retry once it's archived.
- **Captions disabled** on the video (creator opt-out). No fix — this app is caption-dependent.
- **Private / age-gated.** Same — youtubei.js is unauthenticated.

The transcript is cached in Strapi (see ADR 0001 / data-model.md). Once it succeeds, regenerating the summary never re-hits YouTube — `regenerateSummary` only re-runs the AI step.

## Symptom: empty result on feed when library shouldn't be empty

If the **`BackendErrorPanel` isn't showing** but you see "Nothing here yet", the loader genuinely got `videos: []` from Strapi. That's the *real* "empty after filters" case, not a backend failure.

**Diagnose:**

- Are filters set in the URL? `?q=`, `?tag=`, `?minScore=70`, `?mode=semantic`. Clear them.
- Strapi admin: `http://localhost:1350/admin` → Content Manager → Video. Are rows there?

If rows exist in Strapi but don't appear on the feed, check that they have `summaryStatus` set — the feed shows pending+generated+failed but a row with `null` status would be unusual (the share path defaults it to `pending`).

## Symptom: Related Videos / semantic search shows nothing

The Tier 1 embedding either doesn't exist or is stale (different model / version).

**Fix from `/settings`:**

- Embedding panel shows Total / Current / Stale / Missing counts.
- Click "Backfill N missing" or "Reindex N stale" depending on what's surfaced. Concurrency 3, safe to run anytime.

**When to bump `EMBEDDING_VERSION`:** if you change the **text-builder** in `client/src/lib/services/embeddings.ts` (different fields concatenated, different ordering). Without the bump, old vectors silently survive a meaning-changing edit. ADR 0003 covers this.

**When to change `OLLAMA_EMBEDDING_MODEL`:** swapping to a different embedding model (e.g. `mxbai-embed-large`). The version stays the same; the model field invalidates. Backfill all afterward.

## Symptom: scores are missing or look wrong on the feed

Three separate issues; check which one applies.

| Symptom | Cause | Fix |
|---|---|---|
| Card chip says `Score —` | Older row has no `signalScore` or `finalScore` | `/settings` → "Refresh content scores". |
| Score is suspiciously round (25 / 50 / 70 / 85) | Pure-LLM `valueScore` from before the hybrid system. `valueScoreSource: 'derived'` | Re-rate with AI (slow) from the Settings advanced panel. |
| Score doesn't match my read of the video | Working as designed — the model + signals can disagree with you. Calibration phase deferred (ADR 0005) | Tune `FINAL_SCORE_WEIGHTS` in `videos.ts` and re-run the score backfill. |

The Refresh-scores backfill is fast (~50ms per video, no AI). The AI re-rate is slow (5–15s per video, sequential). Bulk AI re-rate runs from `/settings` → Advanced section.

## Symptom: "Address already in use" on `:1350` or `:3015`

Orphan processes from a previous run. `start.sh` already handles this; if you're running `yarn dev` directly:

```bash
lsof -ti :1350 -ti :3015 | xargs kill -9
```

Then re-run.

## Symptom: Strapi DB is corrupted / unreadable

Usually from `yarn seed` against a live Strapi instance, or a hard kill mid-write.

**Recover (in order of escalation):**

1. **Stop everything.** `pkill -f strapi` and `pkill -f vite`.
2. **Try the WAL recovery.** Strapi uses `better-sqlite3`; the journal might recover on next open. Just restart `yarn server` and watch the logs.
3. **Restore from seed.** If you have `server/seed-data/seed.tar.gz` from a known-good state:
   ```bash
   rm server/.tmp/data.db
   yarn seed
   ```
   This wipes and reimports.
4. **Nuclear.** `rm server/.tmp/data.db` and start fresh (loses all data).

To **avoid** this in the future: `yarn seed` only runs **before** starting Strapi.

## Maintenance: rotating Strapi secrets

The six secrets in `server/.env` (`APP_KEYS`, `API_TOKEN_SALT`, `ADMIN_JWT_SECRET`, `TRANSFER_TOKEN_SALT`, `ENCRYPTION_KEY`, `JWT_SECRET`) are placeholder values from `setup`. **Regenerate before any non-local deploy.**

```bash
openssl rand -base64 16                       # one value
```

For `APP_KEYS`, generate four and comma-separate. After rotating: existing API tokens remain valid (they're hashed with the salt at issue time), but admin sessions are invalidated. Stored field-encrypted data becomes unreadable if you change `ENCRYPTION_KEY` after data was written (probably no impact for this app — Strapi's field encryption isn't used by our schemas).

## Maintenance: capturing your library as a seed

```bash
yarn export                                   # writes server/seed-data/seed.tar.gz
git add server/seed-data/seed.tar.gz
git commit
```

The export is **unencrypted** (`--no-encrypt`) so it's git-diffable. **Don't commit a real personal library** — the file contains every transcript, every note, and every chat-derived note title.

`yarn seed` replaces matching collections — it's a wipe-and-reimport, not a merge.

## Local SQLite ↔ Neon

The app deliberately runs **two independent databases**, picked by `NODE_ENV` in `server/config/database.ts`:

- **`strapi develop`** (NODE_ENV=development) → a local **SQLite** file (`server/.tmp/music-kb.db`, override with `DATABASE_FILENAME`). Offline, never touches the cloud.
- **`strapi start`** (NODE_ENV=production) → **Neon Postgres** (the `DATABASE_*` env vars).

This is **not** sync — there's no per-row merge. Data moves between the two only when you run an export/import, and **import wipes the destination first** (whole-DB, last-writer-wins). So work in one place at a time and propagate deliberately:

```bash
# Back up either database to server/exports/ (timestamped, unencrypted)
yarn db:dump:local            # dumps the dev SQLite
yarn db:dump:neon             # dumps Neon (boots Strapi in prod mode)

# Load a dump INTO a database (DESTRUCTIVE — wipes the target first).
# Stop the app first. Path is relative to server/.
yarn db:load:neon exports/local-20260601-101500.tar.gz    # push dev work up to Neon
yarn db:load:local exports/neon-20260601-101500.tar.gz    # seed local dev from Neon
```

Notes:
- Dev opens the existing `server/.tmp/music-kb.db` if present (your prior local data). To refresh it from Neon, run `yarn db:dump:neon` then `yarn db:load:local <file>`.
- Exports are engine-agnostic (logical data, not a SQL dump), so SQLite ↔ Postgres round-trips cleanly, and they include media files + schema.
- They're **unencrypted** and contain everything — don't commit or share them (`server/exports/` is git-ignored).
- `strapi transfer` (instance→instance over HTTP, needs a running destination + transfer token) is an alternative to the file dance; the export/import flow above is simpler for a single machine.

## Maintenance: periodic local backups

`./db-backup.sh` (repo root) takes a consistent snapshot of the dev SQLite
into `backups/sqlite/` — safe while the app runs (SQLite online `.backup`
API) — and prunes snapshots older than 14 days (`KEEP` env to override).
`./db-backup.sh --push` additionally mirrors local data up to Neon
(destructive to Neon; pre-dumps it to `backups/neon/` first; needs the
stack stopped).

To run the snapshot daily at 09:00 via launchd:

```bash
cp scripts/com.music-kb.db-backup.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.music-kb.db-backup.plist
```

Logs land in `~/Library/Logs/music-kb-backup.log`.

## Performance tuning

### Ollama

| Setting | Default | Bump when |
|---|---|---|
| `OLLAMA_KEEP_ALIVE` | `5m` (Ollama default), `15m` after `yarn start` | The model takes >10s to "wake up" between summaries — bump to `30m` or `60m` so it stays warm across batches. |
| `OLLAMA_NUM_PARALLEL` | `1` (Ollama 0.20+) | You have RAM headroom and want concurrent inference. Each parallel slot keeps a copy of the KV cache — a 4B model at NUM_PARALLEL=2 is ~6 GB. **Must match `MAP_CONCURRENCY`.** |
| `MAP_CONCURRENCY` (client env) | `1` | Same as above. Map-reduce summary chunks run in parallel; cap = `NUM_PARALLEL`. |

After changing `NUM_PARALLEL`: `yarn start:fresh` to actually restart Ollama.

### RAM ceiling

Per the user's machine: 24 GB RAM. Practical model size ceilings:

- **<19 GB** model is fine, comfortable headroom.
- **15–18 GB** borderline — works, but other apps will swap.
- **≥19 GB** thrashes — choose a smaller model or quantization.

`gemma4-kb:latest` (Q4 4B) is ~3 GB plus KV cache — comfortable. Stepping up to `gemma3:8b` or `qwen2.5:14b` is fine; `:32b` is not.

### Long video timeouts

The pending screen polls for 10 minutes (200 × 3s). Beyond that, polling stops and the user has to manually refresh / hit Force retry. If you're regularly summarizing 1+ hour videos and hitting the cap:

- Bump `MAP_CONCURRENCY` (and `OLLAMA_NUM_PARALLEL`).
- Reduce the chunk window (currently 2500 words) — more chunks but each finishes faster.
- Use a faster model.

## Maintenance: log inspection

| What | Where |
|---|---|
| Ollama server log | `/tmp/ollama.log` (when started via `nohup ollama serve`). Menubar app: Console.app → search "Ollama". |
| Strapi log | Terminal running `yarn server`. No file logging configured. |
| Client server-fn logs | Terminal running `yarn client`. `learning.ts` is verbose with timing per step. |
| Browser console | Standard. The strapi-client's `logFailure` puts every non-OK Strapi response here. |

## When in doubt

```bash
# Full restart, kills orphans, restarts Ollama, fresh start
pkill -9 ollama
lsof -ti :1350 -ti :3015 | xargs kill -9
yarn start:fresh
```

If that doesn't recover the symptom, check the corresponding section above — the failure has a specific cause and the runbook should cover it. If it doesn't, that's a gap in this doc — note it and add a section.
