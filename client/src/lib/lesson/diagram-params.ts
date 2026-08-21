// Translates a stored `diagram` block into the explicit dots MiniNeck wants.
//
// Blocks store musical *parameters* (root/quality/string-set) rather than
// rendered dots, so a diagram stays correct if the theory layer changes and
// so phase-2 AI generation can emit something small and typed. MiniNeck is a
// dumb renderer that takes NeckDot[] — this module is the single place that
// bridges the two, which also makes it the single place a wrong diagram can
// come from. Hence the tests.

import {
  STRING_SETS,
  triadVoicing,
  type Inversion,
  type TriadQuality,
} from '@music-kb/music/theory/triad-shapes';
import { PITCH_CLASSES, type PitchClass } from '@music-kb/music/types';

export type NeckDotInput = {
  string: number;
  fret: number;
  label?: string;
  root?: boolean;
  dim?: boolean;
};

export type DiagramBlock = {
  instrument: string;
  mode: 'theory' | 'explicit';
  root?: string | null;
  quality?: string | null;
  /** One of the STRING_SETS names, e.g. "e–B–G". */
  stringSet?: string | null;
  inversion?: number | null;
  useParam?: boolean | null;
  dots?: NeckDotInput[] | null;
};

const TRIAD_QUALITIES = new Set([
  'major',
  'minor',
  'augmented',
  'diminished',
]);

/**
 * Resolve a diagram block to dots.
 *
 * `paramValue` is the lesson-level parameter's current value; it wins over
 * the block's own `root` when the block sets `useParam`.
 *
 * Returns `[]` rather than throwing when a shape can't be realised — an
 * unrenderable diagram should leave a gap, not take down the lesson.
 */
export function resolveDiagramDots(
  block: DiagramBlock,
  paramValue?: string,
): NeckDotInput[] {
  if (block.mode === 'explicit') return block.dots ?? [];

  const root = (block.useParam && paramValue ? paramValue : block.root) as
    | PitchClass
    | undefined;
  if (!root || !block.quality) {
    console.warn(
      `[resolveDiagramDots] mode=theory needs root+quality; got root=${JSON.stringify(root)} quality=${JSON.stringify(block.quality)}`,
    );
    return [];
  }
  if (!PITCH_CLASSES.includes(root)) {
    console.warn(`[resolveDiagramDots] root "${root}" is not a valid pitch class`);
    return [];
  }
  if (!TRIAD_QUALITIES.has(block.quality)) {
    console.warn(`[resolveDiagramDots] quality "${block.quality}" is not a renderable triad quality`);
    return [];
  }

  // stringSet arrives as one of the four names in STRING_SETS ("e–B–G",
  // "B–G–D", "G–D–A", "D–A–E") rather than a raw [0,1,2] array — a closed
  // enum an LLM cannot get wrong, and a name a guitarist already knows.
  // Conditionally required: mode=theory needs it to voice a triad, but it
  // cannot be marked `required` in the schema because mode=explicit never
  // uses it — so a missing/invalid value fails closed here, silently but
  // for this warning.
  const set = STRING_SETS.find((s) => s.name === block.stringSet);
  if (!set) {
    console.warn(
      `[resolveDiagramDots] mode=theory needs a valid stringSet; got ${JSON.stringify(block.stringSet)}`,
    );
    return [];
  }

  const voicing = triadVoicing(
    root,
    block.quality as TriadQuality,
    set,
    (block.inversion ?? 0) as Inversion,
  );
  if (!voicing) {
    console.warn(
      `[resolveDiagramDots] triadVoicing() could not resolve root=${root} quality=${block.quality} stringSet=${block.stringSet}`,
    );
    return [];
  }

  // triadVoicing() returns `notes: { string, fret, pc, role }[]` — there is
  // no `label`/`isRoot` field. `role` is one of 'R' / '3' / '5' (with
  // quality-specific accidentals, e.g. '♭3'), matching the existing usage
  // in the hand-written triads lesson (now web/src/lessons/triads.tsx): the
  // role string doubles as the dot label,
  // and the root dot is the one whose role is literally 'R'.
  return voicing.notes.map((n) => ({
    string: n.string,
    fret: n.fret,
    label: n.role,
    root: n.role === 'R',
  }));
}

export type KeyMarkInput = {
  pc: PitchClass;
  label?: string;
  root?: boolean;
  flag?: boolean;
};

export type KeyboardDiagramBlock = {
  mode: 'theory' | 'explicit';
  root?: string | null;
  quality?: string | null;
  useParam?: boolean | null;
  octaves?: number | null;
  marks?: KeyMarkInput[] | null;
};

/**
 * Resolve a keyboard-diagram block to marks for MiniKeyboard.
 *
 * Same rules as resolveDiagramDots: explicit mode passes marks through
 * unchanged, theory mode derives them from root/quality via triadVoicing().
 * A keyboard has no strings, but triadVoicing() needs a string set to
 * compute fret positions — it's only used here to get at
 * `TriadVoicing.notes[].pc`, and pc is derived purely from root/quality/
 * inversion (PITCH_CLASSES[(rootIdx + intervals[which]) % 12]), never from
 * which string set was passed in. So any entry in STRING_SETS produces the
 * same pitch classes; STRING_SETS[0] is used because it's the first one.
 */
export function resolveDiagramMarks(
  block: KeyboardDiagramBlock,
  paramValue?: string,
): KeyMarkInput[] {
  if (block.mode === 'explicit') return block.marks ?? [];

  const root = (block.useParam && paramValue ? paramValue : block.root) as
    | PitchClass
    | undefined;
  if (!root || !block.quality) {
    console.warn(
      `[resolveDiagramMarks] mode=theory needs root+quality; got root=${JSON.stringify(root)} quality=${JSON.stringify(block.quality)}`,
    );
    return [];
  }
  if (!PITCH_CLASSES.includes(root)) {
    console.warn(`[resolveDiagramMarks] root "${root}" is not a valid pitch class`);
    return [];
  }
  if (!TRIAD_QUALITIES.has(block.quality)) {
    console.warn(`[resolveDiagramMarks] quality "${block.quality}" is not a renderable triad quality`);
    return [];
  }

  const voicing = triadVoicing(
    root,
    block.quality as TriadQuality,
    STRING_SETS[0],
    0,
  );
  if (!voicing) {
    console.warn(
      `[resolveDiagramMarks] triadVoicing() could not resolve root=${root} quality=${block.quality}`,
    );
    return [];
  }

  return voicing.notes.map((n) => ({
    pc: n.pc,
    label: n.role,
    root: n.role === 'R',
  }));
}
