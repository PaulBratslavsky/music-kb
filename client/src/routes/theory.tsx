// /theory — standalone music-theory tools page. Currently hosts the Circle
// of Fifths visualizer; future stuff (mode wheel, interval calculator, etc.)
// can slot in here as additional panels.

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { CircleOfFifths } from '#/components/CircleOfFifths';
import { ChordSubstitutions } from '#/components/ChordSubstitutions';

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
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Chord substitutions
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Common reharmonization options for the diatonic chords of the
          selected key — replacement chords, secondary dominants, and
          modal interchange (borrowed from the parallel minor).
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <ChordSubstitutions tonicIdx={tonicIdx} />
        </div>
      </section>
    </main>
  );
}
