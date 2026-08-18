// NaturalNotesStrings — two-string strip showing the natural notes on
// the low E and A strings, frets 0–12. The pedagogical centerpiece of
// the "find any chord" lesson: if you know these 14 notes (7 per string,
// repeating at the 12th fret), every sharp/flat is one fret away and
// every root for the four chord shapes is reachable.
//
// Half-step pairs B→C and E→F are emphasized — they're the spots with
// no sharp/flat between consecutive natural notes, which throws people
// off when they're hunting for chord roots.

const STRING_NAMES = ['A (string 5)', 'low E (string 6)'] as const;

// Natural notes per string, indexed by fret 0..12. null = a fret with
// only sharps/flats (not a natural).
const A_STRING_NATURALS: (string | null)[] = [
  'A', null, 'B', 'C', null, 'D', null, 'E', 'F', null, 'G', null, 'A',
];
const E_STRING_NATURALS: (string | null)[] = [
  'E', 'F', null, 'G', null, 'A', null, 'B', 'C', null, 'D', null, 'E',
];

// Pairs of fret indices where natural notes sit 1 fret apart (the
// no-sharp-between-them spots). Emphasized to drive the lesson point
// home.
const HALF_STEP_PAIRS_A = [
  [2, 3], // B → C
  [7, 8], // E → F
];
const HALF_STEP_PAIRS_E = [
  [0, 1], // E → F
  [7, 8], // B → C
];

const FRET_COUNT = 12;
const FRET_W = 50;
const STRING_GAP = 56;
const PADDING_X = 84;
const PADDING_TOP = 30;
// Generous bottom padding so the fret-number row sits well below the
// bottom-string's note circles. With only ~7px gap the numbers visually
// merge into the orange note dots and break the alignment cue.
const PADDING_BOTTOM = 40;

const TOTAL_W = PADDING_X + FRET_W * FRET_COUNT + 24;
const TOTAL_H = PADDING_TOP + STRING_GAP + PADDING_BOTTOM;

const FRET_INLAYS_SINGLE = new Set([3, 5, 7, 9]);
const FRET_INLAYS_DOUBLE = new Set([12]);

export function NaturalNotesStrings() {
  const xForFret = (f: number) =>
    f === 0 ? PADDING_X - 30 : PADDING_X + (f - 0.5) * FRET_W;
  const yForString = (i: number) => PADDING_TOP + i * STRING_GAP;

  return (
    <svg
      viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
      width="100%"
      role="img"
      aria-label="Natural notes on the low E and A strings"
      className="select-none"
    >
      {/* Fretboard background */}
      <rect
        x={PADDING_X}
        y={PADDING_TOP - 16}
        width={FRET_W * FRET_COUNT}
        height={STRING_GAP + 32}
        fill="var(--fret-wood)"
        rx={4}
      />

      {/* Nut */}
      <rect
        x={PADDING_X - 6}
        y={PADDING_TOP - 16}
        width={6}
        height={STRING_GAP + 32}
        fill="#d8cdb8"
      />

      {/* Fret lines */}
      {Array.from({ length: FRET_COUNT }, (_, i) => i + 1).map((f) => (
        <line
          key={`fret-${f}`}
          x1={PADDING_X + f * FRET_W}
          x2={PADDING_X + f * FRET_W}
          y1={PADDING_TOP - 16}
          y2={PADDING_TOP + STRING_GAP + 16}
          stroke="var(--fret-line)"
          strokeWidth={2}
        />
      ))}

      {/* Inlay dots — center between the two strings */}
      {Array.from({ length: FRET_COUNT }, (_, i) => i + 1)
        .filter((f) => FRET_INLAYS_SINGLE.has(f))
        .map((f) => (
          <circle
            key={`inlay-${f}`}
            cx={PADDING_X + (f - 0.5) * FRET_W}
            cy={PADDING_TOP + STRING_GAP / 2}
            r={5}
            fill="#5a5048"
          />
        ))}
      {Array.from({ length: FRET_COUNT }, (_, i) => i + 1)
        .filter((f) => FRET_INLAYS_DOUBLE.has(f))
        .map((f) => (
          <g key={`inlay2-${f}`}>
            <circle
              cx={PADDING_X + (f - 0.5) * FRET_W - 7}
              cy={PADDING_TOP + STRING_GAP / 2}
              r={5}
              fill="#5a5048"
            />
            <circle
              cx={PADDING_X + (f - 0.5) * FRET_W + 7}
              cy={PADDING_TOP + STRING_GAP / 2}
              r={5}
              fill="#5a5048"
            />
          </g>
        ))}

      {/* Strings */}
      {STRING_NAMES.map((name, i) => (
        <g key={`string-${i}`}>
          <line
            x1={PADDING_X - 6}
            x2={PADDING_X + FRET_W * FRET_COUNT}
            y1={yForString(i)}
            y2={yForString(i)}
            stroke="var(--string)"
            strokeWidth={2 + i}
          />
          <text
            x={PADDING_X - 14}
            y={yForString(i) + 4}
            fontSize={11}
            fill="var(--ink-soft)"
            textAnchor="end"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          >
            {name}
          </text>
        </g>
      ))}

      {/* Half-step lanes — translucent bands across the half-step fret
          pairs on each string, so the B-C / E-F "no sharp between them"
          spots pop out at a glance. */}
      {HALF_STEP_PAIRS_A.map(([a, b]) => {
        const left = a === 0 ? xForFret(0) - 16 : xForFret(a) - FRET_W / 2;
        const right = xForFret(b) + FRET_W / 2;
        return (
          <rect
            key={`hsA-${a}`}
            x={left}
            y={yForString(0) - 20}
            width={right - left}
            height={40}
            fill="#dc2626"
            opacity={0.08}
            rx={4}
          />
        );
      })}
      {HALF_STEP_PAIRS_E.map(([a, b]) => {
        const left = a === 0 ? xForFret(0) - 16 : xForFret(a) - FRET_W / 2;
        const right = xForFret(b) + FRET_W / 2;
        return (
          <rect
            key={`hsE-${a}`}
            x={left}
            y={yForString(1) - 20}
            width={right - left}
            height={40}
            fill="#dc2626"
            opacity={0.08}
            rx={4}
          />
        );
      })}

      {/* Natural-note markers — A string */}
      {A_STRING_NATURALS.map((name, fret) => {
        if (!name) return null;
        return (
          <g key={`A-${fret}`}>
            <circle
              cx={xForFret(fret)}
              cy={yForString(0)}
              r={13}
              fill="var(--accent)"
              stroke="#0b0d12"
              strokeWidth={1.5}
            />
            <text
              x={xForFret(fret)}
              y={yForString(0) + 4}
              fontSize={12}
              fill="white"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight={700}
            >
              {name}
            </text>
          </g>
        );
      })}

      {/* Natural-note markers — low E string */}
      {E_STRING_NATURALS.map((name, fret) => {
        if (!name) return null;
        return (
          <g key={`E-${fret}`}>
            <circle
              cx={xForFret(fret)}
              cy={yForString(1)}
              r={13}
              fill="var(--accent)"
              stroke="#0b0d12"
              strokeWidth={1.5}
            />
            <text
              x={xForFret(fret)}
              y={yForString(1) + 4}
              fontSize={12}
              fill="white"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight={700}
            >
              {name}
            </text>
          </g>
        );
      })}

      {/* Fret numbers below — pushed down from the bottom string so they
          don't visually merge into the note circles. Slightly larger
          font for readability at this scale. */}
      {Array.from({ length: FRET_COUNT + 1 }, (_, i) => i).map((f) => (
        <text
          key={`fnum-${f}`}
          x={xForFret(f)}
          y={PADDING_TOP + STRING_GAP + 32}
          fontSize={12}
          fontWeight={500}
          fill="var(--ink-muted)"
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {f === 0 ? 'open' : f}
        </text>
      ))}
    </svg>
  );
}
