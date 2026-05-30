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

import { useRef, useState } from 'react';
import type { Composition, ChordSpan } from '#/lib/music/compose/types';
import { TOTAL_TICKS } from '#/lib/music/compose/types';
import { triadLabel } from '#/lib/music/compose/labels';
import { degreeColor } from '#/lib/music/compose/colors';
import { getDiatonicChords } from '#/lib/music/theory/diatonic';
import { keyToScaleSelection } from '#/lib/music/compose/playback';
import { LABEL_W, TRACK_COLS, isBarStart, isBeatStart } from './laneLayout';

type DragState = {
  id: string;
  mode: 'move' | 'resize';
  pointerStartX: number;
  tickW: number;
  origStart: number;
  origLength: number;
};

export function ChordLane({
  comp,
  selectedId,
  cursor,
  currentStep,
  onSelect,
  onSetCursor,
  onMove,
  onResize,
  onRemove,
}: {
  comp: Composition;
  selectedId: string | null;
  cursor: number;
  currentStep: number | null;
  onSelect: (id: string | null) => void;
  onSetCursor: (beat: number) => void;
  onMove: (id: string, newStart: number) => void;
  onResize: (id: string, newLength: number) => void;
  onRemove: (id: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const labelByDegree = (() => {
    const chords = getDiatonicChords(keyToScaleSelection(comp));
    const m = new Map<number, ReturnType<typeof triadLabel>>();
    for (const c of chords) m.set(c.degree, triadLabel(c));
    return m;
  })();

  const beginDrag = (
    e: React.PointerEvent,
    span: ChordSpan,
    mode: 'move' | 'resize',
  ) => {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    dragRef.current = {
      id: span.id,
      mode,
      pointerStartX: e.clientX,
      tickW: rect.width / TOTAL_TICKS,
      origStart: span.start,
      origLength: span.length,
    };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const deltaTicks = Math.round((e.clientX - d.pointerStartX) / d.tickW);
    if (d.mode === 'move') {
      onMove(d.id, d.origStart + deltaTicks);
    } else {
      onResize(d.id, d.origLength + deltaTicks);
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    }
    dragRef.current = null;
    setDragging(false);
  };

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
                step === currentStep ? 'bg-[var(--accent-soft)]' : ''
              } ${
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
          onPointerMove={dragging ? onPointerMove : undefined}
          onPointerUp={dragging ? endDrag : undefined}
        >
          {comp.chords.map((span) => {
            const label = labelByDegree.get(span.degree);
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
                onPointerDown={(e) => beginDrag(e, span, 'move')}
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
                  onPointerDown={(e) => beginDrag(e, span, 'resize')}
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
