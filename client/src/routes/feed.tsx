import { useEffect, useState } from 'react';
import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import { VideoCard } from '#/components/VideoCard';
import { BackendErrorPanel } from '#/components/BackendErrorPanel';
import { Button } from '#/components/ui/button';
import {
  getFeed,
  semanticSearchVideos,
  type SemanticHit,
} from '#/data/server-functions/videos';
import { getMatchTier } from '#/lib/services/embeddings';
import {
  DIGEST_MAX_VIDEOS,
  DIGEST_MIN_VIDEOS,
} from '#/lib/services/digest';
import type { StrapiVideo } from '#/lib/services/videos';

const FeedSearchSchema = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().max(80).optional(),
  page: z.number().int().min(1).max(1000).optional(),
  mode: z.enum(['keyword', 'semantic']).optional(),
  // 'recent' (createdAt desc, default) | 'score' (signalScore desc).
  // Surfaced as a toggle in the feed header.
  sort: z.enum(['recent', 'score']).optional(),
  // Lower bound on the hybrid Content score (0–100). Surfaced as a
  // 3-way preset chip in the feed header (All / 50+ / 70+). Omit or
  // 0 = no filter; videos with no score are hidden when this is set.
  minScore: z.number().int().min(0).max(100).optional(),
});

type SemanticResultShape = {
  kind: 'semantic';
  hits: SemanticHit[];
  query: string;
};

type KeywordResultShape = {
  kind: 'keyword';
  result: {
    videos: StrapiVideo[];
    total: number;
    page: number;
    pageCount: number;
  };
};

// Backend (Strapi) unreachable or errored. The previous behavior was
// to fall back to an empty result, so the user couldn't tell whether
// the library was empty or the backend was dead. Now surfaced as a
// distinct loader variant.
type BackendErrorShape = {
  kind: 'backend-error';
  error: string;
};

type FeedLoaderData =
  | KeywordResultShape
  | SemanticResultShape
  | BackendErrorShape;

export const Route = createFileRoute('/feed')({
  validateSearch: FeedSearchSchema,
  loaderDeps: ({ search }) => ({
    q: search.q,
    tag: search.tag,
    page: search.page,
    mode: search.mode,
    sort: search.sort,
    minScore: search.minScore,
  }),
  loader: async ({ deps }): Promise<FeedLoaderData> => {
    // Semantic mode requires a query. With no query the mode toggle is
    // irrelevant — fall back to the normal feed listing.
    if (deps.mode === 'semantic' && deps.q) {
      // Pull a deeper window so client-side pagination has rows to page
      // through. Keeps the server work the same (the embed compares
      // against the whole library either way) — just changes the cutoff.
      const res = await semanticSearchVideos({
        data: { query: deps.q, limit: 90 },
      });
      if (res.status === 'ok') {
        // Apply minScore filter client-side for semantic mode. The server
        // doesn't filter by score here — semantic search keys on similarity,
        // and re-running with a Strapi finalScore filter would mean a second
        // round-trip. Cheaper to slice the already-ranked list locally.
        const min = deps.minScore ?? 0;
        const hits =
          min > 0
            ? res.hits.filter(
                (h) =>
                  typeof h.video.finalScore === 'number' &&
                  h.video.finalScore >= min,
              )
            : res.hits;
        return { kind: 'semantic', hits, query: deps.q };
      }
      // On semantic failure (Ollama down, model missing), degrade to keyword.
    }
    const result = await getFeed({
      // 9 per page = clean 3×3 grid on desktop, 9-row stack on mobile.
      data: {
        q: deps.q,
        tag: deps.tag,
        page: deps.page ?? 1,
        pageSize: 9,
        sort: deps.sort ?? 'recent',
        minScore: deps.minScore,
      },
    });
    if (result.error) {
      return { kind: 'backend-error', error: result.error };
    }
    return { kind: 'keyword', result };
  },
  component: FeedPage,
  head: () => ({ meta: [{ title: 'Feed · Music KB' }] }),
});

function FeedPage() {
  const loaderData = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();

  // Backend dead → render the error panel and bail out before any
  // derived state reads `loaderData.result` / `loaderData.hits`. Keep
  // the page header so the user sees where they are; everything below
  // gets replaced by the panel.
  if (loaderData.kind === 'backend-error') {
    return (
      <main className="px-6 pb-28 pt-10 sm:px-10 sm:pt-14 lg:px-14">
        <header className="mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            Knowledge feed
          </span>
        </header>
        <BackendErrorPanel message={loaderData.error} />
      </main>
    );
  }

  // Normalize both shapes (keyword paginated, semantic ranked) into a common
  // list. Keyword mode is paginated server-side via Strapi; semantic mode
  // gets a single deeper-window response that we slice client-side here
  // so the same Pagination component works for both.
  const SEMANTIC_PAGE_SIZE = 9;
  const semanticPage = search.page ?? 1;
  const semanticPageCount =
    loaderData.kind === 'semantic'
      ? Math.max(1, Math.ceil(loaderData.hits.length / SEMANTIC_PAGE_SIZE))
      : 1;
  const semanticHitsForPage =
    loaderData.kind === 'semantic'
      ? loaderData.hits.slice(
          (semanticPage - 1) * SEMANTIC_PAGE_SIZE,
          semanticPage * SEMANTIC_PAGE_SIZE,
        )
      : [];

  const videos =
    loaderData.kind === 'keyword'
      ? loaderData.result.videos
      : semanticHitsForPage.map((h) => h.video);
  // For semantic mode, compute a match tier per hit — derived from rank
  // + score (in the FULL ranked list, not the paged slice — rank should
  // reflect global similarity ordering, not page-local position).
  const tiers =
    loaderData.kind === 'semantic'
      ? new Map(
          loaderData.hits.map(
            (h, rank) =>
              [h.video.documentId, getMatchTier(rank, h.score)] as const,
          ),
        )
      : null;

  // Selection mode is page-local state. Switching tags/search keeps the
  // current selection because the component doesn't remount — only the
  // loader re-runs. Leaving /feed resets everything.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Poll the loader while any card is `pending` so summaries flip to
  // "generated" on the feed without a manual refresh. Only relevant in
  // keyword mode — semantic-search results always have generated summaries
  // (the loader requires it).
  useEffect(() => {
    if (loaderData.kind !== 'keyword') return;
    const anyPending = videos.some((v) => v.summaryStatus === 'pending');
    if (!anyPending) return;
    const id = globalThis.setInterval(() => {
      void router.invalidate();
    }, 3000);
    return () => globalThis.clearInterval(id);
  }, [loaderData.kind, videos, router]);

  // Escape cancels selection mode, matching the intuitive pattern.
  useEffect(() => {
    if (!selectionMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectionMode(false);
        setSelected(new Set());
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [selectionMode]);

  const toggleSelected = (youtubeVideoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(youtubeVideoId)) {
        next.delete(youtubeVideoId);
      } else if (next.size < DIGEST_MAX_VIDEOS) {
        next.add(youtubeVideoId);
      }
      return next;
    });
  };

  const startDigestMode = () => {
    setSelectionMode(true);
    setSelected(new Set());
  };

  const cancelDigestMode = () => {
    setSelectionMode(false);
    setSelected(new Set());
  };

  const submitDigest = () => {
    if (selected.size < DIGEST_MIN_VIDEOS) return;
    navigate({
      to: '/digest',
      search: { videos: Array.from(selected).join(',') },
    });
  };

  return (
    <main className="px-6 pb-28 pt-10 sm:px-10 sm:pt-14 lg:px-14">
      <header className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          Knowledge feed
        </span>
        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <h1 className="display-title max-w-3xl text-[2.75rem] text-[var(--ink)] sm:text-[4rem]">
            Shared videos,
            <br />
            <span className="text-[var(--ink-muted)]">summarized.</span>
          </h1>
          {!selectionMode && videos.length > 0 && (
            <Button
              size="pill"
              variant="outline"
              onClick={startDigestMode}
            >
              Create digest
            </Button>
          )}
        </div>
      </header>

      <SearchBar
        q={search.q ?? ''}
        tag={search.tag}
        mode={search.mode ?? 'keyword'}
      />

      {search.tag && <ActiveTagPill tag={search.tag} />}

      {selectionMode && (
        <div className="mb-5 rounded-xl border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-3 text-sm text-[var(--ink)]">
          Pick 2–{DIGEST_MAX_VIDEOS} videos to digest. Videos without
          summaries can&apos;t be picked.
        </div>
      )}

      {videos.length === 0 ? (
        <EmptyFeed
          q={search.q}
          tag={search.tag}
          mode={loaderData.kind === 'semantic' ? 'semantic' : 'keyword'}
          minScore={search.minScore}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--ink-muted)]">
            {loaderData.kind === 'keyword' ? (
              <>
                <span>
                  {loaderData.result.total}{' '}
                  {loaderData.result.total === 1 ? 'video' : 'videos'}
                </span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <MinScoreFilter current={search.minScore ?? 0} />
                  <SortToggle current={search.sort ?? 'recent'} />
                  <span>
                    Page {loaderData.result.page} of{' '}
                    {Math.max(1, loaderData.result.pageCount)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <span>
                  {loaderData.hits.length} semantic{' '}
                  {loaderData.hits.length === 1 ? 'match' : 'matches'} for
                  &ldquo;{loaderData.query}&rdquo;
                </span>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <MinScoreFilter current={search.minScore ?? 0} />
                  <span>
                    Ranked by similarity · Page {semanticPage} of{' '}
                    {semanticPageCount}
                  </span>
                </div>
              </>
            )}
          </div>
          <section className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => {
              const eligible = video.summaryStatus === 'generated';
              const isSelected = selected.has(video.youtubeVideoId);
              const atCap =
                selected.size >= DIGEST_MAX_VIDEOS && !isSelected;
              const tier = tiers?.get(video.documentId);
              return (
                <VideoCard
                  key={video.documentId}
                  video={video}
                  selectable={selectionMode}
                  selected={isSelected}
                  eligible={eligible}
                  disabled={atCap}
                  onToggle={() => toggleSelected(video.youtubeVideoId)}
                  matchTier={tier}
                />
              );
            })}
          </section>
          {loaderData.kind === 'keyword' ? (
            <Pagination
              currentPage={loaderData.result.page}
              pageCount={loaderData.result.pageCount}
              q={search.q}
              tag={search.tag}
              mode={search.mode}
              sort={search.sort}
              minScore={search.minScore}
            />
          ) : (
            <Pagination
              currentPage={semanticPage}
              pageCount={semanticPageCount}
              q={search.q}
              tag={search.tag}
              mode="semantic"
              sort={search.sort}
              minScore={search.minScore}
            />
          )}
        </>
      )}

      {selectionMode && (
        <DigestSelectionBar
          count={selected.size}
          onCancel={cancelDigestMode}
          onSubmit={submitDigest}
        />
      )}
    </main>
  );
}

function DigestSelectionBar({
  count,
  onCancel,
  onSubmit,
}: Readonly<{
  count: number;
  onCancel: () => void;
  onSubmit: () => void;
}>) {
  const canSubmit = count >= DIGEST_MIN_VIDEOS;
  return (
    <div
      role="toolbar"
      aria-label="Digest selection"
      className="fixed inset-x-0 bottom-6 z-20 mx-auto flex w-[min(92vw,600px)] items-center justify-between gap-3 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 py-2.5 shadow-[0_8px_24px_rgba(9,9,11,0.12)]"
    >
      <div className="flex items-center gap-2 text-sm text-[var(--ink)]">
        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--accent)] px-2 text-xs font-semibold text-white">
          {count}
        </span>
        <span className="text-[var(--ink-muted)]">
          of {DIGEST_MAX_VIDEOS} selected
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSubmit} disabled={!canSubmit}>
          Create digest →
        </Button>
      </div>
    </div>
  );
}

function SearchBar({
  q,
  tag,
  mode,
}: Readonly<{ q: string; tag?: string; mode: 'keyword' | 'semantic' }>) {
  return (
    <form method="get" action="/feed" className="mb-6 grid gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={
            mode === 'semantic'
              ? 'Describe what you\'re looking for…'
              : 'Search titles, channels, captions…'
          }
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none"
        />
        {tag && <input type="hidden" name="tag" value={tag} />}
        <Button type="submit" size="pill">
          Search
        </Button>
      </div>
      <SearchModeToggle mode={mode} />
    </form>
  );
}

function SearchModeToggle({ mode }: Readonly<{ mode: 'keyword' | 'semantic' }>) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ink-muted)]">
      <span>Mode:</span>
      <label className="inline-flex cursor-pointer items-center gap-1">
        <input
          type="radio"
          name="mode"
          value="keyword"
          defaultChecked={mode === 'keyword'}
          className="accent-[var(--accent)]"
        />
        <span>Keyword</span>
      </label>
      <label className="inline-flex cursor-pointer items-center gap-1">
        <input
          type="radio"
          name="mode"
          value="semantic"
          defaultChecked={mode === 'semantic'}
          className="accent-[var(--accent)]"
        />
        <span>
          Semantic{' '}
          <span className="text-[var(--ink-muted)]">
            (embeddings · meaning-based)
          </span>
        </span>
      </label>
    </div>
  );
}

function ActiveTagPill({ tag }: Readonly<{ tag: string }>) {
  return (
    <div className="mb-5 flex items-center gap-2 text-sm text-[var(--ink-muted)]">
      Filtered by
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1 text-xs font-medium text-[var(--ink)]">
        #{tag}
        <Link
          to="/feed"
          search={{}}
          aria-label="Clear tag filter"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--line)]"
        >
          ×
        </Link>
      </span>
    </div>
  );
}

function Pagination({
  currentPage,
  pageCount,
  q,
  tag,
  mode,
  sort,
  minScore,
}: Readonly<{
  currentPage: number;
  pageCount: number;
  q?: string;
  tag?: string;
  mode?: 'keyword' | 'semantic';
  sort?: 'recent' | 'score';
  minScore?: number;
}>) {
  if (pageCount <= 1) return null;
  const prev = Math.max(1, currentPage - 1);
  const next = Math.min(pageCount, currentPage + 1);

  // Preserve every URL-state knob across page changes. Previously this
  // dropped `mode` and `sort`, which silently reset the user's filter
  // when they hit Next.
  const baseSearch = { q, tag, mode, sort, minScore };

  return (
    <nav className="mt-10 flex items-center justify-center gap-3" aria-label="Pagination">
      <Button asChild size="pill" variant="outline" disabled={currentPage === 1}>
        <Link to="/feed" search={{ ...baseSearch, page: prev }}>
          ← Prev
        </Link>
      </Button>
      <span className="text-sm font-medium text-[var(--ink-muted)]">
        {currentPage} / {pageCount}
      </span>
      <Button asChild size="pill" variant="outline" disabled={currentPage === pageCount}>
        <Link to="/feed" search={{ ...baseSearch, page: next }}>
          Next →
        </Link>
      </Button>
    </nav>
  );
}

function EmptyFeed({
  q,
  tag,
  mode,
  minScore,
}: Readonly<{
  q?: string;
  tag?: string;
  mode: 'keyword' | 'semantic';
  minScore?: number;
}>) {
  const scoreFiltered = typeof minScore === 'number' && minScore > 0;
  const filtered = Boolean(q || tag) || scoreFiltered;
  const semanticEmpty = mode === 'semantic' && Boolean(q);
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--card)] p-10 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
        {filtered ? 'No matches' : 'Nothing here yet'}
      </p>
      <h2 className="display-title mt-2 text-3xl text-[var(--ink)]">
        {filtered ? 'Try a different search.' : 'Share the first video.'}
      </h2>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">
        {semanticEmpty
          ? 'Nothing in the library clears the similarity threshold. Try different wording, or switch to keyword mode.'
          : scoreFiltered && !q && !tag
            ? `No videos scoring at least ${minScore}. Lower the threshold or add more videos.`
            : filtered
              ? 'Or clear the filter to see everything.'
              : 'Paste a YouTube URL to seed the knowledge base. The AI summary runs in the background.'}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        {filtered ? (
          <Button asChild size="pill" variant="outline">
            <Link to="/feed" search={{}}>
              Clear filters
            </Link>
          </Button>
        ) : (
          <Button asChild size="pill">
            <Link to="/new-post">Share a video</Link>
          </Button>
        )}
      </div>
    </section>
  );
}

// Shared chip styling for the header toggle groups. Extracted because
// MinScoreFilter and SortToggle below are visually identical chip
// groups — keeping the styles in one place ensures they don't drift.
//
// `focus-visible` (not `focus`) so mouse clicks don't leave a stuck
// ring; only keyboard-driven focus shows it. Tabbable users get a
// clear accent ring, mouse users get the existing hover behavior.
const CHIP_BASE =
  'rounded-full px-2.5 py-0.5 text-[0.7rem] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]';
const CHIP_INACTIVE = `${CHIP_BASE} border border-transparent font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]`;
const CHIP_ACTIVE = `${CHIP_BASE} border border-[var(--line)] bg-[var(--card)] font-semibold text-[var(--ink)]`;

// Three-preset chip group for the minimum Content score filter. State
// lives in the URL (`?minScore=…`) so links/refreshes preserve it.
// Changing the threshold resets the page so the user always lands on
// the first page of the new filtered set rather than (e.g.) page 4 of
// what may now be a 2-page result.
//
// Why presets instead of a slider: practical bands cluster at a few
// values (anything / decent / high), and chips give the same
// information density as the SortToggle next to it without adding a
// drag interaction. Easy to add a slider later if calibration work
// reveals more useful thresholds.
function MinScoreFilter({ current }: Readonly<{ current: number }>) {
  const isActive = (val: number) => current === val;
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] p-0.5">
      <span className="px-2 text-[0.65rem] uppercase tracking-wider text-[var(--ink-muted)]">
        Score
      </span>
      <Link
        to="/feed"
        // 'undefined' clears the URL param entirely.
        search={(prev) => ({ ...prev, minScore: undefined, page: undefined })}
        className={isActive(0) ? CHIP_ACTIVE : CHIP_INACTIVE}
        title="No filter"
      >
        All
      </Link>
      <Link
        to="/feed"
        search={(prev) => ({ ...prev, minScore: 50, page: undefined })}
        className={isActive(50) ? CHIP_ACTIVE : CHIP_INACTIVE}
        title="Hide videos scoring under 50"
      >
        50+
      </Link>
      <Link
        to="/feed"
        search={(prev) => ({ ...prev, minScore: 70, page: undefined })}
        className={isActive(70) ? CHIP_ACTIVE : CHIP_INACTIVE}
        title="Hide videos scoring under 70"
      >
        70+
      </Link>
    </div>
  );
}

// Two-pill toggle for the feed sort. State lives in the URL (`?sort=…`)
// so links / refreshes preserve the choice. Switching sort resets to
// page 1, since "page 5 by recency" doesn't map to "page 5 by score."
function SortToggle({ current }: Readonly<{ current: 'recent' | 'score' }>) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] p-0.5">
      <span className="px-2 text-[0.65rem] uppercase tracking-wider text-[var(--ink-muted)]">
        Sort
      </span>
      <Link
        to="/feed"
        search={(prev) => ({ ...prev, sort: undefined, page: undefined })}
        className={current === 'recent' ? CHIP_ACTIVE : CHIP_INACTIVE}
        title="Newest first"
      >
        Recent
      </Link>
      <Link
        to="/feed"
        search={(prev) => ({ ...prev, sort: 'score' as const, page: undefined })}
        className={current === 'score' ? CHIP_ACTIVE : CHIP_INACTIVE}
        title="Highest content score first"
      >
        Score
      </Link>
    </div>
  );
}
