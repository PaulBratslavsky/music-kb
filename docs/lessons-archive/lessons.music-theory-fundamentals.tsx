// /lessons/music-theory-fundamentals — part 1 of the three-part guitar
// theory track. Conceptual only — what general music theory is, why
// guitar theory is a shortcut on top of it, and the 9 short principles
// every player benefits from. No fretboard diagrams here; the next
// two lessons handle the practical "how do I see this on the neck?"
// part of the story.

import { createFileRoute, Link } from '@tanstack/react-router';
import { Callout, Principle, Step } from '#/components/lesson/Step';

export const Route = createFileRoute(
  '/lessons/music-theory-fundamentals',
)({
  component: MusicTheoryFundamentalsPage,
  head: () => ({
    meta: [{ title: 'Music theory fundamentals · Music KB' }],
  }),
});

function MusicTheoryFundamentalsPage() {
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-10 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · part 1 of 3 · fundamentals
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          Music theory fundamentals
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          What general music theory actually is, why "guitar theory" is
          a shortcut on top of it, and the 9 short principles every
          guitar player benefits from. Read this once and the rest of
          the track (mapping scales, CAGED, Roman numerals) makes much
          more sense.
        </p>
        <NextStepHint />
      </header>

      {/* ----------------------------------------------------- Section 1 */}
      <Step
        number={1}
        title='"Guitar theory" vs. general music theory'
        lede="General music theory applies to every instrument — piano, sax,
          voice, guitar. Guitar theory applies only to the guitar, and
          it's a shortcut: instead of memorizing the 7 notes for each
          of the 12 keys, you memorize shapes and patterns that are
          identical across all 12 keys. Learn one shape, get all 12
          keys for free."
      >
        <Callout>
          The fundamentals of music theory are to music what arithmetic
          is to math: everyone needs them. Jazz is calculus — a small
          subset of musicians use it, but they always start with the
          fundamentals first. The arithmetic of music theory is{' '}
          <strong>diatonic theory</strong> — how a key works.
        </Callout>
      </Step>

      {/* ----------------------------------------------------- Section 2 */}
      <Step
        number={2}
        title="The 9 principles"
        lede="The fundamentals condensed to nine short rules. Each one
          carries you from notes → scales → chords → keys → all 12 keys
          working the same way."
      >
        <ol className="mt-4 space-y-3 text-sm text-[var(--ink-soft)]">
          <Principle n={1}>
            <strong>There are 12 keys.</strong> Each contains exactly 7
            notes. Pick any starting note, play the major scale, and
            you have that key's 7-note set. The key is named after the
            note you started on.
          </Principle>
          <Principle n={2}>
            <strong>Each key has a relative minor.</strong> Look at the
            6th note of the major scale — that's the relative minor
            (the Aeolian perspective).
          </Principle>
          <Principle n={3}>
            <strong>Relative major + minor share all 7 notes.</strong>{' '}
            From the major perspective the scale is called the{' '}
            <em>major / Ionian scale</em>. From the minor perspective
            the same 7 notes are called the{' '}
            <em>natural minor / Aeolian scale</em>.
          </Principle>
          <Principle n={4}>
            <strong>The 7 triads</strong> come from starting on each of
            the 7 scale notes and stacking every-other-note three times
            (root, 3rd, 5th).
          </Principle>
          <Principle n={5}>
            <strong>The 7 seventh chords</strong> come from doing the
            same thing but stacking 4 notes (root, 3rd, 5th, 7th).
          </Principle>
          <Principle n={6}>
            <strong>Relative major + minor also share their 7 chords</strong>
            {' '}(both triad and 7th forms) — just like they share their
            7 notes.
          </Principle>
          <Principle n={7}>
            <strong>The Circle of Fifths gives you the chord family</strong>
            : the 6-wedge cluster around any tonic is the 3 major + 3
            minor chords of that key. Open the{' '}
            <Link to="/theory" className="underline">
              wheel
            </Link>{' '}
            and click any wedge to see this live.
          </Principle>
          <Principle n={8}>
            <strong>All 12 keys work exactly the same</strong> because
            the intervallic relationships between scale notes are
            identical in every major scale. That's why guitar theory's
            shape-based shortcut works.
          </Principle>
          <Principle n={9}>
            <strong>Each key has 7 perspectives (modes)</strong>. The
            1st (Ionian / major) and 6th (Aeolian / minor) are so
            common we usually don't call them modes at all. The other
            five — Dorian, Phrygian, Lydian, Mixolydian, Locrian — are
            "advanced" territory.
          </Principle>
        </ol>
      </Step>

      <footer className="mt-12 max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-6">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Next up
        </h2>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          The theory in your head is one thing — being able to find it
          on the neck is another. Next lesson covers the three common
          systems for mapping these 7 notes across all six strings.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/lessons/scale-systems-on-the-neck"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-1.5 text-sm font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
          >
            Part 2: Mapping scales on the neck →
          </Link>
          <Link
            to="/lessons"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-4 py-1.5 text-sm font-medium text-[var(--ink-muted)] no-underline hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            Back to lessons
          </Link>
        </div>
      </footer>
    </main>
  );
}

function NextStepHint() {
  return (
    <p className="mt-2 text-xs text-[var(--ink-muted)]">
      Part 1 of 3 ·{' '}
      <Link
        to="/lessons/scale-systems-on-the-neck"
        className="underline hover:text-[var(--ink)]"
      >
        Part 2 →
      </Link>{' '}
      ·{' '}
      <Link
        to="/lessons/caged-and-roman-numerals"
        className="underline hover:text-[var(--ink)]"
      >
        Part 3 →
      </Link>
    </p>
  );
}
