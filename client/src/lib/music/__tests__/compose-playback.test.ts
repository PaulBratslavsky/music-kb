import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  resolveBassMidi,
  resolveChordMidis,
  resolveMelodyMidi,
} from '../compose/playback';
import { emptyComposition } from '../compose/types';
import type { Composition, Degree } from '../compose/types';
import { pitchClassFromMidi } from '../theory/notes';

function cMajor(): Composition {
  return emptyComposition('t1', 'Test', 'C', 'major');
}

describe('resolveChordMidis', () => {
  it('builds the I triad of C major as C-E-G', () => {
    const midis = resolveChordMidis(cMajor(), 1);
    expect(midis.map(pitchClassFromMidi)).toEqual(['C', 'E', 'G']);
  });

  it('builds the V triad of C major as G-B-D (triad only, no 7th)', () => {
    const midis = resolveChordMidis(cMajor(), 5);
    expect(midis).toHaveLength(3);
    expect(midis.map(pitchClassFromMidi)).toEqual(['G', 'B', 'D']);
  });

  it('builds the ii triad of C major as D-F-A', () => {
    const midis = resolveChordMidis(cMajor(), 2);
    expect(midis.map(pitchClassFromMidi)).toEqual(['D', 'F', 'A']);
  });
});

describe('degree → note resolution stays ascending across the octave wrap', () => {
  it('A-minor melody: degree 1 (A) is lower than degree 3 (C an octave up)', () => {
    const am = emptyComposition('t2', 'Am', 'A', 'minor');
    const d1 = resolveMelodyMidi(am, { degree: 1, octave: 0 })!;
    const d3 = resolveMelodyMidi(am, { degree: 3, octave: 0 })!;
    expect(pitchClassFromMidi(d1)).toBe('A');
    expect(pitchClassFromMidi(d3)).toBe('C');
    expect(d3).toBeGreaterThan(d1); // C is realized in the octave above A
  });

  it('octave offset raises a melody note by exactly 12 semitones', () => {
    const c = cMajor();
    const low = resolveMelodyMidi(c, { degree: 1, octave: 0 })!;
    const high = resolveMelodyMidi(c, { degree: 1, octave: 1 })!;
    expect(high - low).toBe(12);
  });

  it('bass ignores the octave offset (single-band)', () => {
    const c = cMajor();
    const a = resolveBassMidi(c, { degree: 1, octave: 0 })!;
    const b = resolveBassMidi(c, { degree: 1, octave: 1 })!;
    expect(a).toBe(b);
  });

  it('bass sits below melody for the same degree', () => {
    const c = cMajor();
    const mel = resolveMelodyMidi(c, { degree: 1, octave: 0 })!;
    const bass = resolveBassMidi(c, { degree: 1, octave: 0 })!;
    expect(bass).toBeLessThan(mel);
  });
});

describe('buildSchedule', () => {
  it('is empty for an untouched composition', () => {
    expect(buildSchedule(cMajor())).toEqual([]);
  });

  it('fires each chord span once on its start tick, carrying its length', () => {
    const c = cMajor();
    c.chords = [
      { id: 'a', degree: 1 as Degree, start: 0, length: 16 },
      { id: 'b', degree: 5 as Degree, start: 32, length: 8 },
    ];
    const schedule = buildSchedule(c);
    expect(schedule.map((e) => e.step)).toEqual([0, 32]);
    expect(schedule[0].chord?.map(pitchClassFromMidi)).toEqual(['C', 'E', 'G']);
    expect(schedule[0].chordTicks).toBe(16);
    expect(schedule[1].chord?.map(pitchClassFromMidi)).toEqual(['G', 'B', 'D']);
    expect(schedule[1].chordTicks).toBe(8);
  });

  it('merges chord + melody + bass that land on the same tick', () => {
    const c = cMajor();
    c.chords = [{ id: 'a', degree: 1 as Degree, start: 0, length: 16 }];
    c.melody = [{ id: 'm', degree: 3, octave: 0, start: 0, length: 4 }];
    c.bass = [{ id: 'b', degree: 1, octave: 0, start: 0, length: 4 }];
    const [first] = buildSchedule(c);
    expect(first.step).toBe(0);
    expect(first.chord).toBeDefined();
    expect(pitchClassFromMidi(first.melody!)).toBe('E');
    expect(first.melodyTicks).toBe(4);
    expect(pitchClassFromMidi(first.bass!)).toBe('C');
  });

  it('keeps a mid-bar melody note independent of any chord', () => {
    const c = cMajor();
    c.melody = [{ id: 'm', degree: 2, octave: 0, start: 20, length: 2 }];
    const schedule = buildSchedule(c);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].step).toBe(20);
    expect(schedule[0].chord).toBeUndefined();
    expect(pitchClassFromMidi(schedule[0].melody!)).toBe('D');
  });
});
