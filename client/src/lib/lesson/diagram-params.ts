// Translates a stored `diagram` block into the explicit dots MiniNeck wants.
//
// Blocks store musical *parameters* (root/quality/string-set) rather than
// rendered dots, so a diagram stays correct if the theory layer changes and
// so phase-2 AI generation can emit something small and typed. MiniNeck is a
// dumb renderer that takes NeckDot[] — this module is the single place that
// bridges the two, which also makes it the single place a wrong diagram can
// come from. Hence the tests.
//
// -----------------------------------------------------------------------------
// The author says WHAT to show; the theory layer decides WHERE the dots go
// -----------------------------------------------------------------------------
//
// This project already refuses to store a timecode a model produced (BM25-
// grounded against the real transcript instead) and a pitch label a model
// produced (recomputed from the tuning). Fret positions are the same class
// of fact and the largest instance of it: an A major arpeggio's dots are
// arithmetic, and a lesson that shipped them one hand-placed dot at a time
// was storing a guess.
//
// So a theory-mode diagram carries an `intent`, and each intent is realized
// by `packages/music`:
//
//     chord     root + quality + stringSet + inversion   triadVoicing()
//     scale     root + scaleType + position              realizeCagedShape()
//     arpeggio  root + quality + position                realizeArpeggio()
//     pattern   root + scaleType + patternIndex          threeNotesPerString()
//
// `mode: 'explicit'` stays, for the shapes theory genuinely cannot express
// (a lick, a partial voicing, a fingering with a deliberate omission). It is
// the escape hatch, not the default.
//
// Two rules keep this honest, and both are load-bearing:
//
//   1. THE COMBINATION IS VALIDATED, not just the fields. `position: 2` on
//      a major-pentatonic scale — which ships boxes 1 and 5 only — is
//      REFUSED, naming the legal values, rather than realized as an empty
//      shape. Empty-and-silent is the failure this codebase keeps
//      producing; `validateTheoryDiagram` is the answer to it, and
//      `resolveDiagramDots` runs it too so the renderer and the parser can
//      never disagree about what is legal.
//   2. LABELS COME FROM THE REALIZATION. Every dot's label is the degree
//      the theory layer computed for it ('R', '3', 'b7'), never a string an
//      author typed. Same reason as the pitch-label correction on the MCP
//      path: a name at a position is arithmetic.

import {
  arpeggioPositions,
  arpeggioShapeName,
  realizeArpeggio,
  supportsArpeggio,
  type ArpeggioPosition,
} from '@music-kb/music/theory/arpeggios';
import { scaleDegrees } from '@music-kb/music/theory/degrees';
import { threeNotesPerString } from '@music-kb/music/theory/neck-patterns';
import { realizeCagedShape, scalePositions, shapeName } from '@music-kb/music/theory/positions';
import { getScalePitchClasses } from '@music-kb/music/theory/scales';
import {
  STRING_SETS,
  triadVoicing,
  type Inversion,
  type TriadQuality,
} from '@music-kb/music/theory/triad-shapes';
import { pitchClassAt } from '@music-kb/music/instruments/neck';
import {
  CHORD_QUALITIES,
  PITCH_CLASSES,
  SCALE_TYPES,
  type ChordQuality,
  type PitchClass,
  type ScaleType,
} from '@music-kb/music/types';

// Structurally a subset of MiniNeck's own `NeckDot` — every field here
// exists there with the same meaning, so a resolved dot can be handed
// straight to the renderer. The four style flags (dim/hollow/ringed/light)
// are what let ONE diagram carry two layers of meaning: scale tones under
// chord tones, or "where your hand is" against "where else that note
// lives". MiniNeck.tsx's doc comment on each is the authority on what they
// look like; the lesson.neck-dot schema and docs/lesson-authoring.md
// mirror them.
export type NeckDotInput = {
  string: number;
  fret: number;
  label?: string;
  root?: boolean;
  dim?: boolean;
  hollow?: boolean;
  ringed?: boolean;
  light?: boolean;
};

export type DiagramBlock = {
  instrument: string;
  mode: 'theory' | 'explicit';
  /** What the diagram is OF. Absent means `chord` — every stored block predates it. */
  intent?: string | null;
  root?: string | null;
  quality?: string | null;
  /** One of the STRING_SETS names, e.g. "e–B–G". */
  stringSet?: string | null;
  inversion?: number | null;
  /** One of SCALE_TYPES — `scale` and `pattern` intents. */
  scaleType?: string | null;
  /** '1'–'5' or '2oct' — `scale` and `arpeggio` intents. Stored as a string. */
  position?: string | number | null;
  /** 1-based 3NPS pattern number — `pattern` intent. */
  patternIndex?: number | null;
  useParam?: boolean | null;
  dots?: NeckDotInput[] | null;
};

// -----------------------------------------------------------------------------
// The theory-mode vocabulary
// -----------------------------------------------------------------------------

export const DIAGRAM_INTENTS = ['chord', 'scale', 'arpeggio', 'pattern'] as const;
export type DiagramIntent = (typeof DIAGRAM_INTENTS)[number];

/** The default for a block that names no intent — every diagram stored before this existed. */
export const DEFAULT_DIAGRAM_INTENT: DiagramIntent = 'chord';

/**
 * The long triad spellings this block has used since it could only voice
 * triads, mapped to the theory layer's own `ChordQuality` names.
 *
 * Kept because 97 stored theory diagrams carry them, and dropping a value
 * from a Strapi enum makes every one of those rows unsaveable. They are
 * exact aliases — `major` IS `maj` — so `toChordQuality` folds them
 * together and nothing downstream sees two vocabularies.
 */
const LEGACY_TRIAD_SPELLINGS: Record<string, ChordQuality> = {
  major: 'maj',
  minor: 'min',
  augmented: 'aug',
  diminished: 'dim',
};

/** The reverse: a block `quality` that `triadVoicing()` can actually voice. */
const TRIAD_SPELLING_OF: Record<string, TriadQuality> = {
  major: 'major',
  minor: 'minor',
  augmented: 'augmented',
  diminished: 'diminished',
  maj: 'major',
  min: 'minor',
  aug: 'augmented',
  dim: 'diminished',
};

/**
 * Every `quality` the block accepts, in the order the schema lists them:
 * the four legacy spellings first, then the theory layer's own names for
 * every quality that has an arpeggio shape.
 *
 * DERIVED from `supportsArpeggio` rather than typed out, so a quality that
 * gains a shape in `packages/music` (a drop-2 source, say) becomes
 * authorable by editing one Strapi enum, and a quality that never had one
 * can never appear here to be silently refused later. `diagram-params.test.ts`
 * pins this against the real `server/src/components/lesson/diagram.json`.
 */
export const DIAGRAM_QUALITIES: readonly string[] = [
  ...Object.keys(LEGACY_TRIAD_SPELLINGS),
  ...CHORD_QUALITIES.filter((q) => supportsArpeggio(q)),
];

/** The `quality` values `intent="chord"` can voice — triads, and only triads. */
export const CHORD_INTENT_QUALITIES: readonly string[] = Object.keys(TRIAD_SPELLING_OF);

/**
 * `position` as it is stored: a string, because the vocabulary is the scale
 * boxes' own `ScalePosition` and that includes `'2oct'` alongside 1–5. A
 * Strapi integer column cannot hold both, and inventing a second enum for
 * "the two-octave one" would be a new vocabulary for a position that
 * already has a name.
 */
export const DIAGRAM_POSITIONS = ['1', '2', '3', '4', '5', '2oct'] as const;

/** The scale types a `scale`/`pattern` diagram can name. The theory layer's list, verbatim. */
export const DIAGRAM_SCALE_TYPES: readonly string[] = SCALE_TYPES;

/** Longest 3NPS pattern number any supported scale offers (major/modes: 7 notes). */
export const MAX_PATTERN_INDEX = 7;

function toDiagramIntent(value: unknown): DiagramIntent | null {
  if (value == null || value === '') return DEFAULT_DIAGRAM_INTENT;
  return (DIAGRAM_INTENTS as readonly string[]).includes(value as string)
    ? (value as DiagramIntent)
    : null;
}

/** A block `quality` as the theory layer names it, or null if it is not one. */
export function toChordQuality(value: unknown): ChordQuality | null {
  if (typeof value !== 'string') return null;
  const legacy = LEGACY_TRIAD_SPELLINGS[value];
  if (legacy) return legacy;
  return (CHORD_QUALITIES as readonly string[]).includes(value)
    ? (value as ChordQuality)
    : null;
}

/** A block `quality` `triadVoicing()` can voice, or null. */
function toTriadQuality(value: unknown): TriadQuality | null {
  return typeof value === 'string' ? (TRIAD_SPELLING_OF[value] ?? null) : null;
}

/** A stored `position` as the theory layer's `ScalePosition`, or null. */
export function toDiagramPosition(value: unknown): ArpeggioPosition | null {
  const raw = typeof value === 'number' ? String(value) : value;
  if (typeof raw !== 'string') return null;
  if (raw === '2oct') return '2oct';
  if (!/^[1-5]$/.test(raw)) return null;
  return Number(raw) as ArpeggioPosition;
}

function toScaleType(value: unknown): ScaleType | null {
  return typeof value === 'string' && (SCALE_TYPES as readonly string[]).includes(value)
    ? (value as ScaleType)
    : null;
}

/** Which root a theory diagram is actually drawn from, once `useParam` is applied. */
function effectiveRoot(block: DiagramBlock, paramValue?: string): string | null {
  const raw = block.useParam && paramValue ? paramValue : block.root;
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/**
 * Why this theory-mode block cannot be drawn — `field` is the attribute to
 * fix, `message` says what is legal.
 */
export type DiagramTheoryProblem = { field: string; message: string };

/**
 * Is this (intent, root, quality, scaleType, position, …) COMBINATION one
 * the theory layer will draw?
 *
 * The distinction that matters: this refuses a combination *by name*
 * — "majorPentatonic has boxes 1, 5, 2oct; you asked for 2" — instead of
 * letting the realizer return an empty array that a renderer then draws as
 * a blank fretboard. Four blank fretboards once shipped to published
 * lessons exactly that way. Every message quotes the legal set, because a
 * refusal an author cannot act on is only a slower silence.
 *
 * Field presence and value legality are checked together on purpose: from
 * the author's side "you forgot `scaleType`" and "`scaleType=chromatic`
 * isn't one" are the same mistake at two stages of typing it.
 *
 * Returns `null` when the combination is realizable. That is NOT a promise
 * that it draws anything visible — the fret window can still hide it, which
 * is what `visibleNeckDots` is for.
 */
export function validateTheoryDiagram(
  block: DiagramBlock,
  paramValue?: string,
): DiagramTheoryProblem | null {
  const intent = toDiagramIntent(block.intent);
  if (!intent) {
    return {
      field: 'intent',
      message: `intent="${String(block.intent)}" is not one of: ${DIAGRAM_INTENTS.join(', ')}.`,
    };
  }

  const root = effectiveRoot(block, paramValue);
  if (!root) {
    return {
      field: 'root',
      message:
        'mode="theory" needs a root — set `root`, or set `useParam` and give the lesson a `parameter` to supply one.',
    };
  }
  if (!PITCH_CLASSES.includes(root as PitchClass)) {
    return {
      field: 'root',
      message: `root="${root}" is not a pitch class. Legal values: ${PITCH_CLASSES.join(', ')} (sharps only — no flats).`,
    };
  }

  if (intent === 'chord') {
    if (!toTriadQuality(block.quality)) {
      return {
        field: 'quality',
        message:
          `intent="chord" voices a triad, so quality=${JSON.stringify(block.quality ?? null)} cannot be voiced. ` +
          `Legal values: ${CHORD_INTENT_QUALITIES.join(', ')}. For a four-note chord use intent="arpeggio", which draws its tones across a position instead of as one grip.`,
      };
    }
    if (!STRING_SETS.some((s) => s.name === block.stringSet)) {
      return {
        field: 'stringSet',
        message:
          `intent="chord" needs a stringSet to voice the triad on; got ${JSON.stringify(block.stringSet ?? null)}. ` +
          `Legal values: ${STRING_SETS.map((s) => s.name).join(', ')} (EN DASH U+2013 separators, not hyphens).`,
      };
    }
    return null;
  }

  if (intent === 'arpeggio') {
    const quality = toChordQuality(block.quality);
    if (!quality) {
      return {
        field: 'quality',
        message: `quality=${JSON.stringify(block.quality ?? null)} is not one this diagram accepts. Legal values: ${DIAGRAM_QUALITIES.join(', ')}.`,
      };
    }
    const legal = arpeggioPositions(quality);
    if (legal.length === 0) {
      return {
        field: 'quality',
        message:
          `quality="${block.quality}" has more than four distinct tones, so it has no arpeggio SHAPE — inside one hand position it lights up half the window and reads as a scale box, not an arpeggio. ` +
          `Qualities with an arpeggio: ${DIAGRAM_QUALITIES.join(', ')}.`,
      };
    }
    const position = toDiagramPosition(block.position);
    if (position === null) {
      return {
        field: 'position',
        message: `intent="arpeggio" needs a position; got ${JSON.stringify(block.position ?? null)}. Legal values for quality="${block.quality}": ${legal.join(', ')}.`,
      };
    }
    if (!legal.includes(position)) {
      return {
        field: 'position',
        message: `position="${position}" is not one quality="${block.quality}" offers. Legal values: ${legal.join(', ')}.`,
      };
    }
    return null;
  }

  // scale + pattern both need a scale type.
  const scaleType = toScaleType(block.scaleType);
  if (!scaleType) {
    return {
      field: 'scaleType',
      message: `intent="${intent}" needs a scaleType; got ${JSON.stringify(block.scaleType ?? null)}. Legal values: ${DIAGRAM_SCALE_TYPES.join(', ')}.`,
    };
  }

  if (intent === 'scale') {
    const legal = scalePositions(scaleType);
    const position = toDiagramPosition(block.position);
    if (position === null) {
      return {
        field: 'position',
        message: `intent="scale" needs a position; got ${JSON.stringify(block.position ?? null)}. Legal values for scaleType="${scaleType}": ${legal.join(', ')}.`,
      };
    }
    if (!legal.includes(position)) {
      return {
        field: 'position',
        message:
          `position="${position}" is not one scaleType="${scaleType}" has a box for. Legal values: ${legal.join(', ')}` +
          (legal.length === 1
            ? ' — this scale ships no numbered CAGED boxes, only the universal two-octave window.'
            : '.'),
      };
    }
    return null;
  }

  // pattern: 3NPS. There are as many patterns as the scale has notes, so
  // the legal range is a fact about the scale, not a fixed 1–7.
  const patternCount = getScalePitchClasses({ root: root as PitchClass, type: scaleType }).length;
  if (patternCount === 0) {
    return {
      field: 'scaleType',
      message: `scaleType="${scaleType}" produced no notes for root="${root}", so there is no pattern to draw.`,
    };
  }
  const index = block.patternIndex;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > patternCount) {
    return {
      field: 'patternIndex',
      message:
        `intent="pattern" needs a patternIndex between 1 and ${patternCount}; got ${JSON.stringify(index ?? null)}. ` +
        `A ${scaleType} scale has ${patternCount} notes, so it has ${patternCount} three-notes-per-string patterns — pattern N starts on scale degree N.`,
    };
  }
  return null;
}

/**
 * Fields this block sets that its intent will ignore.
 *
 * Not an error — an ignored field draws nothing wrong. It is worth SAYING,
 * though: `stringSet` on an `intent="scale"` diagram means the author was
 * thinking of a triad, and the picture they get will not be the one in
 * their head.
 */
export function irrelevantTheoryFields(block: DiagramBlock): string[] {
  const intent = toDiagramIntent(block.intent) ?? DEFAULT_DIAGRAM_INTENT;
  const used: Record<DiagramIntent, string[]> = {
    chord: ['quality', 'stringSet', 'inversion'],
    scale: ['scaleType', 'position'],
    arpeggio: ['quality', 'position'],
    pattern: ['scaleType', 'patternIndex'],
  };
  const candidates = ['quality', 'stringSet', 'inversion', 'scaleType', 'position', 'patternIndex'];
  return candidates.filter(
    (field) =>
      !used[intent].includes(field) &&
      block[field as keyof DiagramBlock] !== undefined &&
      block[field as keyof DiagramBlock] !== null,
  );
}

/** Degree label the way a player reads it: the tonic is 'R', not '1'. */
function asRootLabel(degree: string | undefined): string | undefined {
  return degree === '1' ? 'R' : degree;
}

/** Realized board positions → labelled dots, with the label computed per pitch class. */
function labelByPitchClass(
  positions: readonly { string: number; fret: number }[],
  root: PitchClass,
  degrees: Partial<Record<PitchClass, string>>,
): NeckDotInput[] {
  const out: NeckDotInput[] = [];
  const seen = new Set<string>();
  for (const p of positions) {
    const key = `${p.string}:${p.fret}`;
    if (seen.has(key)) continue;
    // Recomputed from the tuning, never carried — the same rule the MCP
    // path applies to a hand-typed label.
    const pc = pitchClassAt(p.string, p.fret, 'guitar');
    if (pc == null) continue;
    const label = pc === root ? 'R' : asRootLabel(degrees[pc]);
    if (!label) continue;
    seen.add(key);
    out.push({ string: p.string, fret: p.fret, label, root: pc === root });
  }
  return out;
}

/**
 * Resolve a diagram block to dots.
 *
 * `paramValue` is the lesson-level parameter's current value; it wins over
 * the block's own `root` when the block sets `useParam`.
 *
 * Returns `[]` rather than throwing when a shape can't be realised — an
 * unrenderable diagram should leave a gap, not take down the lesson. The
 * gap is the LAST resort though: `validateTheoryDiagram` runs first here so
 * that whatever reaches this point has already been refused by name at
 * parse time, and the console.warn says which combination it was.
 */
export function resolveDiagramDots(
  block: DiagramBlock,
  paramValue?: string,
): NeckDotInput[] {
  if (block.mode === 'explicit') return block.dots ?? [];

  const problem = validateTheoryDiagram(block, paramValue);
  if (problem) {
    console.warn(`[resolveDiagramDots] ${problem.field}: ${problem.message}`);
    return [];
  }

  const intent = toDiagramIntent(block.intent) ?? DEFAULT_DIAGRAM_INTENT;
  const root = effectiveRoot(block, paramValue) as PitchClass;

  if (intent === 'chord') {
    // stringSet arrives as one of the four names in STRING_SETS ("e–B–G",
    // "B–G–D", "G–D–A", "D–A–E") rather than a raw [0,1,2] array — a closed
    // enum an LLM cannot get wrong, and a name a guitarist already knows.
    const set = STRING_SETS.find((s) => s.name === block.stringSet)!;
    const voicing = triadVoicing(
      root,
      toTriadQuality(block.quality) as TriadQuality,
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

  if (intent === 'arpeggio') {
    const quality = toChordQuality(block.quality) as ChordQuality;
    const position = toDiagramPosition(block.position) as ArpeggioPosition;
    // realizeArpeggio already recomputes each pitch class from the tuning
    // and labels it from the chord — it hands back exactly what a dot needs.
    return realizeArpeggio(root, quality, position).map((n) => ({
      string: n.string,
      fret: n.fret,
      label: n.degree,
      root: n.root,
    }));
  }

  const scaleType = toScaleType(block.scaleType) as ScaleType;
  const pcs = getScalePitchClasses({ root, type: scaleType });
  const degrees = scaleDegrees({ root, type: scaleType });

  if (intent === 'scale') {
    const position = toDiagramPosition(block.position) as ArpeggioPosition;
    return labelByPitchClass(realizeCagedShape(position, root, pcs, scaleType), root, degrees);
  }

  // pattern: three notes per string, numbered from the degree it starts on.
  return labelByPitchClass(
    threeNotesPerString(pcs, (block.patternIndex as number) - 1),
    root,
    degrees,
  );
}

/**
 * What this theory diagram is, in words a caption can borrow — "E-shape",
 * "Box 2", "2 octaves", "Pattern 3".
 *
 * Exists so a shape's NAME is computed from the same position the dots came
 * from rather than typed alongside them, which is how a caption ends up
 * saying "box 2" over box 3.
 */
export function diagramShapeName(block: DiagramBlock): string | null {
  const intent = toDiagramIntent(block.intent) ?? DEFAULT_DIAGRAM_INTENT;
  if (intent === 'pattern') {
    return typeof block.patternIndex === 'number' ? `Pattern ${block.patternIndex}` : null;
  }
  const position = toDiagramPosition(block.position);
  if (position === null) return null;
  if (intent === 'arpeggio') return arpeggioShapeName(position);
  const scaleType = toScaleType(block.scaleType);
  return scaleType ? shapeName(position, scaleType) : null;
}

// -----------------------------------------------------------------------------
// What the renderer will actually DRAW
// -----------------------------------------------------------------------------
//
// Resolving a diagram is only half of "does this draw something". MiniNeck
// then picks a fret WINDOW and clips to it — and when the block carries an
// explicit `fromFret`/`toFret`, that window always wins over the dots. A
// triad that resolves at frets 7–9 inside a block that says `fromFret=0
// toFret=5` resolves fine and renders a completely empty fretboard.
//
// So the geometry below mirrors MiniNeck's own `resolveWindow` + `visible`
// filter, exactly, and the parse-time check in markdown-blocks.ts runs it.
// A mirror is a drift risk, so `diagram-params.test.ts` renders the REAL
// MiniNeck into jsdom and asserts this module predicts exactly the dots it
// draws: change either side alone and the suite fails. (The honest fix is
// for MiniNeck to import `resolveNeckWindow` from here — it cannot happen
// in this commit because that file is being edited elsewhere.)

/** MiniNeck's `MAX_FRET`. Higher than a real board so a 14th-fret shape isn't clipped. */
export const NECK_MAX_FRET = { guitar: 22, bass: 20 } as const;
/** MiniNeck's `GUITAR_STRINGS` / `BASS_STRINGS` lengths. */
export const NECK_STRING_COUNT = { guitar: 6, bass: 4 } as const;
/** MiniNeck's `minSpan` default — no caller passes another value. */
export const NECK_MIN_SPAN = 5;

export type NeckInstrument = keyof typeof NECK_MAX_FRET;

/** The renderer's own narrowing: anything that isn't 'bass' draws a guitar. */
export function asNeckInstrument(value: unknown): NeckInstrument {
  return value === 'bass' ? 'bass' : 'guitar';
}

/** Mirrors `resolveWindow` in MiniNeck.tsx. Keep the two identical. */
export function resolveNeckWindow(
  dots: readonly { fret: number }[],
  instrument: NeckInstrument,
  fromFret?: number,
  toFret?: number,
  minSpan: number = NECK_MIN_SPAN,
): { lo: number; hi: number } {
  const maxFret = NECK_MAX_FRET[instrument];
  if (fromFret != null && toFret != null) {
    return { lo: Math.max(0, fromFret), hi: Math.min(maxFret, toFret) };
  }
  if (dots.length === 0) return { lo: 0, hi: minSpan };

  const frets = dots.map((d) => d.fret);
  let lo = Math.max(0, Math.min(...frets) - 1);
  let hi = Math.min(maxFret, Math.max(...frets) + 1);
  if (frets.includes(0)) lo = 0;
  while (hi - lo < minSpan && hi < maxFret) hi += 1;
  while (hi - lo < minSpan && lo > 0) lo -= 1;
  return { lo, hi };
}

/**
 * Is there a position on this board for the dot at all?
 *
 * MiniNeck indexes strings by array position and does NOT bounds-check
 * them: `string=5` on a bass is drawn at a y outside the svg's own
 * viewBox, so it vanishes without clipping anything else. A fret past the
 * last one is clipped by the window instead. Both are invisible dots that
 * validate, which is why this is a separate predicate from the window —
 * a window repair cannot rescue them.
 */
export function isOnNeck(
  dot: { string: number; fret: number },
  instrument: NeckInstrument,
): boolean {
  return (
    Number.isInteger(dot.string) &&
    dot.string >= 0 &&
    dot.string < NECK_STRING_COUNT[instrument] &&
    Number.isInteger(dot.fret) &&
    dot.fret >= 0 &&
    dot.fret <= NECK_MAX_FRET[instrument]
  );
}

/**
 * The dots a reader will actually see: on the board AND inside the window
 * MiniNeck picks for this `fromFret`/`toFret` pair. Returning fewer than
 * it was given is the whole signal — see `markdown-blocks.ts`.
 */
export function visibleNeckDots<T extends { string: number; fret: number }>(
  dots: readonly T[],
  instrument: NeckInstrument,
  fromFret?: number,
  toFret?: number,
  minSpan: number = NECK_MIN_SPAN,
): T[] {
  const { lo, hi } = resolveNeckWindow(dots, instrument, fromFret, toFret, minSpan);
  return dots.filter((d) => isOnNeck(d, instrument) && d.fret >= lo && d.fret <= hi);
}

/**
 * The window that shows every one of `dots` — the author's own window
 * WIDENED to fit rather than replaced, so a deliberately wide framing
 * survives the repair. Padded one fret either side and pinned to the nut
 * by an open string, the same two rules MiniNeck's auto-fit uses, because
 * a dot sitting exactly on `lo` is drawn in the open-string gutter to the
 * left of the nut instead of on the board.
 */
export function widenNeckWindow(
  dots: readonly { fret: number }[],
  instrument: NeckInstrument,
  fromFret: number,
  toFret: number,
): { fromFret: number; toFret: number } {
  const maxFret = NECK_MAX_FRET[instrument];
  const frets = dots.map((d) => d.fret).filter((f) => f >= 0 && f <= maxFret);
  if (frets.length === 0) return { fromFret, toFret };
  const needLo = frets.includes(0) ? 0 : Math.max(0, Math.min(...frets) - 1);
  const needHi = Math.min(maxFret, Math.max(...frets) + 1);
  return {
    fromFret: Math.max(0, Math.min(fromFret, needLo)),
    toFret: Math.min(maxFret, Math.max(toFret, needHi)),
  };
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
  const quality = toTriadQuality(block.quality);
  if (!quality) {
    console.warn(`[resolveDiagramMarks] quality "${block.quality}" is not a renderable triad quality`);
    return [];
  }

  const voicing = triadVoicing(root, quality, STRING_SETS[0], 0);
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
