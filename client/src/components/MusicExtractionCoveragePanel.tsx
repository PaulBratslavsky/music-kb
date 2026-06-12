import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import {
  extractVideoMusic,
  listMusicExtractionCandidates,
} from '#/data/server-functions/videos';

// Bulk music analysis — the AI re-rate pattern from ContentSignalsPanel:
// the loop lives client-side (one extractVideoMusic call per video, ~90s
// each against the local model), so progress is visible and the run is
// cancellable by clicking Cancel or closing the page. Each successful
// extraction also refreshes that video's Tier-1 embedding server-side, so
// no separate reindex pass is needed afterwards.
export function MusicExtractionCoveragePanel() {
  const router = useRouter();

  const [coverage, setCoverage] = useState<{
    total: number;
    pending: number;
  } | null>(null);
  const [runState, setRunState] = useState<
    | { kind: 'idle' }
    | { kind: 'running'; current: number; total: number; lastVideo: string | null }
    | { kind: 'done'; ok: number; failed: number; total: number }
    | { kind: 'cancelled'; ok: number; failed: number; total: number }
  >({ kind: 'idle' });
  // Ref, not state: the running loop must see the click immediately — a
  // state value captured by the loop's closure never updates mid-run.
  const cancelRequested = useRef(false);

  const refresh = async () => {
    const result = await listMusicExtractionCandidates();
    setCoverage({ total: result.total, pending: result.candidates.length });
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleAnalyzeAll = async () => {
    if (runState.kind === 'running') return;
    cancelRequested.current = false;
    const { candidates } = await listMusicExtractionCandidates();
    const total = candidates.length;
    if (total === 0) {
      setRunState({ kind: 'done', ok: 0, failed: 0, total: 0 });
      return;
    }
    let ok = 0;
    let failed = 0;
    setRunState({ kind: 'running', current: 0, total, lastVideo: null });
    for (let i = 0; i < candidates.length; i += 1) {
      if (cancelRequested.current) {
        setRunState({ kind: 'cancelled', ok, failed, total });
        await refresh();
        return;
      }
      const v = candidates[i];
      setRunState({
        kind: 'running',
        current: i + 1,
        total,
        lastVideo: v.videoTitle ?? v.videoId,
      });
      try {
        const result = await extractVideoMusic({ data: { videoId: v.videoId } });
        if (result.status === 'ok') ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setRunState({ kind: 'done', ok, failed, total });
    await refresh();
    await router.invalidate();
  };

  const running = runState.kind === 'running';
  const analyzed =
    coverage === null ? null : coverage.total - coverage.pending;

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Music analysis
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          The AI reads each video&apos;s transcript and extracts the key,
          chords, techniques, and referenced songs. The data shows on each
          video&apos;s Theory tab and feeds cross-video search (&ldquo;videos
          in E minor&rdquo;). New videos are analyzed automatically when
          their summary generates.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
        <div className="flex-1 text-sm">
          <p className="font-medium text-[var(--ink)]">
            Analyze the whole library
          </p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            One local-model pass per video (~1–2 min each), sequential and
            cancellable. Re-embeds each video as it goes, so search picks the
            data up immediately.
          </p>
          {coverage === null && (
            <p className="mt-1 text-xs italic text-[var(--ink-muted)]">
              Checking library…
            </p>
          )}
          {coverage !== null && coverage.pending > 0 && !running && (
            <p className="mt-1 text-xs text-[var(--ink)]">
              <strong>{analyzed}</strong> of <strong>{coverage.total}</strong>{' '}
              videos analyzed — {coverage.pending} to go.
            </p>
          )}
          {coverage !== null && coverage.pending === 0 && (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Every video is analyzed and current.
            </p>
          )}
          {runState.kind === 'running' && (
            <p className="mt-1 text-xs text-[var(--ink)]">
              {runState.current} / {runState.total} —{' '}
              {runState.lastVideo ? (
                <span className="text-[var(--ink-muted)]">
                  {runState.lastVideo}
                </span>
              ) : null}
            </p>
          )}
          {runState.kind === 'done' && (
            <p className="mt-1 text-xs text-[var(--ink)]">
              Done. <strong>{runState.ok}</strong> analyzed,{' '}
              <strong>{runState.failed}</strong> failed of {runState.total}.
            </p>
          )}
          {runState.kind === 'cancelled' && (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Cancelled. {runState.ok} analyzed, {runState.failed} failed
              before stop.
            </p>
          )}
        </div>
        {running ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              cancelRequested.current = true;
            }}
          >
            Cancel
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => void handleAnalyzeAll()}
            disabled={coverage === null || coverage.pending === 0}
          >
            Analyze library
          </Button>
        )}
      </div>
    </section>
  );
}
