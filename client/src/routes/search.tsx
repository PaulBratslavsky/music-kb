import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { Button } from '#/components/ui/button';
import {
  searchLibraryPassages,
  type LibraryPassageHit,
} from '#/data/server-functions/videos';
import {
  getMatchTier,
  MATCH_TIER_LABEL,
  type MatchTier,
} from '#/lib/services/embeddings';

// Moment search — library-wide semantic query against the Tier-2 passage
// index. Each hit is a ~60s span inside a video; clicking through lands
// on the learn page with a `?t=<sec>` deep link that seeks the player.
const SearchSchema = z.object({
  q: z.string().max(500).optional(),
});

type LoaderData =
  | { status: 'empty' }
  | { status: 'ok'; query: string; hits: LibraryPassageHit[] }
  | { status: 'error'; query: string; error: string };

export const Route = createFileRoute('/search')({
  validateSearch: SearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ deps }): Promise<LoaderData> => {
    const q = deps.q?.trim();
    if (!q) return { status: 'empty' };
    const res = await searchLibraryPassages({
      data: { query: q, limit: 30 },
    });
    if (res.status !== 'ok') {
      return { status: 'error', query: q, error: res.error };
    }
    return { status: 'ok', query: q, hits: res.hits };
  },
  component: SearchPage,
  head: () => ({ meta: [{ title: 'Moment search · YT Knowledge Base' }] }),
});

function SearchPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <main className="px-6 pb-28 pt-10 sm:px-10 sm:pt-14 lg:px-14">
      <header className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          Moment search
        </span>
        <h1 className="display-title mt-5 max-w-3xl text-[2.75rem] text-[var(--ink)] sm:text-[4rem]">
          Find specific
          <br />
          <span className="text-[var(--ink-muted)]">moments.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm text-[var(--ink-muted)]">
          Semantic search across every ~60-second chunk of every transcript in
          the library. Finds passages that <em>mean</em> your query, not just
          ones that use the same words.
        </p>
      </header>

      <SearchForm q={search.q ?? ''} />

      {data.status === 'empty' && (
        <p className="mt-8 text-sm text-[var(--ink-muted)]">
          Enter a query above — try something descriptive like{' '}
          <span className="font-mono">"how do agents handle tool failures"</span>
          {' '}or{' '}
          <span className="font-mono">"when to use suspense boundaries"</span>.
        </p>
      )}

      {data.status === 'error' && (
        <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Couldn&apos;t run the search: {data.error}
        </div>
      )}

      {data.status === 'ok' && (
        <>
          <div className="mt-8 mb-4 text-sm text-[var(--ink-muted)]">
            {data.hits.length} {data.hits.length === 1 ? 'moment' : 'moments'}{' '}
            for &ldquo;{data.query}&rdquo;
          </div>
          {data.hits.length === 0 ? (
            <EmptyResults />
          ) : (
            <section className="grid gap-4">
              {data.hits.map((hit, i) => (
                <MomentCard
                  key={`${hit.video.documentId}-${i}`}
                  hit={hit}
                  tier={getMatchTier(i, hit.passage.score)}
                />
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

function SearchForm({ q }: Readonly<{ q: string }>) {
  return (
    <form method="get" action="/search" className="flex flex-wrap gap-2">
      <input
        type="search"
        name="q"
        defaultValue={q}
        autoFocus
        placeholder="Describe the moment you're looking for…"
        className="h-11 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none"
      />
      <Button type="submit" size="pill">
        Search
      </Button>
    </form>
  );
}

function EmptyResults() {
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-8 text-center">
      <p className="text-sm text-[var(--ink)]">No matching moments.</p>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">
        Try different wording, or{' '}
        <Link
          to="/settings"
          className="text-[var(--accent)] no-underline hover:underline"
        >
          check passage coverage
        </Link>{' '}
        — the library may need indexing first.
      </p>
    </section>
  );
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}:${String(rest).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function MomentCard({
  hit,
  tier,
}: Readonly<{ hit: LibraryPassageHit; tier: MatchTier }>) {
  const { video, passage } = hit;
  // Deep-link: `?t=<startSec>` lands on the learn page with the iframe
  // seeded at `&start=…&autoplay=1` — YouTube seeks + plays immediately.
  const startSec = Math.max(0, Math.floor(passage.startSec));
  const [playing, setPlaying] = useState(false);

  return (
    <article className="group flex gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 transition hover:border-[var(--line-strong)]">
      {/* Thumbnail slot: static image by default; becomes an inline
          YouTube player when clicked so the user can preview the moment
          without leaving /search. The rest of the card still navigates
          to the full learn page. */}
      <div className="hidden flex-none sm:block">
        {playing ? (
          <div className="relative h-24 w-40 overflow-hidden rounded-lg bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${video.youtubeVideoId}?enablejsapi=1&rel=0&start=${startSec}&autoplay=1`}
              title={video.videoTitle ?? video.youtubeVideoId}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full border-0"
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPlaying(false);
              }}
              aria-label="Close preview"
              className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-[0.7rem] text-white hover:bg-black"
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setPlaying(true);
            }}
            aria-label={`Preview moment at ${formatTime(passage.startSec)}`}
            className="group/thumb relative block h-24 w-40 overflow-hidden rounded-lg bg-[var(--bg-subtle)]"
          >
            {video.videoThumbnailUrl ? (
              <img
                src={video.videoThumbnailUrl}
                alt={video.videoTitle ?? video.youtubeVideoId}
                className="h-full w-full object-cover transition group-hover/thumb:brightness-75"
              />
            ) : (
              <span
                aria-hidden="true"
                className="block h-full w-full bg-[var(--bg-subtle)]"
              />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white transition group-hover/thumb:bg-black/80">
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[0.65rem] font-medium tabular-nums text-white">
              {formatTime(passage.startSec)}
            </span>
          </button>
        )}
      </div>

      <Link
        to="/learn/$videoId"
        params={{ videoId: video.youtubeVideoId }}
        search={{ t: startSec }}
        className="min-w-0 flex-1 no-underline"
      >
        <header className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-1 text-sm font-semibold text-[var(--ink)] transition group-hover:text-[var(--accent)]">
              {video.videoTitle ?? video.youtubeVideoId}
            </h3>
            {video.videoAuthor && (
              <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
                {video.videoAuthor}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1 text-[0.65rem] text-[var(--ink-muted)]">
            <span className="tabular-nums font-medium">
              {formatTime(passage.startSec)}–{formatTime(passage.endSec)}
            </span>
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
        </header>
        <p className="line-clamp-3 text-sm leading-relaxed text-[var(--ink-soft)]">
          {passage.text}
        </p>
      </Link>
    </article>
  );
}
