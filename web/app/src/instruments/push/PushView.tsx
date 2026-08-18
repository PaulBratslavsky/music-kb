import type { GameModeState, GuessPosition, Note, PitchClass } from '../../types';
import { buildPushLayout, PUSH_COLS, PUSH_ROWS } from './layout';
import { midiFromNote } from '../../theory/notes';

type Props = {
  highlighted: Note[];
  rootPitchClass?: PitchClass | null;
  focusedPitchClass?: PitchClass | null;
  onPickPitchClass?: (pc: PitchClass) => void;
  /** Called with the exact midi number on click (used for audio playback). */
  onPlayNote?: (midi: number) => void;
  /** Optional override map: PC → label to display on lit pads (e.g., scale degrees). */
  pcLabels?: Partial<Record<PitchClass, string>>;
  emphasizedPitchClasses?: Set<PitchClass> | null;
  gameMode?: GameModeState;
  onGameGuess?: (pos: GuessPosition) => void;
};

const PAD = 44;
const GAP = 4;
const PADDING = 12;

export function PushView({
  highlighted,
  rootPitchClass,
  focusedPitchClass,
  onPickPitchClass,
  onPlayNote,
  pcLabels,
  emphasizedPitchClasses,
  gameMode,
  onGameGuess,
}: Props) {
  const inGame = gameMode?.enabled === true;
  const grid = buildPushLayout();

  const highlightedPCs = new Set<PitchClass>(highlighted.map((n) => n.pitchClass));

  const isLit = (note: Note) => highlightedPCs.has(note.pitchClass);
  const isRoot = (pc: PitchClass) => rootPitchClass != null && pc === rootPitchClass;
  const isFocused = (pc: PitchClass) => focusedPitchClass != null && pc === focusedPitchClass;

  // Pending/checked overlays for game mode, keyed by `${row}-${col}`.
  const padKey = (row: number, col: number) => `${row}-${col}`;
  const pendingPad = new Set<string>(
    inGame
      ? gameMode!.pendingGuesses
          .filter((p): p is Extract<GuessPosition, { kind: 'push' }> => p.kind === 'push')
          .map((p) => padKey(p.row, p.col))
      : [],
  );
  const checkedPad = new Map<string, { correct: boolean; expectedPC: PitchClass; actualPC: PitchClass }>();
  if (inGame && gameMode!.checkedResults) {
    for (const r of gameMode!.checkedResults) {
      if (r.position.kind === 'push') {
        checkedPad.set(padKey(r.position.row, r.position.col), {
          correct: r.correct,
          expectedPC: r.expectedPC,
          actualPC: r.actualPC,
        });
      }
    }
  }

  const totalWidth = PADDING * 2 + PUSH_COLS * PAD + (PUSH_COLS - 1) * GAP;
  const totalHeight = PADDING * 2 + PUSH_ROWS * PAD + (PUSH_ROWS - 1) * GAP;

  const xForCol = (col: number) => PADDING + col * (PAD + GAP);
  const yForDisplayRow = (displayRow: number) =>
    PADDING + displayRow * (PAD + GAP);

  return (
    <svg
      className="instrument-svg"
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      role="img"
      aria-label="Ableton Push grid (chromatic mode)"
    >
      {grid.flatMap((row, rIdx) =>
        row.map((pad) => {
          const displayRow = PUSH_ROWS - 1 - rIdx;
          const x = xForCol(pad.col);
          const y = yForDisplayRow(displayRow);
          const lit = !inGame && isLit(pad.note);
          const root = !inGame && isRoot(pad.note.pitchClass);
          const focused = !inGame && isFocused(pad.note.pitchClass);
          const dimmed =
            lit &&
            emphasizedPitchClasses != null &&
            !emphasizedPitchClasses.has(pad.note.pitchClass);

          // Compute fill/label, with game mode taking precedence.
          let fill: string;
          let label: string = '';
          let textFill: string = 'var(--text-dim)';
          let labelWeight = 500;
          if (inGame) {
            const k = padKey(pad.row, pad.col);
            const checked = checkedPad.get(k);
            const pending = pendingPad.has(k);
            if (checked) {
              fill = checked.correct ? 'var(--game-correct)' : 'var(--game-wrong)';
              if (!checked.correct) {
                label = checked.actualPC;
                textFill = '#0b0d12';
                labelWeight = 700;
              }
            } else if (pending) {
              fill = 'var(--game-pending)';
            } else {
              fill = 'var(--pad)';
            }
          } else {
            fill = lit ? (root ? 'var(--pad-on-root)' : 'var(--pad-on)') : 'var(--pad)';
            textFill = lit ? '#0b0d12' : 'var(--text-dim)';
            label = lit && pcLabels?.[pad.note.pitchClass]
              ? (pcLabels[pad.note.pitchClass] as string)
              : pad.note.pitchClass;
            labelWeight = lit || focused ? 700 : 500;
          }

          return (
            <g
              key={`pad-${pad.row}-${pad.col}`}
              style={{ cursor: inGame || onPickPitchClass ? 'pointer' : 'default' }}
              onClick={() => {
                if (inGame) {
                  onGameGuess?.({ kind: 'push', row: pad.row, col: pad.col });
                  onPlayNote?.(midiFromNote(pad.note));
                  return;
                }
                onPickPitchClass?.(pad.note.pitchClass);
                onPlayNote?.(midiFromNote(pad.note));
              }}
              opacity={dimmed ? 0.35 : 1}
            >
              <rect
                x={x}
                y={y}
                width={PAD}
                height={PAD}
                rx={6}
                ry={6}
                fill={fill}
                stroke={focused ? 'var(--focus)' : lit ? '#0b0d12' : '#0f1115'}
                strokeWidth={focused ? 3 : 1.5}
              />
              {label && (
                <text
                  x={x + PAD / 2}
                  y={y + PAD / 2 + 4}
                  fontSize={11}
                  fontWeight={labelWeight}
                  fill={focused && !lit ? 'var(--focus)' : textFill}
                  textAnchor="middle"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  pointerEvents="none"
                >
                  {label}
                </text>
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}
