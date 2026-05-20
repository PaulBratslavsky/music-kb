import type { ReactElement } from 'react';
import type { Note, PitchClass } from '../../types';
import { midiFromNote } from '../../theory/notes';

type Props = {
  notes: Note[];
  pcDisplay?: Partial<Record<PitchClass, string>>;
  /**
   * 'stack'    chord     — notes stacked vertically at one position
   * 'sequence' scale     — notes ascending across the bar
   * 'single'   one note  — single whole note
   */
  mode: 'stack' | 'sequence' | 'single';
};

// Book-like compact proportions: 5-line staff at small line gap, single bar.
const STAFF_LINE_GAP = 6;
const STAFF_LEFT = 38;
const STAFF_TOP = 14;
const STAFF_HEIGHT = STAFF_LINE_GAP * 4;
const STAFF_BOTTOM = STAFF_TOP + STAFF_HEIGHT;
const NOTE_WIDTH = 26;
const PADDING = 8;
const NOTE_RX = 4.5;
const NOTE_RY = 3.2;

const LETTER_STEP: Record<string, number> = {
  C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6,
};

function diatonicStep(note: Note, displayName: string): number {
  const letter = displayName[0].toUpperCase();
  return note.octave * 7 + (LETTER_STEP[letter] ?? 0);
}

// F5 (top staff line) reference. Each diatonic step = half-line gap.
const F5_STEP = 38;
function yForStep(step: number): number {
  return STAFF_TOP + (F5_STEP - step) * (STAFF_LINE_GAP / 2);
}

function accidentalFor(displayName: string): string | null {
  if (displayName.length < 2) return null;
  if (displayName.includes('#')) return '♯';
  if (displayName.includes('b')) return '♭';
  return null;
}

export function SheetMusicView({ notes, pcDisplay, mode }: Props) {
  const uniq = new Map<number, Note>();
  for (const n of notes) {
    const m = midiFromNote(n);
    if (!uniq.has(m)) uniq.set(m, n);
  }
  const sorted = [...uniq.values()].sort((a, b) => midiFromNote(a) - midiFromNote(b));

  const xFor = (i: number): number => {
    if (mode === 'stack') return STAFF_LEFT + 30;
    return STAFF_LEFT + 18 + i * NOTE_WIDTH;
  };

  const totalWidth =
    mode === 'stack'
      ? STAFF_LEFT + 70
      : STAFF_LEFT + 18 + Math.max(1, sorted.length) * NOTE_WIDTH + PADDING + 6;
  const totalHeight = STAFF_BOTTOM + 20; // room for clef descender + low ledger lines

  const ledgerLines = (note: Note, x: number): ReactElement[] => {
    const display = pcDisplay?.[note.pitchClass] ?? note.pitchClass;
    const step = diatonicStep(note, display);
    const y = yForStep(step);
    const out: ReactElement[] = [];
    if (y > STAFF_BOTTOM) {
      // Below staff — ledger lines start one step below bottom line (E4 = 30).
      for (let s = 28; s >= step; s -= 2) {
        const ly = yForStep(s);
        out.push(
          <line
            key={`led-low-${s}-${x}`}
            x1={x - 7}
            x2={x + 7}
            y1={ly}
            y2={ly}
            stroke="var(--text)"
            strokeWidth={1}
          />,
        );
      }
    } else if (y < STAFF_TOP) {
      for (let s = 40; s <= step; s += 2) {
        const ly = yForStep(s);
        out.push(
          <line
            key={`led-high-${s}-${x}`}
            x1={x - 7}
            x2={x + 7}
            y1={ly}
            y2={ly}
            stroke="var(--text)"
            strokeWidth={1}
          />,
        );
      }
    }
    return out;
  };

  return (
    <svg
      className="instrument-svg"
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Sheet music notation"
      style={{ maxWidth: totalWidth * 4, height: 'auto' }}
    >
      {/* 5 staff lines */}
      {Array.from({ length: 5 }, (_, i) => (
        <line
          key={`staff-${i}`}
          x1={STAFF_LEFT}
          x2={totalWidth - PADDING}
          y1={STAFF_TOP + i * STAFF_LINE_GAP}
          y2={STAFF_TOP + i * STAFF_LINE_GAP}
          stroke="var(--text)"
          strokeWidth={0.8}
        />
      ))}

      {/* Treble clef (Unicode 𝄞) — sized to fit the staff height */}
      <text
        x={STAFF_LEFT - 28}
        y={STAFF_BOTTOM + 6}
        fontSize={32}
        fill="var(--text)"
        fontFamily="serif"
      >
        𝄞
      </text>

      {/* Bar lines */}
      <line
        x1={STAFF_LEFT}
        x2={STAFF_LEFT}
        y1={STAFF_TOP}
        y2={STAFF_BOTTOM}
        stroke="var(--text)"
        strokeWidth={1}
      />
      <line
        x1={totalWidth - PADDING}
        x2={totalWidth - PADDING}
        y1={STAFF_TOP}
        y2={STAFF_BOTTOM}
        stroke="var(--text)"
        strokeWidth={1.3}
      />

      {/* Notes */}
      {sorted.map((note, i) => {
        const display = pcDisplay?.[note.pitchClass] ?? note.pitchClass;
        const step = diatonicStep(note, display);
        const x = xFor(i);
        const y = yForStep(step);
        const acc = accidentalFor(display);
        return (
          <g key={`n-${midiFromNote(note)}`}>
            {ledgerLines(note, x)}
            {acc && (
              <text
                x={x - 11}
                y={y + 3}
                fontSize={11}
                fill="var(--text)"
                fontFamily="serif"
                textAnchor="middle"
              >
                {acc}
              </text>
            )}
            {/* Whole note: open ellipse, slight tilt like engraved notation */}
            <ellipse
              cx={x}
              cy={y}
              rx={NOTE_RX}
              ry={NOTE_RY}
              fill="none"
              stroke="var(--text)"
              strokeWidth={1.4}
              transform={`rotate(-22 ${x} ${y})`}
            />
          </g>
        );
      })}
    </svg>
  );
}
