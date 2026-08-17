// Read-only fretboard diagram sized for embedding *inside* a lesson.
//
// The full GuitarView / BassView in ../../instruments are the
// interactive surfaces on /builder — they carry game mode, click-to-play,
// CAGED overlays and the theory-companion stylesheet. A lesson doesn't
// want any of that; it wants a small static picture of one pattern, drawn
// inline so the reader never has to leave the page. That's this.
//
// Conventions match the rest of the app: string 0 = highest pitch (high e
// on guitar, G on bass), and dots are addressed by absolute fret number
// (0 = open, drawn to the left of the nut).

export type NeckDot = {
  /** 0 = highest-pitched string. */
  string: number;
  /** Absolute fret. 0 = open string (rendered left of the nut). */
  fret: number;
  /** Short text inside the dot — a note name ("F♯") or degree ("b3"). */
  label?: string;
  /** Roots get the accent fill so the shape's anchor is obvious. */
  root?: boolean;
};

export type MiniNeckProps = {
  instrument?: 'guitar' | 'bass';
  dots: NeckDot[];
  /** Explicit fret window. Omit both to auto-fit around `dots`. */
  fromFret?: number;
  toFret?: number;
  /** Minimum number of frets in the auto-fitted window. */
  minSpan?: number;
  ariaLabel: string;
};

const GUITAR_STRINGS = ['e', 'B', 'G', 'D', 'A', 'E'] as const;
const BASS_STRINGS = ['G', 'D', 'A', 'E'] as const;

// Higher than GuitarView's 15-fret board: a lesson diagram has to be able
// to draw a pattern that sits up at the 14th fret without clipping its top
// three notes, and every real guitar has at least 20 frets anyway.
const MAX_FRET = { guitar: 22, bass: 20 } as const;

const FRET_W = 40;
const STRING_GAP = 22;
const PADDING_X = 54;
const PADDING_Y = 18;
const FRET_NUM_H = 18;
const DOT_R = 9;

const INLAYS_SINGLE = new Set([3, 5, 7, 9, 15, 17, 19]);
const INLAYS_DOUBLE = new Set([12]);

/**
 * Pick the visible fret window. An explicit from/to always wins; otherwise
 * we pad one fret either side of the dots and widen to `minSpan` so a
 * three-fret shape doesn't render as a cramped sliver. Open-string dots
 * force the window to start at the nut.
 */
function resolveWindow(
  dots: NeckDot[],
  maxFret: number,
  fromFret?: number,
  toFret?: number,
  minSpan = 5,
): { lo: number; hi: number } {
  if (fromFret != null && toFret != null) {
    return { lo: Math.max(0, fromFret), hi: Math.min(maxFret, toFret) };
  }
  if (dots.length === 0) return { lo: 0, hi: minSpan };

  const frets = dots.map((d) => d.fret);
  let lo = Math.max(0, Math.min(...frets) - 1);
  let hi = Math.min(maxFret, Math.max(...frets) + 1);
  // An open-string dot only reads correctly against the nut.
  if (frets.includes(0)) lo = 0;
  while (hi - lo < minSpan && hi < maxFret) hi += 1;
  while (hi - lo < minSpan && lo > 0) lo -= 1;
  return { lo, hi };
}

export function MiniNeck({
  instrument = 'guitar',
  dots,
  fromFret,
  toFret,
  minSpan = 5,
  ariaLabel,
}: MiniNeckProps) {
  const stringNames = instrument === 'bass' ? BASS_STRINGS : GUITAR_STRINGS;
  const stringCount = stringNames.length;
  const { lo, hi } = resolveWindow(
    dots,
    MAX_FRET[instrument],
    fromFret,
    toFret,
    minSpan,
  );

  const fretCount = Math.max(1, hi - lo);
  const boardW = fretCount * FRET_W;
  const totalW = PADDING_X * 2 + boardW;
  const totalH = PADDING_Y * 2 + STRING_GAP * (stringCount - 1) + FRET_NUM_H;

  const boardLeft = PADDING_X;
  // Fret n is drawn in the gap between fret line n-1 and n, so its dot sits
  // at the midpoint. Open strings sit in the left gutter, before the nut.
  const xForFret = (fret: number) =>
    fret === 0 && lo === 0
      ? boardLeft - 18
      : boardLeft + (fret - lo - 0.5) * FRET_W;
  const yForString = (idx: number) => PADDING_Y + idx * STRING_GAP;

  const boardBottom = yForString(stringCount - 1);
  const visible = dots.filter((d) => d.fret >= lo && d.fret <= hi);

  return (
    <svg
      viewBox={`0 0 ${totalW} ${totalH}`}
      width="100%"
      style={{ maxWidth: totalW }}
      role="img"
      aria-label={ariaLabel}
      className="select-none"
    >
      {/* Position inlays, drawn under the strings like a real neck. */}
      {Array.from({ length: fretCount }, (_, i) => lo + i + 1)
        .filter((f) => INLAYS_SINGLE.has(f) || INLAYS_DOUBLE.has(f))
        .map((f) =>
          INLAYS_DOUBLE.has(f) ? (
            <g key={`inlay-${f}`}>
              <circle
                cx={xForFret(f)}
                cy={PADDING_Y + STRING_GAP * 0.75}
                r={4}
                fill="var(--line-strong)"
              />
              <circle
                cx={xForFret(f)}
                cy={boardBottom - STRING_GAP * 0.75}
                r={4}
                fill="var(--line-strong)"
              />
            </g>
          ) : (
            <circle
              key={`inlay-${f}`}
              cx={xForFret(f)}
              cy={(PADDING_Y + boardBottom) / 2}
              r={4}
              fill="var(--line-strong)"
            />
          ),
        )}

      {/* Frets. The nut (fret line at position 0) is drawn thicker. */}
      {Array.from({ length: fretCount + 1 }, (_, i) => lo + i).map((f) => (
        <line
          key={`fret-${f}`}
          x1={boardLeft + (f - lo) * FRET_W}
          x2={boardLeft + (f - lo) * FRET_W}
          y1={PADDING_Y - 6}
          y2={boardBottom + 6}
          stroke={f === 0 ? 'var(--ink)' : 'var(--line-strong)'}
          strokeWidth={f === 0 ? 4 : 1}
        />
      ))}

      {/* Strings + their open-note names in the left gutter. */}
      {stringNames.map((name, i) => (
        <g key={`string-${i}`}>
          <line
            x1={boardLeft}
            x2={boardLeft + boardW}
            y1={yForString(i)}
            y2={yForString(i)}
            stroke="var(--ink-faint)"
            strokeWidth={1 + (i / stringCount) * 1.4}
          />
          <text
            x={boardLeft - 40}
            y={yForString(i)}
            fontSize={10}
            fontWeight={700}
            fill="var(--ink-muted)"
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {name}
          </text>
        </g>
      ))}

      {/* Fret numbers under the board. */}
      {Array.from({ length: fretCount }, (_, i) => lo + i + 1).map((f) => (
        <text
          key={`fretnum-${f}`}
          x={xForFret(f)}
          y={boardBottom + FRET_NUM_H + 2}
          fontSize={9}
          fill="var(--ink-muted)"
          textAnchor="middle"
        >
          {f}
        </text>
      ))}

      {/* Dots. --ink fill against --card text keeps the label legible in
          both themes (the two tokens invert together). */}
      {visible.map((d) => (
        <g key={`dot-${d.string}-${d.fret}`} pointerEvents="none">
          <circle
            cx={xForFret(d.fret)}
            cy={yForString(d.string)}
            r={DOT_R}
            fill={d.root ? 'var(--accent)' : 'var(--ink)'}
          />
          {d.label && (
            <text
              x={xForFret(d.fret)}
              y={yForString(d.string)}
              fontSize={d.label.length > 2 ? 7 : 8.5}
              fontWeight={700}
              fill={d.root ? '#ffffff' : 'var(--card)'}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {d.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
