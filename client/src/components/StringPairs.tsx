// String Pairs visualizer.
//
// Maps the lesson Ricky Comiskey teaches in "How the Fretboard Really
// Works" — guitar is tuned in fourths except for one step (G→B is a
// major third, the "kink"), so the six strings cluster naturally into
// three pairs: E-A, D-G, B-E. A subset pair A-D also sits on a fourth.
//
// What this view shows:
//   - the six strings, labeled, drawn as horizontal lanes
//   - the interval between adjacent strings (P4, P4, P4, M3, P4)
//   - the three primary string pairs colored as three lanes
//   - the M3 "kink" highlighted with the +1 fret correction note
//
// Pure SVG. Read-only. The "drive it home" pedagogical tool — when the
// user sees three identical lanes side by side, the "patterns repeat
// across string pairs" idea clicks.

// Six strings, indexed from high E (string 0) at the top to low E (string 5)
// at the bottom. The interval listed at index i is between string i and
// string i+1 (i.e. between the higher-pitched string above and the next
// string down).
const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'] as const;
const INTERVALS = [
  { name: 'P4', long: 'Perfect 4th', kink: false }, // e ↔ B
  { name: 'M3', long: 'Major 3rd',   kink: true  }, // B ↔ G — the kink
  { name: 'P4', long: 'Perfect 4th', kink: false }, // G ↔ D
  { name: 'P4', long: 'Perfect 4th', kink: false }, // D ↔ A
  { name: 'P4', long: 'Perfect 4th', kink: false }, // A ↔ E
] as const;

// Three primary string pairs, indexed by the higher string in each pair
// (matches the lesson's E-A / D-G / B-E grouping).
// Colors echo the lesson's "green / orange / blue" lanes.
type Pair = {
  label: string;
  /** Top string index (higher pitch). */
  top: number;
  /** Bottom string index (lower pitch). */
  bottom: number;
  /** Lane color. */
  color: string;
};

const PAIRS: Pair[] = [
  // High E + B (string 0 and 1)
  { label: 'B–e', top: 0, bottom: 1, color: '#22c55e' },
  // G + D (string 2 and 3)
  { label: 'D–G', top: 2, bottom: 3, color: '#eab308' },
  // A + E (string 4 and 5)
  { label: 'E–A', top: 4, bottom: 5, color: '#4f8cff' },
];

// Optional subset pair A-D (also a perfect fourth).
const SUBSET_PAIR: Pair = { label: 'A–D', top: 3, bottom: 4, color: '#a855f7' };

const W = 800;
const PADDING_X = 80;
const PADDING_Y = 30;
const ROW_GAP = 36;
const STRING_W = W - PADDING_X * 2;
const TOTAL_H = PADDING_Y * 2 + (STRING_NAMES.length - 1) * ROW_GAP;

const yForString = (i: number) => PADDING_Y + i * ROW_GAP;

export function StringPairs() {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--ink-soft)]">
        The six guitar strings group into <strong>three pairs</strong> separated
        by perfect 4ths. The one exception — between <strong>G and B</strong>{' '}
        — is a major 3rd. Every pattern that "moves cleanly" up the neck does
        so because consecutive string pairs are tuned identically; the kink
        between G and B is the spot where you have to <strong>shift +1 fret</strong> to compensate.
      </p>

      <svg
        viewBox={`0 0 ${W} ${TOTAL_H}`}
        width="100%"
        role="img"
        aria-label="Guitar string pairs"
        className="rounded-lg bg-[var(--bg-subtle)]"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Pair lane backgrounds — colored bands behind the two strings of
            each primary pair, so the "three lanes" idea reads at a glance. */}
        {PAIRS.map((pair) => (
          <rect
            key={`lane-${pair.label}`}
            x={PADDING_X - 12}
            y={yForString(pair.top) - 10}
            width={STRING_W + 20}
            height={yForString(pair.bottom) - yForString(pair.top) + 20}
            fill={pair.color}
            opacity={0.12}
            rx={8}
            ry={8}
          />
        ))}

        {/* Strings */}
        {STRING_NAMES.map((name, i) => (
          <g key={`s-${i}`}>
            <line
              x1={PADDING_X}
              y1={yForString(i)}
              x2={PADDING_X + STRING_W}
              y2={yForString(i)}
              stroke="var(--ink)"
              strokeWidth={1 + (i / STRING_NAMES.length) * 1.5}
              opacity={0.8}
            />
            <text
              x={PADDING_X - 18}
              y={yForString(i)}
              fontSize={16}
              fontWeight={700}
              fill="var(--ink)"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {name}
            </text>
          </g>
        ))}

        {/* Interval labels between strings (right side of the diagram) */}
        {INTERVALS.map((iv, i) => {
          const yMid = (yForString(i) + yForString(i + 1)) / 2;
          return (
            <g key={`iv-${i}`}>
              <text
                x={PADDING_X + STRING_W + 14}
                y={yMid}
                fontSize={13}
                fontWeight={iv.kink ? 700 : 500}
                fill={iv.kink ? '#dc2626' : 'var(--ink-soft)'}
                textAnchor="start"
                dominantBaseline="middle"
              >
                {iv.name}
              </text>
              {iv.kink && (
                <text
                  x={PADDING_X + STRING_W + 14 + 30}
                  y={yMid}
                  fontSize={11}
                  fontWeight={600}
                  fill="#dc2626"
                  textAnchor="start"
                  dominantBaseline="middle"
                >
                  ← kink (+1 fret)
                </text>
              )}
            </g>
          );
        })}

        {/* Subset pair label (A-D) inside the lane it spans. */}
        <text
          x={(PADDING_X + (PADDING_X + STRING_W)) / 2}
          y={(yForString(SUBSET_PAIR.top) + yForString(SUBSET_PAIR.bottom)) / 2}
          fontSize={11}
          fontWeight={600}
          fill={SUBSET_PAIR.color}
          textAnchor="middle"
          dominantBaseline="middle"
          opacity={0.7}
        >
          ↕ subset pair {SUBSET_PAIR.label} (also a P4)
        </text>

        {/* Primary pair labels — small chips just to the right of the
            "interval column", inside each pair's lane. */}
        {PAIRS.map((pair) => {
          const yMid = (yForString(pair.top) + yForString(pair.bottom)) / 2;
          return (
            <text
              key={`lbl-${pair.label}`}
              x={PADDING_X - 48}
              y={yMid}
              fontSize={11}
              fontWeight={700}
              fill={pair.color}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {pair.label}
            </text>
          );
        })}
      </svg>

      <ul className="grid grid-cols-1 gap-2 text-xs text-[var(--ink-soft)] sm:grid-cols-2">
        <li>
          <span className="font-semibold text-[var(--ink)]">Three primary pairs</span>{' '}
          (E–A, D–G, B–e) are tuned identically — any shape you learn on one
          pair plays the same way on the others.
        </li>
        <li>
          <span className="font-semibold text-[var(--ink)]">The kink</span>{' '}
          between G and B is a major 3rd, not a 4th. Crossing it forces a{' '}
          <span className="font-semibold text-[#dc2626]">+1 fret shift</span>{' '}
          to keep the pattern intact.
        </li>
        <li>
          <span className="font-semibold text-[var(--ink)]">Subset pair</span>{' '}
          (A–D) sits in the middle and also spans a 4th, giving you a fourth
          "lane" for moving ideas around.
        </li>
        <li>
          <span className="font-semibold text-[var(--ink)]">CAGED octaves</span>{' '}
          are how you bridge between pairs — same root note, different lane,
          same shape.
        </li>
      </ul>
    </div>
  );
}
