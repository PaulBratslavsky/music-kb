// Composes the whole progression into ONE svg.instrument-svg so the existing
// pure-SVG PNG exporter (exportFretboardPng) can rasterize it. Rendered
// off-screen by ProgressionPanel; never shown directly. Each chord is the
// same ChordMini diagram the on-screen strip uses, nested at a grid cell,
// with the chord name beneath.
import { ChordMini } from '#/components/ChordMini';
import { QUALITY_LABELS } from '@music-kb/music/theory/quality-labels';
import type { ProgressionChord } from '#/lib/services/progressions';
import type { ChordQuality } from '@music-kb/music/types';

function label(c: ProgressionChord): string {
  return `${c.root}${QUALITY_LABELS[c.quality as ChordQuality] ?? c.quality}`;
}

const COLS = 4;

export function ProgressionSheet({
  chords,
  instrument,
}: {
  chords: ProgressionChord[];
  instrument: 'guitar' | 'piano';
}) {
  if (chords.length === 0) return null;
  const guitar = instrument === 'guitar';
  // Diagram intrinsic sizes (match ChordDiagram / MiniPiano).
  const DW = guitar ? 134 : 112;
  const DH = guitar ? 140 : 64;
  const LABEL_H = 22;
  const PAD = 12;
  const cellW = DW + PAD * 2;
  const cellH = DH + LABEL_H + PAD;
  const cols = Math.min(COLS, chords.length);
  const rows = Math.ceil(chords.length / cols);
  const W = cols * cellW;
  const H = rows * cellH;

  return (
    <svg
      className="instrument-svg"
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
    >
      <rect x={0} y={0} width={W} height={H} fill="var(--card)" />
      {chords.map((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * cellW;
        const y = row * cellH;
        const dx = x + (cellW - DW) / 2;
        const dy = y + PAD;
        return (
          <g key={`${c.root}-${c.quality}-${c.voicingIndex ?? 0}-${i}`}>
            <g transform={`translate(${dx}, ${dy})`}>
              <ChordMini chord={c} instrument={instrument} orientation="horizontal" />
            </g>
            <text
              x={x + cellW / 2}
              y={y + PAD + DH + 15}
              textAnchor="middle"
              fontSize={13}
              fontWeight={600}
              fill="var(--ink)"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {label(c)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
