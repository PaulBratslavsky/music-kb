// /lessons/power-chords — one shape, the whole neck.
//
// A power chord is the simplest thing on the guitar and still has two
// details worth a lesson: it is THREE notes (root, fifth, octave) rather
// than the dyad people often draw, and the shape changes when it crosses
// the G–B string pair. Both are the kind of thing you learn once and then
// never think about again — which is exactly what a lesson is for.
//
// It also has an honest gap worth teaching: there is no power chord on a
// diminished degree, because root + ♭5 is a tritone, not a fifth.

import { createFileRoute, Link } from '@tanstack/react-router';
import { MiniNeck, type NeckDot } from '#/components/lesson/MiniNeck';
import { chordGrip } from '@music-kb/music/theory/power-chords';

export const Route = createFileRoute('/lessons/power-chords')({
  component: PowerChordsPage,
  head: () => ({ meta: [{ title: 'Power chords · Music KB' }] }),
});

const POWER = [0, 7, 12];
const ROLES = ['R', '5', 'R'];
function Shape({
  string,
  fret,
  caption,
}: {
  string: number;
  fret: number;
  caption: string;
}) {
  const grip = chordGrip(string, fret, POWER);
  if (!grip) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
        <p className="text-xs text-[var(--ink-muted)]">
          No shape here — not enough strings above the root.
        </p>
      </div>
    );
  }
  const dots: NeckDot[] = grip.map((p, i) => ({
    string: p.string,
    fret: p.fret,
    label: ROLES[i],
    root: ROLES[i] === 'R',
  }));
  const lo = Math.min(...grip.map((p) => p.fret));
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
      <MiniNeck
        dots={dots}
        fromFret={Math.max(0, lo - 1)}
        toFret={lo + 4}
        ariaLabel={caption}
      />
      <p className="mt-1 text-center text-xs text-[var(--ink-muted)]">
        {caption}
      </p>
    </div>
  );
}

function PowerChordsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · Chords · Shapes
        </p>
        <h1 className="mt-1 text-3xl font-bold text-[var(--ink)] sm:text-4xl">
          Power chords: one shape, the whole neck
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          A power chord is a root, the fifth above it, and the octave on
          top. It has no third, which is why it's neither major nor minor —
          and why it sits under almost every rock riff ever written: it
          fits over either.
        </p>
      </header>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          1. The shape
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Root on a low string, fifth two frets up on the next string,
          octave two frets up on the string after that. Three notes, one
          hand position.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Shape string={5} fret={0} caption="E5 — open, low E string" />
          <Shape string={5} fret={3} caption="G5 — same shape, 3rd fret" />
          <Shape string={5} fret={8} caption="C5 — same shape, 8th fret" />
        </div>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Those are the same fingering three times. That's the whole
          appeal: learn the natural notes on the low E and A strings and
          this one shape gives you every power chord there is.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          2. Move it to the A string
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Identical shape, new root string. The E and A strings between them
          cover every root without leaving the first twelve frets.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Shape string={4} fret={3} caption="C5 — A string, 3rd fret" />
          <Shape string={4} fret={5} caption="D5 — A string, 5th fret" />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          3. The one exception: the B string
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Standard tuning is all perfect fourths except <strong>G to B</strong>,
          which is a major third. Any shape crossing that pair has to
          stretch one fret further to reach the same interval — so a power
          chord rooted on the G string is <strong>+3</strong> to the fifth,
          not +2.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Shape string={3} fret={5} caption="G5 — D string root, the usual +2 / +2" />
          <Shape string={2} fret={5} caption="C5 — G string root, note the +3 stretch" />
        </div>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          You don't have to memorise the number. Just know that shapes stop
          behaving once they touch the B string, and check the interval by
          ear when they do — it's the same reason chord shapes look
          different on the top two strings.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          4. Where there is no power chord
        </h2>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Every key has one degree you can't play this shape on. In a major
          key it's the <strong>vii°</strong>; in a natural minor key it's
          the <strong>ii°</strong>. Those chords are diminished, meaning
          their fifth is flattened — and root plus a flat fifth is a{' '}
          <strong>tritone</strong>, not a fifth at all.
        </p>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Play the normal shape there anyway and you sound a note outside
          the key. In E minor that degree is F♯: the shape would give you
          C♯, but the key only contains C. Most players simply avoid it, or
          move the shape to a neighbouring degree.
        </p>
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
          <p className="text-sm text-[var(--ink-soft)]">
            <strong className="text-[var(--ink)]">Try it:</strong> in{' '}
            <Link
              to="/theory"
              search={{ tab: 'practice' }}
              className="font-medium text-[var(--accent)]"
            >
              Theory → Practice
            </Link>
            , switch to Power chords and step through the degrees. The
            diminished one is marked, and deliberately has no shape to find.
          </p>
        </div>
      </section>

      <Link to="/lessons" className="text-sm text-[var(--ink-muted)] no-underline">
        ← All lessons
      </Link>
    </main>
  );
}
