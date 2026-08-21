import { describe, it, expect } from 'vitest';
import {
  resolveDiagramDots,
  resolveDiagramMarks,
  type DiagramBlock,
  type KeyboardDiagramBlock,
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
