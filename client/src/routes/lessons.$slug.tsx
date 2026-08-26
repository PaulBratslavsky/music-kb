import { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { BackendErrorPanel } from '#/components/BackendErrorPanel';
import { LessonBody } from '#/components/lesson/LessonBody';
import { LessonNav } from '#/components/lesson/LessonNav';
import { LessonSources } from '#/components/lesson/LessonSources';
import {
  LessonVideoPanel,
  lessonHasVideoPanel,
} from '#/components/lesson/LessonVideoPanel';
import type {
  LessonCitation,
  LessonVideoSelection,
} from '#/lib/lesson/citation';
import { getLessonBySlug } from '#/data/server-functions/lessons';
import type { Lesson, LessonResult } from '#/lib/services/lessons';

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

  return <LessonView lesson={data.lesson} />;
}

// Two columns: the lesson on the left, a sticky video panel on the right.
//
// Why the shape differs from /learn's, which is the layout this borrows
// from: that page height-locks the whole viewport on `lg` and scrolls its
// two columns independently. A lesson is long-form reading — 55 to 91
// blocks, up to ~2,300 words — and taking the page scrollbar away from it
// would break browser find-in-page position, the `#heading` jumps
// LessonNav emits, and the reader's sense of how much is left. So the
// page scrolls normally and the panel is `position: sticky` instead. Same
// breakpoint (`lg`), same 6fr/4fr proportions, same "content left, video
// right" idiom; only the mechanism that pins the right column changes.
//
// Narrow: one column, panel below the content (no `lg:` classes apply).
function LessonView({ lesson }: Readonly<{ lesson: Lesson }>) {
  const [selection, setSelection] = useState<LessonVideoSelection | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  // A lesson with no citable video gets no panel at all, and keeps the
  // single centred reading column. Deliberate, over an empty-state box:
  // hand-written and pre-relation lessons have nothing to verify against,
  // and a permanently empty right-hand column would be a hole the reader
  // has to work out the purpose of on every one of them. The panel exists
  // to serve citations; no citations, no panel.
  const hasPanel = lessonHasVideoPanel(lesson.body, lesson.videos);

  const handleCitationSelect = useCallback((citation: LessonCitation) => {
    // `seq` increments on every click, including a repeat click on the
    // citation already loaded — that is what makes "play it again" work.
    setSelection((prev) => ({ ...citation, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleSelectVideo = useCallback((videoId: string) => {
    setSelection((prev) => ({ videoId, seq: (prev?.seq ?? 0) + 1 }));
  }, []);

  const handleClear = useCallback(() => setSelection(null), []);

  // The way back from the panel on a narrow screen. Finds the citation
  // that is currently playing by the `aria-current` mark it already
  // carries — no extra state, and it cannot drift out of sync with the
  // highlight, because it IS the highlight. Scoped to the content column
  // so it does not match the panel's own active source card.
  const handleReturnToCitation = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const target = content.querySelector('[aria-current="true"]') ?? content;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // On a narrow viewport the panel sits below the lesson, so a citation
  // click would otherwise change something entirely off-screen — the
  // click would read as broken. Bring the panel into view when it is not
  // already there. On `lg` it is sticky and always in view, so this is a
  // no-op; that is why the check is on real geometry rather than a
  // media query.
  useEffect(() => {
    if (selection === null) return;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const alreadyVisible = rect.top < window.innerHeight * 0.75 && rect.bottom > 96;
    if (alreadyVisible) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selection]);

  return (
    <main
      className={`mx-auto w-full max-w-3xl px-4 py-10 sm:px-8 sm:py-16 ${
        hasPanel ? 'lg:max-w-[84rem]' : ''
      }`}
    >
      <div
        className={
          hasPanel ? 'lg:grid lg:grid-cols-[6fr_4fr] lg:items-start lg:gap-12' : ''
        }
      >
        <div ref={contentRef} className="min-w-0">
          <header className="mb-12">
            {/* `instrument` is omitted when it is `any` — the schema default,
                and the value a lesson gets when the outline had no instrument
                in mind, so printing it would add a word that means nothing.
                Anything else belongs in the eyebrow: whether this is a guitar
                or a piano lesson is the first thing a reader wants to know,
                and until now the field was stored and shown nowhere. */}
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Lesson · {lesson.level}
              {lesson.instrument && lesson.instrument !== 'any'
                ? ` · ${lesson.instrument}`
                : ''}
            </p>
            <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
              {lesson.title}
            </h1>
            {lesson.summary ? (
              <p className="mt-3 text-sm text-[var(--ink-soft)]">{lesson.summary}</p>
            ) : null}
          </header>
          {/* LessonNav stays in the content column rather than moving into
              the panel. Two reasons. It is a <details> that scrolls away
              once you have used it, and the panel is the one region that
              never scrolls away — putting a table of contents there would
              permanently spend the vertical space the video needs, at
              exactly the `lg` widths where that space is tightest (and the
              chat panel is still to come). And on narrow the panel sits
              BELOW the lesson, where a table of contents is worthless: you
              reach it after reading. It belongs at the top of the reading
              column, which is where it already is. */}
          <LessonNav blocks={lesson.body} />
          <LessonBody
            blocks={lesson.body}
            parameter={lesson.parameter}
            sourceVideos={lesson.videos}
            onCitationSelect={handleCitationSelect}
            activeCitation={selection}
          />
          {/* Kept at the bottom of the content column on purpose: this is
              the scrolled-to-end / printable summary of provenance. The
              panel is the interactive one. */}
          <LessonSources videos={lesson.videos} />
        </div>

        {hasPanel ? (
          <aside
            ref={panelRef}
            aria-label="Lesson sources and player"
            className="mt-12 scroll-mt-20 border-t border-[var(--line)] pt-8 lg:sticky lg:top-20 lg:mt-0 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:border-t-0 lg:pt-0"
          >
            <LessonVideoPanel
              videos={lesson.videos}
              selection={selection}
              onSelect={handleSelectVideo}
              onClear={handleClear}
              onReturnToCitation={handleReturnToCitation}
            />
          </aside>
        ) : null}
      </div>
    </main>
  );
}
