// /lessons/find-any-chord — the "2 strings, 4 shapes" pedagogy.
//
// The core idea: if you can find any note on the low E and A strings,
// you can play any major, minor, or power chord because all four
// movable shapes anchor their root on one of those two strings. This
// lesson walks the learner through:
//   1. Memorize the natural notes on the low E and A strings.
//   2. Learn the power chord shape — neither major nor minor, drop it
//      on any root and play.
//   3. Play along with rock songs (mostly power chords).
//   4. Layer on the four barre shapes (E/A × major/minor) for chord
//      voicings with a clear major or minor color.
//
// Reuses ChordDiagram for the 4 shapes; NaturalNotesStrings for the
// dedicated two-string view that visualizes step 1.

import { Link } from '../components/Link';
import { ChordDiagram } from './components/LessonChordDiagram';
import { NaturalNotesStrings } from './components/NaturalNotesStrings';
import { Step } from './components/Step';

// The 4 shapes the lesson uses. Same data shape as on
// /lessons/essential-chords — kept inline rather than imported because
// the per-card copy here is lesson-specific ("anchor on E", "anchor on A").
const SHAPES: Array<{
  id: string;
  title: string;
  example: string;
  anchor: 'E' | 'A';
  description: string;
  strings: Array<
    | { kind: 'fretted'; fret: number; isRoot?: boolean }
    | { kind: 'open' }
    | { kind: 'muted' }
  >;
  barre?: { fret: number; fromString: number; toString: number };
  builderTarget?: { root: string; quality: string };
}> = [
  {
    id: 'power',
    title: 'Power chord',
    example: 'G5',
    anchor: 'E',
    description:
      'Root + 5th + octave-root. No 3rd, so it sounds neither major nor minor. Anchors equally well on the low E string or A string.',
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
    example: 'F major',
    anchor: 'E',
    description:
      'Root on the low E string. Barre your index finger across all 6 strings at the root fret, then fret the rest with fingers 2, 3, 4.',
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
    example: 'Fm',
    anchor: 'E',
    description:
      'Same as the E-shape major but the 3rd is lowered — lift the middle finger off the G string. One note flips the chord from bright to dark.',
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
    example: 'B major',
    anchor: 'A',
    description:
      'Root on the A string; low E is muted. The trickier barre — most guitarists let the ring finger mini-bar the D-G-B strings.',
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
    example: 'Bm',
    anchor: 'A',
    description:
      'A-shape with the B-string note lowered by one fret. Same A-string root + low-E mute.',
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
];

// Curated practice songs — mostly power chord driven, easy to find
// recordings of, plenty of YouTube guitar covers. Picked across decades
// so the learner isn't trapped in one era.
const PRACTICE_SONGS = [
  { title: 'Smoke on the Water', artist: 'Deep Purple', riff: 'G5  B♭5  C5 — the iconic opening riff is 3 power chords.' },
  { title: 'Iron Man', artist: 'Black Sabbath', riff: 'Slow power chord progression — perfect tempo for finding roots on the fly.' },
  { title: 'Smells Like Teen Spirit', artist: 'Nirvana', riff: 'F5  B♭5  A♭5  D♭5 — chorus is straight power chords across the neck.' },
  { title: 'Seven Nation Army', artist: 'The White Stripes', riff: 'E5  G5  E5  D5  C5  B5 — single-string root walk, ideal for memorizing the E string.' },
  { title: 'Blitzkrieg Bop', artist: 'Ramones', riff: 'A5  D5  E5 — the entire song. Pure E-string + A-string power chord drill.' },
  { title: 'Brain Stew', artist: 'Green Day', riff: 'A5  G5  F♯5  F5  E5 — chromatic descent that drills natural-note hunting.' },
];

export default function FindAnyChordPage() {
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-10 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · pedagogy
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          Find any chord with 2 strings + 4 shapes
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          You don't need to memorize 60 chord shapes. You need to know the
          natural notes on <strong className="text-[var(--ink)]">two strings</strong>{' '}
          (low E + A) and{' '}
          <strong className="text-[var(--ink)]">four movable shapes</strong>{' '}
          (power chord, plus E/A barre × major/minor). That's enough to
          play any major, minor, or power chord at any fret. Work the
          steps below in order — each one earns you the next.
        </p>
      </header>

      {/* ------------------------------------------------------------ Step 1 */}
      <Step
        number={1}
        title="Learn the natural notes on the low E and A strings"
        lede="If you know the 14 natural notes on these two strings, every sharp and flat is one fret away. Watch the two red bands — those are the half-step pairs where B → C and E → F sit one fret apart, the spots most beginners trip on."
      >
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <NaturalNotesStrings />
          <ul className="mt-4 grid grid-cols-1 gap-2 text-xs text-[var(--ink-soft)] sm:grid-cols-2">
            <li>
              <strong className="text-[var(--ink)]">Low E string</strong>:
              E (open) — F (1) — G (3) — A (5) — B (7) — C (8) — D (10) — E (12)
            </li>
            <li>
              <strong className="text-[var(--ink)]">A string</strong>:
              A (open) — B (2) — C (3) — D (5) — E (7) — F (8) — G (10) — A (12)
            </li>
            <li>
              <strong className="text-[var(--ink)]">Half-step pairs</strong>:
              B→C and E→F are only 1 fret apart (no black key between).
              The other pairs (A→B, C→D, etc.) are 2 frets / a whole step.
            </li>
            <li>
              <strong className="text-[var(--ink)]">Sharps + flats</strong>:
              every accidental sits one fret up from the natural below it.
              Know F (low E fret 1) → F♯ is fret 2.
            </li>
          </ul>
          <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--ink-muted)]">
            <strong className="text-[var(--ink)]">Practice drill:</strong>{' '}
            say each note's name out loud as you fret it. Start on the low
            E open and walk up to the 12th fret naming every natural; do
            the same on the A string. 5 minutes a day for a week and you
            won't have to count frets anymore.
          </div>
        </div>
      </Step>

      {/* ------------------------------------------------------------ Step 2 */}
      <Step
        number={2}
        title="Power chord — your first universal shape"
        lede="The power chord is just root + 5th + octave. No 3rd, so it doesn't commit to major or minor — same shape works whether the song is in a major key or a minor key. Anchor the shape on the low E string (or the A string) at whatever natural note you want, and you've named the chord."
      >
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
          <div className="flex justify-center">
            <ChordDiagram strings={SHAPES[0].strings} />
          </div>
          <div className="text-sm text-[var(--ink-soft)]">
            <p>
              <strong className="text-[var(--ink)]">G5 example</strong> —
              root on the low E string at fret 3 (G). Power chord shape:
              fret the next two strings (A and D) two frets above the root.
              Slide the whole shape down to fret 1 → F5. Up to fret 5 →
              A5. The shape never changes; only the anchor note does.
            </p>
            <p className="mt-3">
              You can also anchor power chords on the{' '}
              <strong className="text-[var(--ink)]">A string</strong> —
              same shape, root on the second-lowest string. Pick whichever
              is closer to the next chord in the song.
            </p>
            <div className="mt-4">
              <Link
                to="/builder"
                search={{ theory: `chord:${SHAPES[0].builderTarget!.root}:${SHAPES[0].builderTarget!.quality}` }}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
              >
                Open G5 on the fretboard →
              </Link>
            </div>
          </div>
        </div>
      </Step>

      {/* ------------------------------------------------------------ Step 3 */}
      <Step
        number={3}
        title="Practice with songs you already know"
        lede="Power chords carry most of rock, punk, and metal. Pick a song you love and try to play along — the goal is finding roots fast, not perfect tone. These are some great starter tracks for the 2-strings drill:"
      >
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PRACTICE_SONGS.map((s) => (
            <li
              key={s.title}
              className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <strong className="text-sm text-[var(--ink)]">{s.title}</strong>
                <span className="text-xs text-[var(--ink-muted)]">{s.artist}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">{s.riff}</p>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-[var(--ink-muted)]">
          Once a song feels easy, switch which string you're anchoring on:
          play the same progression with all-A-string roots, then all-low-E
          roots. Picks up tempo + cements both anchors at once.
        </p>
      </Step>

      {/* ------------------------------------------------------------ Step 4 */}
      <Step
        number={4}
        title="Layer on the four barre shapes — major and minor at every fret"
        lede="Now the chords get a clear major or minor color. Each shape anchors on the same two strings you already memorized. Slide each one to wherever the root sits."
      >
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {SHAPES.slice(1).map((s) => (
            <article
              key={s.id}
              className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"
            >
              <h3 className="text-sm font-semibold text-[var(--ink)]">
                {s.title}
              </h3>
              <p className="text-xs text-[var(--ink-muted)]">
                {s.example} · anchors on the {s.anchor} string
              </p>
              <div className="my-3 flex justify-center">
                <ChordDiagram strings={s.strings} barre={s.barre} />
              </div>
              <p className="text-xs text-[var(--ink-soft)]">{s.description}</p>
              {s.builderTarget && (
                <div className="mt-3 flex justify-end">
                  <Link
                    to="/builder"
                    search={{ theory: `chord:${s.builderTarget.root}:${s.builderTarget.quality}` }}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
                  >
                    On fretboard →
                  </Link>
                </div>
              )}
            </article>
          ))}
        </div>
        <div className="mt-6 max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-5 text-sm text-[var(--ink-soft)]">
          <p className="font-semibold text-[var(--ink)]">Putting it together</p>
          <p className="mt-2">
            With the 2 strings + 4 shapes you can now reach{' '}
            <strong className="text-[var(--ink)]">every major and minor chord at every fret</strong>.
            Want C major? C is at fret 8 on the low E or fret 3 on the A.
            Slide the E-shape barre to fret 8 or the A-shape barre to
            fret 3 — both are C major, just different voicings. Pick
            whichever sits closer to the next chord in the progression.
          </p>
          <p className="mt-2">
            Power chord, E-shape barre, Em-shape barre, A-shape barre,
            Am-shape barre = the rock-guitar starter kit. From here, every
            other chord (7ths, sus chords, extended jazz voicings) is a
            small modification of one of these five.
          </p>
        </div>
      </Step>

      <footer className="mt-12 max-w-3xl text-xs text-[var(--ink-muted)]">
        <p>
          Next steps: explore the full set of 10 shapes on the{' '}
          <Link
            to="/lessons/essential-chords"
            className="underline hover:text-[var(--ink)]"
          >
            essential chord shapes
          </Link>{' '}
          page, or open any of the chords above on the{' '}
          <Link to="/builder" className="underline hover:text-[var(--ink)]">
            fretboard explorer
          </Link>{' '}
          to see them with all the chord tones labeled.
        </p>
      </footer>
    </main>
  );
}

