// A row of pattern pills over one shared MiniNeck.
//
// Built for the scale-system case: a section with five pentatonic boxes or
// seven 3NPS shapes to show. Stacking that many fretboards makes the page
// unreadable, so the pills swap one inline diagram instead. The shared
// fret window is the other half of the idea — with `fromFret`/`toFret`
// fixed for the whole set, stepping through the pills shows the patterns
// climbing the neck rather than each one being re-cropped to its own span.
//
// Ported from web/src/lessons/components/NeckPatternPicker.tsx with two
// deliberate removals:
//
//   - The `theory`/`linkLabel` deep link out to the fretboard explorer is
//     gone. Lessons here are self-contained — that principle is why the
//     diagrams are inline in the first place — and a "hear this on the
//     fretboard explorer →" affordance navigates the reader out mid-lesson
//     to a route this app doesn't even have.
//   - Patterns are keyed by array index rather than an authored `id`.
//     Strapi assigns every component row a numeric `id` of its own and the
//     lesson block schemas reject an author-supplied one (see the "field
//     naming trap: block `id`" note in docs/lesson-authoring.md), so an
//     `id` field here would have been a second, conflicting notion of
//     identity for no gain.

import { useState } from 'react';
import { MiniNeck, type NeckDot } from './MiniNeck';

export type NeckPattern = {
  /** Pill text, e.g. "Position 3". */
  label: string;
  /** Line under the diagram, e.g. "E minor pentatonic · frets 4–8". */
  sub?: string;
  dots: NeckDot[];
};

export function NeckPatternPicker({
  patterns,
  instrument = 'guitar',
  fromFret,
  toFret,
}: Readonly<{
  patterns: NeckPattern[];
  instrument?: 'guitar' | 'bass';
  /** Shared fret window for the whole set. */
  fromFret?: number;
  toFret?: number;
}>) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = patterns[activeIndex] ?? patterns[0];
  if (!active) return null;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {patterns.map((p, i) => (
          <button
            key={`${i}-${p.label}`}
            type="button"
            onClick={() => setActiveIndex(i)}
            aria-pressed={i === activeIndex}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              i === activeIndex
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink)] hover:border-[var(--line-strong)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <MiniNeck
          instrument={instrument}
          dots={active.dots}
          fromFret={fromFret}
          toFret={toFret}
          ariaLabel={`${active.label} — ${active.sub ?? 'fretboard pattern'}`}
        />
      </div>

      {active.sub ? (
        <p className="mt-3 text-xs text-[var(--ink-soft)]">{active.sub}</p>
      ) : null}
    </div>
  );
}
