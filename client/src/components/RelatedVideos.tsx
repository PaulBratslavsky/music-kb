import { useEffect, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  relatedVideos,
  type RelatedVideo,
  type RelatedVideosResult,
} from '#/data/server-functions/videos';
import {
  DIGEST_MAX_VIDEOS,
  DIGEST_MIN_VIDEOS,
} from '#/lib/services/digest';
import {
  getMatchTier,
  MATCH_TIER_LABEL,
  type MatchTier,
} from '#/lib/services/embeddings';
import { Button } from '#/components/ui/button';

type Props = {
  videoId: string;
  limit?: number;
};

// Semantic-neighbor block below the summary. Silently absent when the
// target has no embedding yet, or when nothing clears the similarity
// threshold. When present, doubles as a digest seeder: top two neighbors
// are pre-selected and the header button jumps straight to /digest.
export function RelatedVideos({ videoId, limit = 6 }: Readonly<Props>) {
  const navigate = useNavigate();
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; results: RelatedVideo[] }
    | { kind: 'hidden' }
  >({ kind: 'loading' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res: RelatedVideosResult = await relatedVideos({
        data: { videoId, limit },
      });
      if (cancelled) return;
      if (res.status !== 'ok' || res.results.length === 0) {
        setState({ kind: 'hidden' });
        return;
      }
      setState({ kind: 'ready', results: res.results });
      // Seed selection with the top two neighbors so the "Create digest"
      // button is immediately actionable (current + 2 = 3, well above
      // DIGEST_MIN_VIDEOS). User can still uncheck them.
      const seed = res.results
        .slice(0, Math.min(2, DIGEST_MAX_VIDEOS - 1))
        .map((r) => r.youtubeVideoId);
      setSelected(new Set(seed));
    })();
    return () => {
      cancelled = true;
    };
  }, [videoId, limit]);

  if (state.kind !== 'ready') return null;

  const totalCount = 1 + selected.size; // the current video is always included
  const atCap = selected.size >= DIGEST_MAX_VIDEOS - 1;
  const canCreate =
    totalCount >= DIGEST_MIN_VIDEOS && totalCount <= DIGEST_MAX_VIDEOS;

  const toggle = (ytId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ytId)) {
        next.delete(ytId);
      } else if (next.size < DIGEST_MAX_VIDEOS - 1) {
        next.add(ytId);
      }
      return next;
    });
  };

  const createDigest = () => {
    if (!canCreate) return;
    const ids = [videoId, ...Array.from(selected)];
    navigate({
      to: '/digest',
      search: { videos: ids.join(',') },
    });
  };

  return (
    <section className="mt-16 border-t border-[var(--line)] pt-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Related videos
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Semantically closest in your library. Toggle checkboxes to tune
            the digest selection.
          </p>
        </div>
        <Button
          size="pill"
          variant="outline"
          onClick={createDigest}
          disabled={!canCreate}
          title={
            canCreate
              ? undefined
              : selected.size === 0
                ? 'Select at least one neighbor'
                : 'Too many selected'
          }
        >
          Create digest ({totalCount})
        </Button>
      </header>
      <div className="grid gap-4 sm:grid-cols-2">
        {state.results.map((r, i) => (
          <RelatedCard
            key={r.documentId}
            item={r}
            tier={getMatchTier(i, r.score)}
            selected={selected.has(r.youtubeVideoId)}
            onToggle={() => toggle(r.youtubeVideoId)}
            disabled={atCap && !selected.has(r.youtubeVideoId)}
          />
        ))}
      </div>
    </section>
  );
}

function RelatedCard({
  item,
  tier,
  selected,
  onToggle,
  disabled,
}: Readonly<{
  item: RelatedVideo;
  tier: MatchTier;
  selected: boolean;
  onToggle: () => void;
  disabled: boolean;
}>) {
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border transition ${
        selected
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30'
          : 'border-[var(--line)] hover:border-[var(--line-strong)]'
      } bg-[var(--card)]`}
    >
      {/* Selection checkbox overlays the thumbnail corner. Intercepts clicks
          so they don't bubble to the underlying thumbnail link. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!disabled || selected) onToggle();
        }}
        disabled={disabled && !selected}
        aria-pressed={selected}
        aria-label={
          disabled && !selected
            ? `Cannot select — digest capped at ${DIGEST_MAX_VIDEOS} videos`
            : selected
              ? 'Deselect from digest'
              : 'Add to digest'
        }
        title={
          disabled && !selected
            ? `Max ${DIGEST_MAX_VIDEOS} per digest`
            : selected
              ? 'Click to deselect'
              : 'Add to digest'
        }
        className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 transition ${
          selected
            ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
            : 'border-[var(--line)] bg-[var(--card)]/90'
        } ${disabled && !selected ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-[var(--line-strong)]'}`}
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

      <Link
        to="/learn/$videoId"
        params={{ videoId: item.youtubeVideoId }}
        className="flex flex-col no-underline"
      >
        {item.videoThumbnailUrl ? (
          <div className="aspect-video w-full overflow-hidden bg-[var(--bg-subtle)]">
            <img
              src={item.videoThumbnailUrl}
              alt={item.videoTitle ?? item.youtubeVideoId}
              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            />
          </div>
        ) : (
          <span
            aria-hidden="true"
            className="aspect-video w-full bg-[var(--bg-subtle)]"
          />
        )}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-[var(--ink)] transition group-hover:text-[var(--accent)]">
            {item.videoTitle ?? item.youtubeVideoId}
          </h3>
          <div className="mt-auto flex items-center justify-between gap-2 text-[0.65rem] text-[var(--ink-muted)]">
            <span className="truncate">{item.videoAuthor ?? '—'}</span>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${
                tier === 'top' || tier === 'strong'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-[var(--line)] bg-[var(--bg-subtle)]'
              }`}
            >
              {MATCH_TIER_LABEL[tier]}
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}
