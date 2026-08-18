// A row of pattern pills over one shared MiniNeck.
//
// Built for /lessons/scale-systems-on-the-neck, where a section has five
// pentatonic boxes or seven 3NPS patterns to show. Stacking that many
// fretboards makes the page unreadable and shipping them as links makes
// the reader leave mid-lesson — so the pills swap one inline diagram.
//
// The deep-link to /builder stays as a secondary action for the reader who
// wants to hear the pattern, but nothing in the lesson depends on it.

import { useState } from 'react';
import { Link } from './Link';
import { MiniNeck, type NeckDot } from './MiniNeck';

export type NeckPattern = {
  id: string;
  /** Pill text, e.g. "Position 3". */
  label: string;
  /** Line under the diagram, e.g. "E minor pentatonic · frets 4–8". */
  sub?: string;
  dots: NeckDot[];
  /** ?theory= param for the fretboard-explorer link. */
  theory?: string;
};

export function NeckPatternPicker({
  patterns,
  instrument = 'guitar',
  linkLabel = 'Hear this on the fretboard explorer →',
  fromFret,
  toFret,
}: {
  patterns: NeckPattern[];
  instrument?: 'guitar' | 'bass';
  linkLabel?: string;
  /** Shared fret window for the whole set. Keeps every diagram the same
   *  size as the pills are stepped through, so the reader sees the
   *  patterns climb the neck instead of each one being re-cropped. */
  fromFret?: number;
  toFret?: number;
}) {
  const [activeId, setActiveId] = useState(patterns[0]?.id);
  const active = patterns.find((p) => p.id === activeId) ?? patterns[0];
  if (!active) return null;

  return (
    <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {patterns.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setActiveId(p.id)}
            aria-pressed={p.id === active.id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              p.id === active.id
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

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        {active.sub && (
          <p className="text-xs text-[var(--ink-soft)]">{active.sub}</p>
        )}
        {active.theory && (
          <Link
            to="/builder"
            search={{ theory: active.theory }}
            className="text-xs font-medium text-[var(--accent)] no-underline hover:underline"
          >
            {linkLabel}
          </Link>
        )}
      </div>
    </div>
  );
}
