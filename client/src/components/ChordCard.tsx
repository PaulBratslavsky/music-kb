// One chord as a compact, self-contained card — the per-chord export source
// ("⬇ Export each" in ProgressionPanel). Built for dropping onto a vertical
// short video as an overlay, so it spends no pixels it doesn't need: the
// name sits directly above the diagram and padding is minimal. The card is
// a rounded rect; export it with a transparent PNG background so the
// corners stay see-through.
//
// Distinct from ProgressionSheet (the whole progression in a grid, name
// under each diagram) — that layout reads well as a page, not as an overlay.
import { ChordMini } from '#/components/ChordMini';
import type { ProgressionChord } from '#/lib/services/progressions';

// Intrinsic diagram sizes: ChordDiagram drawn horizontally is 140×134
// (its 134×140 box rotated); MiniPiano is 112×64. `gap` is the space
// between the name's baseline and the diagram — the guitar diagram brings
// its own 12px top gutter, the keyboard starts at its top edge.
const GUITAR = { w: 140, h: 134, gap: 0 };
const PIANO = { w: 112, h: 64, gap: 12 };
const PAD_X = 8;
const NAME_SIZE = 20;
const NAME_BASELINE = 24;

export function ChordCard({
  chord,
  label,
  instrument,
}: {
  chord: ProgressionChord;
  label: string;
  instrument: 'guitar' | 'piano';
}) {
  const guitar = instrument === 'guitar';
  const d = guitar ? GUITAR : PIANO;
  const W = d.w + PAD_X * 2;
  // The guitar diagram carries its own bottom gutter (for the "5fr" label);
  // the piano has none, so give it the same side padding underneath.
  const top = NAME_BASELINE + d.gap;
  const H = top + d.h + (guitar ? 0 : PAD_X);

  return (
    <svg
      className="instrument-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
    >
      <rect x={0} y={0} width={W} height={H} rx={12} ry={12} fill="var(--card)" />
      <text
        x={W / 2}
        y={NAME_BASELINE}
        textAnchor="middle"
        fontSize={NAME_SIZE}
        fontWeight={700}
        fill="var(--ink)"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {label}
      </text>
      <g transform={`translate(${PAD_X}, ${top})`}>
        <ChordMini chord={chord} instrument={instrument} orientation="horizontal" />
      </g>
    </svg>
  );
}
