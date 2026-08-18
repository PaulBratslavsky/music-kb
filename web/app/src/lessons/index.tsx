// /lessons — index of the guitar lessons, ported from music-kb.
//
// Each card links to a self-contained lesson page. The lessons are pure
// static content with no backend dependency, which is exactly why they
// belong in this app as well as in music-kb.

import { Link } from './components/Link';

type LessonEntry = {
  slug: string;
  title: string;
  blurb: string;
  duration: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
};

export const LESSONS: LessonEntry[] = [
  {
    slug: 'music-theory-fundamentals',
    title: 'Music theory fundamentals (part 1 of 3)',
    blurb:
      'What general music theory actually is, why "guitar theory" is a shortcut on top of it, and the 9 short principles that turn notes into scales into chords into keys.',
    duration: '~15 min read',
    level: 'Beginner',
  },
  {
    slug: 'scale-systems-on-the-neck',
    title: 'Mapping scales on the neck (part 2 of 3)',
    blurb:
      'Three systems for mapping the diatonic scale across all six strings — 5 pentatonic positions, 7 three-notes-per-string patterns, and the underrated 3-pattern "Super Duper" system. Every pattern is drawn inline.',
    duration: '~20 min read',
    level: 'Intermediate',
  },
  {
    slug: 'caged-and-roman-numerals',
    title: 'CAGED + thinking in numbers (part 3 of 3)',
    blurb:
      'The CAGED system covers every chord across the neck; Roman numerals let you transpose any progression to any key for free.',
    duration: '~15 min read',
    level: 'Intermediate',
  },
  {
    slug: 'find-any-chord',
    title: 'Find any chord with 2 strings + 4 shapes',
    blurb:
      'Memorize the natural notes on the low E and A strings, learn one power-chord shape and the four E/A barre shapes, and you have every major/minor chord at every fret.',
    duration: '~30 min read + practice',
    level: 'Beginner',
  },
  {
    slug: 'essential-chords',
    title: '10 essential chord shapes',
    blurb:
      'The 10 moveable shapes every guitarist needs — power chord, E/A barre forms for major / minor / dominant 7 / minor 7, plus the Hendrix 7♯9.',
    duration: '~10 min reference',
    level: 'Beginner',
  },
  {
    slug: 'half-steps-to-chords',
    title: 'Half steps → every chord in a key',
    blurb:
      'One skill — counting half steps — builds the major and minor scales, the numbers 1–7, the major/minor difference (4+3 vs 3+4), all seven chords of any key, and the circle of fifths. Shown inline on piano, guitar and bass.',
    duration: '~30 min read',
    level: 'Beginner',
  },
];

export default function LessonsIndexPage() {
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lessons
        </p>
        <h1 className="mt-1 text-3xl font-bold text-[var(--ink)] sm:text-4xl">
          Guitar lessons
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Self-contained walk-throughs that pair theory with practice. Each
          lesson cross-links to the builder so you can dig as deep as you
          want.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {LESSONS.map((l) => (
          <Link
            key={l.slug}
            to={`/lessons/${l.slug}`}
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
