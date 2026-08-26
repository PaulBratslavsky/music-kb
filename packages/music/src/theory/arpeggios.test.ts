// Is an arpeggio diagram actually the chord it claims to be?
//
// This module exists so a lesson never draws a fret the model guessed, so
// the tests have to be stronger than "it returns something". They sweep
// EVERY combination the API accepts — 12 roots × 20 qualities × their
// positions — and check each dot against the chord recomputed from a raw
// MIDI tuning table declared here, not from the code under test. A dot that
// is not a chord tone of that exact chord fails.
//
// The other half is the refusal. A combination the theory layer cannot
// realize must come back EMPTY, because empty is a thing a caller can
// detect and explain, and a half-right fretboard is not.

import { describe, expect, it } from 'vitest';
import {
  ARPEGGIO_SHAPE_SOURCES,
  MAX_ARPEGGIO_TONES,
  arpeggioPositions,
  arpeggioShapeName,
  arpeggioWindow,
  realizeArpeggio,
  supportsArpeggio,
  type ArpeggioPosition,
} from './arpeggios';
import { getChordPitchClasses } from './chords';
import { CAGED_POSITION_WINDOWS, TWO_OCTAVE_BOX } from './positions';
import {
  CHORD_QUALITIES,
  PITCH_CLASSES,
  type ChordQuality,
  type PitchClass,
} from '../types';

/** Standard tuning, high e … low E — spelled out so the sweep below checks
 *  the realization against an independent source of pitch, the same way
 *  positions.structure.test.ts does. */
const TUNING = [64, 59, 55, 50, 45, 40];
const MAX_FRET = 15;

const pcAt = (string: number, fret: number): PitchClass =>
  PITCH_CLASSES[(TUNING[string] + fret) % 12];

const SUPPORTED = CHORD_QUALITIES.filter((q) => supportsArpeggio(q));
const UNSUPPORTED = CHORD_QUALITIES.filter((q) => !supportsArpeggio(q));

const ALL_POSITIONS: ArpeggioPosition[] = [1, 2, 3, 4, 5, '2oct'];

/** Every (root, quality, position) the API says it accepts. */
function* everyAcceptedCombination(): Generator<{
  root: PitchClass;
  quality: ChordQuality;
  position: ArpeggioPosition;
}> {
  for (const root of PITCH_CLASSES) {
    for (const quality of SUPPORTED) {
      for (const position of arpeggioPositions(quality)) {
        yield { root, quality, position };
      }
    }
  }
}

const describeCombo = (
  root: PitchClass,
  quality: ChordQuality,
  position: ArpeggioPosition,
) => `${root}${quality} position ${position}`;

/* -------------------------------------------------------------------------- */
/*  The sweep: everything it accepts is the chord it claims                    */
/* -------------------------------------------------------------------------- */

describe('every accepted combination realizes the chord it names', () => {
  it('draws something — no accepted combination comes back empty', () => {
    for (const { root, quality, position } of everyAcceptedCombination()) {
      expect(
        realizeArpeggio(root, quality, position).length,
        `${describeCombo(root, quality, position)} realized to nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it('every dot is a genuine chord tone of that chord', () => {
    for (const { root, quality, position } of everyAcceptedCombination()) {
      const tones = getChordPitchClasses(root, quality);
      for (const dot of realizeArpeggio(root, quality, position)) {
        expect(
          tones,
          `${describeCombo(root, quality, position)} put ${pcAt(dot.string, dot.fret)} at string ${dot.string} fret ${dot.fret}, which is not in ${tones.join(' ')}`,
        ).toContain(pcAt(dot.string, dot.fret));
      }
    }
  });

  it("every dot's own pitch class matches the fret it sits on", () => {
    // `pc` is a stored field; the tuning is the authority. If these two ever
    // disagree the label is a fiction, which is the failure mode this whole
    // module was written to make impossible.
    for (const { root, quality, position } of everyAcceptedCombination()) {
      for (const dot of realizeArpeggio(root, quality, position)) {
        expect(dot.pc, `${describeCombo(root, quality, position)} string ${dot.string} fret ${dot.fret}`).toBe(
          pcAt(dot.string, dot.fret),
        );
      }
    }
  });

  it('labels every dot, and labels exactly the root dots as the root', () => {
    for (const { root, quality, position } of everyAcceptedCombination()) {
      const dots = realizeArpeggio(root, quality, position);
      for (const dot of dots) {
        expect(dot.degree, `${describeCombo(root, quality, position)} left a dot unlabelled`).toBeTruthy();
        expect(dot.root, `${describeCombo(root, quality, position)} root flag disagrees with the pitch class`).toBe(
          dot.pc === root,
        );
        expect(dot.degree === 'R').toBe(dot.pc === root);
      }
    }
  });

  it('always contains the root — an arpeggio shape without it is unplayable as one', () => {
    for (const { root, quality, position } of everyAcceptedCombination()) {
      expect(
        realizeArpeggio(root, quality, position).some((d) => d.root),
        `${describeCombo(root, quality, position)} has no root dot`,
      ).toBe(true);
    }
  });

  it('stays on the board, with no position drawn twice', () => {
    for (const { root, quality, position } of everyAcceptedCombination()) {
      const seen = new Set<string>();
      for (const dot of realizeArpeggio(root, quality, position)) {
        expect(Number.isInteger(dot.string)).toBe(true);
        expect(dot.string).toBeGreaterThanOrEqual(0);
        expect(dot.string).toBeLessThan(TUNING.length);
        expect(Number.isInteger(dot.fret)).toBe(true);
        expect(dot.fret).toBeGreaterThanOrEqual(0);
        expect(dot.fret).toBeLessThanOrEqual(MAX_FRET);

        const key = `${dot.string}:${dot.fret}`;
        expect(seen.has(key), `${describeCombo(root, quality, position)} drew ${key} twice`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('fits inside the position\'s own fret window — it is a hand position, not the whole neck', () => {
    for (const { root, quality, position } of everyAcceptedCombination()) {
      const window = arpeggioWindow(position)!;
      const span = window.hi - window.lo;
      const dots = realizeArpeggio(root, quality, position);
      const frets = dots.map((d) => d.fret);
      expect(
        Math.max(...frets) - Math.min(...frets),
        `${describeCombo(root, quality, position)} spans more than its ${span + 1}-fret window`,
      ).toBeLessThanOrEqual(span);
    }
  });

  it('is one movable shape — identical fret offsets from all 12 roots', () => {
    // The property that makes a position worth naming. If C major position 1
    // and G major position 1 were different pictures, "position 1" would not
    // mean anything a player could carry between keys.
    for (const quality of SUPPORTED) {
      for (const position of arpeggioPositions(quality)) {
        const shapes = new Set<string>();
        for (const root of PITCH_CLASSES) {
          const dots = realizeArpeggio(root, quality, position);
          const lowest = Math.min(...dots.map((d) => d.fret));
          shapes.add(
            dots
              .map((d) => `${d.string}:${d.fret - lowest}:${d.degree}`)
              .sort()
              .join(','),
          );
        }
        expect(
          shapes.size,
          `${quality} position ${position} is not one shape — ${shapes.size} variants across the 12 roots`,
        ).toBe(1);
      }
    }
  });

  it('returns the dots in ascending pitch, the order you would play them', () => {
    for (const { root, quality, position } of everyAcceptedCombination()) {
      const midis = realizeArpeggio(root, quality, position).map(
        (d) => TUNING[d.string] + d.fret,
      );
      for (let i = 1; i < midis.length; i += 1) {
        expect(midis[i], `${describeCombo(root, quality, position)} is out of pitch order`).toBeGreaterThanOrEqual(
          midis[i - 1],
        );
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  The refusal: unsupported combinations return nothing, not something        */
/* -------------------------------------------------------------------------- */

describe('unsupported combinations return empty rather than a plausible shape', () => {
  it('refuses qualities with more tones than an arpeggio shape can show', () => {
    // 9ths and up light a 4-fret window so densely the picture stops being an
    // arpeggio and starts being a scale box. Refusing beats drawing that.
    expect(UNSUPPORTED).toEqual([
      '9', 'maj9', 'm9', '11', 'm11', '13', 'm13', '7b9', '7#9', 'alt',
    ]);

    for (const quality of UNSUPPORTED) {
      expect(getChordPitchClasses('C', quality).length).toBeGreaterThan(MAX_ARPEGGIO_TONES);
      expect(supportsArpeggio(quality)).toBe(false);
      expect(arpeggioPositions(quality)).toEqual([]);
      for (const position of ALL_POSITIONS) {
        for (const root of PITCH_CLASSES) {
          expect(
            realizeArpeggio(root, quality, position),
            `${describeCombo(root, quality, position)} should have been refused`,
          ).toEqual([]);
        }
      }
    }
  });

  it('refuses a position no source claims, for every supported quality', () => {
    const illegal = [0, 6, 7, -1, 1.5, NaN, 'all', '3nps'] as unknown as ArpeggioPosition[];
    for (const quality of SUPPORTED) {
      for (const position of illegal) {
        expect(
          realizeArpeggio('C', quality, position),
          `C${quality} position ${String(position)} should have been refused`,
        ).toEqual([]);
      }
    }
  });

  it('refuses a root that is not a pitch class', () => {
    const notRoots = ['H', 'Cb', 'c', 'Bb', '', 'C#4'] as unknown as PitchClass[];
    for (const root of notRoots) {
      expect(realizeArpeggio(root, 'maj', 1)).toEqual([]);
    }
  });

  it('names the legal values a caller should offer instead', () => {
    // What a validator quotes back. It has to be a real list, not a promise
    // that one exists.
    expect(arpeggioPositions('maj')).toEqual([1, 2, 3, 4, 5, '2oct']);
    expect(arpeggioPositions('13')).toEqual([]);
    for (const position of arpeggioPositions('maj')) {
      expect(realizeArpeggio('C', 'maj', position).length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Degree labels — computed, and the ones a player expects                    */
/* -------------------------------------------------------------------------- */

describe('degree labels', () => {
  // Every supported quality, rooted on C. These are the labels a reader sees
  // on the dot, so they are pinned by hand rather than derived — a label that
  // silently became '13' where a guitarist reads '6' is a regression even
  // though the pitch is right.
  const EXPECTED: Record<string, Record<string, string>> = {
    '5': { C: 'R', G: '5' },
    maj: { C: 'R', E: '3', G: '5' },
    min: { C: 'R', 'D#': 'b3', G: '5' },
    dim: { C: 'R', 'D#': 'b3', 'F#': 'b5' },
    aug: { C: 'R', E: '3', 'G#': '#5' },
    sus2: { C: 'R', D: '2', G: '5' },
    sus4: { C: 'R', F: '4', G: '5' },
    '6': { C: 'R', E: '3', G: '5', A: '6' },
    m6: { C: 'R', 'D#': 'b3', G: '5', A: '6' },
    maj7: { C: 'R', E: '3', G: '5', B: '7' },
    min7: { C: 'R', 'D#': 'b3', G: '5', 'A#': 'b7' },
    dom7: { C: 'R', E: '3', G: '5', 'A#': 'b7' },
    m7b5: { C: 'R', 'D#': 'b3', 'F#': 'b5', 'A#': 'b7' },
    dim7: { C: 'R', 'D#': 'b3', 'F#': 'b5', A: 'bb7' },
    mMaj7: { C: 'R', 'D#': 'b3', G: '5', B: '7' },
    '7sus4': { C: 'R', F: '4', G: '5', 'A#': 'b7' },
    add9: { C: 'R', D: '9', E: '3', G: '5' },
    madd9: { C: 'R', D: '9', 'D#': 'b3', G: '5' },
    '7b5': { C: 'R', E: '3', 'F#': 'b5', 'A#': 'b7' },
    '7#5': { C: 'R', E: '3', 'G#': '#5', 'A#': 'b7' },
  };

  it('covers every supported quality', () => {
    // Iterating EXPECTED below rather than SUPPORTED keeps a new quality from
    // silently going unlabelled-checked; this is the test that notices.
    expect(Object.keys(EXPECTED).sort()).toEqual([...SUPPORTED].sort());
  });

  for (const [quality, expected] of Object.entries(EXPECTED)) {
    it(`C${quality} labels its tones ${Object.values(expected).join(' ')}`, () => {
      const seen: Record<string, string> = {};
      for (const position of arpeggioPositions(quality as ChordQuality)) {
        for (const dot of realizeArpeggio('C', quality as ChordQuality, position)) {
          seen[dot.pc] = dot.degree;
        }
      }
      expect(seen).toEqual(expected);
    });
  }

  it('labels transpose with the root rather than staying stuck on C', () => {
    const eMajor = realizeArpeggio('E', 'maj', 1);
    expect(new Set(eMajor.filter((d) => d.degree === 'R').map((d) => d.pc))).toEqual(new Set(['E']));
    expect(new Set(eMajor.filter((d) => d.degree === '3').map((d) => d.pc))).toEqual(new Set(['G#']));
    expect(new Set(eMajor.filter((d) => d.degree === '5').map((d) => d.pc))).toEqual(new Set(['B']));
  });
});

/* -------------------------------------------------------------------------- */
/*  Known shapes — the guitarist's eye test, pinned                            */
/* -------------------------------------------------------------------------- */

describe('the shapes are the ones a guitarist would draw', () => {
  const asKeys = (root: PitchClass, quality: ChordQuality, position: ArpeggioPosition) =>
    realizeArpeggio(root, quality, position)
      .map((d) => `${d.string}-${d.fret}-${d.degree}`)
      .sort();

  it('C major position 1 is the E-shape arpeggio at the 8th fret', () => {
    // Root on the 6th string at fret 8, the barre shape plus the 3rd below it.
    expect(asKeys('C', 'maj', 1)).toEqual(
      [
        '5-8-R', // low E, C
        '4-7-3', // A, E
        '4-10-5', // A, G
        '3-10-R', // D, C
        '2-9-3', // G, E
        '1-8-5', // B, G
        '0-8-R', // high e, C
      ].sort(),
    );
  });

  it('C major position 4 is the A-shape arpeggio at the 3rd fret', () => {
    expect(asKeys('C', 'maj', 4)).toEqual(
      [
        '5-3-5', // low E, G
        '4-3-R', // A, C  ← root on the 5th string, which is what makes it the A shape
        '3-2-3', // D, E
        '3-5-5', // D, G
        '2-5-R', // G, C
        '1-5-3', // B, E
        '0-3-5', // high e, G
      ].sort(),
    );
  });

  it('A minor position 1 is the Am barre shape at the 5th fret', () => {
    expect(asKeys('A', 'min', 1)).toEqual(
      [
        '5-5-R', // low E, A
        '4-7-5', // A, E
        '3-7-R', // D, A
        '2-5-b3', // G, C
        '1-5-5', // B, E
        '0-5-R', // high e, A
      ].sort(),
    );
  });

  it('G7 position 1 puts the b7 on the 4th string, where the E-shape dom7 has it', () => {
    const g7 = realizeArpeggio('G', 'dom7', 1);
    expect(g7.filter((d) => d.degree === 'b7').map((d) => `${d.string}-${d.fret}`)).toEqual(['3-3']);
    expect(g7.filter((d) => d.root).map((d) => `${d.string}-${d.fret}`)).toEqual(['5-3', '3-5', '0-3']);
  });

  it('names the positions after the CAGED shape they sit in', () => {
    expect(arpeggioShapeName(1)).toBe('E-shape');
    expect(arpeggioShapeName(2)).toBe('D-shape');
    expect(arpeggioShapeName(3)).toBe('C-shape');
    expect(arpeggioShapeName(4)).toBe('A-shape');
    expect(arpeggioShapeName(5)).toBe('G-shape');
    expect(arpeggioShapeName('2oct')).toBe('2 octaves');
  });
});

/* -------------------------------------------------------------------------- */
/*  The extension point                                                        */
/* -------------------------------------------------------------------------- */

describe('the shape-source registry', () => {
  // These hold for whatever is in the registry, so a drop-2 or sweep-shape
  // source added later is covered the day it lands rather than the day
  // someone remembers to widen a test.

  it('every source only claims positions the public API also offers', () => {
    for (const source of ARPEGGIO_SHAPE_SOURCES) {
      for (const quality of CHORD_QUALITIES) {
        for (const position of source.positions(quality)) {
          expect(
            arpeggioPositions(quality),
            `source "${source.id}" claims ${quality} position ${position} but the API does not offer it`,
          ).toContain(position);
        }
      }
    }
  });

  it('every source draws only chord tones, on the board, for everything it claims', () => {
    for (const source of ARPEGGIO_SHAPE_SOURCES) {
      for (const quality of CHORD_QUALITIES) {
        for (const position of source.positions(quality)) {
          for (const root of PITCH_CLASSES) {
            const raw = source.realize(root, quality, position);
            expect(raw.length, `source "${source.id}" drew nothing for ${describeCombo(root, quality, position)}`).toBeGreaterThan(0);
            const tones = getChordPitchClasses(root, quality);
            for (const p of raw) {
              expect(p.string).toBeGreaterThanOrEqual(0);
              expect(p.string).toBeLessThan(TUNING.length);
              expect(p.fret).toBeGreaterThanOrEqual(0);
              expect(p.fret).toBeLessThanOrEqual(MAX_FRET);
              expect(
                tones,
                `source "${source.id}" put a non-chord tone in ${describeCombo(root, quality, position)}`,
              ).toContain(pcAt(p.string, p.fret));
            }
          }
        }
      }
    }
  });

  it('offers a position exactly when some source claims it', () => {
    for (const quality of CHORD_QUALITIES) {
      const claimed = new Set(
        ARPEGGIO_SHAPE_SOURCES.flatMap((s) => s.positions(quality)),
      );
      expect(new Set(arpeggioPositions(quality))).toEqual(claimed);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Reuse, not a second copy of the box data                                   */
/* -------------------------------------------------------------------------- */

describe('positions come from the scale-box machinery, not a parallel table', () => {
  it('uses the CAGED windows positions.ts derives from its own verified shapes', () => {
    for (const position of [1, 2, 3, 4, 5] as const) {
      expect(arpeggioWindow(position)).toEqual(CAGED_POSITION_WINDOWS[position]);
    }
    expect(arpeggioWindow('2oct')).toEqual(TWO_OCTAVE_BOX);
    expect(arpeggioWindow(9 as unknown as ArpeggioPosition)).toBeNull();
  });

  it('windows are the fret span of the CAGED boxes, root-relative', () => {
    // Pinned so a future edit to the windows is a deliberate act. Box 5
    // reaching back to -4 is the G-shape's stretch on the G string, and it is
    // part of the hand position, not a typo.
    expect(CAGED_POSITION_WINDOWS).toEqual({
      1: { lo: -1, hi: 2 },
      2: { lo: 2, hi: 6 },
      3: { lo: 4, hi: 7 },
      4: { lo: -6, hi: -2 },
      5: { lo: -4, hi: 0 },
    });
  });
});
