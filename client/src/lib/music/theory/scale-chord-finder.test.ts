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

describe('findChordsInScale — power chords are SHAPES', () => {
  const TUNING = [64, 59, 55, 50, 45, 40];
  const midi = (p: { string: number; fret: number }) => TUNING[p.string] + p.fret;

  it('returns grips, each root plus the fifth on the next string', () => {
    const chords = findChordsInScale('E', 'minor', 3, 'power');
    const i = chords[0];
    expect(i.grips.length).toBeGreaterThan(0);
    for (const grip of i.grips) {
      expect(grip).toHaveLength(2);
      expect(grip[1].string).toBe(grip[0].string - 1);
      expect(midi(grip[1]) - midi(grip[0])).toBe(7);
    }
  });

  it('uses +3 across G→B rather than +2', () => {
    const chords = findChordsInScale('E', 'minor', 'all', 'power');
    for (const c of chords) {
      for (const grip of c.grips) {
        const expected = grip[0].string === 2 ? 3 : 2; // G string = index 2
        if (c.quality !== 'dim') {
          expect(grip[1].fret - grip[0].fret).toBe(expected);
        }
      }
    }
  });

  it('the diminished degree gets a FLAT fifth, not the standard shape', () => {
    const chords = findChordsInScale('E', 'minor', 'all', 'power');
    const ii = chords[1];
    expect(ii.flatFifthWarning).toBe(true);
    for (const grip of ii.grips) {
      expect(midi(grip[1]) - midi(grip[0])).toBe(6);
    }
  });

  it('triad mode returns grips too — a triad is a hand shape as well', () => {
    const grips = findChordsInScale('E', 'minor', 3, 'triads')[0].grips;
    expect(grips.length).toBeGreaterThan(0);
    for (const g of grips) expect(g).toHaveLength(3);
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
  it('anchors every grip on a root inside the box', () => {
    // Box 3 of E minor spans frets 4-8 (guitarscale.org Shape 3). The ROOT
    // must sit in the box; the rest of the grip may reach outside it,
    // because a shape trimmed to a fret window is a different shape.
    const boxed = findChordsInScale('E', 'minor', 3, 'triads');
    for (const chord of boxed) {
      for (const grip of chord.grips) {
        expect(grip[0].fret).toBeGreaterThanOrEqual(4);
        expect(grip[0].fret).toBeLessThanOrEqual(8);
      }
    }
  });

  it('labels every chord tone by its role, not its note name', () => {
    const [i] = findChordsInScale('E', 'minor', 3, 'triads');
    expect(i.roleFor.get('E')).toBe('R');
    expect(i.roleFor.get('G')).toBe('3');
    expect(i.roleFor.get('B')).toBe('5');

    const [ip] = findChordsInScale('E', 'minor', 3, 'power');
    expect(ip.roleFor.get('E')).toBe('R');
    expect(ip.roleFor.get('B')).toBe('5');
    expect(ip.roleFor.has('G')).toBe(false); // no third in a power chord
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
