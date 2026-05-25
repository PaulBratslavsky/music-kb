// /theory — standalone music-theory tools page. Currently hosts the Circle
// of Fifths visualizer; future stuff (mode wheel, interval calculator, etc.)
// can slot in here as additional panels.

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleOfFifths } from '#/components/CircleOfFifths';
import { ChordSubstitutions } from '#/components/ChordSubstitutions';
import { IntervalCalculator } from '#/components/IntervalCalculator';
import {
  CIRCLE_MAJORS,
  CIRCLE_MAJOR_DISPLAY,
  CIRCLE_MINOR_DISPLAY,
} from '#/lib/music/circle-of-fifths';

export const Route = createFileRoute('/theory')({
  component: TheoryPage,
  head: () => ({ meta: [{ title: 'Music theory · Music KB' }] }),
});

function TheoryPage() {
  // Tonic state is shared between the Circle and the Substitutions panel —
  // clicking a wedge on the wheel re-pivots both the diatonic family
  // shown on the circle and the substitution suggestions below.
  const [tonicIdx, setTonicIdx] = useState(0);

  return (
    <main className="page-wrap mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <h1 className="display-title text-3xl text-[var(--ink)] sm:text-4xl">
          Music theory
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Interactive theory tools that work independently of any video or
          instrument. Click around to explore.
        </p>
      </header>

      <section>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Circle of fifths
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Pick any key as the tonic — the diatonic chord family (I-IV-V plus
          relative minors) lights up, and the wheel shows the key signature.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <CircleOfFifths tonicIdx={tonicIdx} onTonicChange={setTonicIdx} />
          {/* Deep-links into /builder so the user can see the chosen tonic
              rendered as a chord or scale on the fretboard. Sharp-side
              tonics (C..F#) link with sharp spellings; flat-side keys are
              still passed as sharps since /builder's parser only accepts
              the sharp form (Db → C#, Bb → A#, etc.). */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-[var(--line)] pt-4 text-xs">
            <span className="text-[var(--ink-muted)]">View on fretboard:</span>
            <Link
              to="/builder"
              search={{ theory: `scale:${CIRCLE_MAJORS[tonicIdx]}:major` }}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
            >
              {CIRCLE_MAJOR_DISPLAY[tonicIdx]} major scale →
            </Link>
            <Link
              to="/builder"
              search={{ theory: `scale:${CIRCLE_MAJORS[tonicIdx]}:minor` }}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
              title={`Relative minor: ${CIRCLE_MINOR_DISPLAY[tonicIdx]}`}
            >
              {CIRCLE_MINOR_DISPLAY[tonicIdx]} natural minor →
            </Link>
            <Link
              to="/builder"
              search={{ theory: `chord:${CIRCLE_MAJORS[tonicIdx]}:maj` }}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
            >
              {CIRCLE_MAJOR_DISPLAY[tonicIdx]} chord →
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Chord substitutions
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Common reharmonization options for the diatonic chords of the
          selected key — replacement chords, secondary dominants, and
          modal interchange (borrowed from the parallel minor). Click any
          chord name to view it on the fretboard.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <ChordSubstitutions tonicIdx={tonicIdx} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Interval calculator
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Pick two notes — see the interval name, semitone count, and what
          it inverts to. Hit Hear it to audition the pair.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <IntervalCalculator />
        </div>
      </section>
    </main>
  );
}
