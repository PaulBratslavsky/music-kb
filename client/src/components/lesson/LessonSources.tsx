// "Built from" section at the end of a lesson — the videos it drew on.
// Mirrors the "Source videos" section on /digest (client/src/routes/digest.tsx):
// same card shape (thumbnail + title, linking into /learn/$videoId), same
// grid. `videos` is already resolved by getLessonBySlugWithStatus — either
// the populated `videos` relation or, for older lessons, the distinct set
// derived from blocks' `source.videoId`. Renders nothing (not an empty
// heading) when there's nothing to show, which is the normal case for
// hand-written lessons.
//
// Links open in a new tab (`target="_blank"`), same as the inline
// citations in LessonBody's SourceNote — a lesson is meant to be
// self-contained; following a source should never navigate away from it.

import { Link } from '@tanstack/react-router';
import type { LessonSourceVideo } from '#/lib/services/lessons';

export function LessonSources({
  videos,
}: Readonly<{ videos: LessonSourceVideo[] }>) {
  if (videos.length === 0) return null;

  return (
    <section className="mt-12 border-t border-[var(--line)] pt-8">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
        Built from
      </h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {videos.map((v) => (
          <Link
            key={v.documentId}
            to="/learn/$videoId"
            params={{ videoId: v.youtubeVideoId }}
            target="_blank"
            rel="noopener noreferrer"
            // `min-w-0` on the card itself, not just on the title inside
            // it: as a grid item the card defaults to `min-width: auto`,
            // so a long video title pushed it past the column and the
            // whole page scrolled sideways on a phone (532px of content
            // in a 390px viewport). The inner `truncate` could never fire
            // because the box it was truncating into kept growing.
            className="flex min-w-0 gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 transition hover:border-[var(--line-strong)]"
          >
            {v.videoThumbnailUrl && (
              <img
                src={v.videoThumbnailUrl}
                alt=""
                className="h-16 w-28 shrink-0 rounded-md object-cover"
              />
            )}
            <div className="min-w-0 self-center">
              <div className="truncate text-sm font-medium text-[var(--ink)]">
                {v.videoTitle ?? v.youtubeVideoId}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
