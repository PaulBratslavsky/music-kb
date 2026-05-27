// /music — library of music-type videos. These are saved with metadata
// only (no transcript, no AI summary, no scoring), so the page doesn't
// need the rich VerdictBlock + summary chrome that the lesson feed has.
// Each card links to /video/$documentId where the LoopBuilder +
// visualizer live — that's where you go to figure out a song.

import { createFileRoute, Link } from '@tanstack/react-router';
import { getFeed } from '#/data/server-functions/videos';
import type { PaginatedVideos, StrapiVideo } from '#/lib/services/videos';
import { BackendErrorPanel } from '#/components/BackendErrorPanel';

type MusicLoaderData =
  | { kind: 'ok'; result: PaginatedVideos }
  | { kind: 'backend-error'; error: string };

export const Route = createFileRoute('/music')({
  loader: async (): Promise<MusicLoaderData> => {
    const result = await getFeed({
      data: {
        pageSize: 24,
        sort: 'recent',
        videoType: 'music',
      },
    });
    if (result.error) return { kind: 'backend-error', error: result.error };
    return { kind: 'ok', result };
  },
  component: MusicPage,
  head: () => ({ meta: [{ title: 'Music · Music KB' }] }),
});

function MusicPage() {
  const data = Route.useLoaderData();

  if (data.kind === 'backend-error') {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
        <PageHeader />
        <BackendErrorPanel message={data.error} />
      </main>
    );
  }

  const { videos } = data.result;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <PageHeader count={videos.length} />
      {videos.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <MusicCard key={v.documentId} video={v} />
          ))}
        </div>
      )}
    </main>
  );
}

function PageHeader({ count }: { count?: number }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="display-title text-3xl text-[var(--ink)] sm:text-4xl">
          Music
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Songs you've added for figuring out by ear. Click any track to
          open the LoopBuilder + visualizer.
        </p>
      </div>
      <Link
        to="/new-post"
        className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)] px-3.5 py-1.5 text-sm font-medium text-[var(--cream)] no-underline transition hover:bg-[var(--ink-soft)]"
      >
        + Add music
      </Link>
      {typeof count === 'number' && (
        <span className="sr-only">{count} videos</span>
      )}
    </header>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-10 text-center">
      <p className="text-base font-semibold text-[var(--ink)]">
        No music yet
      </p>
      <p className="mt-2 max-w-md mx-auto text-sm text-[var(--ink-muted)]">
        Add a YouTube song link via{' '}
        <Link to="/new-post" className="underline">
          Share
        </Link>{' '}
        and pick the <strong>Music</strong> type — it'll skip the
        transcript and AI steps and land straight in your music library.
      </p>
    </div>
  );
}

function MusicCard({ video }: { video: StrapiVideo }) {
  return (
    <Link
      to="/video/$documentId"
      params={{ documentId: video.documentId }}
      className="group block overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)] no-underline transition hover:border-[var(--accent)]"
    >
      {video.videoThumbnailUrl ? (
        <div className="aspect-video w-full overflow-hidden bg-[var(--bg-subtle)]">
          <img
            src={video.videoThumbnailUrl}
            alt={video.videoTitle ?? 'Music video thumbnail'}
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-[1.03]"
          />
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center bg-[var(--bg-subtle)] text-[var(--ink-muted)]">
          ♪
        </div>
      )}
      <div className="px-4 py-3">
        <h2 className="line-clamp-2 text-sm font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
          {video.videoTitle ?? 'Untitled track'}
        </h2>
        {video.videoAuthor && (
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {video.videoAuthor}
          </p>
        )}
        {video.caption && (
          <p className="mt-2 line-clamp-2 text-xs text-[var(--ink-soft)]">
            {video.caption}
          </p>
        )}
        {video.tags && video.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {video.tags.slice(0, 4).map((t) => (
              <span
                key={t.documentId}
                className="rounded-full bg-[var(--bg-subtle)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-muted)]"
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
