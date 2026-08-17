import { describe, expect, it } from 'vitest';
import { chordToneMap, outsideScaleTones } from './chord-overlay';
import { getScalePitchClasses } from './scales';

describe('chordToneMap', () => {
  it('labels a major triad R / 3 / 5', () => {
    const m = chordToneMap('C', 'maj')!;
    expect([...m.tones].sort()).toEqual(['C', 'E', 'G']);
    expect(m.labelFor.get('C')).toBe('R');
    expect(m.labelFor.get('E')).toBe('3');
    expect(m.labelFor.get('G')).toBe('5');
  });

  it('labels a minor triad with a flat third', () => {
    const m = chordToneMap('E', 'min')!;
    expect(m.labelFor.get('E')).toBe('R');
    expect(m.labelFor.get('G')).toBe('b3');
    expect(m.labelFor.get('B')).toBe('5');
  });

  it('labels a major 7th chord R / 3 / 5 / 7', () => {
    const m = chordToneMap('C', 'maj7')!;
    expect([...m.tones].sort()).toEqual(['B', 'C', 'E', 'G']);
    expect(m.labelFor.get('B')).toBe('7');
  });

  it('labels a dominant 7th with a flat seventh', () => {
    const m = chordToneMap('G', 'dom7')!;
    expect(m.labelFor.get('F')).toBe('b7');
    expect(m.labelFor.get('B')).toBe('3');
  });

  it('keeps labels relative to the CHORD root, not the key', () => {
    // Am inside C major: A is the root of the chord even though it is the
    // 6th degree of the key.
    const m = chordToneMap('A', 'min')!;
    expect(m.labelFor.get('A')).toBe('R');
    expect(m.root).toBe('A');
  });
});

describe('outsideScaleTones', () => {
  it('is empty for a chord fully inside the scale', () => {
    const scale = getScalePitchClasses({ root: 'E', type: 'minor' });
    // Cmaj7 = C E G B, all diatonic to E minor.
    expect(outsideScaleTones(chordToneMap('C', 'maj7')!, scale)).toEqual([]);
  });

  it('flags the note a secondary dominant adds', () => {
    // In E minor, B7 sounds D# — the raised 7th, outside the natural scale.
    const scale = getScalePitchClasses({ root: 'E', type: 'minor' });
    expect(outsideScaleTones(chordToneMap('B', 'dom7')!, scale)).toEqual(['D#']);
  });
});
