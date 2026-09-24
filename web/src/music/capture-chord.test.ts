// What "+ Add chord" captures, per view mode.
//
// The interesting case is arpeggio. It shares chord mode's root + quality
// picker but has no inversion or voicing — `urlFromState` deliberately omits
// both because an arpeggio is every position of the chord, not one grip. The
// in-memory `state.chord` still carries whatever chord mode last set, so
// capturing it verbatim would attach a voicing the arpeggio view never drew.
// These tests pin that it's normalised away instead.
import { describe, expect, it } from 'vitest';
import type { AppState } from '@music-kb/music/types';
import { chordToCapture } from './capture-chord';

const base: AppState = {
  mode: 'chord',
  chord: { root: 'C', quality: 'maj', inversion: 2, voicingIndex: 3 },
  scale: { root: 'C', type: 'major' },
  singleNote: 'C',
  scalePosition: 'all',
  preferFlats: false,
  chordDepth: 'triad',
};

describe('chord mode', () => {
  it('captures the selection verbatim, voicing and inversion included', () => {
    expect(chordToCapture(base)).toEqual({
      root: 'C',
      quality: 'maj',
      inversion: 2,
      voicingIndex: 3,
    });
  });
});

describe('arpeggio mode', () => {
  it('captures root + quality but drops the leftover inversion and voicing', () => {
    const captured = chordToCapture({ ...base, mode: 'arpeggio' });
    expect(captured).toEqual({
      root: 'C',
      quality: 'maj',
      inversion: 0,
      voicingIndex: 0,
    });
  });

  it('follows the arpeggio own root and quality', () => {
    const captured = chordToCapture({
      ...base,
      mode: 'arpeggio',
      chord: { root: 'D', quality: 'min7', inversion: 1, voicingIndex: 4 },
    });
    expect(captured?.root).toBe('D');
    expect(captured?.quality).toBe('min7');
  });
});

describe('modes with no chord to capture', () => {
  it.each(['scale', 'note', 'all'] as const)('%s returns null', (mode) => {
    expect(chordToCapture({ ...base, mode })).toBeNull();
  });
});
