import { createFileRoute } from '@tanstack/react-router';
import { BackendErrorPanel } from '#/components/BackendErrorPanel';
import { LessonBody } from '#/components/lesson/LessonBody';
import { getLessonBySlug } from '#/data/server-functions/lessons';
import type { LessonResult } from '#/lib/services/lessons';

export const Route = createFileRoute('/lessons/$slug')({
  component: LessonPage,
  loader: async ({ params }): Promise<LessonResult> =>
    getLessonBySlug({ data: { slug: params.slug } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.ok
          ? `${loaderData.lesson.title} · Music KB`
          : 'Lesson · Music KB',
      },
    ],
  }),
});

function LessonPage() {
  const data = Route.useLoaderData();

  // status 0 means the network never answered — Strapi is down, which is a
  // different problem from a slug that does not exist.
  if (!data.ok) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
        {data.status === 404 ? (
          <p className="text-sm text-[var(--ink-soft)]">
            No lesson found at this address.
          </p>
        ) : (
          <BackendErrorPanel message={data.error} />
        )}
      </main>
    );
  }

  const { lesson } = data;
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · {lesson.level}
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          {lesson.title}
        </h1>
        {lesson.summary ? (
          <p className="mt-3 text-sm text-[var(--ink-soft)]">{lesson.summary}</p>
        ) : null}
      </header>
      <LessonBody blocks={lesson.body} parameter={lesson.parameter} />
    </main>
  );
}
