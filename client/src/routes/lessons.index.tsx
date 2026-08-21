// /lessons — index of the guitar lessons. Each card links to a
// self-contained lesson page. Lesson data is Strapi-backed; add new lessons
// through the CMS, not here.

import { createFileRoute, Link } from '@tanstack/react-router';
import { listLessons } from '#/data/server-functions/lessons';
import type { LessonSummary } from '#/lib/services/lessons';

export const Route = createFileRoute('/lessons/')({
  component: LessonsIndexPage,
  loader: async (): Promise<LessonSummary[]> => listLessons(),
  head: () => ({ meta: [{ title: 'Lessons · Music KB' }] }),
});

function LessonsIndexPage() {
  const lessons = Route.useLoaderData();

  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lessons
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          Guitar lessons
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Self-contained walk-throughs that pair theory with practice.
          Click any card to start; each lesson cross-links to the
          fretboard explorer and the rest of the visualizer so you can
          dig as deep as you want.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {lessons.map((l) => (
          <Link
            key={l.documentId}
            to="/lessons/$slug"
            params={{ slug: l.slug }}
            className="group block rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 no-underline transition hover:border-[var(--accent)]"
          >
            <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-medium">
                {l.level}
              </span>
            </div>
            <h2 className="mt-3 text-base font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
              {l.title}
            </h2>
            {l.summary ? (
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{l.summary}</p>
            ) : null}
            <span className="mt-4 inline-block text-xs font-semibold text-[var(--accent)]">
              Start lesson →
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
