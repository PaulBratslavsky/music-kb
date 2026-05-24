// SavedLoopsList — right-column list of saved Loops for the current video.
// Sits below LoopControls and above VideoChat. Each row links to
// `/learn/$videoId?view=theory&loopId=<documentId>` which rehydrates:
//   • the player (loopStartSec/loopEndSec/loopActive + seekTo)
//   • the LoopBuilder draft (candidateKey + progression)
//   • the TheoryCompanion's visualizer (scale mode at the saved root)
//
// The list refreshes when `refreshKey` bumps — wired from the Save flow
// so a freshly-saved loop appears immediately without a route reload.

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  listLoopsForVideo,
  deleteLoopFn,
} from '#/data/server-functions/loops';
import type { StrapiLoop } from '#/lib/services/loops';

function formatRange(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const t = Math.max(0, Math.floor(s));
    return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
  };
  return `${fmt(startSec)}–${fmt(endSec)}`;
}

function keyLabel(key: StrapiLoop['key']): string | null {
  if (!key || typeof key !== 'object') return null;
  const root = (key as { root?: string }).root;
  const type = (key as { type?: string }).type;
  if (!root || !type) return null;
  return `${root} ${type}`;
}

export function SavedLoopsList({
  videoDocumentId,
  refreshKey,
}: {
  videoDocumentId: string;
  refreshKey: number;
}) {
  const [loops, setLoops] = useState<StrapiLoop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listLoopsForVideo({ data: { videoDocumentId } })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'error') {
          setError(res.error);
          setLoops([]);
        } else {
          setLoops(res.loops);
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load loops');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoDocumentId, refreshKey]);

  const handleDelete = async (docId: string) => {
    if (!window.confirm('Delete this saved loop?')) return;
    const prev = loops;
    setLoops((rows) => rows.filter((r) => r.documentId !== docId));
    const res = await deleteLoopFn({ data: { documentId: docId } });
    if (res.status === 'error') {
      // Rollback on failure.
      setLoops(prev);
      // eslint-disable-next-line no-alert
      window.alert(`Delete failed: ${res.error}`);
    }
  };

  if (loading) {
    return (
      <div className="border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--ink-muted)] sm:px-6">
        Loading saved loops…
      </div>
    );
  }
  if (error) {
    return (
      <div className="border-t border-[var(--line)] px-4 py-3 text-xs text-destructive sm:px-6">
        {error}
      </div>
    );
  }
  if (loops.length === 0) {
    return (
      <div className="border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--ink-muted)] sm:px-6">
        No saved loops yet. Mark A/B above, find the key on the Theory tab,
        capture a progression, then click <em>Save loop</em>.
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--line)] bg-[var(--card)] px-4 py-3 text-sm sm:px-6">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Saved loops · {loops.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {loops.map((loop) => {
          const key = keyLabel(loop.key);
          const chordCount = Array.isArray(loop.progression)
            ? loop.progression.length
            : 0;
          return (
            <li
              key={loop.documentId}
              className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-1.5 text-xs"
            >
              <Link
                to="/learn/$videoId"
                params={{ videoId: loop.video?.youtubeVideoId ?? '' }}
                search={{ view: 'theory', loopId: loop.documentId }}
                className="flex min-w-0 flex-1 items-center gap-2 no-underline"
              >
                <span className="truncate font-medium text-[var(--ink)]">
                  {loop.label}
                </span>
                <span className="font-mono text-[var(--ink-muted)]">
                  {formatRange(loop.startSec, loop.endSec)}
                </span>
                {key && (
                  <span className="rounded-full border border-[var(--line-strong)] bg-[var(--card)] px-1.5 py-0.5 text-[0.65rem] text-[var(--ink-soft)]">
                    {key}
                  </span>
                )}
                <span className="text-[var(--ink-muted)]">
                  {chordCount} chord{chordCount === 1 ? '' : 's'}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => void handleDelete(loop.documentId)}
                aria-label={`Delete loop ${loop.label}`}
                className="text-[var(--ink-muted)] hover:text-destructive"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
