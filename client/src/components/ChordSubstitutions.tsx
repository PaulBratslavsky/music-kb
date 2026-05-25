// Chord substitution suggestions for a major-key tonic. Three sections:
//
//   1. Diatonic-function substitutes — chord-by-chord, what each diatonic
//      chord can be replaced with (vi for I, ii for IV, tritone sub for V,
//      and so on). The everyday reharm toolkit.
//
//   2. Secondary dominants — V7 of each non-tonic diatonic chord. Treats
//      each target as a temporary tonic to add forward motion.
//
//   3. Modal interchange — chords borrowed from the parallel minor key
//      (bIII, bVI, bVII, iv). The "color" reharms that change mood
//      without changing key.
//
// Pure presentational. Tonic is supplied as a circle index so the page
// can share state with <CircleOfFifths/>.

import {
  diatonicSubs,
  modalInterchange,
  secondaryDominants,
  type ChordSuggestion,
} from '#/lib/music/chord-substitutions';
import {
  CIRCLE_MAJOR_DISPLAY,
} from '#/lib/music/circle-of-fifths';

export function ChordSubstitutions({ tonicIdx }: { tonicIdx: number }) {
  const diatonic = diatonicSubs(tonicIdx);
  const secondary = secondaryDominants(tonicIdx);
  const borrowed = modalInterchange(tonicIdx);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h3 className="text-base font-semibold text-[var(--ink)]">
          Substitutions in {CIRCLE_MAJOR_DISPLAY[tonicIdx]} major
        </h3>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Pick a tonic on the wheel above. The lists below shift to that key
          automatically.
        </p>
      </header>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Replacement chords (per diatonic function)
        </h4>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <th className="px-3 py-2 font-medium">Roman</th>
                <th className="px-3 py-2 font-medium">Chord</th>
                <th className="px-3 py-2 font-medium">Substitutes</th>
              </tr>
            </thead>
            <tbody>
              {diatonic.map((row) => (
                <tr
                  key={row.numeral}
                  className="border-b border-[var(--line)] last:border-b-0"
                >
                  <td className="px-3 py-2 font-mono text-xs text-[var(--ink-muted)]">
                    {row.numeral}
                  </td>
                  <td className="px-3 py-2 font-semibold text-[var(--ink)]">
                    {row.chord}
                  </td>
                  <td className="px-3 py-2">
                    <ul className="flex flex-col gap-1">
                      {row.subs.map((s, i) => (
                        <SubLine key={i} sub={s} />
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Secondary dominants
        </h4>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          A V7 chord pointing at a non-tonic diatonic target. Adds tension
          before the resolution; common in jazz, bossa, and pre-chorus
          builds.
        </p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {secondary.map((s, i) => (
            <SubLine key={i} sub={s} />
          ))}
        </ul>
      </section>

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Modal interchange (borrowed from parallel minor)
        </h4>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Chords from the {CIRCLE_MAJOR_DISPLAY[tonicIdx]} natural-minor key
          dropped into the major progression. Changes the color without
          changing the key.
        </p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {borrowed.map((s, i) => (
            <SubLine key={i} sub={s} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function SubLine({ sub }: { sub: ChordSuggestion }) {
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      <span className="inline-block min-w-[2.75rem] rounded border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-0.5 text-center font-semibold text-[var(--ink)]">
        {sub.name}
      </span>
      <span className="text-xs text-[var(--ink-soft)]">{sub.why}</span>
    </li>
  );
}
