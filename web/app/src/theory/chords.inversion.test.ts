import { describe, expect, it } from 'vitest';
import { inversionForBass, applyInversion, getChordPitchClasses } from './chords';
import { pianoVoicing } from './voicings/piano';
import { midiFromPitchOctave } from './notes';

describe('inversionForBass', () => {
  it('root in the bass is root position', () => {
    expect(inversionForBass('E', 'min', 'E')).toBe(0);
  });

  it('third in the bass is first inversion', () => {
    expect(inversionForBass('E', 'min', 'G')).toBe(1);
  });

  it('fifth in the bass is second inversion — the Em/B case', () => {
    expect(inversionForBass('E', 'min', 'B')).toBe(2);
  });

  it('seventh in the bass is third inversion', () => {
    expect(inversionForBass('C', 'maj7', 'B')).toBe(3);
  });

  it('falls back to root position when the bass is not a chord tone', () => {
    // F under Em is a pedal, not an inversion — no inversion describes it.
    expect(inversionForBass('E', 'min', 'F')).toBe(0);
  });

  it('the returned inversion really puts that note lowest', () => {
    for (const bass of ['E', 'G', 'B'] as const) {
      const inv = inversionForBass('E', 'min', bass);
      const voiced = applyInversion(getChordPitchClasses('E', 'min'), inv);
      expect(voiced[0]).toBe(bass);
    }
  });
});

describe('the whole chain: detected bass -> stored inversion -> voicing', () => {
  it('a detected Em/B actually voices with B lowest', () => {
    // What detect sees: notes lowest-first, so B is the bass.
    const inversion = inversionForBass('E', 'min', 'B');
    // What every re-deriving surface then does with it.
    const notes = pianoVoicing({
      root: 'E',
      quality: 'min',
      inversion,
      voicingIndex: 0,
    });
    const midis = notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave));
    const lowest = notes[midis.indexOf(Math.min(...midis))];
    expect(lowest.pitchClass).toBe('B');
  });

  it('without the inversion it would wrongly voice E lowest', () => {
    // The bug this guards: inversion left at 0 puts the root back in the
    // bass and the slash chord silently becomes a root-position one.
    const notes = pianoVoicing({ root: 'E', quality: 'min', inversion: 0, voicingIndex: 0 });
    const midis = notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave));
    const lowest = notes[midis.indexOf(Math.min(...midis))];
    expect(lowest.pitchClass).toBe('E');
  });
});
