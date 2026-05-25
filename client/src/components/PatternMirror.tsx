// Pattern Mirror demo.
//
// Picks a small "shape" — a power chord, a minor-pentatonic
// rectangle-and-leg, or a major-triad arpeggio — and renders it
// THREE TIMES on a single fretboard, once on each primary string pair.
// Whenever a copy crosses the G→B "kink" (where the tuning is a major
// 3rd instead of a perfect 4th), the relevant note shifts +1 fret to
// keep the shape musically intact.
//
// Driver concept from Ricky Comiskey's lesson: "one idea, three voices."
// Visualizing it side-by-side on the same neck makes the abstract rule
// (string pairs + CAGED octaves) concrete.

import { useState } from 'react';
import { pcSemitoneFromCircleIdx } from '#/lib/music/chord-substitutions';
import {
  majorDisplay,
  type CircleDirection,
  type Enharmonic,
} from '#/lib/music/circle-of-fifths';

// Internal string indexing: 0 = high e, 5 = low E (matches StringPairs.tsx).
// The primary pairs Ricky teaches are (top, bottom) string indices:
//   pair 1: low E + A   → strings 5 and 4
//   pair 2: D + G       → strings 3 and 2
//   pair 3: B + high e  → strings 1 and 0
//
// A "shape" is a set of (stringOffset, fretOffset) cells — stringOffset is
// 0 (top string of the pair) or 1 (bottom string), fretOffset is relative
// to the shape's anchor fret. The same shape data is placed on each pair.
// When the pair spans the G-B kink, fretOffsets above the kink-crossing
// string get +1 to compensate.

const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'] as const;

type ShapeCell = {
  /** 0 = lower-pitched (string-pair "low"), 1 = higher-pitched ("high"). */
  pairString: 0 | 1;
  fretOffset: number;
  label?: string;
  /** When true this is the root note → colored differently. */
  root?: boolean;
};

type Shape = {
  id: string;
  /** Function returning the display name given the current tonic (e.g.
   *  "C5 power chord", "G minor pentatonic"). Built lazily so the label
   *  re-pivots as the user clicks new keys on the Circle above. */
  name: (tonicSpelling: string) => string;
  /** Whether this shape is musically "major" or "minor" — picks the right
   *  fret offset from the tonic. Power chords are neutral (use major
   *  anchoring); pentatonics anchor minor; triads anchor major. */
  rootFretOnLowE: 'major' | 'minor';
  /** Cells, expressed as (pairString, fretOffset). */
  cells: ShapeCell[];
  /** One-line description for the picker. */
  blurb: string;
};

const SHAPES: Shape[] = [
  {
    id: 'power',
    name: (t) => `${t}5 power chord`,
    rootFretOnLowE: 'major',
    blurb: 'Root + 5th on adjacent strings. Slides cleanly across pairs.',
    cells: [
      { pairString: 0, fretOffset: 0, label: 'R', root: true },
      { pairString: 1, fretOffset: 2, label: '5' },
    ],
  },
  {
    id: 'pentatonic',
    name: (t) => `${t} minor pentatonic`,
    rootFretOnLowE: 'major',
    blurb: 'b7 → R → b3 → 4 → 5 — the starry-night fragment.',
    cells: [
      { pairString: 0, fretOffset: 0, label: 'b7' },
      { pairString: 0, fretOffset: 2, label: 'R', root: true },
      { pairString: 1, fretOffset: 0, label: 'b3' },
      { pairString: 1, fretOffset: 2, label: '4' },
      { pairString: 1, fretOffset: 4, label: '5' },
    ],
  },
  {
    id: 'triad',
    name: (t) => `${t} major triad`,
    rootFretOnLowE: 'major',
    blurb: 'R → 3 → 5 on adjacent strings.',
    cells: [
      { pairString: 0, fretOffset: 0, label: 'R', root: true },
      { pairString: 0, fretOffset: 4, label: '3' },
      { pairString: 1, fretOffset: 2, label: '5' },
    ],
  },
];

/** Fret on the low E string for a given pitch-class semitone (0=C..11=B).
 *  E is semitone 4, so fret = (semitone - 4) mod 12. Always returns a
 *  value in [0, 11] so the resulting shape sits in the playable region. */
function fretOnLowE(semitone: number): number {
  return ((semitone - 4) % 12 + 12) % 12;
}

// Pair color matches StringPairs.tsx — viewer reads "this is the green
// lane" everywhere on /theory.
type PairDef = {
  /** Lower-pitched (top of pair, deeper note) string index. */
  lowStringIdx: number;
  /** Higher-pitched string index. */
  highStringIdx: number;
  /** When the BOTTOM string of the pair is below the G-B kink (i.e. when
   *  the high string is B or e), the high note's fret needs +1 because
   *  the tuning gap is a major 3rd, not a 4th. */
  crossesKink: boolean;
  color: string;
  label: string;
};

const PAIRS: PairDef[] = [
  // E-A pair: strings 5 (E) and 4 (A). No kink.
  { lowStringIdx: 5, highStringIdx: 4, crossesKink: false, color: '#4f8cff', label: 'E–A' },
  // D-G pair: strings 3 (D) and 2 (G). No kink.
  { lowStringIdx: 3, highStringIdx: 2, crossesKink: false, color: '#eab308', label: 'D–G' },
  // B-e pair: strings 1 (B) and 0 (high e). The HIGHER pitch end of this
  // pair sits above the G-B kink, so the "high string" notes shift +1 fret.
  { lowStringIdx: 1, highStringIdx: 0, crossesKink: true, color: '#22c55e', label: 'B–e' },
];

// Layout constants. Smaller than the main GuitarView since this is a teaching
// thumbnail — clarity > detail.
const FRET_COUNT = 15;
const FRET_W = 44;
const STRING_GAP = 22;
const PADDING_X = 38;
const PADDING_Y = 20;
const STRING_COUNT = 6;
const TOTAL_W = PADDING_X * 2 + FRET_W * FRET_COUNT;
const TOTAL_H = PADDING_Y * 2 + STRING_GAP * (STRING_COUNT - 1);

const xForFret = (fret: number) =>
  fret === 0 ? PADDING_X - 18 : PADDING_X + (fret - 0.5) * FRET_W;
const yForString = (idx: number) => PADDING_Y + idx * STRING_GAP;

export function PatternMirror({
  tonicCircleIdx = 0,
  enharmonic = 'standard',
  direction = 'fourths',
}: {
  /** Circle-of-fifths index for the current tonic (0=C, 1=G in fifths /
   *  1=F in fourths, etc.). Falls back to C when omitted so the demo
   *  works standalone too. */
  tonicCircleIdx?: number;
  enharmonic?: Enharmonic;
  direction?: CircleDirection;
} = {}) {
  const [shapeId, setShapeId] = useState<string>(SHAPES[0].id);
  const shape = SHAPES.find((s) => s.id === shapeId) ?? SHAPES[0];
  const tonicSemi = pcSemitoneFromCircleIdx(tonicCircleIdx);
  const tonicSpelling = majorDisplay(tonicCircleIdx, enharmonic, direction);
  const anchorFret = fretOnLowE(tonicSemi);

  // For each pair, realize the shape's cells onto specific (string, fret)
  // positions, applying the +1 kink correction when needed.
  type Placed = {
    pairColor: string;
    pairLabel: string;
    string: number;
    fret: number;
    label: string;
    root: boolean;
  };
  const placements: Placed[] = [];
  for (const pair of PAIRS) {
    for (const cell of shape.cells) {
      const stringIdx = cell.pairString === 0 ? pair.lowStringIdx : pair.highStringIdx;
      // pairString=1 means the higher-pitched string of the pair. When the
      // pair crosses the G-B kink, that higher string is B or e; the
      // distance from the low string is a M3 instead of a P4, so the
      // fretOffset listed in the shape (designed for a P4 pair) needs to
      // shift +1 to land on the same note.
      const kinkShift = pair.crossesKink && cell.pairString === 1 ? 1 : 0;
      const fret = anchorFret + cell.fretOffset + kinkShift;
      if (fret < 0 || fret > FRET_COUNT) continue;
      placements.push({
        pairColor: pair.color,
        pairLabel: pair.label,
        string: stringIdx,
        fret,
        label: cell.label ?? '',
        root: !!cell.root,
      });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--ink-soft)]">
        Pick a small idea — a power chord, a pentatonic fragment, a triad —
        and watch the same shape mirror itself onto all three string pairs.
        When the shape crosses the G→B kink the upper note shifts{' '}
        <span className="font-semibold text-[#dc2626]">+1 fret</span> so the
        sound stays the same.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {SHAPES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setShapeId(s.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              shapeId === s.id
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink)] hover:border-[var(--line-strong)]'
            }`}
          >
            {s.name(tonicSpelling)}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--ink-muted)]">{shape.blurb}</p>

      <svg
        viewBox={`0 0 ${TOTAL_W} ${TOTAL_H + 30}`}
        width="100%"
        role="img"
        aria-label={`${shape.name(tonicSpelling)} mirrored across three string pairs`}
        className="rounded-lg bg-[var(--bg-subtle)]"
      >
        {/* Pair background lanes — colored bands behind each pair so the
            viewer can see "green lane / yellow lane / blue lane" at a glance. */}
        {PAIRS.map((pair) => {
          const yTop = yForString(Math.min(pair.lowStringIdx, pair.highStringIdx)) - 10;
          const yBot = yForString(Math.max(pair.lowStringIdx, pair.highStringIdx)) + 10;
          return (
            <rect
              key={`lane-${pair.label}`}
              x={PADDING_X - 6}
              y={yTop}
              width={FRET_W * FRET_COUNT + 12}
              height={yBot - yTop}
              fill={pair.color}
              opacity={0.1}
              rx={6}
              ry={6}
            />
          );
        })}

        {/* Strings */}
        {STRING_NAMES.map((name, i) => (
          <g key={`s-${i}`}>
            <line
              x1={PADDING_X}
              y1={yForString(i)}
              x2={PADDING_X + FRET_W * FRET_COUNT}
              y2={yForString(i)}
              stroke="var(--ink)"
              strokeWidth={1 + (i / STRING_COUNT) * 1.5}
              opacity={0.7}
            />
            <text
              x={PADDING_X - 10}
              y={yForString(i)}
              fontSize={11}
              fontWeight={700}
              fill="var(--ink)"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {name}
            </text>
          </g>
        ))}

        {/* Fret bars */}
        {Array.from({ length: FRET_COUNT + 1 }, (_, f) => (
          <line
            key={`f-${f}`}
            x1={PADDING_X + f * FRET_W}
            y1={PADDING_Y - 6}
            x2={PADDING_X + f * FRET_W}
            y2={PADDING_Y + STRING_GAP * (STRING_COUNT - 1) + 6}
            stroke="var(--ink-faint)"
            strokeWidth={f === 0 ? 3 : 1}
          />
        ))}
        {/* Fret numbers */}
        {Array.from({ length: FRET_COUNT }, (_, i) => i + 1).map((f) => (
          <text
            key={`fnum-${f}`}
            x={PADDING_X + (f - 0.5) * FRET_W}
            y={PADDING_Y + STRING_GAP * (STRING_COUNT - 1) + 20}
            fontSize={9}
            fill="var(--ink-muted)"
            textAnchor="middle"
          >
            {f}
          </text>
        ))}

        {/* Placed notes (one cluster per pair). */}
        {placements.map((p, i) => (
          <g key={`p-${i}`} pointerEvents="none">
            <circle
              cx={xForFret(p.fret)}
              cy={yForString(p.string)}
              r={9}
              fill={p.root ? '#ff7a59' : p.pairColor}
              stroke="#0b0d12"
              strokeWidth={1.5}
            />
            <text
              x={xForFret(p.fret)}
              y={yForString(p.string) + 3}
              fontSize={9}
              fontWeight={700}
              fill="#0b0d12"
              textAnchor="middle"
            >
              {p.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-muted)]">
        {PAIRS.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: p.color }}
            />
            {p.label}
            {p.crossesKink && <em className="text-[#dc2626]"> (+1 kink)</em>}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: '#ff7a59' }}
          />
          Root
        </span>
      </div>
    </div>
  );
}
