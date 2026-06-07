#!/usr/bin/env bash
#
# Periodic local-first backup for music-kb.
#
#   1. Always: a consistent raw SQLite snapshot of the local dev DB. Uses
#      SQLite's online .backup API, so it's safe even while the app holds
#      the file open. → backups/sqlite/music-kb-<stamp>.db
#
#   2. With --push: dump the current Neon DB first (safety net), then push
#      the local SQLite data UP to Neon. The push is a DESTRUCTIVE
#      overwrite — `strapi import` wipes the target before loading — so it
#      only makes sense when Neon is a backup MIRROR of your local data,
#      not a separately-edited prod DB. Needs :1350 free (export/import
#      boot Strapi), so stop the server first. The pre-push Neon dump
#      lands in backups/neon/ so the overwrite is reversible.
#
#   3. Prune snapshots/dumps older than $KEEP days.
#
# Usage:
#   ./db-backup.sh             # snapshot only — safe to cron
#   ./db-backup.sh --push      # snapshot + push local → Neon (overwrites Neon)
#
# Env overrides: SQLITE_DB (path), KEEP (retention days, default 14).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER="$ROOT/server"
SQLITE_DB="${SQLITE_DB:-$SERVER/.tmp/music-kb.db}"
KEEP="${KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
PUSH=0
[ "${1:-}" = "--push" ] && PUSH=1

mkdir -p "$ROOT/backups/sqlite" "$ROOT/backups/neon"

# 1) Raw SQLite snapshot (consistent online backup)
if [ -f "$SQLITE_DB" ]; then
  echo "→ SQLite snapshot…"
  sqlite3 "$SQLITE_DB" ".backup '$ROOT/backups/sqlite/music-kb-$STAMP.db'"
  echo "  backups/sqlite/music-kb-$STAMP.db"
else
  echo "! $SQLITE_DB not found — skipping raw snapshot"
fi

# 2) Optional push to Neon (destructive overwrite, with a safety dump first)
if [ "$PUSH" = "1" ]; then
  if command -v lsof >/dev/null 2>&1 && lsof -ti :1350 >/dev/null 2>&1; then
    echo "✗ Strapi is running on :1350 — stop it before --push (export/import need the port)."
    exit 1
  fi
  cd "$SERVER"
  echo "→ Neon safety dump (before overwrite)…"
  NODE_ENV=production yarn --silent strapi export --no-encrypt --file "../backups/neon/neon-pre-$STAMP"
  echo "→ exporting local SQLite…"
  NODE_ENV=development yarn --silent strapi export --no-encrypt --file "../backups/sqlite/local-$STAMP"
  echo "→ importing into Neon (OVERWRITES cloud data)…"
  NODE_ENV=production yarn --silent strapi import --force --file "../backups/sqlite/local-$STAMP.tar.gz"
  echo "  pushed local → Neon (pre-push Neon dump: backups/neon/neon-pre-$STAMP.tar.gz)"
fi

# 3) Prune old backups
find "$ROOT/backups" -type f \( -name '*.db' -o -name '*.tar.gz' \) -mtime +"$KEEP" -delete 2>/dev/null || true

echo "✓ done ($STAMP)"
