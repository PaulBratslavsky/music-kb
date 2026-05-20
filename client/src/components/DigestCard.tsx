import { Link } from '@tanstack/react-router';
import type { StrapiDigest } from '#/lib/services/digests';

// One row in the /digests grid. Clicking the title navigates to the
// /digest page with the same URL the user originally built the digest
// from (youtubeVideoIds in order) — which triggers a cache-hit via
// videoSetKey so no regeneration happens.
export function DigestCard({ digest }: Readonly<{ digest: StrapiDigest }>) {
  const videos = digest.videos ?? [];
  const youtubeVideoIds = videos.map((v) => v.youtubeVideoId).join(',');
  return (
    <article className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 transition hover:border-[var(--line-strong)]">
      <header className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          Digest
        </span>
        <span className="text-[0.65rem] text-[var(--ink-muted)]">
          {relativeTime(digest.createdAt)}
        </span>
      </header>

      <Link
        to="/digest"
        search={{ videos: youtubeVideoIds }}
        className="mb-2 no-underline"
      >
        <h2 className="line-clamp-2 text-lg font-semibold leading-snug text-[var(--ink)]">
          {digest.title}
        </h2>
      </Link>

      {digest.description && (
        <p className="mb-4 line-clamp-3 flex-1 text-sm leading-relaxed text-[var(--ink-soft)]">
          {digest.description}
        </p>
      )}

      <footer className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3">
        <SourceAvatars videos={videos} />
        <span className="text-[0.65rem] font-medium text-[var(--ink-muted)]">
          {videos.length} {videos.length === 1 ? 'video' : 'videos'}
          {digest.articleMarkdown ? ' · article' : null}
        </span>
      </footer>
    </article>
  );
}

function SourceAvatars({
  videos,
}: Readonly<{ videos: StrapiDigest['videos'] }>) {
  const shown = videos.slice(0, 4);
  return (
    <div className="flex -space-x-2">
      {shown.map((v) =>
        v.videoThumbnailUrl ? (
          <img
            key={v.documentId}
            src={v.videoThumbnailUrl}
            alt={v.videoTitle ?? v.youtubeVideoId}
            className="h-8 w-8 rounded-full border-2 border-[var(--card)] object-cover"
          />
        ) : (
          <span
            key={v.documentId}
            aria-hidden="true"
            className="h-8 w-8 rounded-full border-2 border-[var(--card)] bg-[var(--bg-subtle)]"
          />
        ),
      )}
      {videos.length > shown.length && (
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--card)] bg-[var(--bg-subtle)] text-[0.6rem] font-semibold text-[var(--ink-muted)]">
          +{videos.length - shown.length}
        </span>
      )}
    </div>
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
