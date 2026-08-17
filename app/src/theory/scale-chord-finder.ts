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
  /** Where they sit inside the chosen box. */
  positions: RealizedPosition[];
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
  // Power chord: root + fifth, no third. The fifth follows the chord — a
  // diminished degree has a flat one, which is exactly the case worth
  // teaching rather than hiding.
  return quality === 'dim' ? [0, 6] : [0, 7];
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
    const targetPcs = targetIntervals(mode, t.quality).map((i) => transpose(t.root, i));
    const wanted = new Set(targetPcs);

    const positions = (boxed ?? allNeckPositions(scalePcs)).filter((p) =>
      wanted.has(pitchAt(p)),
    );

    return {
      degree: t.degree,
      chordName: mode === 'power' ? `${t.rootDisplay}5` : t.chordName,
      roman: t.roman,
      quality: t.quality,
      targetPcs,
      positions,
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
