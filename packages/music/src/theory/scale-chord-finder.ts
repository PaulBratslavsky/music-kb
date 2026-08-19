// "Find the chords hiding inside a scale shape."
//
// The play-along panel answers what to play right now. This answers a
// different, slower question: given a box you already know, where do the
// chords of the key actually live in it? That is the step between knowing
// a scale shape and being able to use it, and it's a practice activity
// rather than a play-along one — hence Theory > Practice, not the video
// page.
//
// Every chord here is filtered to the notes of ONE box, which is the whole
// point: a triad you can reach without moving your hand is a triad you will
// actually use.

import type { PitchClass, ScalePosition, ScaleType } from '../types';
import { PITCH_CLASSES } from '../types';
import { getDiatonicTriads, type DiatonicTriad } from './diatonic';
import { realizeCagedShape, type RealizedPosition } from './positions';
import { chordGrips } from './power-chords';
import { getScalePitchClasses } from './scales';

export type FinderMode = 'triads' | 'power';

export type FoundChord = {
  degree: number;
  /** "Em", "G", "F#dim" … */
  chordName: string;
  /** "i", "III", "ii°" … */
  roman: string;
  quality: DiatonicTriad['quality'];
  /** Notes to look for, in the current mode. */
  targetPcs: PitchClass[];
  /**
   * Where to play it. For triads: every chord tone inside the box. For
   * power chords: the actual GRIPS — root plus the fifth on the next
   * string — because a power chord is a hand shape, not a set of pitch
   * classes. Scattering its notes across the box loses the only thing that
   * makes it a power chord.
   */
  positions: RealizedPosition[];
  /**
   * The playable shapes, each one note per consecutive string: [root, 3rd,
   * 5th] for a triad, [root, 5th] for a power chord. Both are grips — a
   * hand position you can slide — so both are returned as shapes rather
   * than as loose dots scattered through the box.
   */
  grips: RealizedPosition[][];
  /**
   * pitch class → its role in THIS chord ('R', '3', '5'). What a player
   * needs on the board: a note name tells you where you are on the neck,
   * this tells you where you are in the chord.
   */
  roleFor: Map<PitchClass, string>;
  /**
   * Role of each note IN THE GRIP, by index — 'R','3','5' or 'R','5','R'.
   * Prefer this over roleFor when labelling positions: a power chord's
   * octave is the same pitch class as its root, so a pitch-class map
   * cannot tell them apart.
   */
  roles: string[];
  /**
   * Set when this degree's 5th is diminished — the ii° in minor, the vii° in
   * major. A power chord there is NOT the usual root+7-semitone grip: the
   * fifth is flat, so playing the standard shape puts a note outside the
   * key. Drawing it silently would teach the wrong thing, so callers should
   * surface this.
   */
  flatFifthWarning: boolean;
};

/** Semitones above the root for the notes we ask the player to find. */
function targetIntervals(mode: FinderMode, quality: DiatonicTriad['quality']): number[] {
  if (mode === 'triads') {
    switch (quality) {
      case 'maj': return [0, 4, 7];
      case 'min': return [0, 3, 7];
      case 'dim': return [0, 3, 6];
      case 'aug': return [0, 4, 8];
    }
  }
  // Power chord: root, fifth, and the octave on top — the three-note shape
  // guitarists actually play, not the bare dyad. The fifth follows the
  // chord, so a diminished degree gets a FLAT one, which is exactly the
  // case worth teaching rather than hiding.
  return quality === 'dim' ? [0, 6, 12] : [0, 7, 12];
}

function transpose(root: PitchClass, semis: number): PitchClass {
  return PITCH_CLASSES[(PITCH_CLASSES.indexOf(root) + semis) % 12];
}

/**
 * Every diatonic chord of `scale`, reduced to the notes reachable inside
 * `position`. A degree whose notes don't all appear in the box is still
 * returned — with only the positions that do exist — because "this shape
 * only gives you the root and fifth here" is useful information, not an
 * error.
 *
 * Pass position 'all' to search the whole neck.
 */
export function findChordsInScale(
  root: PitchClass,
  type: ScaleType,
  position: ScalePosition,
  mode: FinderMode,
): FoundChord[] {
  const scalePcs = getScalePitchClasses({ root, type });
  const triads = getDiatonicTriads({ root, type });
  if (triads.length !== 7) return [];

  const boxed =
    position === 'all'
      ? null
      : realizeCagedShape(position, root, scalePcs, type);

  return triads.map((t) => {
    const intervals = targetIntervals(mode, t.quality);
    const targetPcs = intervals.map((i) => transpose(t.root, i));
    const scope = boxed ?? allNeckPositions(scalePcs);

    // Roles follow the INTERVAL, not the position in the list — the octave
    // of a power chord is the ROOT again, and keying off the index would
    // relabel it "5" and then overwrite the real root, since both are the
    // same pitch class. A diminished fifth still reads as the 5 of its
    // chord (flagged separately) rather than as a b5 to decode.
    const roleForInterval = (semis: number): string => {
      const mod = ((semis % 12) + 12) % 12;
      if (mod === 0) return 'R';
      if (mod === 3 || mod === 4) return '3';
      return '5'; // 6 (diminished) or 7
    };
    const roles = intervals.map(roleForInterval);
    const roleFor = new Map<PitchClass, string>();
    targetPcs.forEach((pc, i) => {
      // First writer wins, so the root keeps 'R' when the octave repeats it.
      if (!roleFor.has(pc)) roleFor.set(pc, roles[i]);
    });

    // Anchor a grip on each ROOT in the box; the other notes fall where the
    // shape puts them — +2 frets to the next string, +3 across G→B — even
    // when that leaves the box, because a grip clipped to a fret window is
    // a different grip.
    //
    // Except on a diminished degree in power mode, which gets NO grip. A
    // power chord is root + perfect fifth; root + diminished fifth is a
    // tritone, which is a different interval and a different (unplayed)
    // shape. Drawing something there would teach a grip nobody uses and
    // that sounds wrong — the honest answer is that this degree has no
    // power chord.
    const noPowerChord = mode === 'power' && t.quality === 'dim';
    const roots = noPowerChord ? [] : scope.filter((p) => pitchAt(p) === t.root);
    const grips = chordGrips(roots, intervals, MAX_FRET);

    return {
      degree: t.degree,
      chordName: mode === 'power' ? `${t.rootDisplay}5` : t.chordName,
      roman: t.roman,
      quality: t.quality,
      targetPcs,
      positions: grips.flat(),
      grips,
      roleFor,
      /** Role per grip index — the reliable one; see roleForInterval. */
      roles,
      // Only meaningful for power chords: a triad SPELLS its diminished
      // fifth, so there is nothing to warn about.
      flatFifthWarning: mode === 'power' && t.quality === 'dim',
    };
  });
}

// --- neck helpers ---------------------------------------------------------

const TUNING = [64, 59, 55, 50, 45, 40]; // high e → low E, standard
const MAX_FRET = 15;

function pitchAt(p: RealizedPosition): PitchClass {
  return PITCH_CLASSES[(TUNING[p.string] + p.fret) % 12];
}

function allNeckPositions(scalePcs: readonly PitchClass[]): RealizedPosition[] {
  const out: RealizedPosition[] = [];
  for (let s = 0; s < TUNING.length; s += 1) {
    for (let f = 0; f <= MAX_FRET; f += 1) {
      if (scalePcs.includes(PITCH_CLASSES[(TUNING[s] + f) % 12])) {
        out.push({ string: s, fret: f });
      }
    }
  }
  return out;
}
