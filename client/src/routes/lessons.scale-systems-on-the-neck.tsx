// /lessons/scale-systems-on-the-neck — part 2 of the three-part guitar
// theory track. The practical "how do I see this on the neck?" piece.
// Covers the three layer-1 systems for mapping the diatonic scale
// across all six strings: 5 pentatonic positions, 7 3NPS patterns,
// and the underrated 3-pattern "Super Duper" approach. Every pattern
// card deep-links to /builder where the user can hear and slide it.

import { createFileRoute, Link } from '@tanstack/react-router';
import { Callout, Step } from '#/components/lesson/Step';

export const Route = createFileRoute(
  '/lessons/scale-systems-on-the-neck',
)({
  component: ScaleSystemsPage,
  head: () => ({
    meta: [{ title: 'Mapping scales on the neck · Music KB' }],
  }),
});

function ScaleSystemsPage() {
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-10 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · part 2 of 3 · neck mapping
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          Mapping scales on the neck
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Three different ways to see the same diatonic scale across all
          six strings. They all do the same job — pick the one that
          makes sense to your brain. Every pattern below opens on the{' '}
          <Link to="/builder" className="underline">
            fretboard explorer
          </Link>{' '}
          so you can hear it and try it in any key.
        </p>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Part 2 of 3 ·{' '}
          <Link
            to="/lessons/music-theory-fundamentals"
            className="underline hover:text-[var(--ink)]"
          >
            ← Part 1
          </Link>{' '}
          ·{' '}
          <Link
            to="/lessons/caged-and-roman-numerals"
            className="underline hover:text-[var(--ink)]"
          >
            Part 3 →
          </Link>
        </p>
      </header>

      {/* ----------------------------------------------------- Section 1 */}
      <Step
        number={1}
        title="The 5 pentatonic positions"
        lede="The first system. Five movable shapes, each containing 5 of
          the 7 scale tones (the pentatonic subset) at a specific
          position. Add the 2 missing notes back in to get the full
          diatonic scale at that position."
      >
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Anchor position #1 by placing your index finger on the{' '}
          <strong>minor scale root</strong> (or pinky on the{' '}
          <strong>major scale root</strong>). The other four chain up
          the neck from there.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <PatternLink
              key={n}
              label={`Position ${n}`}
              sub="E minor pentatonic"
              theory="scale:E:minorPentatonic"
            />
          ))}
        </div>
        <Callout>
          Add the 2 non-pentatonic scale tones to each position and you
          have the full 7-note diatonic scale at that position. Switch
          the scale type to <em>minor</em> in <code>/builder</code> to
          see the same positions with all 7 notes.
        </Callout>
      </Step>

      {/* ----------------------------------------------------- Section 2 */}
      <Step
        number={2}
        title="The seven 3-notes-per-string patterns"
        lede="Same job as the 5 pentatonic positions — map the diatonic
          scale across the neck — but using 7 patterns of exactly 3
          notes on each string. Each pattern starts on a different
          scale note on the low E. Pattern #1 starts on the root."
      >
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([1, 2, 3, 4, 5, 6, 7] as const).map((n) => (
            <PatternLink
              key={n}
              label={`Pattern ${n}`}
              sub="G major (use Shape selector on /builder)"
              theory="scale:G:major"
            />
          ))}
        </div>
        <Callout>
          When you're playing in the minor perspective of the key,
          re-number these patterns so pattern #6 (which starts on the
          Aeolian root) becomes your new #1.
        </Callout>
      </Step>

      {/* ----------------------------------------------------- Section 3 */}
      <Step
        number={3}
        title="The Super Duper Top Secret 3-pattern system"
        lede="Same job again — map the diatonic scale — but using only 3
          patterns. Underrated because there's nothing to confuse it
          with, so the internet doesn't argue about it. Two of the
          three are just patterns you already know."
      >
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SystemCard
            label="Pattern 1"
            sub='Pentatonic position #1 — "Home Box"'
            description="The most common shape every guitarist learns first. Anchored on the low-E-string root."
            theory="scale:E:minorPentatonic"
          />
          <SystemCard
            label="Pattern 2"
            sub='Pentatonic position #4 — "A-String Home Box"'
            description="Anchored on the A-string root. A second movable position you can chain off pattern 1."
            theory="scale:E:minorPentatonic"
          />
          <SystemCard
            label="Pattern 3"
            sub="The 1st 3NPS pattern"
            description="Three notes per string, starting on the scale root on the low E. Fills the gap between the two pentatonic boxes."
            theory="scale:G:major"
          />
        </div>
        <Callout>
          <strong>The point of all three systems is identical.</strong>{' '}
          Five positions, seven patterns, three patterns — they all map
          the same 7 diatonic notes across the same fretboard. Pick the
          one that makes sense to your brain and move on.
        </Callout>
      </Step>

      <footer className="mt-12 max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-6">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Next up
        </h2>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Mapping the scale is "layer 1". Next lesson is "layer 2" —
          chords. Same fretboard, different goal: how do you keep up
          with chord changes when you're soloing, and how do you
          transpose any progression to any key without thinking?
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/lessons/caged-and-roman-numerals"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-1.5 text-sm font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
          >
            Part 3: CAGED + Roman numerals →
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

function PatternLink({
  label,
  sub,
  theory,
}: {
  label: string;
  sub: string;
  theory: string;
}) {
  return (
    <Link
      to="/builder"
      search={{ theory }}
      className="block rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 no-underline transition hover:border-[var(--accent)]"
    >
      <div className="text-sm font-semibold text-[var(--ink)]">{label}</div>
      <div className="mt-0.5 text-xs text-[var(--ink-muted)]">{sub}</div>
      <div className="mt-2 text-xs font-medium text-[var(--accent)]">
        Open on fretboard →
      </div>
    </Link>
  );
}

function SystemCard({
  label,
  sub,
  description,
  theory,
}: {
  label: string;
  sub: string;
  description: string;
  theory: string;
}) {
  return (
    <Link
      to="/builder"
      search={{ theory }}
      className="block rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 no-underline transition hover:border-[var(--accent)]"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-[var(--ink)]">{sub}</div>
      <p className="mt-2 text-xs text-[var(--ink-soft)]">{description}</p>
      <div className="mt-3 text-xs font-medium text-[var(--accent)]">
        Try it on the fretboard →
      </div>
    </Link>
  );
}
