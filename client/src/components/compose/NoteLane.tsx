// A piano-roll lane for melody or bass. Seven degree rows (degree 7 on
// top, 1 at the bottom, each labeled with its note name in the current
// key) over the 128-tick timeline. Click an empty cell to drop a note of
// the current duration; drag a note's body to move it in time AND pitch
// (up/down across rows), drag its right edge to resize, or double-click
// to remove. Monophonic: notes never overlap in time (clamped in
// spans.ts). Hovering a cell auditions the pitch.
//
// All notes render in a single lane-wide overlay (7 rows × 128 cols) so
// a move-drag can carry a note across rows; the per-row background grids
// underneath handle placement clicks + gridlines + chord-tone highlight.

import { useRef } from 'react';
import type { Composition, Degree, NoteSpan } from '#/lib/music/compose/types';
import { TOTAL_TICKS } from '#/lib/music/compose/types';
import { keyToScaleSelection, resolveMelodyMidi, resolveBassMidi } from '#/lib/music/compose/playback';
import { getScalePitchClasses } from '#/lib/music/theory/scales';
import { synth } from '#/lib/music/audio/synth';
import { LABEL_W, TRACK_COLS, isBarStart, isBeatStart } from './laneLayout';
import type { ChordToneHighlight } from './chordHighlight';

const DEGREES: Degree[] = [7, 6, 5, 4, 3, 2, 1];
const ROW_H = 20; // px, must match the row height below
/** Grid row (1-based, top=1) for a degree, given DEGREES order. */
const rowForDegree = (degree: number) => 8 - degree;

type DragState = {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  tickW: number;
  origStart: number;
  origLength: number;
  origDegree: Degree;
  /** Last degree auditioned during a move-drag, to avoid re-triggering. */
  lastDegree: Degree;
};

export function NoteLane({
  comp,
  lane,
  notes,
  currentStep,
  color,
  highlight,
  selectedId,
  onPlace,
  onSelect,
  onMove,
  onResize,
  onRemove,
}: {
  comp: Composition;
  lane: 'melody' | 'bass';
  notes: NoteSpan[];
  currentStep: number | null;
  color: string;
  highlight?: ChordToneHighlight | null;
  selectedId: string | null;
  onPlace: (degree: Degree, tick: number) => void;
  onSelect: (id: string | null) => void;
  /** Move a note to a new start tick and (for body drags) a new degree. */
  onMove: (id: string, newStart: number, newDegree: Degree) => void;
  onResize: (id: string, newLength: number) => void;
  onRemove: (id: string) => void;
}) {
  const pcs = getScalePitchClasses(keyToScaleSelection(comp)); // index 0 = degree 1
  const resolve = lane === 'melody' ? resolveMelodyMidi : resolveBassMidi;
  const dragRef = useRef<DragState | null>(null);

  const preview = (degree: Degree) => {
    const midi = resolve(comp, { degree, octave: 0 });
    if (midi != null) synth.playNote(midi, 260, lane === 'melody' ? 'piano' : 'bass');
  };

  // Pointer capture + handlers live on the note block (not gated by
  // state) so the very first pointermove of a quick flick registers —
  // otherwise short nudges get dropped and read as a click.
  const beginDrag = (e: React.PointerEvent, note: NoteSpan, mode: 'move' | 'resize') => {
    const el = e.currentTarget as HTMLElement;
    const block = mode === 'resize' ? (el.parentElement as HTMLElement | null) : el;
    const overlay = el.closest('.note-overlay');
    if (!overlay || !block) return;
    const rect = overlay.getBoundingClientRect();
    dragRef.current = {
      id: note.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      tickW: rect.width / TOTAL_TICKS,
      origStart: note.start,
      origLength: note.length,
      origDegree: note.degree,
      lastDegree: note.degree,
    };
    block.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const deltaTicks = Math.round((e.clientX - d.startX) / d.tickW);
    if (d.mode === 'resize') {
      onResize(d.id, d.origLength + deltaTicks);
      return;
    }
    // Body drag: time (x) + pitch (y). Up = higher degree.
    const deltaRows = Math.round((e.clientY - d.startY) / ROW_H);
    const newDegree = Math.max(1, Math.min(7, d.origDegree - deltaRows)) as Degree;
    // Audition the pitch as the note crosses into a new row.
    if (newDegree !== d.lastDegree) {
      preview(newDegree);
      d.lastDegree = newDegree;
    }
    onMove(d.id, d.origStart + deltaTicks, newDegree);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    }
    dragRef.current = null;
  };

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
              const isPlayhead = tick === currentStep;
              return (
                <button
                  key={tick}
                  type="button"
                  onClick={() => onPlace(degree, tick)}
                  onMouseEnter={() => preview(degree)}
                  className={`border-b ${
                    isPlayhead ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-subtle)]'
                  }`}
                  style={{
                    borderColor: 'var(--line)',
                    borderLeft: isBarStart(tick)
                      ? '2px solid var(--ink-muted)'
                      : isBeatStart(tick)
                        ? '1px solid var(--line)'
                        : 'none',
                    backgroundColor: toned && !isPlayhead ? highlight!.color : undefined,
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
        className="note-overlay pointer-events-none absolute top-0 grid"
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
              onPointerDown={(e) => beginDrag(e, note, 'move')}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
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
                onPointerDown={(e) => beginDrag(e, note, 'resize')}
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
