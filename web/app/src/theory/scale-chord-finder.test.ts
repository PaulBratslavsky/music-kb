import { describe, expect, it } from 'vitest';
import { findChordsInScale } from './scale-chord-finder';

describe('findChordsInScale — triads', () => {
  const chords = findChordsInScale('E', 'minor', 'all', 'triads');

  it('returns the seven diatonic chords of the key', () => {
    expect(chords.map((c) => c.chordName)).toEqual([
      'Em', 'F#dim', 'G', 'Am', 'Bm', 'C', 'D',
    ]);
  });

  it('labels them with roman numerals carrying the quality', () => {
    expect(chords.map((c) => c.roman)).toEqual([
      'i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII',
    ]);
  });

  it('gives a minor triad a flat third', () => {
    const i = chords[0];
    expect(i.targetPcs).toEqual(['E', 'G', 'B']);
  });

  it('gives a diminished triad a flat fifth', () => {
    const ii = chords[1];
    expect(ii.targetPcs).toEqual(['F#', 'A', 'C']);
  });

  it('never warns about a flat fifth in triad mode — the triad spells it', () => {
    expect(chords.every((c) => !c.flatFifthWarning)).toBe(true);
  });
});

describe('findChordsInScale — power chords', () => {
  const chords = findChordsInScale('E', 'minor', 'all', 'power');

  it('reduces every chord to root + fifth', () => {
    expect(chords[0].targetPcs).toEqual(['E', 'B']); // E5
    expect(chords[2].targetPcs).toEqual(['G', 'D']); // G5
  });

  it('names them with the 5 suffix', () => {
    expect(chords.map((c) => c.chordName)).toEqual([
      'E5', 'F#5', 'G5', 'A5', 'B5', 'C5', 'D5',
    ]);
  });

  it('flags the diminished degree, whose fifth is flat', () => {
    // F#5 in E minor is the trap: the standard root+7-semitones grip would
    // sound C#, which is not in the key. The real fifth here is C.
    const ii = chords[1];
    expect(ii.flatFifthWarning).toBe(true);
    expect(ii.targetPcs).toEqual(['F#', 'C']);
  });

  it('flags exactly one degree in a minor key', () => {
    expect(chords.filter((c) => c.flatFifthWarning)).toHaveLength(1);
  });

  it('flags the vii in a major key instead', () => {
    const major = findChordsInScale('C', 'major', 'all', 'power');
    const flagged = major.filter((c) => c.flatFifthWarning);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].roman).toBe('vii°');
    expect(flagged[0].targetPcs).toEqual(['B', 'F']);
  });
});

describe('findChordsInScale — restricted to a box', () => {
  it('only returns positions inside the chosen box', () => {
    const boxed = findChordsInScale('E', 'minor', 3, 'triads');
    // Box 3 of E minor spans frets 4-8 (guitarscale.org Shape 3).
    for (const chord of boxed) {
      for (const p of chord.positions) {
        expect(p.fret).toBeGreaterThanOrEqual(4);
        expect(p.fret).toBeLessThanOrEqual(8);
      }
    }
  });

  it('finds fewer positions in a box than across the whole neck', () => {
    const all = findChordsInScale('E', 'minor', 'all', 'triads');
    const boxed = findChordsInScale('E', 'minor', 3, 'triads');
    const total = (cs: typeof all) => cs.reduce((n, c) => n + c.positions.length, 0);
    expect(total(boxed)).toBeLessThan(total(all));
    expect(total(boxed)).toBeGreaterThan(0);
  });

  it('still lists a degree whose notes are only partly in the box', () => {
    // Every degree is returned even if the box is short on its notes —
    // "this shape only gives you two of the three here" is information.
    expect(findChordsInScale('E', 'minor', 1, 'triads')).toHaveLength(7);
  });
});
