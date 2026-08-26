// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import { MiniNeck, type NeckDot } from '#/components/lesson/MiniNeck';
import {
  diagramShapeName,
  irrelevantTheoryFields,
  isOnNeck,
  resolveDiagramDots,
  resolveDiagramMarks,
  resolveNeckWindow,
  validateTheoryDiagram,
  visibleNeckDots,
  widenNeckWindow,
  DIAGRAM_QUALITIES,
  NECK_MAX_FRET,
  type DiagramBlock,
  type KeyboardDiagramBlock,
  type NeckInstrument,
} from './diagram-params';
import { getChordPitchClasses } from '@music-kb/music/theory/chords';
import { getScalePitchClasses } from '@music-kb/music/theory/scales';
import { pitchClassAt } from '@music-kb/music/instruments/neck';
import { PITCH_CLASSES, SCALE_TYPES, type PitchClass } from '@music-kb/music/types';

describe('resolveDiagramDots', () => {
  it('returns explicit dots unchanged in explicit mode', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'explicit',
      dots: [{ string: 0, fret: 3, label: 'G', root: true }],
    };
    expect(resolveDiagramDots(block)).toEqual([
      { string: 0, fret: 3, label: 'G', root: true },
    ]);
  });

  it('computes dots from theory parameters in theory mode', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'theory',
      root: 'C',
      quality: 'major',
      stringSet: 'e–B–G',
      inversion: 0,
    };
    const dots = resolveDiagramDots(block);
    expect(dots.length).toBeGreaterThan(0);
    // A triad has exactly one root dot.
    expect(dots.filter((d) => d.root)).toHaveLength(1);
  });

  it('prefers the lesson parameter over the block root when useParam is set', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'theory',
      root: 'C',
      quality: 'major',
      stringSet: 'e–B–G',
      inversion: 0,
      useParam: true,
    };
    const inC = resolveDiagramDots(block, 'C');
    const inD = resolveDiagramDots(block, 'D');
    // Same shape, different position — the whole point of the parameter.
    expect(inD).not.toEqual(inC);
  });

  it('returns an empty array rather than throwing on an unresolvable shape', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'theory',
      root: 'C',
      quality: 'major',
      stringSet: 'not-a-real-set',
      inversion: 0,
    };
    expect(resolveDiagramDots(block)).toEqual([]);
  });

  it('returns an empty array for a root outside PITCH_CLASSES', () => {
    const block: DiagramBlock = {
      instrument: 'guitar',
      mode: 'theory',
      root: 'H',
      quality: 'major',
      stringSet: 'e–B–G',
      inversion: 0,
    };
    expect(resolveDiagramDots(block)).toEqual([]);
  });
});

// =============================================================================
// Theory intents — the author says WHAT, the theory layer decides WHERE
// =============================================================================

const theory = (extra: Partial<DiagramBlock>): DiagramBlock => ({
  instrument: 'guitar',
  mode: 'theory',
  ...extra,
});

/** The pitch class MiniNeck will actually sound at this dot. */
const pcOf = (dot: { string: number; fret: number }) =>
  pitchClassAt(dot.string, dot.fret, 'guitar');

describe('theory intents realize dots from the theory layer', () => {
  it('intent="scale" draws a CAGED box made only of that scale’s notes', () => {
    const dots = resolveDiagramDots(
      theory({ intent: 'scale', root: 'G', scaleType: 'major', position: '2' }),
    );
    const pcs = getScalePitchClasses({ root: 'G', type: 'major' });
    expect(dots.length).toBeGreaterThan(5);
    for (const dot of dots) expect(pcs).toContain(pcOf(dot));
    // ...and its roots are labelled as roots, not as "1".
    expect(dots.filter((d) => d.root).every((d) => d.label === 'R')).toBe(true);
    expect(dots.some((d) => d.root)).toBe(true);
  });

  it('intent="arpeggio" draws only chord tones, labelled by what they do in the chord', () => {
    const dots = resolveDiagramDots(
      theory({ intent: 'arpeggio', root: 'A', quality: 'min7', position: '1' }),
    );
    const tones = getChordPitchClasses('A', 'min7');
    expect(dots.length).toBeGreaterThan(3);
    for (const dot of dots) expect(tones).toContain(pcOf(dot));
    // R / b3 / 5 / b7 — the degree map of a minor 7th, nothing invented.
    expect(new Set(dots.map((d) => d.label))).toEqual(new Set(['R', 'b3', '5', 'b7']));
  });

  it('intent="pattern" draws three notes on every string', () => {
    const dots = resolveDiagramDots(
      theory({ intent: 'pattern', root: 'E', scaleType: 'minor', patternIndex: 1 }),
    );
    const pcs = getScalePitchClasses({ root: 'E', type: 'minor' });
    expect(dots).toHaveLength(18);
    for (const dot of dots) expect(pcs).toContain(pcOf(dot));
    for (let s = 0; s < 6; s += 1) {
      expect(dots.filter((d) => d.string === s), `string ${s}`).toHaveLength(3);
    }
  });

  it('a block with no intent is still the triad it always was', () => {
    const withIntent = resolveDiagramDots(
      theory({ intent: 'chord', root: 'C', quality: 'major', stringSet: 'e–B–G' }),
    );
    const without = resolveDiagramDots(
      theory({ root: 'C', quality: 'major', stringSet: 'e–B–G' }),
    );
    expect(without).toEqual(withIntent);
    expect(without).toHaveLength(3);
  });

  it('the short quality spellings mean the same thing as the long ones', () => {
    expect(resolveDiagramDots(theory({ root: 'C', quality: 'maj', stringSet: 'e–B–G' }))).toEqual(
      resolveDiagramDots(theory({ root: 'C', quality: 'major', stringSet: 'e–B–G' })),
    );
  });

  it('useParam re-realizes the shape in the reader’s key, for every intent', () => {
    const block = theory({ intent: 'scale', root: 'C', scaleType: 'minorPentatonic', position: '1', useParam: true });
    const inC = resolveDiagramDots(block, 'C');
    const inF = resolveDiagramDots(block, 'F');
    expect(inF).not.toEqual(inC);
    for (const dot of inF) {
      expect(getScalePitchClasses({ root: 'F', type: 'minorPentatonic' })).toContain(pcOf(dot));
    }
  });

  // The claim the whole change rests on: what the theory layer says exists
  // is what draws, everywhere, in every key.
  it('every quality the schema offers realizes an arpeggio from every root', () => {
    for (const quality of DIAGRAM_QUALITIES) {
      for (const root of PITCH_CLASSES) {
        const dots = resolveDiagramDots(theory({ intent: 'arpeggio', root, quality, position: '1' }));
        expect(dots.length, `${root} ${quality}`).toBeGreaterThan(0);
        expect(dots.some((d) => d.root), `${root} ${quality} has no root dot`).toBe(true);
      }
    }
  });

  it('every scale type realizes its two-octave window from every root', () => {
    for (const scaleType of SCALE_TYPES) {
      for (const root of PITCH_CLASSES) {
        const dots = resolveDiagramDots(theory({ intent: 'scale', root, scaleType, position: '2oct' }));
        expect(dots.length, `${root} ${scaleType}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('validateTheoryDiagram refuses a COMBINATION by name', () => {
  it('names the boxes a scale actually has', () => {
    const problem = validateTheoryDiagram(
      theory({ intent: 'scale', root: 'C', scaleType: 'majorPentatonic', position: '2' }),
    );
    expect(problem?.field).toBe('position');
    // The legal set, quoted — not "the diagram came out empty".
    expect(problem?.message).toContain('1, 5, 2oct');
  });

  it('says a mode has no numbered box rather than letting one render blank', () => {
    const problem = validateTheoryDiagram(
      theory({ intent: 'scale', root: 'D', scaleType: 'dorian', position: '3' }),
    );
    expect(problem?.field).toBe('position');
    expect(problem?.message).toContain('2oct');
    expect(problem?.message).toContain('no numbered CAGED boxes');
  });

  it('refuses a chord quality the triad voicer cannot voice, and points at the arpeggio intent', () => {
    const problem = validateTheoryDiagram(
      theory({ intent: 'chord', root: 'C', quality: 'maj7', stringSet: 'e–B–G' }),
    );
    expect(problem?.field).toBe('quality');
    expect(problem?.message).toContain('intent="arpeggio"');
  });

  it('refuses a quality with more than four tones as an arpeggio, saying why', () => {
    const problem = validateTheoryDiagram(theory({ intent: 'arpeggio', root: 'C', quality: '13', position: '1' }));
    expect(problem?.field).toBe('quality');
    expect(problem?.message).toContain('maj7');
  });

  it('caps patternIndex at the number of notes the scale has, not a flat 7', () => {
    expect(
      validateTheoryDiagram(theory({ intent: 'pattern', root: 'A', scaleType: 'minorPentatonic', patternIndex: 6 }))
        ?.message,
    ).toContain('between 1 and 5');
    expect(
      validateTheoryDiagram(theory({ intent: 'pattern', root: 'A', scaleType: 'minorPentatonic', patternIndex: 5 })),
    ).toBeNull();
  });

  it('rejects an intent it does not have, naming the four', () => {
    const problem = validateTheoryDiagram(theory({ intent: 'tapping', root: 'C' }));
    expect(problem?.field).toBe('intent');
    expect(problem?.message).toContain('chord, scale, arpeggio, pattern');
  });

  // The invariant that keeps the parser and the renderer from disagreeing:
  // a refusal and an empty realization are the same event.
  it('a combination it accepts always realizes dots, and one it refuses never does', () => {
    const blocks: DiagramBlock[] = [];
    for (const scaleType of SCALE_TYPES) {
      for (const position of ['1', '2', '3', '4', '5', '2oct']) {
        blocks.push(theory({ intent: 'scale', root: 'C', scaleType, position }));
        blocks.push(theory({ intent: 'pattern', root: 'C', scaleType, patternIndex: Number(position === '2oct' ? 7 : position) }));
      }
    }
    for (const quality of [...DIAGRAM_QUALITIES, '13', 'alt']) {
      for (const position of ['1', '5', '2oct']) {
        blocks.push(theory({ intent: 'arpeggio', root: 'C', quality, position }));
      }
    }
    for (const block of blocks) {
      const accepted = validateTheoryDiagram(block) === null;
      const drew = resolveDiagramDots(block).length > 0;
      expect(drew, `${JSON.stringify(block)} — accepted=${accepted} drew=${drew}`).toBe(accepted);
    }
  });
});

describe('labels and names come from the realization', () => {
  it('every dot carries a computed degree, and its pitch class agrees with the label', () => {
    const dots = resolveDiagramDots(theory({ intent: 'arpeggio', root: 'C', quality: 'dom7', position: '2' }));
    const degrees: Record<string, PitchClass> = { R: 'C', '3': 'E', '5': 'G', b7: 'A#' };
    for (const dot of dots) {
      expect(dot.label, JSON.stringify(dot)).toBeTruthy();
      expect(degrees[dot.label as string], `label ${dot.label}`).toBe(pcOf(dot));
    }
  });

  it('names the shape from the same position the dots came from', () => {
    expect(diagramShapeName(theory({ intent: 'scale', root: 'C', scaleType: 'major', position: '1' }))).toBe('E-shape');
    expect(diagramShapeName(theory({ intent: 'scale', root: 'C', scaleType: 'blues', position: '3' }))).toBe('Box 3');
    expect(diagramShapeName(theory({ intent: 'arpeggio', root: 'C', quality: 'maj', position: '2oct' }))).toBe('2 octaves');
    expect(diagramShapeName(theory({ intent: 'pattern', root: 'C', scaleType: 'major', patternIndex: 3 }))).toBe('Pattern 3');
  });
});

describe('irrelevantTheoryFields', () => {
  it('names the fields an intent will not read', () => {
    expect(
      irrelevantTheoryFields(theory({ intent: 'scale', root: 'C', scaleType: 'major', position: '1', stringSet: 'e–B–G' })),
    ).toEqual(['stringSet']);
  });

  it('says nothing when every field set is one the intent uses', () => {
    expect(
      irrelevantTheoryFields(theory({ intent: 'chord', root: 'C', quality: 'major', stringSet: 'e–B–G', inversion: 1 })),
    ).toEqual([]);
  });
});

describe('resolveDiagramMarks', () => {
  it('returns explicit marks unchanged in explicit mode', () => {
    const block: KeyboardDiagramBlock = {
      mode: 'explicit',
      marks: [{ pc: 'G', label: 'G', root: true }],
    };
    expect(resolveDiagramMarks(block)).toEqual([
      { pc: 'G', label: 'G', root: true },
    ]);
  });

  it('preserves flag: true on explicit marks in explicit mode', () => {
    const block: KeyboardDiagramBlock = {
      mode: 'explicit',
      marks: [{ pc: 'E', label: 'E', flag: true }],
    };
    expect(resolveDiagramMarks(block)).toEqual([
      { pc: 'E', label: 'E', flag: true },
    ]);
  });

  it('computes marks from theory parameters with exactly one root', () => {
    const block: KeyboardDiagramBlock = {
      mode: 'theory',
      root: 'C',
      quality: 'major',
    };
    const marks = resolveDiagramMarks(block);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.filter((m) => m.root)).toHaveLength(1);
  });

  it('prefers the lesson parameter over the block root when useParam is set', () => {
    const block: KeyboardDiagramBlock = {
      mode: 'theory',
      root: 'C',
      quality: 'major',
      useParam: true,
    };
    const inC = resolveDiagramMarks(block, 'C');
    const inD = resolveDiagramMarks(block, 'D');
    expect(inD).not.toEqual(inC);
  });

  it('returns an empty array for a root outside PITCH_CLASSES', () => {
    const block: KeyboardDiagramBlock = {
      mode: 'theory',
      root: 'H',
      quality: 'major',
    };
    expect(resolveDiagramMarks(block)).toEqual([]);
  });
});

// =============================================================================
// The visibility mirror, checked against the renderer itself
// =============================================================================
//
// `resolveNeckWindow` / `visibleNeckDots` are a copy of MiniNeck's own
// `resolveWindow` and its `visible` filter, and a copy is a drift risk. So
// this suite does not assert against remembered numbers: it renders the REAL
// MiniNeck into jsdom, reads back the dots it actually drew, and asserts the
// mirror predicted exactly that set. Change the renderer's window logic
// without changing this module and these fail — which is the point, since
// the parser trusts the mirror to decide whether a diagram is worth keeping.

afterEach(cleanup);

/** The dots MiniNeck really drew, by label. Dot groups are the only ones
 *  with pointer-events="none"; inlays and strings are not. */
function drawnLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('g[pointer-events="none"]'))
    .map((g) => g.querySelector('text')?.textContent ?? '')
    .filter(Boolean)
    .sort();
}

function renderNeck(
  dots: NeckDot[],
  instrument: NeckInstrument,
  fromFret?: number,
  toFret?: number,
): HTMLElement {
  const { container } = render(
    createElement(MiniNeck, { instrument, dots, fromFret, toFret, ariaLabel: 'test' }),
  );
  return container;
}

/** Frets → dots, one per string, each labelled with its own fret number. */
function dotsAt(frets: number[]): NeckDot[] {
  return frets.map((fret, i) => ({ string: i, fret, label: `f${fret}` }));
}

describe('visibleNeckDots predicts what MiniNeck draws', () => {
  const cases: Array<{
    name: string;
    frets: number[];
    instrument: NeckInstrument;
    fromFret?: number;
    toFret?: number;
  }> = [
    { name: 'auto-fit around a mid-neck shape', frets: [7, 8, 9], instrument: 'guitar' },
    // The reported failure: a shape at 7–9 inside an explicit 0–5 window.
    {
      name: 'an explicit window that hides every dot',
      frets: [7, 8, 9],
      instrument: 'guitar',
      fromFret: 0,
      toFret: 5,
    },
    {
      name: 'an explicit window that hides one dot',
      frets: [8, 8, 9],
      instrument: 'guitar',
      fromFret: 3,
      toFret: 8,
    },
    {
      name: 'an explicit window that holds every dot',
      frets: [8, 8, 9],
      instrument: 'guitar',
      fromFret: 3,
      toFret: 10,
    },
    { name: 'an open string, which pins the window to the nut', frets: [0, 3, 5], instrument: 'guitar' },
    {
      name: 'a window wider than the board',
      frets: [21, 22, 23],
      instrument: 'guitar',
      fromFret: 0,
      toFret: 40,
    },
    { name: 'a fret past the end of the board, auto-fitted', frets: [3, 30], instrument: 'guitar' },
    {
      name: 'an inverted window',
      frets: [5, 6, 7],
      instrument: 'guitar',
      fromFret: 9,
      toFret: 2,
    },
    { name: 'a bass shape', frets: [3, 5, 7], instrument: 'bass', fromFret: 4, toFret: 9 },
  ];

  it.each(cases)('$name', ({ frets, instrument, fromFret, toFret }) => {
    const dots = dotsAt(frets);
    const predicted = visibleNeckDots(dots, instrument, fromFret, toFret)
      .map((d) => d.label as string)
      .sort();
    expect(drawnLabels(renderNeck(dots, instrument, fromFret, toFret))).toEqual(predicted);
  });

  it('agrees with the renderer that a clipped diagram is blank', () => {
    const dots = dotsAt([7, 8, 9]);
    expect(visibleNeckDots(dots, 'guitar', 0, 5)).toEqual([]);
    expect(drawnLabels(renderNeck(dots, 'guitar', 0, 5))).toEqual([]);
  });
});

describe('isOnNeck matches the geometry MiniNeck actually draws', () => {
  it('a string the instrument does not have is drawn outside the svg', () => {
    // MiniNeck does not bounds-check the string index, so the dot IS in the
    // DOM — below the viewBox, where it renders as nothing at all. That is
    // why isOnNeck is a separate predicate from the fret window.
    const dot: NeckDot = { string: 5, fret: 5, label: 'ghost' };
    expect(isOnNeck(dot, 'bass')).toBe(false);
    const container = renderNeck([dot], 'bass');
    expect(drawnLabels(container)).toEqual(['ghost']); // present in the markup…
    const svg = container.querySelector('svg')!;
    const height = Number(svg.getAttribute('viewBox')!.split(' ')[3]);
    const cy = Number(container.querySelector('g[pointer-events="none"] circle')!.getAttribute('cy'));
    expect(cy).toBeGreaterThan(height); // …and off the bottom of it.
  });

  it('accepts every position the board has and nothing beyond', () => {
    expect(isOnNeck({ string: 3, fret: 20 }, 'bass')).toBe(true);
    expect(isOnNeck({ string: 4, fret: 20 }, 'bass')).toBe(false);
    expect(isOnNeck({ string: 5, fret: NECK_MAX_FRET.guitar }, 'guitar')).toBe(true);
    expect(isOnNeck({ string: 5, fret: NECK_MAX_FRET.guitar + 1 }, 'guitar')).toBe(false);
    expect(isOnNeck({ string: -1, fret: 3 }, 'guitar')).toBe(false);
    expect(isOnNeck({ string: 0, fret: -1 }, 'guitar')).toBe(false);
  });
});

describe('widenNeckWindow', () => {
  it('grows a window until every dot is inside it, keeping the author’s framing', () => {
    const dots = dotsAt([12, 15]);
    const widened = widenNeckWindow(dots, 'guitar', 0, 5);
    expect(widened).toEqual({ fromFret: 0, toFret: 16 });
    expect(visibleNeckDots(dots, 'guitar', widened.fromFret, widened.toFret)).toHaveLength(2);
  });

  it('pads one fret in, so a dot never lands in the open-string gutter', () => {
    // MiniNeck draws fret `lo` half a fret LEFT of the nut line, so a window
    // starting exactly on the lowest dot puts that dot off the board.
    const widened = widenNeckWindow(dotsAt([9, 11]), 'guitar', 12, 14);
    expect(widened.fromFret).toBe(8);
  });

  it('pins to the nut for an open string and never runs past the last fret', () => {
    expect(widenNeckWindow(dotsAt([0, 3]), 'guitar', 5, 7)).toEqual({ fromFret: 0, toFret: 7 });
    expect(widenNeckWindow(dotsAt([22]), 'guitar', 0, 3)).toEqual({ fromFret: 0, toFret: 22 });
  });
});

describe('resolveNeckWindow', () => {
  it('lets an explicit window win over the dots, exactly as the renderer does', () => {
    expect(resolveNeckWindow(dotsAt([7, 8, 9]), 'guitar', 0, 5)).toEqual({ lo: 0, hi: 5 });
  });

  it('widens an auto-fitted window to the minimum span, upward first', () => {
    // 6–9 is a three-fret sliver; the renderer grows `hi` before `lo`.
    expect(resolveNeckWindow(dotsAt([7, 8]), 'guitar')).toEqual({ lo: 6, hi: 11 });
  });

  it('clamps to the end of the board', () => {
    expect(resolveNeckWindow([], 'bass', 0, 99)).toEqual({ lo: 0, hi: NECK_MAX_FRET.bass });
  });
});
