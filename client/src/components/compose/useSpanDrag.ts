// Shared pointer-drag for span blocks (chords + melody/bass notes). Both
// lanes drag identically: pointer-capture on the block (so a quick flick's
// first move isn't dropped), convert pixel delta → tick delta against the
// track width, and call onMove/onResize live. Note lanes additionally map
// vertical movement to a scale degree (pitch) via `rowHeight`.
//
// The block's resize handle lives inside the block, so a resize pointerdown
// fires on the handle — capture is taken on its parent (the block) in both
// cases. Measurement uses the caller-provided track ref (its width spans
// exactly the tick columns).

import { useRef } from 'react';

export type DragMode = 'move' | 'resize';

export type DragSpan = {
  id: string;
  start: number;
  length: number;
  /** Current scale degree (note lanes only); ignored when rowHeight is unset. */
  degree?: number;
};

type DragState = {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  tickW: number;
  origStart: number;
  origLength: number;
  origDegree: number;
  lastDegree: number;
};

export type SpanDragHandlers = {
  begin: (e: React.PointerEvent, span: DragSpan, mode: DragMode) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
};

export function useSpanDrag(opts: {
  trackRef: React.RefObject<HTMLElement | null>;
  totalTicks: number;
  /** Row height in px; when set, vertical drag changes degree (1..7). */
  rowHeight?: number;
  /** newDegree equals the original degree when rowHeight is unset. */
  onMove: (id: string, newStart: number, newDegree: number) => void;
  onResize: (id: string, newLength: number) => void;
  /** Fired when a move-drag crosses into a new degree (for audition). */
  onDegreeChange?: (degree: number) => void;
}): SpanDragHandlers {
  const drag = useRef<DragState | null>(null);

  const begin = (e: React.PointerEvent, span: DragSpan, mode: DragMode) => {
    const track = opts.trackRef.current;
    const el = e.currentTarget as HTMLElement;
    const block = mode === 'resize' ? (el.parentElement as HTMLElement | null) : el;
    if (!track || !block) return;
    const rect = track.getBoundingClientRect();
    drag.current = {
      id: span.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      tickW: rect.width / opts.totalTicks,
      origStart: span.start,
      origLength: span.length,
      origDegree: span.degree ?? 0,
      lastDegree: span.degree ?? 0,
    };
    block.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const deltaTicks = Math.round((e.clientX - d.startX) / d.tickW);
    if (d.mode === 'resize') {
      opts.onResize(d.id, d.origLength + deltaTicks);
      return;
    }
    let degree = d.origDegree;
    if (opts.rowHeight) {
      const deltaRows = Math.round((e.clientY - d.startY) / opts.rowHeight);
      degree = Math.max(1, Math.min(7, d.origDegree - deltaRows));
      if (degree !== d.lastDegree) {
        opts.onDegreeChange?.(degree);
        d.lastDegree = degree;
      }
    }
    opts.onMove(d.id, d.origStart + deltaTicks, degree);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    }
    drag.current = null;
  };

  return { begin, onPointerMove, onPointerUp };
}
