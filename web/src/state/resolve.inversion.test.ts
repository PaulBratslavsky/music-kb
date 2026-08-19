import { describe, expect, it } from 'vitest';
import type { AppState } from '@music-kb/music/types';
import { midiFromNote } from '@music-kb/music/theory/notes';
import { resolveSelection, chordInversionCount } from './resolve';

/** The builder's state with one chord selected. */
const stateFor = (inversion: number): AppState => ({
  mode: 'chord',
  chord: { root: 'E', quality: 'min', inversion, voicingIndex: 0 },
  scale: { root: 'C', type: 'major' },
  singleNote: 'C',
  scalePosition: 'all',
  preferFlats: false,
  chordDepth: 'triad',
});

/** Lowest note the piano lights — the bass, which is what names an inversion. */
const bassOf = (inversion: number) => {
  const { piano } = resolveSelection(stateFor(inversion));
  const midis = piano.map(midiFromNote);
  return piano[midis.indexOf(Math.min(...midis))].pitchClass;
};

describe('the Inversion stepper moves the notes on the piano', () => {
  it('walks the bass through the chord tones', () => {
    // Em: root position E, first inversion G in the bass, second B.
    expect(bassOf(0)).toBe('E');
    expect(bassOf(1)).toBe('G');
    expect(bassOf(2)).toBe('B');
  });

  it('offers one step per chord tone', () => {
    expect(chordInversionCount(stateFor(0).chord)).toBe(3);
  });

  it('lights specific keys, not every octave of each pitch class', () => {
    // The board can only show an inversion if it addresses keys by absolute
    // pitch. Matching by pitch class lights all octaves and the bass is lost.
    const { pianoMatchByPitchClass, piano } = resolveSelection(stateFor(2));
    expect(pianoMatchByPitchClass).toBe(false);
    expect(piano).toHaveLength(3);
  });

  it('actually changes which keys are lit, not just the label', () => {
    const keys = (inv: number) =>
      resolveSelection(stateFor(inv)).piano.map(midiFromNote).join(',');
    expect(keys(0)).not.toBe(keys(1));
    expect(keys(1)).not.toBe(keys(2));
  });
});
