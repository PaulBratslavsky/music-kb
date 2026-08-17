// #/theory — the theory section.
//
// Two tabs so far, mirroring the useful half of music-kb's /theory:
//   Tools     — the circle of fifths
//   Reference — the generated cheat sheet
//
// music-kb also has Practice / Visualizer / Compose tabs there; the
// visualizer already IS this app's home, and the rest can follow later.

import { useState } from 'react';
import { CircleOfFifths } from '../music/CircleOfFifths';
import { TheoryReference } from './TheoryReference';
import { ScaleChordFinder } from './ScaleChordFinder';

type Tab = 'tools' | 'practice' | 'reference';

export function TheoryPage() {
  const [tab, setTab] = useState<Tab>('tools');

  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-10 xl:px-12">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-[var(--ink)] sm:text-4xl">
          Music theory
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Interactive theory tools that work independently of any video or
          instrument. Jump to <strong className="text-[var(--ink)]">Reference</strong>{' '}
          when you just need to look a formula up.
        </p>
        <div className="mt-4 inline-flex gap-1">
          {(
            [
              ['tools', 'Theory tools'],
              ['practice', 'Practice'],
              ['reference', 'Reference'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip${tab === id ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {tab === 'practice' ? (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-base font-semibold text-[var(--ink)]">
            Find the chords in a scale
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Pick a key and a box, then go find that chord inside the shape on
            your own instrument before revealing it. Triads are the three-note
            chords hiding in every scale position; power chords strip them to
            root and fifth. Boxes are the same ones the rest of the app uses,
            transcribed from guitarscale.org.
          </p>
          <div className="mt-6">
            <ScaleChordFinder />
          </div>
        </section>
      ) : tab === 'tools' ? (
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <h2 className="text-base font-semibold text-[var(--ink)]">
            Circle of fifths
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Pick any key as the tonic — the diatonic chord family (I-IV-V plus
            relative minors) lights up, and the wheel shows the key signature.
          </p>
          <div className="mt-6 flex justify-center">
            <div className="max-w-full">
              <CircleOfFifths />
            </div>
          </div>
        </section>
      ) : (
        <TheoryReference />
      )}
    </main>
  );
}
