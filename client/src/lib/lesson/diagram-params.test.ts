import { describe, it, expect } from 'vitest';
import { resolveDiagramDots, type DiagramBlock } from './diagram-params';

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
});
