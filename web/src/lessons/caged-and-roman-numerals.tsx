// /lessons/caged-and-roman-numerals — part 3 of the three-part guitar
// theory track. "Layer 2": chord visualization on the neck (CAGED) and
// transposing progressions in your head (Roman numerals).
//
// CAGED = the 5 open-position major chord shapes (C, A, G, E, D)
// re-thought as movable barre shapes that interlock across the whole
// fretboard. Each shape's diagram uses the shared ChordDiagram
// component; the "Try as barre" link sends the user to /builder to
// explore the same shape at higher frets.

import { Link } from '../components/Link';
import type { ComponentProps } from 'react';
import { ChordDiagram } from './components/LessonChordDiagram';
import { Callout, Step } from './components/Step';

type StringStates = ComponentProps<typeof ChordDiagram>['strings'];

const CAGED_SHAPES: Array<{
  letter: 'C' | 'A' | 'G' | 'E' | 'D';
  blurb: string;
  strings: StringStates;
}> = [
  {
    letter: 'C',
    blurb:
      'C major in open position. Roots on the A and B strings. As a barre form, the widest stretch of the five.',
    strings: [
      { kind: 'open' },
      { kind: 'fretted', fret: 1 },
      { kind: 'open' },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 3, isRoot: true },
      { kind: 'muted' },
    ],
  },
  {
    letter: 'A',
    blurb:
      'A major in open position. Root on open A. The barre form ("A-shape") is the second most common after E-shape.',
    strings: [
      { kind: 'open' },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 2 },
      { kind: 'open' },
      { kind: 'muted' },
    ],
  },
  {
    letter: 'G',
    blurb:
      'G major in open position. Roots on low-E (fret 3) and high-E (fret 3). The widest stretch of the open shapes.',
    strings: [
      { kind: 'fretted', fret: 3 },
      { kind: 'open' },
      { kind: 'open' },
      { kind: 'open' },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 3, isRoot: true },
    ],
  },
  {
    letter: 'E',
    blurb:
      'E major in open position. Root on open low-E. As a barre form, the single most-used shape in rock guitar.',
    strings: [
      { kind: 'open' },
      { kind: 'open' },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 2 },
      { kind: 'open' },
    ],
  },
  {
    letter: 'D',
    blurb:
      'D major in open position. Root on open D. Compact three-fret window; lowest two strings muted.',
    strings: [
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 2 },
      { kind: 'open' },
      { kind: 'muted' },
      { kind: 'muted' },
    ],
  },
];

const ROMAN_TABLE = [
  { num: 'I', quality: 'major', c: 'C', g: 'G', a: 'A' },
  { num: 'ii', quality: 'minor', c: 'Dm', g: 'Am', a: 'Bm' },
  { num: 'iii', quality: 'minor', c: 'Em', g: 'Bm', a: 'C♯m' },
  { num: 'IV', quality: 'major', c: 'F', g: 'C', a: 'D' },
  { num: 'V', quality: 'major', c: 'G', g: 'D', a: 'E' },
  { num: 'vi', quality: 'minor', c: 'Am', g: 'Em', a: 'F♯m' },
  { num: 'vii°', quality: 'diminished', c: 'B°', g: 'F♯°', a: 'G♯°' },
];

export default function CagedAndRomanNumeralsPage() {
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-10 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · part 3 of 3 · chords + transposition
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          CAGED + thinking in numbers
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          CAGED shows where every chord lives across the whole neck (so
          soloing can target chord tones). Roman numerals let you
          describe progressions in a way that transposes to any key for
          free. Together, these turn the fretboard into one
          interconnected map.
        </p>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Part 3 of 3 ·{' '}
          <Link
            to="/lessons/music-theory-fundamentals"
            className="underline hover:text-[var(--ink)]"
          >
            ← Part 1
          </Link>{' '}
          ·{' '}
          <Link
            to="/lessons/scale-systems-on-the-neck"
            className="underline hover:text-[var(--ink)]"
          >
            ← Part 2
          </Link>
        </p>
      </header>

      {/* ----------------------------------------------------- Section 1 */}
      <Step
        number={1}
        title="The CAGED system"
        lede="The 5 open-position major shapes (C, A, G, E, D) are also the
          5 movable shapes that, together, cover the entire fretboard.
          Slide any of them up the neck (with a barre replacing the open
          strings) and the chord name changes but the shape stays
          identical."
      >
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          The acronym <strong>C-A-G-E-D</strong> is also the order in
          which the shapes chain when you walk a single chord up the
          neck. Play C major using the C-shape at fret 0, then again
          using the A-shape at fret 3, the G-shape at fret 5, and so on
          — all five shapes give you the same C major chord, just at
          different positions.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {CAGED_SHAPES.map((shape) => (
            <article
              key={shape.letter}
              className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
            >
              <h3 className="text-base font-semibold text-[var(--ink)]">
                {shape.letter}-shape
              </h3>
              <div className="mt-3 flex justify-center">
                <ChordDiagram strings={shape.strings} />
              </div>
              <p className="mt-3 text-xs text-[var(--ink-soft)]">
                {shape.blurb}
              </p>
              <div className="mt-3">
                <Link
                  to="/builder"
                  search={{ theory: `chord:${shape.letter}:maj` }}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
                >
                  Try as barre →
                </Link>
              </div>
            </article>
          ))}
        </div>
        <Callout>
          The same five shapes apply to minor chords — flatten each
          shape's 3rd to convert. Memorize where the root sits inside
          each shape and you can find any major or minor chord at any
          fret.
        </Callout>
      </Step>

      {/* ----------------------------------------------------- Section 2 */}
      <Step
        number={2}
        title="Thinking in numbers (Roman numerals)"
        lede="Stop naming progressions by their chord letters and start
          naming them by their scale degree. I–V–vi–IV in C is C-G-Am-F.
          The same I–V–vi–IV in G is G-D-Em-C. Same progression. Same
          feeling. Different key. The number form transposes for free."
      >
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          The qualities are fixed for every major key — the same
          3-major / 3-minor / 1-diminished pattern from{' '}
          <Link to="/lessons/music-theory-fundamentals" className="underline">
            Principle 4
          </Link>{' '}
          in part 1:
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)]">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-[var(--bg-subtle)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
              <tr>
                <th className="px-3 py-2">Numeral</th>
                <th className="px-3 py-2">Quality</th>
                <th className="px-3 py-2">Key of C</th>
                <th className="px-3 py-2">Key of G</th>
                <th className="px-3 py-2">Key of A</th>
              </tr>
            </thead>
            <tbody>
              {ROMAN_TABLE.map((r) => (
                <tr key={r.num} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 font-semibold text-[var(--ink)]">
                    {r.num}
                  </td>
                  <td className="px-3 py-2 text-[var(--ink-soft)]">
                    {r.quality}
                  </td>
                  <td className="px-3 py-2 text-[var(--ink-soft)]">{r.c}</td>
                  <td className="px-3 py-2 text-[var(--ink-soft)]">{r.g}</td>
                  <td className="px-3 py-2 text-[var(--ink-soft)]">{r.a}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout>
          <strong>Pop progressions in numbers:</strong>{' '}
          <code>I–V–vi–IV</code> (every other pop song),{' '}
          <code>vi–IV–I–V</code> (sad pop),{' '}
          <code>I–vi–IV–V</code> (50s doo-wop),{' '}
          <code>ii–V–I</code> (jazz). Once you read progressions in
          numerals, the difference between songs in C, G, A and B♭
          disappears — same shape on the wheel, different starting note.
        </Callout>
        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          The{' '}
          <Link to="/theory" className="underline">
            Circle of Fifths
          </Link>{' '}
          highlights the I-IV-V-vi-ii-iii cluster around any tonic you
          click — a visual shortcut for spotting the diatonic family in
          any key.
        </p>
      </Step>

      <footer className="mt-12 max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-6">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          You finished the track
        </h2>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Theory → neck → chords. The three lessons cover the
          fundamentals that let everything else (modes, extensions, jazz
          voicings) sit on top. Next steps: use the{' '}
          <Link to="/theory" className="underline">
            Circle of Fifths
          </Link>{' '}
          and{' '}
          <Link to="/builder" className="underline">
            fretboard explorer
          </Link>{' '}
          to test what you've learned, or grab the{' '}
          <Link to="/lessons/essential-chords" className="underline">
            10 essential shapes
          </Link>{' '}
          reference.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/lessons"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-1.5 text-sm font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
          >
            Back to lessons
          </Link>
        </div>
      </footer>
    </main>
  );
}
