// /lessons/triads — triads as shapes: string sets and inversions.
//
// Why this is a lesson and not a panel in the builder: a triad is a grid,
// not a single answer. Four qualities x four string sets x three
// inversions is 48 shapes, and the thing worth learning is the PATTERN
// across that grid — how one quality differs from another by a single
// note, and how an inversion is the same three notes re-stacked. A
// highlight overlay on the builder can show you one cell of that grid; it
// can't show you the grid.
//
// Interval formulas follow the standard triad cheat-sheet layout:
//   MAJOR R-3-5 · MINOR R-♭3-5 · AUGMENTED R-3-♯5 · DIMINISHED R-♭3-♭5

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { MiniNeck, type NeckDot } from '#/components/lesson/MiniNeck';
import {
  INVERSION_NAME,
  STRING_SETS,
  TRIAD_FORMULA,
  triadVoicing,
  type Inversion,
  type TriadQuality,
} from '#/lib/music/theory/triad-shapes';
import { PITCH_CLASSES, type PitchClass } from '#/lib/music/types';

export const Route = createFileRoute('/lessons/triads')({
  component: TriadsPage,
  head: () => ({ meta: [{ title: 'Triads across the neck · Music KB' }] }),
});

const QUALITIES: TriadQuality[] = ['major', 'minor', 'augmented', 'diminished'];

const QUALITY_BLURB: Record<TriadQuality, string> = {
  major: 'The default. A major third on the bottom, a minor third on top.',
  minor: 'Flatten the third by one fret. That single note is the whole difference.',
  augmented: 'Raise the fifth. Two major thirds stacked — symmetrical, so every inversion is the same shape moved.',
  diminished: 'Flatten both the third and the fifth. Two minor thirds stacked; tense, and wants to resolve.',
};

function Diagram({
  root,
  quality,
  set,
  inversion,
}: {
  root: PitchClass;
  quality: TriadQuality;
  set: (typeof STRING_SETS)[number];
  inversion: Inversion;
}) {
  const v = triadVoicing(root, quality, set, inversion);
  if (!v) {
    return (
      <p className="text-xs text-[var(--ink-muted)]">
        Doesn't fit on this string set below the 15th fret.
      </p>
    );
  }
  const dots: NeckDot[] = v.notes.map((n) => ({
    string: n.string,
    fret: n.fret,
    label: n.role,
    root: n.role === 'R',
  }));
  return (
    <div>
      <MiniNeck
        dots={dots}
        fromFret={Math.max(0, v.lowestFret - 1)}
        toFret={v.lowestFret + 4}
        ariaLabel={`${root} ${quality}, ${set.name}, ${INVERSION_NAME[inversion]}`}
      />
      <p className="mt-1 text-center text-xs text-[var(--ink-muted)]">
        {INVERSION_NAME[inversion]} · {v.notes.map((n) => n.pc).join(' ')}
      </p>
    </div>
  );
}

function TriadsPage() {
  const [root, setRoot] = useState<PitchClass>('C');
  const [quality, setQuality] = useState<TriadQuality>('major');

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · Chords · Shapes
        </p>
        <h1 className="mt-1 text-3xl font-bold text-[var(--ink)] sm:text-4xl">
          Triads across the neck
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          A triad is three notes: a root, a third and a fifth. On guitar
          that means three adjacent strings — a <strong>string set</strong> —
          and three <strong>inversions</strong>, depending on which of the
          three is lowest. Learn one quality on one string set and you have
          a shape you can move anywhere; learn the grid and you can find any
          triad, anywhere, without thinking.
        </p>
      </header>

      {/* 1 — the formulas */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          1. Four qualities, one note apart
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Every triad is the same skeleton with different spacing. Change one
          note and you change the quality — which is why they're worth
          learning together rather than as four unrelated chords.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {QUALITIES.map((q) => (
            <div
              key={q}
              className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold capitalize text-[var(--ink)]">
                  {q}
                </h3>
                <code className="text-sm font-bold text-[var(--accent)]">
                  {TRIAD_FORMULA[q]}
                </code>
              </div>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {QUALITY_BLURB[q]}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* 2 — the grid */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          2. The grid: string sets × inversions
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Pick a root and a quality; every shape below is that chord. Across
          is the same three notes re-stacked (the inversions), down is the
          same inversion moved to a different string set. Notice that the
          shapes repeat — the sets that are all fourths apart share a
          fingering, and only the ones crossing the <strong>G–B</strong>{' '}
          pair differ, because that pair is a major third instead of a
          fourth.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <select
            aria-label="Root"
            value={root}
            onChange={(e) => setRoot(e.target.value as PitchClass)}
            className="rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-1 text-sm font-medium text-[var(--ink)]"
          >
            {PITCH_CLASSES.map((pc) => (
              <option key={pc} value={pc}>{pc}</option>
            ))}
          </select>
          {QUALITIES.map((q) => (
            <button
              key={q}
              type="button"
              aria-pressed={quality === q}
              onClick={() => setQuality(q)}
              className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${
                quality === q
                  ? 'bg-[var(--accent)] text-white'
                  : 'border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]'
              }`}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-8">
          {STRING_SETS.map((set) => (
            <div key={set.name}>
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">
                String set {set.name}
              </h3>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {([0, 1, 2] as Inversion[]).map((inv) => (
                  <div
                    key={inv}
                    className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3"
                  >
                    <Diagram
                      root={root}
                      quality={quality}
                      set={set}
                      inversion={inv}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3 — how to practise */}
      <section className="mb-10">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          3. How to practise this
        </h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm text-[var(--ink-soft)]">
          <li>
            <strong className="text-[var(--ink)]">One set at a time.</strong>{' '}
            Take e–B–G and play all three inversions of one chord until you
            can find them without looking. That's a third of the neck covered
            for that chord.
          </li>
          <li>
            <strong className="text-[var(--ink)]">Major to minor.</strong>{' '}
            Play a major shape, then move only the third down one fret.
            Hearing that single note flip the quality is the point.
          </li>
          <li>
            <strong className="text-[var(--ink)]">Follow a progression.</strong>{' '}
            Play a I–IV–V using the nearest inversion each time instead of
            jumping to root position. Your hand barely moves — that's what
            inversions are for.
          </li>
        </ul>
        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          To drill this against a specific key, use{' '}
          <Link
            to="/theory"
            search={{ tab: 'practice' }}
            className="font-medium text-[var(--accent)]"
          >
            Theory → Practice
          </Link>
          , which hides the answer until you've found it. To see the same
          chords inside a scale shape, pick a box on{' '}
          <Link to="/builder" className="font-medium text-[var(--accent)]">
            the builder
          </Link>
          .
        </p>
      </section>

      <Link to="/lessons" className="text-sm text-[var(--ink-muted)] no-underline">
        ← All lessons
      </Link>
    </main>
  );
}
