import type { Note, PitchClass } from '../../types';
import { STANDARD_TUNING_MIDI } from '../guitar/layout';
import { midiFromNote } from '../../theory/notes';

type Props = {
  notes: Note[];
  pcDisplay?: Partial<Record<PitchClass, string>>;
  /**
   * 'stack'    — chord (stack notes at one column, one per string)
   * 'sequence' — scale (notes ascending across columns)
   * 'single'   — single note
   */
  mode: 'stack' | 'sequence' | 'single';
};

const STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E']; // 0 = high E
const STRING_GAP = 11;
const PADDING_X = 26;
const PADDING_Y = 14;
const COL_WIDTH = 26;
const LEFT_LABEL_W = 10;

function findStringFret(note: Note): { string: number; fret: number } | null {
  const target = midiFromNote(note);
  let best: { string: number; fret: number } | null = null;
  for (let s = 0; s < STANDARD_TUNING_MIDI.length; s++) {
    const fret = target - STANDARD_TUNING_MIDI[s];
    if (fret < 0 || fret > 15) continue;
    if (!best || fret < best.fret) best = { string: s, fret };
  }
  return best;
}

export function TabView({ notes, pcDisplay, mode }: Props) {
  // For 'sequence' (scale) we want to PRESERVE the input order so the TAB
  // matches the sheet music. For 'stack' (chord) we de-dupe by string but
  // also keep the input order to follow the voicing.
  // De-dupe by midi only (so the same note repeated in input doesn't double up).
  const seenMidi = new Set<number>();
  const inOrder = notes.filter((n) => {
    const m = midiFromNote(n);
    if (seenMidi.has(m)) return false;
    seenMidi.add(m);
    return true;
  });

  const entries: { col: number; pos: { string: number; fret: number }; note: Note }[] = [];
  if (mode === 'stack' || mode === 'single') {
    const usedStrings = new Set<number>();
    inOrder.forEach((note) => {
      const pos = findStringFret(note);
      if (!pos || usedStrings.has(pos.string)) return;
      usedStrings.add(pos.string);
      entries.push({ col: 0, pos, note });
    });
  } else {
    inOrder.forEach((note, i) => {
      const pos = findStringFret(note);
      if (pos) entries.push({ col: i, pos, note });
    });
  }

  const numCols = mode === 'sequence' ? Math.max(1, inOrder.length) : 1;
  const totalWidth = PADDING_X * 2 + LEFT_LABEL_W + numCols * COL_WIDTH + 8;
  const totalHeight = PADDING_Y * 2 + STRING_GAP * 5 + 12; // extra for letter labels

  const yForString = (s: number) => PADDING_Y + s * STRING_GAP;
  const xForCol = (col: number) =>
    PADDING_X + LEFT_LABEL_W + (col + 0.5) * COL_WIDTH;

  // Where to place the row of note-letter labels (just below the lowest string).
  const letterY = yForString(5) + 14;

  return (
    <svg
      className="instrument-svg"
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Guitar tablature"
      style={{ maxWidth: totalWidth * 4, height: 'auto' }}
    >
      {/* string labels */}
      {STRING_LABELS.map((label, s) => (
        <text
          key={`tl-${s}`}
          x={PADDING_X - 2}
          y={yForString(s) + 3}
          fontSize={9}
          fill="var(--text-dim)"
          textAnchor="end"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontWeight={600}
        >
          {label}
        </text>
      ))}

      {/* string lines */}
      {STRING_LABELS.map((_, s) => (
        <line
          key={`tl-line-${s}`}
          x1={PADDING_X + LEFT_LABEL_W}
          x2={totalWidth - PADDING_X / 2}
          y1={yForString(s)}
          y2={yForString(s)}
          stroke="var(--text-dim)"
          strokeWidth={0.7}
        />
      ))}

      {/* nut */}
      <line
        x1={PADDING_X + LEFT_LABEL_W}
        x2={PADDING_X + LEFT_LABEL_W}
        y1={yForString(0) - 2}
        y2={yForString(5) + 2}
        stroke="var(--text)"
        strokeWidth={1.3}
      />

      {/* fret numbers */}
      {entries.map((e, i) => {
        const cx = xForCol(e.col);
        const cy = yForString(e.pos.string);
        const label = String(e.pos.fret);
        const w = label.length === 1 ? 10 : 16;
        const noteName =
          pcDisplay?.[e.note.pitchClass] ?? e.note.pitchClass;
        return (
          <g key={`tab-${i}-${e.pos.string}-${e.pos.fret}`}>
            <rect
              x={cx - w / 2}
              y={cy - 6}
              width={w}
              height={12}
              fill="var(--panel)"
            />
            <text
              x={cx}
              y={cy + 3.5}
              fontSize={10}
              fill="var(--text)"
              textAnchor="middle"
              fontWeight={700}
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
            >
              {label}
            </text>
            {/* Note-letter label below the lowest string, aligned with the column */}
            <text
              x={cx}
              y={letterY}
              fontSize={9}
              fill="var(--text-dim)"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              fontWeight={600}
            >
              {noteName}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
