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
    href: '/lessons/triads',
    title: 'Triads across the neck',
    blurb:
      'Three notes, three adjacent strings, three inversions. The four qualities differ by a single note each — major, minor, augmented, diminished — and the whole grid of string sets and inversions is laid out so you can see the pattern rather than memorise 48 shapes.',
    duration: '~20 min read',
    level: 'Intermediate',
  },
  {
    href: '/lessons/power-chords',
    title: 'Power chords: one shape, the whole neck',
    blurb:
      'Root, fifth, octave — no third, which is why it fits over major and minor alike. One movable shape covers every root, with two details worth knowing: what changes when it crosses the G-B string pair, and the one degree in every key that has no power chord at all.',
    duration: '~10 min read',
    level: 'Beginner',
  },
  {
    href: '/lessons/music-theory-fundamentals',
    title: 'Music theory fundamentals (part 1 of 3)',
    blurb:
      'What general music theory actually is, why "guitar theory" is a shortcut on top of it, and the 9 short principles that turn notes into scales into chords into keys. Conceptual primer — no fretboard diagrams yet.',
    duration: '~15 min read',
    level: 'Beginner',
  },
  {
    href: '/lessons/scale-systems-on-the-neck',
    title: 'Mapping scales on the neck (part 2 of 3)',
    blurb:
      'Three systems for mapping the diatonic scale across all six strings — 5 pentatonic positions, 7 three-notes-per-string patterns, and the underrated 3-pattern "Super Duper" system. Every pattern opens on the fretboard explorer.',
    duration: '~20 min read',
    level: 'Intermediate',
  },
  {
    href: '/lessons/caged-and-roman-numerals',
    title: 'CAGED + thinking in numbers (part 3 of 3)',
    blurb:
      'The CAGED system covers every chord across the neck; Roman numerals let you transpose any progression to any key for free. Together they turn the fretboard into one interconnected map.',
    duration: '~15 min read',
    level: 'Intermediate',
  },
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
  {
    href: '/lessons/half-steps-to-chords',
    title: 'Half steps → every chord in a key',
    blurb:
      'One skill — counting half steps — builds the major and minor scales, the numbers 1–7, the major/minor difference (4+3 vs 3+4), all seven chords of any key, and the circle of fifths. Includes what a whole step and a half step look like when you cross strings, so you can build a scale anywhere instead of memorizing boxes. Shown inline on piano, guitar and bass.',
    duration: '~30 min read',
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
