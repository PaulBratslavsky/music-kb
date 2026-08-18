// /lessons/essential-chords — the 10 moveable shapes every guitarist
// should know, adapted from Blackstar's "10 chord shapes all guitar
// players need to know" article.
//
// The framing is intentional: these are SHAPES, not individual chords.
// Each shape is moveable — slide it up the neck and the root changes
// while the fingering stays the same. So "5 shapes" really means "60+
// chords once you can spell them on the fly."
//
// Each card shows:
//   - title + example chord at a specific fret (so the user has a
//     concrete fingering to try),
//   - compact chord-box diagram,
//   - the teaching note from the article (paraphrased),
//   - a link to /builder so the user can explore the same shape with
//     full fretboard context (octave-doubled notes, root labels,
//     barre overlay, etc.).

import { Link } from './components/Link';
import { ChordDiagram } from './components/LessonChordDiagram';

type EssentialChord = {
  id: string;
  title: string;
  /** A specific example of the shape at a concrete fret — gives the
   *  reader something to play right now. */
  example: string;
  /** 2-3 sentences explaining why this shape matters + how to play it. */
  description: string;
  /** Per-string state, [highE, B, G, D, A, lowE]. */
  strings: Array<
    | { kind: 'fretted'; fret: number; isRoot?: boolean }
    | { kind: 'open' }
    | { kind: 'muted' }
  >;
  /** Optional barre annotation, absolute fret. */
  barre?: { fret: number; fromString: number; toString: number };
  /** Override starting fret of the diagram window. */
  startFret?: number;
  /** /builder deep-link target — opens the chord on the full fretboard. */
  builderTarget?: { root: string; quality: string };
};

const CHORDS: EssentialChord[] = [
  {
    id: 'power',
    title: 'Power chord',
    example: 'G5 (root on low E, fret 3)',
    description:
      'Root + perfect 5th + octave. No 3rd, so it sounds neither major nor minor — works in both. The bread-and-butter of rock, punk, and metal.',
    strings: [
      { kind: 'muted' },
      { kind: 'muted' },
      { kind: 'muted' },
      { kind: 'fretted', fret: 5 },
      { kind: 'fretted', fret: 5 },
      { kind: 'fretted', fret: 3, isRoot: true },
    ],
    builderTarget: { root: 'G', quality: '5' },
  },
  {
    id: 'maj-e',
    title: 'E-shape major barre',
    example: 'F major (root on low E, fret 1)',
    description:
      'The open E shape moved up the neck. Index finger bars all 6 strings at the root fret. Probably the most-used barre shape in rock guitar — every major chord has an E-shape version.',
    strings: [
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 1, isRoot: true },
    ],
    barre: { fret: 1, fromString: 0, toString: 5 },
    builderTarget: { root: 'F', quality: 'maj' },
  },
  {
    id: 'min-e',
    title: 'Em-shape minor barre',
    example: 'Fm (root on low E, fret 1)',
    description:
      'Same as the E-shape major but the 3rd is flattened — lift the middle finger off the G string. One note of difference turns the chord from bright to dark.',
    strings: [
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 1, isRoot: true },
    ],
    barre: { fret: 1, fromString: 0, toString: 5 },
    builderTarget: { root: 'F', quality: 'min' },
  },
  {
    id: 'maj-a',
    title: 'A-shape major barre',
    example: 'B major (root on A, fret 2)',
    description:
      'The open A shape moved up. Root sits on the A string; low E is muted. A trickier barre — the ring finger usually mini-bars the D-G-B trio.',
    strings: [
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 4 },
      { kind: 'fretted', fret: 4 },
      { kind: 'fretted', fret: 4 },
      { kind: 'fretted', fret: 2, isRoot: true },
      { kind: 'muted' },
    ],
    barre: { fret: 2, fromString: 0, toString: 4 },
    builderTarget: { root: 'B', quality: 'maj' },
  },
  {
    id: 'min-a',
    title: 'Am-shape minor barre',
    example: 'Bm (root on A, fret 2)',
    description:
      'A-shape with the B-string 3rd flattened by one fret. Same low-E mute + A-string root.',
    strings: [
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 4 },
      { kind: 'fretted', fret: 4 },
      { kind: 'fretted', fret: 2, isRoot: true },
      { kind: 'muted' },
    ],
    barre: { fret: 2, fromString: 0, toString: 4 },
    builderTarget: { root: 'B', quality: 'min' },
  },
  {
    id: 'dom7-e',
    title: 'E-shape dominant 7',
    example: 'F7 (root on low E, fret 1)',
    description:
      'Major barre with the pinky lifted off — drops the octave root for the ♭7. Classic bluesy edge; the V chord in nearly every blues progression sits here.',
    strings: [
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 1, isRoot: true },
    ],
    barre: { fret: 1, fromString: 0, toString: 5 },
    builderTarget: { root: 'F', quality: 'dom7' },
  },
  {
    id: 'dom7-a',
    title: 'A-shape dominant 7',
    example: 'B7 (root on A, fret 2)',
    description:
      'A-shape major with the middle finger lifted off the D string — opens up the ♭7 on top. Common shape for jazz, swing, and the IV7 of a 12-bar blues.',
    strings: [
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 4 },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 4 },
      { kind: 'fretted', fret: 2, isRoot: true },
      { kind: 'muted' },
    ],
    barre: { fret: 2, fromString: 0, toString: 4 },
    builderTarget: { root: 'B', quality: 'dom7' },
  },
  {
    id: 'min7-e',
    title: 'E-shape minor 7',
    example: 'Fm7 (root on low E, fret 1)',
    description:
      "Em-shape with the pinky off (just like dom7 from major). Mellow, smooth — the vi7 chord of any progression, or the ii7 in a ii-V-I.",
    strings: [
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 1 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 1, isRoot: true },
    ],
    barre: { fret: 1, fromString: 0, toString: 5 },
    builderTarget: { root: 'F', quality: 'min7' },
  },
  {
    id: 'min7-a',
    title: 'A-shape minor 7',
    example: 'Bm7 (root on A, fret 2)',
    description:
      'Am-shape with the D-string flattened to expose the ♭7. The ii7 chord in countless jazz, bossa, and soul tunes (think the opening chord of "The Girl from Ipanema").',
    strings: [
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 3 },
      { kind: 'fretted', fret: 2 },
      { kind: 'fretted', fret: 4 },
      { kind: 'fretted', fret: 2, isRoot: true },
      { kind: 'muted' },
    ],
    barre: { fret: 2, fromString: 0, toString: 4 },
    builderTarget: { root: 'B', quality: 'min7' },
  },
  {
    id: 'hendrix',
    title: 'Hendrix 7♯9',
    example: 'E7♯9 (root on A, fret 7)',
    description:
      'The "Purple Haze" chord. Major 3rd against a ♯9 (= ♭3 enharmonic) creates the signature crunchy clash. Great for funky bluesy rhythms — root on A, low E muted.',
    strings: [
      { kind: 'muted' },
      { kind: 'fretted', fret: 8 },
      { kind: 'fretted', fret: 7 },
      { kind: 'fretted', fret: 6 },
      { kind: 'fretted', fret: 7, isRoot: true },
      { kind: 'muted' },
    ],
    barre: { fret: 7, fromString: 2, toString: 4 },
    startFret: 6,
    builderTarget: { root: 'E', quality: '7#9' },
  },
];

export default function EssentialChordsPage() {
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          10 essential chord shapes
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Instead of memorizing 50 individual chords, learn{' '}
          <strong className="text-[var(--ink)]">5 movable shapes</strong>{' '}
          plus a handful of variations and you'll have every major, minor,
          and 7th chord at any fret. Below are the 10 shapes Blackstar
          recommends as the foundation — power chord, the four CAGED barre
          forms (E + A, major + minor), four dominant/minor 7th variants,
          and the Hendrix 7♯9.
        </p>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Diagrams use the songbook convention — low E on the left, high E
          on the right. Orange dot = the root note. Click any card to open
          the shape on the full fretboard.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {CHORDS.map((c, i) => (
          <article
            key={c.id}
            className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--ink)]">
                <span className="mr-1 text-[var(--ink-muted)]">
                  {String(i + 1).padStart(2, '0')}.
                </span>{' '}
                {c.title}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{c.example}</p>
            <div className="mt-4 flex justify-center">
              <ChordDiagram
                strings={c.strings}
                barre={c.barre}
                startFret={c.startFret}
              />
            </div>
            <p className="mt-4 text-xs text-[var(--ink-soft)]">
              {c.description}
            </p>
            {c.builderTarget && (
              <div className="mt-4 flex justify-end">
                <Link
                  to="/builder"
                  search={{
                    theory: `chord:${c.builderTarget.root}:${c.builderTarget.quality}`,
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
                >
                  Open on fretboard →
                </Link>
              </div>
            )}
          </article>
        ))}
      </div>

      <footer className="mt-12 max-w-3xl text-xs text-[var(--ink-muted)]">
        <p>
          Adapted from{' '}
          <a
            href="https://blackstaramps.com/lessons/10-chord-shapes-all-guitar-players-need-to-know/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[var(--ink)]"
          >
            Blackstar's "10 Chord Shapes All Guitar Players Need to Know"
          </a>
          . The power of these shapes is that each one slides anywhere on
          the neck — learn the shape once, and you get all 12 root notes
          for free.
        </p>
      </footer>
    </main>
  );
}
