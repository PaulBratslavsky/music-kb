// BassView — 4-string bass fretboard. Same visual language as GuitarView
// (strings, frets, inlays, dot markers) but stripped to the essentials:
//   - No game mode (bass v1 is read-only).
//   - No voicing positions / shape overlays — bass plays single notes,
//     so every PC-matching position lights up; no chord shape pinning.
//   - No barre indicator.
//
// The bass neck is longer (20 frets) so the layout uses a slightly
// narrower fret width to keep the overall width similar to the guitar.

import type { Note, PitchClass } from '../../types';
import { buildBassLayout, BASS_FRET_COUNT, STANDARD_BASS_TUNING_MIDI } from './layout';
import { midiFromNote } from '../../theory/notes';

type Props = {
  highlighted: Note[];
  rootPitchClass?: PitchClass | null;
  focusedPitchClass?: PitchClass | null;
  onPickPitchClass?: (pc: PitchClass) => void;
  /** Called with the exact midi number on click (used for audio playback). */
  onPlayNote?: (midi: number) => void;
  pcLabels?: Partial<Record<PitchClass, string>>;
  showNaturals?: boolean;
  emphasizedPitchClasses?: Set<PitchClass> | null;
};

const NATURAL_PCS: ReadonlySet<PitchClass> = new Set<PitchClass>([
  'C', 'D', 'E', 'F', 'G', 'A', 'B',
]);

// Narrower frets than guitar so a 20-fret board fits comfortably.
const FRET_W = 38;
const STRING_GAP = 26;
const PADDING_X = 56;
const PADDING_Y = 22;
const NUT_W = 6;

const STRING_COUNT = STANDARD_BASS_TUNING_MIDI.length;

const FRET_INLAYS_SINGLE = new Set([3, 5, 7, 9, 15, 17, 19]);
const FRET_INLAYS_DOUBLE = new Set([12]);

export function BassView({
  highlighted,
  rootPitchClass,
  focusedPitchClass,
  onPickPitchClass,
  onPlayNote,
  pcLabels,
  showNaturals = false,
  emphasizedPitchClasses,
}: Props) {
  const grid = buildBassLayout();
  // Bass voicings aren't tracked — match every position by pitch class.
  const highlightedPCs = new Set<PitchClass>(highlighted.map((n) => n.pitchClass));

  const isLit = (note: Note) => highlightedPCs.has(note.pitchClass);
  const isRoot = (note: Note) =>
    rootPitchClass != null && note.pitchClass === rootPitchClass;
  const isFocused = (note: Note) =>
    focusedPitchClass != null && note.pitchClass === focusedPitchClass;

  const fretboardLeft = PADDING_X;
  const fretboardTop = PADDING_Y;
  const fretboardWidth = FRET_W * BASS_FRET_COUNT;
  const fretboardHeight = STRING_GAP * (STRING_COUNT - 1);

  const totalWidth = fretboardLeft + fretboardWidth + 16;
  const totalHeight = fretboardTop + fretboardHeight + PADDING_Y;

  const xForFret = (fret: number): number => {
    if (fret === 0) return fretboardLeft - 24;
    return fretboardLeft + (fret - 0.5) * FRET_W;
  };
  const yForString = (s: number): number => fretboardTop + s * STRING_GAP;

  return (
    <svg
      className="instrument-svg"
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      role="img"
      aria-label="Bass fretboard"
    >
      <rect
        x={fretboardLeft}
        y={fretboardTop - 8}
        width={fretboardWidth}
        height={fretboardHeight + 16}
        fill="var(--fret-wood)"
        rx={4}
        ry={4}
      />

      {/* Nut */}
      <rect
        x={fretboardLeft - NUT_W}
        y={fretboardTop - 8}
        width={NUT_W}
        height={fretboardHeight + 16}
        fill="#d8cdb8"
      />

      {/* Fret lines */}
      {Array.from({ length: BASS_FRET_COUNT }, (_, i) => i + 1).map((f) => (
        <line
          key={`fret-${f}`}
          x1={fretboardLeft + f * FRET_W}
          x2={fretboardLeft + f * FRET_W}
          y1={fretboardTop - 8}
          y2={fretboardTop + fretboardHeight + 8}
          stroke="var(--fret-line)"
          strokeWidth={2}
        />
      ))}

      {/* Inlay dots */}
      {Array.from({ length: BASS_FRET_COUNT }, (_, i) => i + 1)
        .filter((f) => FRET_INLAYS_SINGLE.has(f))
        .map((f) => (
          <circle
            key={`inlay-${f}`}
            cx={fretboardLeft + (f - 0.5) * FRET_W}
            cy={fretboardTop + fretboardHeight / 2}
            r={4}
            fill="#5a5048"
          />
        ))}
      {Array.from({ length: BASS_FRET_COUNT }, (_, i) => i + 1)
        .filter((f) => FRET_INLAYS_DOUBLE.has(f))
        .map((f) => (
          <g key={`inlay2-${f}`}>
            <circle
              cx={fretboardLeft + (f - 0.5) * FRET_W}
              cy={fretboardTop + STRING_GAP * 0.7}
              r={4}
              fill="#5a5048"
            />
            <circle
              cx={fretboardLeft + (f - 0.5) * FRET_W}
              cy={fretboardTop + STRING_GAP * 2.3}
              r={4}
              fill="#5a5048"
            />
          </g>
        ))}

      {/* Side-position dots above the neck */}
      {Array.from({ length: BASS_FRET_COUNT }, (_, i) => i + 1)
        .filter((f) => FRET_INLAYS_SINGLE.has(f) || FRET_INLAYS_DOUBLE.has(f))
        .map((f) => (
          <g key={`side-${f}`}>
            <circle
              cx={fretboardLeft + (f - 0.5) * FRET_W - (FRET_INLAYS_DOUBLE.has(f) ? 4 : 0)}
              cy={fretboardTop - 14}
              r={3}
              fill="var(--text-dim)"
            />
            {FRET_INLAYS_DOUBLE.has(f) && (
              <circle
                cx={fretboardLeft + (f - 0.5) * FRET_W + 4}
                cy={fretboardTop - 14}
                r={3}
                fill="var(--text-dim)"
              />
            )}
          </g>
        ))}

      {/* Strings — thicker for bass overall, gradient by index */}
      {grid.map((_, s) => (
        <line
          key={`string-${s}`}
          x1={fretboardLeft - NUT_W}
          x2={fretboardLeft + fretboardWidth}
          y1={yForString(s)}
          y2={yForString(s)}
          stroke="var(--string)"
          strokeWidth={1.5 + (s / STRING_COUNT) * 2}
        />
      ))}

      {/* Open-string labels */}
      {grid.map((row, s) => (
        <text
          key={`open-${s}`}
          x={fretboardLeft - NUT_W - 14}
          y={yForString(s) + 3}
          fontSize={10}
          fill="var(--text-dim)"
          textAnchor="end"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {row[0].note.pitchClass}
        </text>
      ))}

      {/* Fret numbers along the bottom */}
      {Array.from({ length: BASS_FRET_COUNT }, (_, i) => i + 1).map((f) => (
        <text
          key={`fnum-${f}`}
          x={fretboardLeft + (f - 0.5) * FRET_W}
          y={fretboardTop + fretboardHeight + 16}
          fontSize={9}
          fill="var(--text-dim)"
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {f}
        </text>
      ))}

      {/* Click hit-areas */}
      {onPickPitchClass &&
        grid.flatMap((row) =>
          row.map((p) => {
            const cx = xForFret(p.fret);
            const cy = yForString(p.string);
            const w = p.fret === 0 ? 22 : FRET_W - 4;
            const h = STRING_GAP - 2;
            return (
              <rect
                key={`hit-${p.string}-${p.fret}`}
                x={cx - w / 2}
                y={cy - h / 2}
                width={w}
                height={h}
                fill="rgba(0,0,0,0)"
                pointerEvents="all"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  onPickPitchClass?.(p.note.pitchClass);
                  onPlayNote?.(midiFromNote(p.note));
                }}
              >
                <title>
                  {p.note.pitchClass}
                  {p.note.octave} — string {p.string + 1}, fret {p.fret}
                </title>
              </rect>
            );
          }),
        )}

      {/* Focus rings */}
      {focusedPitchClass &&
        grid.flatMap((row) =>
          row
            .filter((p) => isFocused(p.note))
            .map((p) => (
              <circle
                key={`focus-${p.string}-${p.fret}`}
                cx={xForFret(p.fret)}
                cy={yForString(p.string)}
                r={11}
                fill="none"
                stroke="var(--focus)"
                strokeWidth={2}
                pointerEvents="none"
              />
            )),
        )}

      {/* Note markers */}
      {grid.flatMap((row) =>
        row
          .filter((p) => isLit(p.note))
          .map((p) => {
            const cx = xForFret(p.fret);
            const cy = yForString(p.string);
            const root = isRoot(p.note);
            const dimmed =
              emphasizedPitchClasses != null &&
              !emphasizedPitchClasses.has(p.note.pitchClass);
            const fill = root ? 'var(--root)' : 'var(--highlight)';
            return (
              <g
                key={`pos-${p.string}-${p.fret}`}
                pointerEvents="none"
                opacity={dimmed ? 0.3 : 1}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={9}
                  fill={fill}
                  stroke="#0b0d12"
                  strokeWidth={1.5}
                />
                <text
                  x={cx}
                  y={cy + 3}
                  fontSize={9}
                  fill="#0b0d12"
                  textAnchor="middle"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontWeight={600}
                >
                  {pcLabels?.[p.note.pitchClass] ?? p.note.pitchClass}
                </text>
              </g>
            );
          }),
      )}

      {/* Naturals overlay */}
      {showNaturals &&
        grid.flatMap((row) =>
          row
            .filter((p) => NATURAL_PCS.has(p.note.pitchClass))
            .filter((p) => !(rootPitchClass != null && p.note.pitchClass === rootPitchClass))
            .map((p) => (
              <g key={`nat-${p.string}-${p.fret}`} pointerEvents="none">
                <circle
                  cx={xForFret(p.fret)}
                  cy={yForString(p.string)}
                  r={8}
                  fill="var(--natural)"
                  stroke="#0b0d12"
                  strokeWidth={1}
                />
                <text
                  x={xForFret(p.fret)}
                  y={yForString(p.string) + 3}
                  fontSize={9}
                  fill="#0b0d12"
                  textAnchor="middle"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontWeight={600}
                >
                  {pcLabels?.[p.note.pitchClass] ?? p.note.pitchClass}
                </text>
              </g>
            )),
        )}
    </svg>
  );
}
