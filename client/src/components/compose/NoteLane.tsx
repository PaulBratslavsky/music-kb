// A piano-roll lane for melody or bass. Seven degree rows (degree 7 on
// top, 1 at the bottom, each labeled with its note name in the current
// key) over the 128-tick timeline. Click an empty cell to drop a note of
// the current duration; drag a note's body to move it in time AND pitch
// (up/down across rows), drag its right edge to resize, or double-click
// to remove. Monophonic: notes never overlap in time (clamped in
// spans.ts). Hovering a cell auditions the pitch.
//
// Presentational: the parent supplies the per-degree note labels (`pcs`)
// and a `previewNote` audition callback, so this component holds no
// theory/audio knowledge and can be memoized — editing another lane or
// advancing the playhead won't re-render it.
//
// All notes render in a single lane-wide overlay (7 rows × 128 cols) so
// a move-drag can carry a note across rows; the per-row background grids
// underneath handle placement clicks + gridlines + chord-tone highlight.

import { memo, useRef } from 'react';
import type { Degree, NoteSpan } from '#/lib/music/compose/types';
import { TOTAL_TICKS } from '#/lib/music/compose/types';
import type { PitchClass } from '#/lib/music/types';
import { LABEL_W, TRACK_COLS, isBarStart, isBeatStart } from './laneLayout';
import type { ChordToneHighlight } from './chordHighlight';
import { useSpanDrag } from './useSpanDrag';

const DEGREES: Degree[] = [7, 6, 5, 4, 3, 2, 1];
const ROW_H = 20; // px, must match the row height below
/** Grid row (1-based, top=1) for a degree, given DEGREES order. */
const rowForDegree = (degree: number) => 8 - degree;

function NoteLaneImpl({
  lane,
  notes,
  pcs,
  color,
  highlight,
  selectedId,
  onPlace,
  onSelect,
  onMove,
  onResize,
  onRemove,
  previewNote,
}: {
  lane: 'melody' | 'bass';
  notes: NoteSpan[];
  /** Note label per degree, index 0 = degree 1, for the current key. */
  pcs: PitchClass[];
  color: string;
  highlight?: ChordToneHighlight | null;
  selectedId: string | null;
  onPlace: (degree: Degree, tick: number) => void;
  onSelect: (id: string | null) => void;
  /** Move a note to a new start tick and (for body drags) a new degree. */
  onMove: (id: string, newStart: number, newDegree: Degree) => void;
  onResize: (id: string, newLength: number) => void;
  onRemove: (id: string) => void;
  /** Audition a degree (hover + drag-across-rows). */
  previewNote: (degree: Degree) => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { begin, onPointerMove, onPointerUp } = useSpanDrag({
    trackRef: overlayRef,
    totalTicks: TOTAL_TICKS,
    rowHeight: ROW_H,
    onMove: (id, start, degree) => onMove(id, start, degree as Degree),
    onResize,
    onDegreeChange: (degree) => previewNote(degree as Degree),
  });

  return (
    <div className="relative">
      {/* Background: per-degree rows of placement cells + gridlines + highlight */}
      {DEGREES.map((degree) => (
        <div key={degree} className="flex items-stretch" style={{ height: ROW_H }}>
          <div
            style={{ width: LABEL_W }}
            className="flex flex-shrink-0 items-center justify-end gap-1 pr-1.5 text-[9px] leading-none text-[var(--ink-muted)]"
          >
            <span className="tabular-nums">{degree}</span>
            <span className="font-medium text-[var(--ink-soft)]">{pcs[degree - 1] ?? ''}</span>
          </div>
          <div className="grid flex-1" style={{ gridTemplateColumns: TRACK_COLS }}>
            {Array.from({ length: TOTAL_TICKS }, (_, tick) => {
              const toned =
                highlight != null &&
                highlight.degrees.has(degree) &&
                tick >= highlight.start &&
                tick < highlight.start + highlight.length;
              return (
                <button
                  key={tick}
                  type="button"
                  onClick={() => onPlace(degree, tick)}
                  onMouseEnter={() => previewNote(degree)}
                  className="border-b hover:bg-[var(--bg-subtle)]"
                  style={{
                    borderColor: 'var(--line)',
                    borderLeft: isBarStart(tick)
                      ? '2px solid var(--ink-muted)'
                      : isBeatStart(tick)
                        ? '1px solid var(--line)'
                        : 'none',
                    backgroundColor: toned ? highlight!.color : undefined,
                  }}
                  aria-label={`${lane} degree ${degree} tick ${tick + 1}`}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Foreground: one overlay spanning all rows, so notes can move
          across rows (pitch) as well as columns (time). Offset by the
          label gutter so columns align with the background. */}
      <div
        ref={overlayRef}
        className="pointer-events-none absolute top-0 grid"
        style={{
          left: LABEL_W,
          right: 0,
          height: ROW_H * DEGREES.length,
          gridTemplateColumns: TRACK_COLS,
          gridTemplateRows: `repeat(${DEGREES.length}, ${ROW_H}px)`,
        }}
      >
        {notes.map((note) => {
          const selected = note.id === selectedId;
          return (
            <div
              key={note.id}
              className={`pointer-events-auto relative my-px flex cursor-grab select-none items-center rounded-sm ${
                selected ? 'ring-1 ring-white' : ''
              }`}
              style={{
                gridColumn: `${note.start + 1} / span ${note.length}`,
                gridRow: rowForDegree(note.degree),
                backgroundColor: color,
              }}
              onPointerDown={(e) => begin(e, note, 'move')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(note.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onRemove(note.id);
              }}
              title="Drag to move (time + pitch), right edge to resize, double-click to remove"
            >
              <div
                onPointerDown={(e) => begin(e, note, 'resize')}
                className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r bg-black/20 hover:bg-black/40"
                aria-label="Resize note"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Memoized: with stable handler props + key-derived `pcs`, editing the
// other lane or advancing the playhead won't re-render this one.
export const NoteLane = memo(NoteLaneImpl);
