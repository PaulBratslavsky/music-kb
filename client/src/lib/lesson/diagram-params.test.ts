// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import { MiniNeck, type NeckDot } from '#/components/lesson/MiniNeck';
import {
  isOnNeck,
  resolveDiagramDots,
  resolveDiagramMarks,
  resolveNeckWindow,
  visibleNeckDots,
  widenNeckWindow,
  NECK_MAX_FRET,
  type DiagramBlock,
  type KeyboardDiagramBlock,
  type NeckInstrument,
} from './diagram-params';

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
