// Roman Numeral Analyzer.
//
// User types a chord progression (free-form: spaces, commas, pipes
// between chord symbols), picks a key, and gets back each chord with
// its Roman numeral + functional category (T / PD / D / chromatic /
// unknown). Catches diatonic chords, secondary dominants, and common
// modal-interchange chords (♭III, iv, ♭VI, ♭VII in major).
//
// Doesn't auto-detect the key — the user picks. Future enhancement
// could fit candidate keys by scoring each progression's diatonic
// coverage. For now, manual selection keeps the analysis grounded.

import { useState } from 'react';
import { parseChordProgression } from '@music-kb/music/theory/parse-chord';
import { analyzeProgression, type ChordFunction } from '@music-kb/music/theory/roman-analysis';
import { PITCH_CLASSES, type PitchClass } from '@music-kb/music/types';

const FUNCTION_COLORS: Record<ChordFunction, string> = {
  T: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  PD: 'bg-amber-100 text-amber-800 border-amber-300',
  D: 'bg-rose-100 text-rose-800 border-rose-300',
  chromatic: 'bg-purple-100 text-purple-800 border-purple-300',
  unknown: 'bg-[var(--bg-subtle)] text-[var(--ink-muted)] border-[var(--line)]',
};

const FUNCTION_LABELS: Record<ChordFunction, string> = {
  T: 'Tonic',
  PD: 'Pre-dominant',
  D: 'Dominant',
  chromatic: 'Chromatic',
  unknown: 'Unknown',
};

export function RomanAnalyzer() {
  const [input, setInput] = useState('Cmaj7 Am7 Dm7 G7');
  const [keyRoot, setKeyRoot] = useState<PitchClass>('C');
  const [keyMode, setKeyMode] = useState<'major' | 'minor'>('major');

  const { parsed, tokens } = parseChordProgression(input);
  // Filter to successfully-parsed chords for analysis; keep parallel
  // arrays so we can render an "unparsed" placeholder for failures.
  const validChords = parsed.filter((p): p is NonNullable<typeof p> => p !== null);
  const analyses = analyzeProgression(validChords, keyRoot, keyMode);

  // Walk tokens + parsed in parallel, mapping each token to either an
  // analysis result or a "couldn't parse" marker.
  let validIdx = 0;
  const rows = tokens.map((token, i) => {
    const p = parsed[i];
    if (!p) return { token, parsed: false as const };
    const a = analyses[validIdx++];
    return { token, parsed: true as const, analysis: a };
  });

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--ink-soft)]">
        Paste a chord progression — separated by spaces, commas, or pipe
        bars (chord-chart style). Pick a key below and each chord gets a
        Roman numeral + functional category.
      </p>

      <div className="flex flex-col gap-3">
        <div>
          <label
            htmlFor="roman-input"
            className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]"
          >
            Progression
          </label>
          <input
            id="roman-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Cmaj7 Am7 Dm7 G7"
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-2 font-mono text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div>
            <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Key
            </span>
            <div className="inline-flex flex-wrap gap-1">
              {PITCH_CLASSES.map((pc) => (
                <button
                  key={pc}
                  type="button"
                  onClick={() => setKeyRoot(pc)}
                  className={`rounded border px-2 py-0.5 text-xs font-medium transition ${
                    keyRoot === pc
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink-soft)] hover:border-[var(--accent)]'
                  }`}
                >
                  {pc}
                </button>
              ))}
            </div>
          </div>
          <div
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-xs"
            role="radiogroup"
            aria-label="Key mode"
          >
            {(['major', 'minor'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={keyMode === m}
                onClick={() => setKeyMode(m)}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  keyMode === m
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
                }`}
              >
                {m === 'major' ? 'Major' : 'Minor'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">
          Type a progression above to see its analysis.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <th className="px-3 py-2 font-medium">Chord</th>
                <th className="px-3 py-2 font-medium">Roman</th>
                <th className="px-3 py-2 font-medium">Function</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) =>
                row.parsed ? (
                  <tr
                    key={`${row.token}-${i}`}
                    className="border-b border-[var(--line)] last:border-b-0"
                  >
                    <td className="px-3 py-2 font-mono font-semibold text-[var(--ink)]">
                      {row.token}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold text-[var(--ink)]">
                      {row.analysis.roman}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${FUNCTION_COLORS[row.analysis.func]}`}
                        title={FUNCTION_LABELS[row.analysis.func]}
                      >
                        {FUNCTION_LABELS[row.analysis.func]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--ink-soft)]">
                      {row.analysis.explain}
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={`${row.token}-${i}`}
                    className="border-b border-[var(--line)] last:border-b-0"
                  >
                    <td className="px-3 py-2 font-mono text-[var(--ink-muted)]">
                      {row.token}
                    </td>
                    <td
                      colSpan={3}
                      className="px-3 py-2 text-xs italic text-[var(--ink-muted)]"
                    >
                      Couldn't parse — check the chord spelling.
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
