import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import {
  backfillFinalScores,
  backfillSignalScores,
  countMissingFinalScores,
  countMissingSignalScores,
  listRegenerableVideos,
  regenerateVideoVerdict,
} from '#/data/server-functions/videos';

// One unified panel for content scoring. Two paths, clearly separated by
// speed/cost so the user can choose:
//
//   PRIMARY: Refresh content scores — fast, deterministic. Runs the
//            signal pipeline (filler/lexical/etc) and recomputes the
//            hybrid finalScore for every row that needs it. Few
//            seconds for a typical library. This is the button you
//            want 90% of the time.
//
//   SECONDARY: Re-rate with AI — slow. Runs Ollama on every video's
//              transcript to refresh the LLM verdict (watchVerdict +
//              valueScore + verdictSummary + verdictReason). ~5–15s
//              per video, sequential. Only useful when the rubric
//              prompt has changed or you want to refresh stale
//              judgements at scale. Per-video AI re-rate is
//              available on the Learn page.
//
// Earlier iterations of this panel exposed signal-only and final-only
// backfills as separate buttons; merging them into one "Refresh"
// action because the two operations are conceptually one thing —
// "make sure the score for every video reflects current data."
export function ContentSignalsPanel() {
  const router = useRouter();

  const [missing, setMissing] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const [aiState, setAiState] = useState<
    | { kind: 'idle' }
    | { kind: 'running'; current: number; total: number; lastVideo: string | null }
    | { kind: 'done'; ok: number; failed: number; total: number }
    | { kind: 'cancelled'; ok: number; failed: number; total: number }
  >({ kind: 'idle' });
  // Ref, not state: the running loop's closure captures a state value once
  // and never sees the Cancel click — with useState the button did nothing.
  const aiCancelRequested = useRef(false);
  const [aiCancelPending, setAiCancelPending] = useState(false);
  const [aiVisible, setAiVisible] = useState(false);

  const refresh = async () => {
    // "Missing" = at least one of the two inputs to finalScore is
    // unfilled. After clicking Refresh, the count drops to 0.
    const [s, f] = await Promise.all([
      countMissingSignalScores(),
      countMissingFinalScores(),
    ]);
    setMissing((s.missing ?? 0) + (f.missing ?? 0));
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const sig = await backfillSignalScores();
      const fin = await backfillFinalScores();
      const parts: string[] = [];
      if (sig.updated > 0) {
        parts.push(`${sig.updated} signal${sig.updated === 1 ? '' : 's'}`);
      }
      if (fin.updated > 0) {
        parts.push(`${fin.updated} final score${fin.updated === 1 ? '' : 's'}`);
      }
      setRefreshMessage(
        parts.length === 0
          ? 'Nothing to update — every video already has scores.'
          : `Updated ${parts.join(' + ')}.`,
      );
      await refresh();
      await router.invalidate();
    } catch (err) {
      setRefreshMessage(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAiRegenerate = async () => {
    if (aiState.kind === 'running') return;
    aiCancelRequested.current = false;
    setAiCancelPending(false);
    const videos = await listRegenerableVideos();
    const total = videos.length;
    if (total === 0) {
      setAiState({ kind: 'done', ok: 0, failed: 0, total: 0 });
      return;
    }
    let ok = 0;
    let failed = 0;
    setAiState({ kind: 'running', current: 0, total, lastVideo: null });
    for (let i = 0; i < videos.length; i += 1) {
      if (aiCancelRequested.current) {
        setAiState({ kind: 'cancelled', ok, failed, total });
        return;
      }
      const v = videos[i];
      setAiState({
        kind: 'running',
        current: i + 1,
        total,
        lastVideo: v.videoTitle ?? v.videoId,
      });
      try {
        const result = await regenerateVideoVerdict({
          data: { videoId: v.videoId },
        });
        if (result.status === 'ok') ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setAiState({ kind: 'done', ok, failed, total });
    await refresh();
    await router.invalidate();
  };

  const aiRunning = aiState.kind === 'running';

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <header className="mb-3">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Content scores
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Each video has a single 0–100 <strong>Content score</strong> shown
          on cards and the Learn page. It&apos;s a blend of programmatic signals
          (filler density, lexical density, sponsor presence, etc.) and the
          model&apos;s own &ldquo;is this worth your time&rdquo; judgement.
          New videos get a score automatically when their summary generates.
        </p>
      </header>

      {/* Primary action — fast deterministic refresh. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
        <div className="flex-1 text-sm">
          <p className="font-medium text-[var(--ink)]">
            Refresh content scores
          </p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Recomputes scores for every video that&apos;s missing one. Fast
            (~50ms per video), no AI calls.
          </p>
          {missing === null && (
            <p className="mt-1 text-xs italic text-[var(--ink-muted)]">
              Checking library…
            </p>
          )}
          {missing !== null && missing > 0 && (
            <p className="mt-1 text-xs text-[var(--ink)]">
              <strong>{missing}</strong> video
              {missing === 1 ? '' : 's'} need{missing === 1 ? 's' : ''} updating.
            </p>
          )}
          {missing === 0 && (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              All videos have current scores.
            </p>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing || missing === 0 || missing === null}
        >
          {refreshing ? 'Refreshing…' : 'Refresh scores'}
        </Button>
      </div>
      {refreshMessage && (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">{refreshMessage}</p>
      )}

      {/* Secondary action — slow AI re-rate, hidden behind a toggle so it
          doesn't compete for attention with the primary path. */}
      <div className="mt-4">
        {!aiVisible && aiState.kind === 'idle' ? (
          <button
            type="button"
            onClick={() => setAiVisible(true)}
            className="text-xs text-[var(--ink-muted)] underline-offset-2 hover:underline hover:text-[var(--ink)]"
          >
            Advanced: re-rate every video with AI (slow)…
          </button>
        ) : (
          <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 text-sm">
                <p className="font-medium text-[var(--ink)]">
                  Re-rate every video with AI
                </p>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  Runs Ollama on every video&apos;s cached transcript to refresh
                  the LLM verdict. ~5–15s per video, sequential. Only useful
                  when the rubric prompt has changed or you want to refresh
                  stale judgements at scale.
                </p>
                {aiState.kind === 'running' && (
                  <p className="mt-1 text-xs text-[var(--ink)]">
                    {aiState.current} / {aiState.total} —{' '}
                    {aiState.lastVideo ? (
                      <span className="text-[var(--ink-muted)]">
                        {aiState.lastVideo}
                      </span>
                    ) : null}
                  </p>
                )}
                {aiState.kind === 'done' && (
                  <p className="mt-1 text-xs text-[var(--ink)]">
                    Done. <strong>{aiState.ok}</strong> updated,{' '}
                    <strong>{aiState.failed}</strong> failed of {aiState.total}.
                  </p>
                )}
                {aiState.kind === 'cancelled' && (
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    Cancelled. {aiState.ok} updated, {aiState.failed} failed
                    before stop.
                  </p>
                )}
              </div>
              {aiRunning ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    aiCancelRequested.current = true;
                    setAiCancelPending(true);
                  }}
                  disabled={aiCancelPending}
                >
                  {aiCancelPending ? 'Stopping…' : 'Cancel'}
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleAiRegenerate()}
                >
                  Re-rate with AI
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
