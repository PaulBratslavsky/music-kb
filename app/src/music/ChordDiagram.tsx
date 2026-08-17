// Compact chord-box diagram — the songbook-style fingering chart that
// shows a 4-5 fret window with dots for fretted notes, O for open
// strings, X for muted strings, and an optional barre line.
//
// Layout convention:
//   - Strings are vertical (low E on the LEFT, high E on the RIGHT) —
//     this is the standard right-handed chord chart orientation that
//     every guitar method book uses.
//   - Frets are horizontal, with the nut (or topmost displayed fret) at
//     the top.
//   - When the chord lives high up the neck, we show a fret-number
//     label on the left of the topmost displayed fret (e.g. "7fr").
//
// Read-only — no interaction. Used by the section chord strip and the
// progression panel on the player page.

const STRING_COUNT = 6;

type StringState =
  // `note` is the sounding pitch class ("E", "G#"). Supplying it draws the
  // name inside the fretted dot, and in place of the open string's O — a
  // sounding string is worth naming either way. Muted strings keep the
  // conventional x, which is what carries the played-vs-not distinction.
  | { kind: 'fretted'; fret: number; isRoot?: boolean; note?: string }
  | { kind: 'open'; note?: string }
  | { kind: 'muted' };

export type ChordDiagramProps = {
  /** Per-string state, indexed [highE, B, G, D, A, lowE]. We flip the
   *  rendering order so lowE appears on the left (standard chord-box). */
  strings: StringState[];
  /** Optional barre. Fret is absolute; fromString/toString are inclusive
   *  string indices in the [highE..lowE] convention (0..5). */
  barre?: { fret: number; fromString: number; toString: number };
  /** Number of frets to display in the diagram. Default 5. */
  fretCount?: number;
  /** Override the fret shown at the top. When omitted, derived from the
   *  lowest fretted note (with at-the-nut chords starting at fret 1). */
  startFret?: number;
  /**
   * 'vertical' (default) is the songbook chord box: nut across the top,
   * strings running down. 'horizontal' rotates it so the strings run left
   * to right with the nut on the LEFT and the low E at the bottom —
   * matching the full fretboard on /builder and every fretboard diagram in
   * the lessons, so the two never disagree about which way the neck runs.
   */
  orientation?: 'vertical' | 'horizontal';
  /**
   * 'fill' makes the svg responsive (width 100%, height from the viewBox)
   * so a card can size the diagram. Default 'fixed' keeps the exact pixel
   * box the lesson pages lay out around.
   */
  size?: 'fixed' | 'fill';
};

const WIDTH = 134;
const HEIGHT = 140;
const PAD_TOP = 26;
const PAD_BOTTOM = 12;
// Wider left gutter so the up-the-neck position indicator ("5fr", "12fr")
// fits without clipping past the SVG's left edge.
const PAD_LEFT = 30;
const PAD_RIGHT = 12;

export function ChordDiagram({
  strings,
  barre,
  fretCount = 5,
  startFret,
  orientation = 'vertical',
  size = 'fixed',
}: ChordDiagramProps) {
  if (strings.length !== STRING_COUNT) {
    throw new Error(`ChordDiagram expects ${STRING_COUNT} string states.`);
  }
  // Pick the start fret. If any played fret is above the visible window,
  // shift the window so the lowest played fret sits near the top.
  const playedFrets = strings
    .map((s) => (s.kind === 'fretted' ? s.fret : null))
    .filter((n): n is number => n !== null);
  const minPlayed = playedFrets.length ? Math.min(...playedFrets) : 1;
  const maxPlayed = playedFrets.length ? Math.max(...playedFrets) : fretCount;
  const computedStart =
    startFret ??
    (maxPlayed <= fretCount ? 1 : Math.max(1, minPlayed));
  // Show nut (thick top line) only when the diagram starts at fret 1.
  const atNut = computedStart === 1;

  const fretBoxW = WIDTH - PAD_LEFT - PAD_RIGHT;
  const fretBoxH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const stringGap = fretBoxW / (STRING_COUNT - 1);
  const fretGap = fretBoxH / fretCount;

  // Flip: lowE on the LEFT, highE on the RIGHT. stringIdx 5 (lowE) → x = PAD_LEFT.
  const xForString = (stringIdx: number) =>
    PAD_LEFT + (STRING_COUNT - 1 - stringIdx) * stringGap;
  const yForFret = (absoluteFret: number) =>
    PAD_TOP + (absoluteFret - computedStart + 1) * fretGap - fretGap / 2;

  const horizontal = orientation === 'horizontal';
  // Text has to be counter-rotated so labels stay upright inside the
  // rotated group.
  const upright = (x: number, y: number) =>
    horizontal ? { transform: `rotate(90, ${x}, ${y})` } : {};

  return (
    <svg
      viewBox={horizontal ? `0 0 ${HEIGHT} ${WIDTH}` : `0 0 ${WIDTH} ${HEIGHT}`}
      width={size === 'fill' ? '100%' : horizontal ? HEIGHT : WIDTH}
      height={size === 'fill' ? undefined : horizontal ? WIDTH : HEIGHT}
      role="img"
      aria-label="Chord diagram"
      className="select-none"
    >
      <g transform={horizontal ? `translate(0, ${WIDTH}) rotate(-90)` : undefined}>
      {/* Open / muted markers above the diagram */}
      {strings.map((s, i) => {
        const x = xForString(i);
        if (s.kind === 'open') {
          return (
            <text
              key={`top-${i}`}
              x={x}
              y={PAD_TOP - 10}
              fontSize={s.note ? (s.note.length > 1 ? 9 : 10) : 11}
              fontWeight={s.note ? 700 : 400}
              textAnchor="middle"
              fill="var(--ink)"
              fontFamily="ui-monospace, monospace"
              {...upright(x, PAD_TOP - 10)}
            >
              {s.note ?? 'O'}
            </text>
          );
        }
        if (s.kind === 'muted') {
          return (
            <text
              key={`top-${i}`}
              x={x}
              y={PAD_TOP - 10}
              fontSize={11}
              textAnchor="middle"
              fill="var(--ink-muted)"
              fontFamily="ui-monospace, monospace"
              {...upright(x, PAD_TOP - 10)}
            >
              ×
            </text>
          );
        }
        return null;
      })}

      {/* Nut (thick top line) when at fret 1; otherwise a fret label */}
      {atNut ? (
        <rect
          x={PAD_LEFT}
          y={PAD_TOP - 3}
          width={fretBoxW}
          height={3}
          fill="var(--ink)"
        />
      ) : (
        <text
          // Rotated, the vertical position would land on top of the low-E
          // dot; shifting it past the string block puts it under the board.
          x={horizontal ? PAD_LEFT - 20 : PAD_LEFT - 7}
          y={PAD_TOP + fretGap / 2 + 3}
          fontSize={9}
          textAnchor={horizontal ? 'middle' : 'end'}
          fill="var(--ink-muted)"
          fontFamily="ui-monospace, monospace"
          {...upright(
            horizontal ? PAD_LEFT - 20 : PAD_LEFT - 7,
            PAD_TOP + fretGap / 2 + 3,
          )}
        >
          {computedStart}fr
        </text>
      )}

      {/* Frets (horizontal lines) */}
      {Array.from({ length: fretCount }, (_, i) => i).map((i) => (
        <line
          key={`fret-${i}`}
          x1={PAD_LEFT}
          x2={PAD_LEFT + fretBoxW}
          y1={PAD_TOP + (i + 1) * fretGap}
          y2={PAD_TOP + (i + 1) * fretGap}
          stroke="var(--line)"
          strokeWidth={1}
        />
      ))}

      {/* Strings (vertical lines) */}
      {Array.from({ length: STRING_COUNT }, (_, i) => i).map((i) => (
        <line
          key={`string-${i}`}
          x1={PAD_LEFT + i * stringGap}
          x2={PAD_LEFT + i * stringGap}
          y1={PAD_TOP}
          y2={PAD_TOP + fretBoxH}
          stroke="var(--line)"
          strokeWidth={1}
        />
      ))}

      {/* Barre — rendered before dots so the dots stack on top */}
      {barre && barre.fret >= computedStart && barre.fret < computedStart + fretCount && (
        <rect
          x={xForString(Math.max(barre.fromString, barre.toString)) - 5}
          y={yForFret(barre.fret) - 5}
          width={
            Math.abs(xForString(barre.fromString) - xForString(barre.toString)) + 10
          }
          height={10}
          rx={5}
          ry={5}
          fill="var(--ink)"
          opacity={0.85}
        />
      )}

      {/* Fingered dots. A labelled dot grows slightly so a two-character
          name ("G#") still fits inside it without touching the edge. */}
      {strings.map((s, i) => {
        if (s.kind !== 'fretted') return null;
        if (s.fret < computedStart || s.fret >= computedStart + fretCount) return null;
        const cx = xForString(i);
        const cy = yForFret(s.fret);
        return (
          <g key={`dot-${i}`}>
            <circle
              cx={cx}
              cy={cy}
              r={s.note ? 7.5 : 6.5}
              fill={s.isRoot ? 'var(--accent)' : 'var(--ink)'}
              stroke="#0b0d12"
              strokeWidth={1}
            />
            {s.note && (
              <text
                x={cx}
                y={cy}
                fontSize={s.note.length > 1 ? 7 : 8.5}
                fontWeight={700}
                fill={s.isRoot ? '#ffffff' : 'var(--card)'}
                textAnchor="middle"
                dominantBaseline="central"
                {...upright(cx, cy)}
              >
                {s.note}
              </text>
            )}
          </g>
        );
      })}
      </g>
    </svg>
  );
}
