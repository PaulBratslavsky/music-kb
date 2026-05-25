// /theory — standalone music-theory tools page. Currently hosts the Circle
// of Fifths visualizer; future stuff (mode wheel, interval calculator, etc.)
// can slot in here as additional panels.

import { createFileRoute } from '@tanstack/react-router';
import { CircleOfFifths } from '#/components/CircleOfFifths';

export const Route = createFileRoute('/theory')({
  component: TheoryPage,
  head: () => ({ meta: [{ title: 'Music theory · Music KB' }] }),
});

function TheoryPage() {
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
          <CircleOfFifths />
        </div>
      </section>
    </main>
  );
}
