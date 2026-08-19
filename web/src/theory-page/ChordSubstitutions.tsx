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

import { useState } from 'react';
import { Link } from '../components/Link';
import {
  diatonicSubs,
  minorDiatonicSubs,
  minorModalInterchange,
  minorSecondaryDominants,
  modalInterchange,
  secondaryDominants,
  type ChordSuggestion,
  type DiatonicChordSubs,
} from '@music-kb/music/theory/chord-substitutions';
import {
  CIRCLE_MAJOR_DISPLAY,
  CIRCLE_MINOR_DISPLAY,
} from '@music-kb/music/theory/circle-of-fifths';

// First substitution in each row already encodes the same root → can't
// re-use directly. Build a quality-aware link based on the Roman numeral
// instead: I/IV/V → maj, ii/iii/vi → min, vii° → dim. Returns null for
// shapes that don't map to a known ChordQuality.
function chordLinkForNumeral(row: DiatonicChordSubs): string | null {
  // Strip the chord's quality suffix (m, °) and keep the root letter +
  // any accidental (#, ♭). We use the raw `chord` string the helper
  // built, then re-derive the spelling sharp-side for the link.
  const m = row.chord.match(/^([A-G][♭#♯]?)/);
  if (!m) return null;
  // Convert any ♯ / ♭ in display to the parser's canonical ASCII form.
  const root = m[1].replace('♯', '#').replace('♭', 'b');
  // Parser accepts only sharp spellings for PitchClass, so flatten Db→C#, etc.
  const FLAT_TO_SHARP: Record<string, string> = {
    Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#',
  };
  const canon = FLAT_TO_SHARP[root] ?? root;
  if (row.numeral === 'V') return `chord:${canon}:maj`;
  if (row.numeral === 'I' || row.numeral === 'IV') return `chord:${canon}:maj`;
  if (row.numeral === 'ii' || row.numeral === 'iii' || row.numeral === 'vi') {
    return `chord:${canon}:min`;
  }
  if (row.numeral === 'vii°') return `chord:${canon}:dim`;
  return null;
}

export function ChordSubstitutions({ tonicIdx }: { tonicIdx: number }) {
  // Minor keys reharm differently enough to be worth their own view: the v
  // is minor and has no leading tone, bIII/bVI/bVII are diatonic rather
  // than borrowed, and interchange runs the other way — a minor key
  // borrows from the parallel MAJOR.
  const [mode, setMode] = useState<'major' | 'minor'>('major');
  const isMinor = mode === 'minor';

  const diatonic = isMinor ? minorDiatonicSubs(tonicIdx) : diatonicSubs(tonicIdx);
  const secondary = isMinor
    ? minorSecondaryDominants(tonicIdx)
    : secondaryDominants(tonicIdx);
  const borrowed = isMinor
    ? minorModalInterchange(tonicIdx)
    : modalInterchange(tonicIdx);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-[var(--ink)]">
            Substitutions in{' '}
            {isMinor
              ? `${CIRCLE_MINOR_DISPLAY[tonicIdx]} (${CIRCLE_MINOR_DISPLAY[tonicIdx].replace(/m$/, '')} minor)`
              : `${CIRCLE_MAJOR_DISPLAY[tonicIdx]} major`}
          </h3>
          <div className="inline-flex gap-1">
            {(['major', 'minor'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                className={`rounded-lg px-2 py-0.5 text-xs font-medium capitalize ${
                  mode === m
                    ? 'bg-[var(--accent)] text-white'
                    : 'border border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Pick a tonic on the wheel above. The lists below shift to that key
          automatically.{' '}
          {isMinor
            ? 'Minor reharms differently: the v has no leading tone, and ♭III/♭VI/♭VII are diatonic here rather than borrowed.'
            : ''}
        </p>
      </header>

      {/* Replacement table on the left, the two shorter lists (Secondary
          dominants + Modal interchange) stacked on the right. Halves the
          section's vertical footprint on wide screens; collapses to a
          single column on narrow ones. */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-6 lg:grid-cols-2 lg:items-start">
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
              {diatonic.map((row) => {
                // Build a self-link for the original diatonic chord too —
                // clicking "Dm" in the ii row should open Dm on the
                // fretboard, just like clicking a substitution chord does.
                const selfLink = chordLinkForNumeral(row);
                return (
                  <tr
                    key={row.numeral}
                    className="border-b border-[var(--line)] last:border-b-0"
                  >
                    <td className="px-3 py-2 font-mono text-xs text-[var(--ink-muted)]">
                      {row.numeral}
                    </td>
                    <td className="px-3 py-2 font-semibold text-[var(--ink)]">
                      {selfLink ? (
                        <Link
                          to="/builder"
                          search={{ theory: selfLink }}
                          className="text-[var(--ink)] no-underline hover:text-[var(--accent)] hover:underline"
                          title={`View ${row.chord} on the fretboard`}
                        >
                          {row.chord}
                        </Link>
                      ) : (
                        row.chord
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <ul className="flex flex-col gap-1">
                        {row.subs.map((s, i) => (
                          <SubLine key={i} sub={s} />
                        ))}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-col gap-6">
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
            {isMinor
              ? 'Modal interchange (borrowed from parallel major)'
              : 'Modal interchange (borrowed from parallel minor)'}
          </h4>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {isMinor
              ? `Chords from ${CIRCLE_MINOR_DISPLAY[tonicIdx].replace(/m$/, '')} major dropped into the minor progression — interchange runs the other way here. The Picardy third is the classic case.`
              : `Chords from the ${CIRCLE_MAJOR_DISPLAY[tonicIdx]} natural-minor key dropped into the major progression. Changes the color without changing the key.`}
          </p>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {borrowed.map((s, i) => (
              <SubLine key={i} sub={s} />
            ))}
          </ul>
        </section>
      </div>
      </div>
    </div>
  );
}

function SubLine({ sub }: { sub: ChordSuggestion }) {
  // When a deep-link target is available, wrap the chord chip in a Link to
  // /builder so the user can see the chord on a fretboard with one click.
  // Otherwise render as plain text — keeps exotic suggestions visible
  // even when we don't have a matching ChordQuality for them.
  const chip = (
    <span className="inline-block min-w-[2.75rem] rounded border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-0.5 text-center font-semibold text-[var(--ink)] transition group-hover:border-[var(--accent)] group-hover:bg-[var(--accent-soft)]">
      {sub.name}
    </span>
  );
  return (
    <li className="flex flex-wrap items-baseline gap-2">
      {sub.link ? (
        <Link
          to="/builder"
          search={{ theory: sub.link }}
          className="group no-underline"
          title={`View ${sub.name} on the fretboard`}
        >
          {chip}
        </Link>
      ) : (
        chip
      )}
      <span className="text-xs text-[var(--ink-soft)]">{sub.why}</span>
    </li>
  );
}
