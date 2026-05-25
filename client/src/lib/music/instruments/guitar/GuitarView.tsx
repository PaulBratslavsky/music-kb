import type { GameModeState, GuessPosition, Note, PitchClass } from '../../types';
import { buildGuitarLayout, FRET_COUNT, STANDARD_TUNING_MIDI } from './layout';
import { midiFromNote } from '../../theory/notes';

type Props = {
  highlighted: Note[];
  rootPitchClass?: PitchClass | null;
  matchByPitchClass?: boolean;
  focusedPitchClass?: PitchClass | null;
  onPickPitchClass?: (pc: PitchClass) => void;
  /** Called with the exact midi number on click (used for audio playback). */
  onPlayNote?: (midi: number) => void;
  pcLabels?: Partial<Record<PitchClass, string>>;
  shapePositions?: Set<string> | null;
  /** (music-kb fork) One or more position-sets to draw as tight polygon
   *  outlines on top of the fretboard. Each set produces one outline that
   *  hugs the union of its cells, offset OUTWARD past the dot edges so the
   *  line sits clearly outside the markers. Used by /builder's "All
   *  positions" scale view to visualize how each CAGED shape tiles across
   *  the neck. Pass an empty array (or omit) to suppress outlines entirely
   *  — the single-shape view doesn't need them. */
  shapeOutlines?: Set<string>[];
  showNaturals?: boolean;
  emphasizedPitchClasses?: Set<PitchClass> | null;
  gameMode?: GameModeState;
  onGameGuess?: (pos: GuessPosition) => void;
};

type GameMark = 'pending' | 'correct' | 'wrong';

const NATURAL_PCS: ReadonlySet<PitchClass> = new Set<PitchClass>([
  'C', 'D', 'E', 'F', 'G', 'A', 'B',
]);

const FRET_W = 52;
const STRING_GAP = 22;
const PADDING_X = 56;
const PADDING_Y = 22;
const NUT_W = 6;

const STRING_COUNT = STANDARD_TUNING_MIDI.length;

// Standard fretboard inlays used as positional reference markers, matching
// the diagrams on guitarscale.org and most production electric guitars.
const FRET_INLAYS_SINGLE = new Set([3, 5, 7, 9, 15]);
const FRET_INLAYS_DOUBLE = new Set([12]);

export function GuitarView({
  highlighted,
  rootPitchClass,
  matchByPitchClass = false,
  focusedPitchClass,
  onPickPitchClass,
  onPlayNote,
  pcLabels,
  shapePositions,
  shapeOutlines,
  showNaturals = false,
  emphasizedPitchClasses,
  gameMode,
  onGameGuess,
}: Props) {
  const inGame = gameMode?.enabled === true;
  const grid = buildGuitarLayout();

  // Pending/checked overlays for game mode, keyed by `${string}-${fret}`.
  const posKey = (s: number, f: number) => `${s}-${f}`;
  const pendingPos = new Set<string>(
    inGame
      ? gameMode!.pendingGuesses
          .filter((p): p is Extract<GuessPosition, { kind: 'guitar' }> => p.kind === 'guitar')
          .map((p) => posKey(p.string, p.fret))
      : [],
  );
  const checkedPos = new Map<string, { correct: boolean; expectedPC: PitchClass; actualPC: PitchClass }>();
  if (inGame && gameMode!.checkedResults) {
    for (const r of gameMode!.checkedResults) {
      if (r.position.kind === 'guitar') {
        checkedPos.set(posKey(r.position.string, r.position.fret), {
          correct: r.correct,
          expectedPC: r.expectedPC,
          actualPC: r.actualPC,
        });
      }
    }
  }
  const gameMark = (s: number, f: number): GameMark | null => {
    const k = posKey(s, f);
    const c = checkedPos.get(k);
    if (c) return c.correct ? 'correct' : 'wrong';
    if (pendingPos.has(k)) return 'pending';
    return null;
  };
  const highlightedMidis = new Set(highlighted.map(midiFromNote));
  const highlightedPCs = new Set<PitchClass>(highlighted.map((n) => n.pitchClass));

  const isLit = (note: Note) =>
    matchByPitchClass
      ? highlightedPCs.has(note.pitchClass)
      : highlightedMidis.has(midiFromNote(note));

  const isRoot = (note: Note) =>
    rootPitchClass != null && note.pitchClass === rootPitchClass;

  const isFocused = (note: Note) =>
    focusedPitchClass != null && note.pitchClass === focusedPitchClass;

  const fretboardLeft = PADDING_X;
  const fretboardTop = PADDING_Y;
  const fretboardWidth = FRET_W * FRET_COUNT;
  const fretboardHeight = STRING_GAP * (STRING_COUNT - 1);

  const totalWidth = fretboardLeft + fretboardWidth + 16;
  const totalHeight = fretboardTop + fretboardHeight + PADDING_Y;

  const xForFret = (fret: number): number => {
    if (fret === 0) return fretboardLeft - 24;
    return fretboardLeft + (fret - 0.5) * FRET_W;
  };
  const yForString = (s: number): number => fretboardTop + s * STRING_GAP;

  // When a 3NPS shape is active, the position markers themselves *are* the
  // shape — no rectangular overlay needed. We just filter highlighted notes
  // to the exact (string, fret) positions in the shape.
  const inShape = (string: number, fret: number) =>
    !shapePositions || shapePositions.has(`${string}-${fret}`);

  // (music-kb fork) For each shape in `shapeOutlines`, compute the bounding
  // rectangle of its cells and draw a single outlined rect around it,
  // offset OUTWARD past the cell edges so the line sits clearly outside
  // the dot markers (not cutting through them) and adjacent shapes'
  // outlines don't collide with each other's notes.
  //
  // Tight per-cell polygons looked busy when 5 CAGED shapes were stacked
  // on the same neck — the irregular boundaries crossed each other in
  // ways that read as visual noise. A single bbox rectangle per shape is
  // clean: 4 sides, one per shape, and the viewer can mentally tile them
  // even when they overlap.
  const OUTLINE_PAD = 10;
  const outlineRects: { x: number; y: number; width: number; height: number }[] = [];
  if (shapeOutlines) {
    for (const positions of shapeOutlines) {
      if (positions.size === 0) continue;
      let minS = Infinity;
      let maxS = -Infinity;
      let minF = Infinity;
      let maxF = -Infinity;
      for (const key of positions) {
        const [s, f] = key.split('-').map(Number);
        if (s < minS) minS = s;
        if (s > maxS) maxS = s;
        if (f < minF) minF = f;
        if (f > maxF) maxF = f;
      }
      if (!Number.isFinite(minS)) continue;
      const left = xForFret(minF) - FRET_W / 2 - OUTLINE_PAD;
      const right = xForFret(maxF) + FRET_W / 2 + OUTLINE_PAD;
      const top = yForString(minS) - STRING_GAP / 2 - OUTLINE_PAD;
      const bottom = yForString(maxS) + STRING_GAP / 2 + OUTLINE_PAD;
      outlineRects.push({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      });
    }
  }

  return (
    <svg
      className="instrument-svg"
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      role="img"
      aria-label="Guitar fretboard"
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


      <rect
        x={fretboardLeft - NUT_W}
        y={fretboardTop - 8}
        width={NUT_W}
        height={fretboardHeight + 16}
        fill="#d8cdb8"
      />

      {Array.from({ length: FRET_COUNT }, (_, i) => i + 1).map((f) => (
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

      {Array.from({ length: FRET_COUNT }, (_, i) => i + 1)
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
      {Array.from({ length: FRET_COUNT }, (_, i) => i + 1)
        .filter((f) => FRET_INLAYS_DOUBLE.has(f))
        .map((f) => (
          <g key={`inlay2-${f}`}>
            <circle
              cx={fretboardLeft + (f - 0.5) * FRET_W}
              cy={fretboardTop + STRING_GAP * 1.2}
              r={4}
              fill="#5a5048"
            />
            <circle
              cx={fretboardLeft + (f - 0.5) * FRET_W}
              cy={fretboardTop + STRING_GAP * 3.8}
              r={4}
              fill="#5a5048"
            />
          </g>
        ))}

      {/* Side-position dots above the fretboard — like the dots on the side of a real
          guitar neck, easier to find positions at a glance. */}
      {Array.from({ length: FRET_COUNT }, (_, i) => i + 1)
        .filter((f) => FRET_INLAYS_SINGLE.has(f) || FRET_INLAYS_DOUBLE.has(f))
        .map((f) => (
          <g key={`side-${f}`}>
            <circle
              cx={fretboardLeft + (f - 0.5) * FRET_W - (FRET_INLAYS_DOUBLE.has(f) ? 4 : 0)}
              cy={fretboardTop - 14}
              r={3}
              fill="var(--ink-muted)"
            />
            {FRET_INLAYS_DOUBLE.has(f) && (
              <circle
                cx={fretboardLeft + (f - 0.5) * FRET_W + 4}
                cy={fretboardTop - 14}
                r={3}
                fill="var(--ink-muted)"
              />
            )}
          </g>
        ))}

      {grid.map((_, s) => (
        <line
          key={`string-${s}`}
          x1={fretboardLeft - NUT_W}
          x2={fretboardLeft + fretboardWidth}
          y1={yForString(s)}
          y2={yForString(s)}
          stroke="var(--string)"
          strokeWidth={s < 3 ? 1 : 1.5}
        />
      ))}

      {!inGame && grid.map((row, s) => (
        <text
          key={`open-${s}`}
          x={fretboardLeft - NUT_W - 14}
          y={yForString(s) + 3}
          fontSize={10}
          fill="var(--ink-muted)"
          textAnchor="end"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {row[0].note.pitchClass}
        </text>
      ))}

      {Array.from({ length: FRET_COUNT }, (_, i) => i + 1).map((f) => (
        <text
          key={`fnum-${f}`}
          x={fretboardLeft + (f - 0.5) * FRET_W}
          y={fretboardTop + fretboardHeight + 16}
          fontSize={9}
          fill="var(--ink-muted)"
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        >
          {f}
        </text>
      ))}

      {/* invisible click hit-areas for every position */}
      {(onPickPitchClass || inGame) &&
        grid.flatMap((row, s) =>
          row.map((p) => {
            const cx = xForFret(p.fret);
            const cy = yForString(p.string);
            const w = p.fret === 0 ? 22 : FRET_W - 4;
            const h = STRING_GAP - 2;
            return (
              <rect
                key={`hit-${s}-${p.fret}`}
                x={cx - w / 2}
                y={cy - h / 2}
                width={w}
                height={h}
                fill="rgba(0,0,0,0)"
                pointerEvents="all"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (inGame) {
                    onGameGuess?.({ kind: 'guitar', string: p.string, fret: p.fret });
                    onPlayNote?.(midiFromNote(p.note));
                    return;
                  }
                  onPickPitchClass?.(p.note.pitchClass);
                  onPlayNote?.(midiFromNote(p.note));
                }}
              >
                <title>
                  {inGame
                    ? `string ${p.string + 1}, fret ${p.fret}`
                    : `${p.note.pitchClass}${p.note.octave} — string ${p.string + 1}, fret ${p.fret}`}
                </title>
              </rect>
            );
          }),
        )}

      {/* (music-kb fork) bounding-rect outlines, one rect per shape in
          `shapeOutlines`. Pushed outward past the dot markers so the
          line sits clearly outside the highlight circles. Rounded
          corners read cleaner than sharp 90° joins when multiple
          outlines overlap. */}
      {outlineRects.map((r, i) => (
        <rect
          key={`outline-${i}`}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          rx={6}
          ry={6}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
          pointerEvents="none"
          opacity={0.85}
        />
      ))}

      {/* focus rings: every position whose PC matches focusedPitchClass */}
      {!inGame && focusedPitchClass &&
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
                opacity={inShape(p.string, p.fret) ? 1 : 0.35}
              />
            )),
        )}

      {/* note markers (chord/scale highlights) — suppressed in game mode */}
      {!inGame && grid.flatMap((row) =>
        row
          .filter((p) => isLit(p.note) && inShape(p.string, p.fret))
          .map((p) => {
            const cx = xForFret(p.fret);
            const cy = yForString(p.string);
            const root = isRoot(p.note);
            // Dim notes that aren't part of the previewed chord (when one is set).
            const dimmed =
              emphasizedPitchClasses != null &&
              !emphasizedPitchClasses.has(p.note.pitchClass);
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
                  fill={root ? 'var(--root)' : 'var(--highlight)'}
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

      {/* game-mode markers (rendered instead of scale highlights when game mode is on) */}
      {inGame && grid.flatMap((row) =>
        row
          .map((p) => ({ p, mark: gameMark(p.string, p.fret) }))
          .filter((x): x is { p: typeof row[number]; mark: GameMark } => x.mark !== null)
          .map(({ p, mark }) => {
            const cx = xForFret(p.fret);
            const cy = yForString(p.string);
            const fill =
              mark === 'correct'
                ? 'var(--game-correct)'
                : mark === 'wrong'
                ? 'var(--game-wrong)'
                : 'var(--game-pending)';
            return (
              <g key={`game-${p.string}-${p.fret}`} pointerEvents="none">
                <circle
                  cx={cx}
                  cy={cy}
                  r={9}
                  fill={fill}
                  stroke="#0b0d12"
                  strokeWidth={1.5}
                />
                {mark === 'wrong' && (
                  <text
                    x={cx}
                    y={cy + 3}
                    fontSize={9}
                    fill="#0b0d12"
                    textAnchor="middle"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight={700}
                  >
                    {checkedPos.get(posKey(p.string, p.fret))?.actualPC}
                  </text>
                )}
              </g>
            );
          }),
      )}

      {/*
        Naturals overlay (rendered last so it sits on top of scale markers).
        Yellow circle on every C/D/E/F/G/A/B position. We skip the root note's
        positions so the orange root marker stays visible underneath.
      */}
      {!inGame && showNaturals &&
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
