import { useState } from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { type StrapiVideo, type WatchVerdict } from '#/lib/services/videos';
import {
  regenerateSummary,
  regenerateVideoSignals,
} from '#/data/server-functions/videos';
import { MATCH_TIER_LABEL, type MatchTier } from '#/lib/services/embeddings';

const VERDICT_META: Record<
  WatchVerdict,
  { label: string; className: string }
> = {
  worth_it: {
    label: 'Worth watching',
    className:
      'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  skim: {
    label: 'Skim it',
    className:
      'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  skip: {
    label: 'Skip',
    className:
      'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]',
  },
};

function VerdictBlock({ video }: Readonly<{ video: StrapiVideo }>) {
  // Pending generation: render a faint placeholder so the card body
  // doesn't collapse into empty space below the caption while the LLM
  // works. Cheap visual anchor — disappears the moment the verdict
  // lands and the real chips render.
  if (video.summaryStatus === 'pending') {
    return (
      <div
        className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] bg-[var(--bg-subtle)]/50 px-3 py-2"
        aria-hidden="true"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" />
        <span className="text-xs italic text-[var(--ink-muted)]">
          Verdict &amp; score appear here once the summary lands.
        </span>
      </div>
    );
  }
  if (!video.watchVerdict || !video.verdictSummary) return null;
  const meta = VERDICT_META[video.watchVerdict];
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${meta.className}`}
        >
          {meta.label}
        </span>
        <ContentScoreChip video={video} />
      </div>
      <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
        {video.verdictSummary}
      </p>
    </div>
  );
}

// Color band for the signal score. Programmatic, deterministic, no
// LLM — these thresholds map directly to the rubric defined in
// `content-signals.ts`. Tuned to match the watchVerdict bands so the
// chip's color reinforces the verdict badge without being identical
// (the verdict badge is the LLM's call; this is the programmatic one).
// Exported: the learn page's chip shares these tiers so the two chips
// read identically (value-score-ui-followups item 3).
export function scoreColorClass(score: number): string {
  if (score >= 70) return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (score >= 50) return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400';
  if (score >= 30) return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  return 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]';
}

// Renders the hybrid `finalScore` (LLM judgment + programmatic signals
// blended). When finalScore is null (older row that hasn't been
// backfilled), falls back to a "Generate score" button that runs the
// per-video signal regen — which writes signalScore AND recomputes
// finalScore, so one click populates the chip.
function ContentScoreChip({ video }: Readonly<{ video: StrapiVideo }>) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await regenerateVideoSignals({
        data: { videoId: video.youtubeVideoId },
      });
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setGenerating(false);
    }
  };

  if (typeof video.finalScore === 'number') {
    return (
      <span
        className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${scoreColorClass(video.finalScore)}`}
        title="Content score (0–100). Hybrid blend: 60% programmatic signals + 40% LLM judgment."
        aria-label={`Content score: ${video.finalScore} out of 100`}
      >
        <span>Content score</span>
        <span className="font-bold">{video.finalScore}</span>
      </span>
    );
  }

  // Score missing — usually a pre-backfill row. Quiet em-dash chip
  // instead of a button-styled CTA so it doesn't fight for attention
  // with real score chips on neighbouring cards. Still clickable to
  // trigger a per-card recompute. Bulk path lives in Settings.
  return (
    <button
      type="button"
      onClick={handleGenerate}
      disabled={generating}
      className="ml-auto inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--line)] bg-transparent px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:opacity-60"
      title={
        error
          ? error
          : 'No content score yet. Click to compute, or run a bulk backfill from Settings.'
      }
    >
      <span>Score</span>
      <span aria-hidden="true">{generating ? '…' : '—'}</span>
    </button>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function SummaryStatusBadge({ video }: Readonly<{ video: StrapiVideo }>) {
  if (video.summaryStatus === 'generated') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
        Summary ready
      </span>
    );
  }
  if (video.summaryStatus === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-destructive">
        Summary failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" />
      Generating…
    </span>
  );
}

const MATCH_TIER_CLASS: Record<MatchTier, string> = {
  top: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  strong: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
  good: 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]',
  related: 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]',
};

function MatchTierChip({ tier }: Readonly<{ tier: MatchTier }>) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.65rem] font-medium ${MATCH_TIER_CLASS[tier]}`}
    >
      {MATCH_TIER_LABEL[tier]}
    </span>
  );
}

function TagChips({ video }: Readonly<{ video: StrapiVideo }>) {
  if (!video.tags || video.tags.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {video.tags.map((t) => (
        <Link
          key={t.id}
          to="/feed"
          search={{ tag: t.slug }}
          className="inline-flex items-center rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          #{t.name}
        </Link>
      ))}
    </div>
  );
}

type VideoCardProps = {
  video: StrapiVideo;
  // Selection mode — when set, renders a checkbox overlay. All four are
  // optional so the component stays a drop-in for non-selection contexts.
  selectable?: boolean;
  selected?: boolean;
  eligible?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  // Match tier for semantic/hybrid search contexts. Replaces the raw
  // "% similar" chip with a rank-tier label ("Top match", "Strong match",
  // etc.). Undefined in non-search contexts.
  matchTier?: MatchTier;
};

export function VideoCard({
  video,
  selectable = false,
  selected = false,
  eligible = true,
  disabled = false,
  onToggle,
  matchTier,
}: Readonly<VideoCardProps>) {
  const src = `https://www.youtube-nocookie.com/embed/${video.youtubeVideoId}`;
  const pickable = selectable && eligible && !disabled;
  const mutedForSelection = selectable && !eligible;
  const selectTooltip = !eligible
    ? 'Needs a summary first'
    : disabled
      ? 'Max 5 per digest'
      : selected
        ? 'Click to deselect'
        : 'Add to digest';
  return (
    <article
      className={`rise-in relative overflow-hidden rounded-2xl border bg-[var(--card)] transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(9,9,11,0.04),0_12px_32px_rgba(9,9,11,0.06)] ${
        selected
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30'
          : 'border-[var(--line)]'
      } ${mutedForSelection ? 'opacity-60' : ''}`}
    >
      <header className="flex items-center gap-3 px-5 pt-5">
        <div className="flex flex-1 flex-col leading-tight">
          <span className="text-xs text-[var(--ink-muted)]">
            Added {relativeTime(video.createdAt)}
          </span>
        </div>
        {matchTier && <MatchTierChip tier={matchTier} />}
        <SummaryStatusBadge video={video} />
        {selectable && (
          <button
            type="button"
            onClick={pickable ? onToggle : undefined}
            disabled={!pickable}
            aria-label={selectTooltip}
            title={selectTooltip}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition ${
              selected
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--line)] bg-[var(--card)]'
            } ${pickable ? 'cursor-pointer hover:border-[var(--line-strong)]' : 'cursor-not-allowed opacity-50'}`}
          >
            {selected && (
              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M6.5 11.5L3 8l1.4-1.4L6.5 8.7l5.1-5.1L13 5z"
                />
              </svg>
            )}
          </button>
        )}
      </header>

      <div className="mt-4 aspect-video w-full overflow-hidden bg-black">
        <iframe
          src={src}
          title={video.videoTitle ?? 'YouTube video'}
          loading="lazy"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full border-0"
        />
      </div>

      <div className="grid gap-1.5 px-5 py-4">
        {video.videoTitle && (
          <h3 className="text-base font-semibold leading-snug tracking-tight text-[var(--ink)]">
            {video.videoTitle}
          </h3>
        )}
        {video.videoAuthor && (
          <p className="text-xs text-[var(--ink-muted)]">{video.videoAuthor}</p>
        )}
        {video.caption && (
          <p className="mt-1 text-sm leading-relaxed text-[var(--ink-soft)]">{video.caption}</p>
        )}
        <VerdictBlock video={video} />
        <TagChips video={video} />
      </div>

      <div className="flex items-center justify-between gap-1 border-t border-[var(--line)] px-3 py-2">
        <RegenerateOnCard video={video} />
        <Link
          to="/learn/$videoId"
          params={{ videoId: video.youtubeVideoId }}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 1a5 5 0 0 0-3 9v1.5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 .5-.5V10a5 5 0 0 0-3-9zm-2 13.5V13h4v1.5a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5z"
            />
          </svg>
          Open summary
        </Link>
      </div>
    </article>
  );
}

// Lightweight regenerate control — skips the full GenerationModeSelect UX
// used on the learn page. Confirms, kicks off a run in `auto` mode, and
// refreshes the feed so the status badge flips to "Generating…".
// Hidden while the summary is still pending to avoid double-triggering.
function RegenerateOnCard({ video }: Readonly<{ video: StrapiVideo }>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (video.summaryStatus === 'pending') return <span />;

  const label =
    video.summaryStatus === 'failed' ? 'Retry generation' : 'Regenerate';

  const onClick = async () => {
    if (running) return;
    if (
      !globalThis.confirm(
        'Regenerate the summary? Old content stays if regeneration fails, and is replaced on success.',
      )
    ) {
      return;
    }
    setRunning(true);
    setMsg(null);
    try {
      const result = await regenerateSummary({
        data: { videoId: video.youtubeVideoId },
      });
      if (result.status === 'error') {
        setMsg(result.error);
        return;
      }
      if (result.status === 'already_running') {
        setMsg('Already running');
        return;
      }
      await router.invalidate();
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={running}
      title={msg ?? label}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)] disabled:opacity-50"
    >
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <path
          fill="currentColor"
          d="M13 8a5 5 0 1 1-1.46-3.54L13 3v4H9l1.54-1.54A3.5 3.5 0 1 0 11.5 8z"
        />
      </svg>
      {running ? 'Starting…' : label}
    </button>
  );
}
