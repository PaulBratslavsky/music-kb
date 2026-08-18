// #/theory — the theory section.
//
// Three tabs, mirroring the useful half of music-kb's /theory:
//   Tools     — the circle of fifths + chord substitutions
//   Practice  — find the chords in a scale
//   Reference — the generated cheat sheet
//
// music-kb also has Visualizer / Compose tabs there; the visualizer
// already IS this app's home, and Compose can follow later.

import { useState } from 'react';
import { ChordSubstitutions } from './ChordSubstitutions';
import { CircleOfFifths } from '../music/CircleOfFifths';
import { TheoryReference } from './TheoryReference';
import { ScaleChordFinder } from './ScaleChordFinder';

type Tab = 'tools' | 'practice' | 'reference';

export function TheoryPage() {
  const [tab, setTab] = useState<Tab>('tools');
  // Shared by the wheel and the substitutions table below it, so picking a
  // key in one moves the other.
  const [tonicIdx, setTonicIdx] = useState(0);

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
              <CircleOfFifths onTonicChange={setTonicIdx} />
            </div>
          </div>

          <div className="mt-10 border-t border-[var(--line)] pt-8">
            <h2 className="text-base font-semibold text-[var(--ink)]">
              Chord substitutions
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              Common reharmonization options for the diatonic chords of the
              key selected on the wheel — replacement chords, secondary
              dominants, and modal interchange. Minor keys get their own
              view: the v has no leading tone, and ♭III/♭VI/♭VII are
              diatonic there rather than borrowed. Click any chord name to
              see it on the fretboard.
            </p>
            <div className="mt-6">
              <ChordSubstitutions tonicIdx={tonicIdx} />
            </div>
          </div>
        </section>
      ) : (
        <TheoryReference />
      )}
    </main>
  );
}
