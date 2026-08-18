// Read-only Ableton Push grid — the third instrument diagram, alongside
// MiniNeck and MiniKeyboard.
//
// PushView in ../../instruments is the interactive /builder surface
// (click to play, game mode). This is the small static picture for the
// play-along panel and lesson pages, same reasoning as the other two.
//
// Layout is Push's stock chromatic mode, straight from buildPushLayout():
// bottom-left is the lowest pitch, +1 semitone per column right, +5 (a
// perfect fourth) per row up. That fourth-per-row is why a chord shape on
// Push repeats diagonally rather than horizontally, and why the same shape
// works from any starting pad — the thing the grid is good at showing.

import { buildPushLayout } from '../../instruments/push/layout';
import type { PitchClass } from '../../types';

export type PushMark = {
  pc: PitchClass;
  /** Text on the pad — a note name or a degree. Falls back to the pitch class. */
  label?: string;
  /** The anchor note: scale tonic, or the chord's root. */
  root?: boolean;
};

export type MiniPushProps = {
  /** Pitch classes to light. Every pad sounding one of these lights up —
   *  a chord shape therefore appears everywhere it exists on the grid,
   *  which is exactly how you learn to move it around. */
  marks: PushMark[];
  /** Visible grid size. The full instrument is 8x8; a chord card is
   *  legible much smaller. Counted from the bottom-left origin. */
  rows?: number;
  cols?: number;
  /** Print the note name on unlit pads too. Off for chord cards (they'd
   *  compete with the shape), on for the scale view where the unlit pads
   *  are the notes you're avoiding. */
  showUnmarkedLabels?: boolean;
  ariaLabel: string;
};

const PAD = 34;
const GAP = 4;
const PADDING = 6;

export function MiniPush({
  marks,
  rows = 8,
  cols = 8,
  showUnmarkedLabels = false,
  ariaLabel,
}: MiniPushProps) {
  const grid = buildPushLayout();
  const byPc = new Map<PitchClass, PushMark>(marks.map((m) => [m.pc, m]));

  const width = PADDING * 2 + cols * PAD + (cols - 1) * GAP;
  const height = PADDING * 2 + rows * PAD + (rows - 1) * GAP;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ maxWidth: width }}
      role="img"
      aria-label={ariaLabel}
      className="select-none"
    >
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const pad = grid[r]?.[c];
          if (!pad) return null;
          const pc = pad.note.pitchClass;
          const mark = byPc.get(pc);
          // Row 0 is the LOWEST pitch, so it belongs at the bottom of the
          // drawing — flip the y axis rather than the data.
          const x = PADDING + c * (PAD + GAP);
          const y = PADDING + (rows - 1 - r) * (PAD + GAP);
          const lit = mark != null;
          return (
            <g key={`${r}-${c}`}>
              <rect
                x={x}
                y={y}
                width={PAD}
                height={PAD}
                rx={5}
                fill={
                  mark?.root
                    ? 'var(--accent)'
                    : lit
                      ? 'var(--ink)'
                      : 'var(--bg-subtle)'
                }
                stroke={lit ? 'none' : 'var(--line)'}
                strokeWidth={1}
              />
              {(lit || showUnmarkedLabels) && (
                <text
                  x={x + PAD / 2}
                  y={y + PAD / 2}
                  fontSize={(mark?.label ?? pc).length > 2 ? 9 : 11}
                  fontWeight={lit ? 700 : 500}
                  fill={
                    mark?.root
                      ? '#ffffff'
                      : lit
                        ? 'var(--card)'
                        : 'var(--ink-muted)'
                  }
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {mark?.label ?? pc}
                </text>
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}
