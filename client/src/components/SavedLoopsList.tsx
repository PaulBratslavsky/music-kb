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
  updateLoop,
} from '#/data/server-functions/loops';
import type { StrapiLoop, StrapiLoopProgression } from '#/lib/services/loops';
import { QUALITY_LABELS } from '#/lib/music/theory/quality-labels';
import type { ChordQuality } from '#/lib/music/types';
import { LoopProgressionView } from '#/components/LoopProgressionView';

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
  // (music-kb fork) Where to navigate when the user clicks a loop.
  // 'learn' (default) goes to /learn/$videoId?view=theory&loopId=...
  // which is the lesson flow with the full LoopBuilder + chat.
  // 'video' goes to /video/$documentId?loopId=... — the music-page
  // flow where /learn doesn't make sense (no transcript / AI summary).
  target = 'learn',
  selectedLoopId,
  onSelectedLoopChange,
}: {
  videoDocumentId: string;
  refreshKey: number;
  target?: 'learn' | 'video';
  /**
   * The loop currently loaded into the player (from `?loopId=`). Its row
   * expands to show that section's own chord progression — the whole point
   * being that chords belong to a section, not to one flat global list.
   */
  selectedLoopId?: string;
  /**
   * The selected loop's current data, pushed up whenever it changes. The
   * chord strip under the player renders from this — without it the strip
   * kept a stale copy fetched at navigation time and showed "no
   * progression" immediately after one was linked here.
   */
  onSelectedLoopChange?: (loop: StrapiLoop | null) => void;
}) {
  const [loops, setLoops] = useState<StrapiLoop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Inline rename: the row being renamed + its draft label.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const startRename = (loop: StrapiLoop) => {
    setRenamingId(loop.documentId);
    setRenameValue(loop.label);
  };

  const commitRename = async (loop: StrapiLoop) => {
    const label = renameValue.trim();
    setRenamingId(null);
    if (!label || label === loop.label) return;
    // Optimistic — the row is the only thing that changes and a failed
    // write is visible on the next load.
    setLoops((prev) =>
      prev.map((l) => (l.documentId === loop.documentId ? { ...l, label } : l)),
    );
    await updateLoop({ data: { documentId: loop.documentId, label } });
  };

  useEffect(() => {
    if (!onSelectedLoopChange) return;
    onSelectedLoopChange(
      loops.find((l) => l.documentId === selectedLoopId) ?? null,
    );
    // onSelectedLoopChange is a fresh closure each render; including it
    // would re-run this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loops, selectedLoopId]);

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
          // The section's chords come from the linked saved progression —
          // sections reference a progression rather than owning chords.
          const linked = loop.savedProgression ?? null;
          const linkedChords = Array.isArray(linked?.chords) ? linked!.chords : [];
          const chordSummary = linkedChords
            .slice(0, 4)
            .map(
              (c) =>
                `${c.root}${
                  c.quality === 'maj'
                    ? ''
                    : (QUALITY_LABELS[c.quality as ChordQuality] ?? c.quality)
                }`,
            )
            .join(' ');
          const isSelected = selectedLoopId === loop.documentId;
          return (
            <li
              key={loop.documentId}
              className={`rounded-md border bg-[var(--bg-subtle)] px-2.5 py-1.5 text-xs ${
                isSelected
                  ? 'border-[var(--accent)]'
                  : 'border-[var(--line)]'
              }`}
            >
              <div className="flex items-center gap-2">
              {renamingId === loop.documentId ? (
                <>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename(loop)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(loop);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    maxLength={120}
                    aria-label={`Rename ${loop.label}`}
                    className="min-w-0 flex-1 rounded border border-[var(--accent)] bg-[var(--card)] px-1.5 py-0.5 text-xs text-[var(--ink)]"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void commitRename(loop)}
                    className="text-[var(--accent)] hover:underline"
                  >
                    save
                  </button>
                </>
              ) : target === 'video' ? (
                <Link
                  to="/video/$documentId"
                  params={{ documentId: videoDocumentId }}
                  search={{ loopId: loop.documentId }}
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
                  <span className="truncate text-[var(--ink-muted)]">
                    {linkedChords.length === 0
                      ? 'no progression'
                      : `${chordSummary}${linkedChords.length > 4 ? ' …' : ''}`}
                  </span>
                </Link>
              ) : (
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
                <span className="truncate text-[var(--ink-muted)]">
                  {linkedChords.length === 0
                    ? 'no progression'
                    : `${chordSummary}${linkedChords.length > 4 ? ' …' : ''}`}
                </span>
              </Link>
              )}
              {renamingId !== loop.documentId && (
                <button
                  type="button"
                  onClick={() => startRename(loop)}
                  aria-label={`Rename loop ${loop.label}`}
                  title="Rename this section"
                  className="text-[var(--ink-muted)] hover:text-[var(--ink)]"
                >
                  ✎
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleDelete(loop.documentId)}
                aria-label={`Delete loop ${loop.label}`}
                className="text-[var(--ink-muted)] hover:text-destructive"
              >
                ×
              </button>
              </div>

              {/* The selected section opens its own chord progression. */}
              {isSelected && (
                <LoopProgressionView
                  loopDocumentId={loop.documentId}
                  videoDocumentId={videoDocumentId}
                  linked={linked}
                  onLinkChange={(next: StrapiLoopProgression | null) =>
                    setLoops((prev) =>
                      prev.map((l) =>
                        l.documentId === loop.documentId
                          ? { ...l, savedProgression: next }
                          : l,
                      ),
                    )
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
