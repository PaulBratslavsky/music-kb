// A piano-roll lane for melody or bass. Seven degree rows (degree 7 on
// top, 1 at the bottom, each labeled with its note name in the current
// key) over the 128-tick timeline. Click an empty cell to drop a note of
// the current duration; drag a note's body to move it, its right edge to
// resize, or × to remove. Monophonic: notes never overlap in time
// (clamped in spans.ts). Hovering auditions the pitch.

import { useRef, useState } from 'react';
import type { Composition, Degree, NoteSpan } from '#/lib/music/compose/types';
import { TOTAL_TICKS } from '#/lib/music/compose/types';
import { keyToScaleSelection, resolveMelodyMidi, resolveBassMidi } from '#/lib/music/compose/playback';
import { getScalePitchClasses } from '#/lib/music/theory/scales';
import { synth } from '#/lib/music/audio/synth';
import { LABEL_W, TRACK_COLS, isBarStart, isBeatStart } from './laneLayout';
import type { ChordToneHighlight } from './chordHighlight';

const DEGREES: Degree[] = [7, 6, 5, 4, 3, 2, 1];

type DragState = {
  id: string;
  mode: 'move' | 'resize';
  pointerStartX: number;
  tickW: number;
  origStart: number;
  origLength: number;
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
  onMove: (id: string, newStart: number) => void;
  onResize: (id: string, newLength: number) => void;
  onRemove: (id: string) => void;
}) {
  const pcs = getScalePitchClasses(keyToScaleSelection(comp)); // index 0 = degree 1
  const resolve = lane === 'melody' ? resolveMelodyMidi : resolveBassMidi;
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  const preview = (degree: Degree) => {
    const midi = resolve(comp, { degree, octave: 0 });
    if (midi != null) synth.playNote(midi, 260, lane === 'melody' ? 'piano' : 'bass');
  };

  const beginDrag = (e: React.PointerEvent, note: NoteSpan, mode: 'move' | 'resize') => {
    // Measure the row's overlay grid (not the block/handle that started
    // the drag) so tick width is correct for both move and resize.
    const overlay = (e.currentTarget as HTMLElement).closest('.note-overlay');
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    dragRef.current = {
      id: note.id,
      mode,
      pointerStartX: e.clientX,
      tickW: rect.width / TOTAL_TICKS,
      origStart: note.start,
      origLength: note.length,
    };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const delta = Math.round((e.clientX - d.pointerStartX) / d.tickW);
    if (d.mode === 'move') onMove(d.id, d.origStart + delta);
    else onResize(d.id, d.origLength + delta);
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
    <div className="flex flex-col">
      {DEGREES.map((degree) => {
        const rowNotes = notes.filter((n) => n.degree === degree);
        return (
          <div key={degree} className="flex items-stretch" style={{ height: 20 }}>
            <div
              style={{ width: LABEL_W }}
              className="flex flex-shrink-0 items-center justify-end gap-1 pr-1.5 text-[9px] leading-none text-[var(--ink-muted)]"
            >
              <span className="tabular-nums">{degree}</span>
              <span className="font-medium text-[var(--ink-soft)]">
                {pcs[degree - 1] ?? ''}
              </span>
            </div>
            <div className="relative flex-1">
              {/* Background cells: placement targets + gridlines + highlight */}
              <div className="grid h-full" style={{ gridTemplateColumns: TRACK_COLS }}>
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
              {/* Note blocks overlay */}
              <div
                className="note-overlay pointer-events-none absolute inset-0 grid"
                style={{ gridTemplateColumns: TRACK_COLS }}
                onPointerMove={dragging ? onPointerMove : undefined}
                onPointerUp={dragging ? endDrag : undefined}
              >
                {rowNotes.map((note) => {
                  const selected = note.id === selectedId;
                  return (
                    <div
                      key={note.id}
                      className={`pointer-events-auto relative flex cursor-grab select-none items-center rounded-sm ${
                        selected ? 'ring-1 ring-white' : ''
                      }`}
                      style={{
                        gridColumn: `${note.start + 1} / span ${note.length}`,
                        backgroundColor: color,
                      }}
                      onPointerDown={(e) => beginDrag(e, note, 'move')}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(note.id);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onRemove(note.id);
                      }}
                      title="Drag to move, right edge to resize, double-click to remove"
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
          </div>
        );
      })}
    </div>
  );
}
