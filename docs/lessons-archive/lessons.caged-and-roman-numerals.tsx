// /lessons/caged-and-roman-numerals — part 3 of the three-part guitar
// theory track. "Layer 2": chord visualization on the neck (CAGED) and
// transposing progressions in your head (Roman numerals).
//
// CAGED = the 5 open-position major chord shapes (C, A, G, E, D)
// re-thought as movable barre shapes that interlock across the whole
// fretboard. Each shape's diagram uses the shared ChordDiagram
// component; the "Try as barre" link sends the user to /builder to
// explore the same shape at higher frets.

import { createFileRoute, Link } from '@tanstack/react-router';
import type { ComponentProps } from 'react';
import { ChordDiagram } from '#/components/ChordDiagram';
import { Callout, Step } from '#/components/lesson/Step';

export const Route = createFileRoute(
  '/lessons/caged-and-roman-numerals',
)({
  component: CagedAndRomanNumeralsPage,
  head: () => ({
    meta: [{ title: 'CAGED + Roman numerals · Music KB' }],
  }),
});

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

const MINOR_TABLE: Array<{
  num: string;
  quality: string;
  a: string;
  e: string;
  d: string;
}> = [
  { num: 'i', quality: 'minor', a: 'Am', e: 'Em', d: 'Dm' },
  { num: 'ii°', quality: 'diminished', a: 'B°', e: 'F#°', d: 'E°' },
  { num: 'III', quality: 'major', a: 'C', e: 'G', d: 'F' },
  { num: 'iv', quality: 'minor', a: 'Dm', e: 'Am', d: 'Gm' },
  { num: 'v', quality: 'minor', a: 'Em', e: 'Bm', d: 'Am' },
  { num: 'VI', quality: 'major', a: 'F', e: 'C', d: 'B♭' },
  { num: 'VII', quality: 'major', a: 'G', e: 'D', d: 'C' },
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

function CagedAndRomanNumeralsPage() {
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

        <h3 className="mt-8 text-base font-semibold text-[var(--ink)]">
          The same idea in a minor key
        </h3>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Minor keys use the same seven chords — the pattern just starts
          somewhere else. A natural minor scale is its relative major
          beginning on the 6th degree, so{' '}
          <strong className="text-[var(--ink)]">
            A minor contains exactly the chords of C major
          </strong>
          . Nothing new to learn: the numbering shifts, the chords don't.
        </p>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          What does change is which one feels like home, and that changes
          the pattern of qualities: minor keys run{' '}
          <code>i ii° III iv v VI VII</code> — one minor, one diminished,
          then major, minor, minor, major, major.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--line)]">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="bg-[var(--bg-subtle)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
              <tr>
                <th className="px-3 py-2">Numeral</th>
                <th className="px-3 py-2">Quality</th>
                <th className="px-3 py-2">Key of Am</th>
                <th className="px-3 py-2">Key of Em</th>
                <th className="px-3 py-2">Key of Dm</th>
              </tr>
            </thead>
            <tbody>
              {MINOR_TABLE.map((r) => (
                <tr key={r.num} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 font-semibold text-[var(--ink)]">
                    {r.num}
                  </td>
                  <td className="px-3 py-2 text-[var(--ink-soft)]">
                    {r.quality}
                  </td>
                  <td className="px-3 py-2 text-[var(--ink-soft)]">{r.a}</td>
                  <td className="px-3 py-2 text-[var(--ink-soft)]">{r.e}</td>
                  <td className="px-3 py-2 text-[var(--ink-soft)]">{r.d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Compare the Am column with the key of C above: same seven
          chords, rotated so Am is number one. That is the whole
          relationship between a key and its relative minor.
        </p>
        <Callout>
          <strong>The one chord that isn't diatonic:</strong> that{' '}
          <code>v</code> is minor, so it has no leading tone pulling back
          to the tonic — Em to Am is a gentle landing, not a resolution.
          Which is why so much minor music raises its third and plays{' '}
          <code>V</code> instead: E major in A minor, borrowing the G♯
          from harmonic minor. If a minor song sounds unexpectedly
          strong going home, that is usually what it did.
        </Callout>
        <p className="mt-4 text-sm text-[var(--ink-soft)]">
          Minor progressions in numbers:{' '}
          <code>i–VI–III–VII</code> (the Andalusian-adjacent pop minor),{' '}
          <code>i–iv–v</code> (minor blues),{' '}
          <code>i–VII–VI–V</code> (flamenco descent, with the raised V).
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
