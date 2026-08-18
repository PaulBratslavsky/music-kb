// Read-only piano diagram for lesson pages — the keyboard counterpart to
// MiniNeck. Same reasoning: PianoView in #/lib/music/instruments is the
// interactive /builder surface, this is a small static picture drawn
// inline so the reader stays on the page.
//
// The one thing it does that PianoView doesn't: `showSteps` draws the
// whole-step / half-step brackets over the top of the marked keys. That
// arc is the whole point of the half-steps lesson — you can *see* that
// the major scale's two half steps land on 3→4 and 7→8.

import type { PitchClass } from '@music-kb/music/types';
import { PITCH_CLASSES } from '@music-kb/music/types';

export type KeyMark = {
  pc: PitchClass;
  /** Text under/inside the key — a note name or a scale degree. */
  label?: string;
  /** Accent fill. The scale root / chord root. */
  root?: boolean;
  /** Attention fill (red). Used for the E–F and B–C half-step pairs. */
  flag?: boolean;
  /**
   * Restrict this mark to one drawn octave (0 = the leftmost). Marks are
   * matched by pitch class by default, which lights the note in EVERY
   * octave — right for a scale, wrong for a chord, where the repeat reads
   * as playing the root twice.
   */
  octave?: number;
  /**
   * Absolute MIDI note. Wins over pitch-class matching entirely, and is the
   * only way to draw a real voicing: B3-E4-G4-B4 has to put B3 BELOW E4,
   * which pitch-class-plus-octave-index cannot express (B is the last key
   * of its octave, so it renders to the right of E and the bass looks like
   * the wrong note). Requires `baseMidi` so the board knows what it starts on.
   */
  midi?: number;
};

export type MiniKeyboardProps = {
  /** How many octaves to draw, starting at C. */
  octaves?: number;
  /**
   * MIDI note of the board's leftmost key (a C). Only needed when marks
   * carry `midi`. Defaults to C4.
   */
  baseMidi?: number;
  /**
   * 'roomy' lifts the natural-width cap so the keyboard fills its
   * container. The svg is width:100% over a viewBox, so the cap — right for
   * a diagram inline in lesson prose — is the only thing holding it back in
   * a full-width panel. Same escape hatch MiniNeck has.
   */
  size?: 'compact' | 'roomy';
  marks: KeyMark[];
  /**
   * Draw W/H brackets between consecutive marks, walking up from the mark
   * flagged `root`. Only meaningful when `marks` is a scale.
   */
  showSteps?: boolean;
  /**
   * Print the note name on keys that aren't marked. Turn this off when the
   * marks carry scale degrees — an unlit "F" sitting in a row of numbers
   * reads as if it were part of the numbering.
   */
  showUnmarkedLabels?: boolean;
  ariaLabel: string;
};

const WHITE_PCS: PitchClass[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
/** Which black key sits immediately right of each white key (if any). */
const BLACK_AFTER: Partial<Record<PitchClass, PitchClass>> = {
  C: 'C#',
  D: 'D#',
  F: 'F#',
  G: 'G#',
  A: 'A#',
};

const WHITE_W = 30;
const WHITE_H = 112;
const BLACK_W = 19;
const BLACK_H = 70;
const PAD_X = 10;
const STEPS_H = 26;

type RenderedKey = {
  pc: PitchClass;
  /** Semitones above the lowest rendered C. Uniquely identifies the key. */
  absSemitone: number;
  isBlack: boolean;
  x: number;
  width: number;
  centerX: number;
};

function buildKeys(octaves: number): RenderedKey[] {
  const keys: RenderedKey[] = [];
  let whiteIdx = 0;
  for (let o = 0; o < octaves; o++) {
    for (const pc of WHITE_PCS) {
      const x = PAD_X + whiteIdx * WHITE_W;
      keys.push({
        pc,
        absSemitone: o * 12 + PITCH_CLASSES.indexOf(pc),
        isBlack: false,
        x,
        width: WHITE_W,
        centerX: x + WHITE_W / 2,
      });
      const black = BLACK_AFTER[pc];
      if (black) {
        const bx = PAD_X + (whiteIdx + 1) * WHITE_W - BLACK_W / 2;
        keys.push({
          pc: black,
          absSemitone: o * 12 + PITCH_CLASSES.indexOf(black),
          isBlack: true,
          x: bx,
          width: BLACK_W,
          centerX: bx + BLACK_W / 2,
        });
      }
      whiteIdx += 1;
    }
  }
  return keys;
}

/**
 * Marks in ascending order from the root, as absolute semitones above the
 * lowest rendered C, with the closing octave appended. Returns [] when
 * there's no root to walk from.
 */
function ascendingFromRoot(marks: KeyMark[]): number[] {
  const root = marks.find((m) => m.root);
  if (!root) return [];
  const rootSemi = PITCH_CLASSES.indexOf(root.pc);
  const offsets = marks
    .map((m) => (PITCH_CLASSES.indexOf(m.pc) - rootSemi + 12) % 12)
    .sort((a, b) => a - b);
  return [...offsets, 12].map((o) => rootSemi + o);
}

const STEP_LABEL: Record<number, string> = { 1: 'H', 2: 'W', 3: 'W+H' };

export function MiniKeyboard({
  octaves = 1,
  baseMidi = 60,
  size = 'compact',
  marks,
  showSteps = false,
  showUnmarkedLabels = true,
  ariaLabel,
}: MiniKeyboardProps) {
  const keys = buildKeys(octaves);
  // Octave-scoped marks win over pitch-class ones for the same key.
  // A mark that names an absolute note or a specific octave must NOT also
  // land in the loose pitch-class map, or it lights every octave and a
  // 4-note voicing draws as 8 keys.
  const byPc = new Map<PitchClass, KeyMark>(
    marks
      .filter((m) => m.octave === undefined && m.midi === undefined)
      .map((m) => [m.pc, m]),
  );
  const byOctavePc = new Map<string, KeyMark>(
    marks
      .filter((m) => m.octave !== undefined && m.midi === undefined)
      .map((m) => [`${m.octave}:${m.pc}`, m]),
  );
  const byMidi = new Map<number, KeyMark>(
    marks.filter((m) => m.midi !== undefined).map((m) => [m.midi!, m]),
  );
  // Most specific wins: an absolute note, then an octave-scoped pitch class,
  // then a bare pitch class.
  const markFor = (k: RenderedKey) =>
    byMidi.get(baseMidi + k.absSemitone) ??
    byOctavePc.get(`${Math.floor(k.absSemitone / 12)}:${k.pc}`) ??
    byPc.get(k.pc);

  const stepSemitones = showSteps ? ascendingFromRoot(marks) : [];
  const centerBySemitone = new Map(keys.map((k) => [k.absSemitone, k.centerX]));

  const topPad = showSteps ? STEPS_H : 6;
  const totalW = PAD_X * 2 + WHITE_PCS.length * octaves * WHITE_W;
  const totalH = topPad + WHITE_H + 6;

  const fillFor = (mark: KeyMark | undefined, isBlack: boolean) => {
    if (!mark) return isBlack ? 'var(--ink)' : 'var(--card)';
    if (mark.root) return 'var(--accent)';
    if (mark.flag) return 'var(--band-red-dot)';
    // Lit but unremarkable: a soft accent wash that still reads as "on"
    // against both an unlit white key and an unlit black key.
    return isBlack ? 'var(--accent-hover)' : 'var(--accent-soft)';
  };

  const textFor = (mark: KeyMark | undefined, isBlack: boolean) => {
    if (mark?.root || mark?.flag) return '#ffffff';
    if (mark && isBlack) return '#ffffff';
    if (mark) return 'var(--accent)';
    return isBlack ? 'var(--card)' : 'var(--ink-muted)';
  };

  return (
    <svg
      viewBox={`0 0 ${totalW} ${totalH}`}
      width="100%"
      style={{ maxWidth: size === 'roomy' ? undefined : totalW }}
      role="img"
      aria-label={ariaLabel}
      className="select-none"
    >
      {/* White keys first so the black keys overlay them. */}
      {keys
        .filter((k) => !k.isBlack)
        .map((k) => {
          const mark = markFor(k);
          return (
            <g key={`w-${k.absSemitone}`}>
              <rect
                x={k.x}
                y={topPad}
                width={WHITE_W}
                height={WHITE_H}
                rx={3}
                fill={fillFor(mark, false)}
                stroke="var(--line-strong)"
                strokeWidth={1}
              />
              {(mark?.label || showUnmarkedLabels) && (
                <text
                  x={k.centerX}
                  y={topPad + WHITE_H - 12}
                  fontSize={9.5}
                  fontWeight={mark ? 700 : 500}
                  fill={textFor(mark, false)}
                  textAnchor="middle"
                >
                  {mark?.label ?? k.pc}
                </text>
              )}
            </g>
          );
        })}

      {keys
        .filter((k) => k.isBlack)
        .map((k) => {
          const mark = markFor(k);
          return (
            <g key={`b-${k.absSemitone}`}>
              <rect
                x={k.x}
                y={topPad}
                width={BLACK_W}
                height={BLACK_H}
                rx={2.5}
                fill={fillFor(mark, true)}
                stroke="var(--ink)"
                strokeWidth={0.75}
              />
              {mark?.label && (
                <text
                  x={k.centerX}
                  y={topPad + BLACK_H - 8}
                  fontSize={8}
                  fontWeight={700}
                  fill={textFor(mark, true)}
                  textAnchor="middle"
                >
                  {mark.label}
                </text>
              )}
            </g>
          );
        })}

      {/* W / H brackets over the marked keys. */}
      {stepSemitones.slice(0, -1).map((semi, i) => {
        const next = stepSemitones[i + 1];
        const x1 = centerBySemitone.get(semi);
        const x2 = centerBySemitone.get(next);
        if (x1 == null || x2 == null) return null;
        const gap = next - semi;
        const isHalf = gap === 1;
        const y = STEPS_H - 12;
        return (
          <g key={`step-${semi}`}>
            <line
              x1={x1}
              x2={x2}
              y1={y}
              y2={y}
              stroke={isHalf ? 'var(--band-red-dot)' : 'var(--ink-faint)'}
              strokeWidth={isHalf ? 2 : 1.25}
            />
            <text
              x={(x1 + x2) / 2}
              y={y - 4}
              fontSize={9}
              fontWeight={700}
              fill={isHalf ? 'var(--band-red-dot)' : 'var(--ink-muted)'}
              textAnchor="middle"
            >
              {STEP_LABEL[gap] ?? `${gap}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
