// The bar-number header row above the lanes. Eight bar labels, each
// spanning its four beats, aligned to the shared track grid.

import { BARS, BEATS_PER_BAR } from '#/lib/music/compose/types';
import { LABEL_W, TRACK_COLS } from './laneLayout';

export function BeatRuler() {
  return (
    <div className="flex items-end" style={{ gap: 0 }}>
      <div style={{ width: LABEL_W }} className="flex-shrink-0" />
      <div className="grid flex-1" style={{ gridTemplateColumns: TRACK_COLS }}>
        {Array.from({ length: BARS }, (_, bar) => (
          <div
            key={bar}
            className="border-l border-[var(--line)] pl-1 text-[10px] font-medium text-[var(--ink-muted)]"
            style={{ gridColumn: `${bar * BEATS_PER_BAR + 1} / span ${BEATS_PER_BAR}` }}
          >
            {bar + 1}
          </div>
        ))}
      </div>
    </div>
  );
}
