// The chord lane — variable-length chord blocks over the 32-beat
// timeline. Blocks can be:
//   - clicked to select (palette then changes the selected block's degree)
//   - dragged by the body to reposition (move)
//   - dragged by the right edge to resize (extend / shrink)
//   - cleared via the × button
// Empty beats are click targets that set the insertion cursor, where the
// next palette chip drops a chord. All overlap/clamp rules live in
// spans.ts; this component just converts pointer geometry into beats and
// calls the handlers live so a block follows the cursor as you drag.

import { memo, useRef } from 'react';
import type { ChordSpan } from '#/lib/music/compose/types';
import { TOTAL_TICKS } from '#/lib/music/compose/types';
import type { DegreeLabel } from '#/lib/music/compose/labels';
import { degreeColor } from '#/lib/music/compose/colors';
import { LABEL_W, TRACK_COLS, isBarStart, isBeatStart } from './laneLayout';
import { useSpanDrag } from './useSpanDrag';

function ChordLaneImpl({
  chords,
  labels,
  selectedId,
  cursor,
  onSelect,
  onSetCursor,
  onMove,
  onResize,
  onRemove,
}: {
  chords: ChordSpan[];
  /** Triad + seventh labels per diatonic degree for the current key. */
  labels: Record<number, DegreeLabel>;
  selectedId: string | null;
  cursor: number;
  onSelect: (id: string | null) => void;
  onSetCursor: (beat: number) => void;
  onMove: (id: string, newStart: number) => void;
  onResize: (id: string, newLength: number) => void;
  onRemove: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const { begin, onPointerMove, onPointerUp } = useSpanDrag({
    trackRef,
    totalTicks: TOTAL_TICKS,
    onMove: (id, start) => onMove(id, start),
    onResize,
  });

  return (
    <div className="flex items-stretch" style={{ height: 56 }}>
      <div
        style={{ width: LABEL_W }}
        className="flex flex-shrink-0 items-center justify-end pr-1.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]"
      >
        Chords
      </div>
      <div className="relative flex-1">
        {/* Background: clickable beat cells + bar gridlines + cursor */}
        <div
          ref={trackRef}
          className="grid h-full"
          style={{ gridTemplateColumns: TRACK_COLS }}
        >
          {Array.from({ length: TOTAL_TICKS }, (_, step) => (
            <button
              key={step}
              type="button"
              onClick={() => {
                onSelect(null);
                onSetCursor(step);
              }}
              className={`border-b ${
                step === cursor && selectedId == null
                  ? 'bg-[var(--bg-subtle)] ring-1 ring-inset ring-[var(--accent)]'
                  : ''
              }`}
              style={{
                borderColor: 'var(--line)',
                borderLeft: isBarStart(step)
                  ? '2px solid var(--ink-muted)'
                  : isBeatStart(step)
                    ? '1px solid var(--line)'
                    : 'none',
              }}
              aria-label={`Tick ${step + 1}`}
            />
          ))}
        </div>

        {/* Foreground: chord blocks, positioned on the same column grid */}
        <div
          className="pointer-events-none absolute inset-0 grid"
          style={{ gridTemplateColumns: TRACK_COLS }}
        >
          {chords.map((span) => {
            const entry = labels[span.degree];
            const label = entry
              ? span.seventh
                ? entry.seventh
                : entry.triad
              : undefined;
            const selected = span.id === selectedId;
            const color = degreeColor(span.degree);
            return (
              <div
                key={span.id}
                className={`pointer-events-auto relative my-0.5 flex cursor-grab select-none flex-col items-center justify-center rounded text-white ${
                  selected ? 'ring-2 ring-white ring-offset-1 ring-offset-[var(--card)]' : ''
                }`}
                style={{
                  gridColumn: `${span.start + 1} / span ${span.length}`,
                  backgroundColor: color,
                }}
                onPointerDown={(e) => begin(e, span, 'move')}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(span.id);
                }}
              >
                <span className="text-sm font-bold leading-none">
                  {label?.roman ?? span.degree}
                </span>
                <span className="text-[10px] leading-tight opacity-90">
                  {label?.name ?? ''}
                </span>
                {/* Clear button — top-left so it never sits under the
                    right-edge resize handle. */}
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(span.id);
                  }}
                  className="absolute left-0.5 top-0 z-20 text-xs leading-none text-white/70 hover:text-white"
                  aria-label="Remove chord"
                >
                  ×
                </button>
                {/* Resize handle (right edge) */}
                <div
                  onPointerDown={(e) => begin(e, span, 'resize')}
                  className="absolute right-0 top-0 h-full w-2 cursor-ew-resize rounded-r bg-black/10 hover:bg-black/25"
                  aria-label="Resize chord"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Memoized: with stable handler props + key-derived `labels`, editing a
// note lane or the playhead advancing won't re-render the chord lane.
export const ChordLane = memo(ChordLaneImpl);
