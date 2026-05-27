// /lessons — index of the guitar lessons. Each card links to a
// self-contained lesson page. Add more entries here as new lessons land.

import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/lessons/')({
  component: LessonsIndexPage,
  head: () => ({ meta: [{ title: 'Lessons · Music KB' }] }),
});

type LessonEntry = {
  href: string;
  title: string;
  blurb: string;
  duration: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
};

const LESSONS: LessonEntry[] = [
  {
    href: '/lessons/find-any-chord',
    title: 'Find any chord with 2 strings + 4 shapes',
    blurb:
      'The "minimum viable" guitar pedagogy — memorize the natural notes on the low E and A strings, learn one power-chord shape and the four E/A barre shapes, and you have every major/minor chord at every fret.',
    duration: '~30 min read + practice',
    level: 'Beginner',
  },
  {
    href: '/lessons/essential-chords',
    title: '10 essential chord shapes',
    blurb:
      'The 10 moveable shapes every guitarist needs — power chord, E/A barre forms for major / minor / dominant 7 / minor 7, plus the Hendrix 7♯9. Compact chord-box diagrams + deep-link to the fretboard explorer for each.',
    duration: '~10 min reference',
    level: 'Beginner',
  },
];

function LessonsIndexPage() {
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
        {LESSONS.map((l) => (
          <Link
            key={l.href}
            to={l.href}
            className="group block rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 no-underline transition hover:border-[var(--accent)]"
          >
            <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
              <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-medium">
                {l.level}
              </span>
              <span>{l.duration}</span>
            </div>
            <h2 className="mt-3 text-base font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
              {l.title}
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">{l.blurb}</p>
            <span className="mt-4 inline-block text-xs font-semibold text-[var(--accent)]">
              Start lesson →
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
