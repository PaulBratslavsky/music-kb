// @vitest-environment jsdom
//
// The bug this pins: the mini keyboard used to light PITCH CLASSES, so Gm
// and Gm/D — which share a pitch-class set and differ only in which note is
// in the bass — drew the byte-identical picture. A slash chord was
// invisible on the card that was supposed to show it.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ChordMini } from '#/components/ChordMini';
import { midiFromPitchOctave } from '@music-kb/music/theory/notes';

afterEach(cleanup);

const G = midiFromPitchOctave('G', 4);
const Bb = midiFromPitchOctave('A#', 4);
const D5 = midiFromPitchOctave('D', 5);
const D4 = midiFromPitchOctave('D', 4);

/** The <svg> the piano card draws, as markup. */
function piano(chord: Parameters<typeof ChordMini>[0]['chord']) {
  const { container } = render(<ChordMini chord={chord} instrument="piano" />);
  const svg = container.querySelector('svg');
  expect(svg).not.toBeNull();
  return svg!;
}

const gm = { root: 'G', quality: 'min', inversion: 0, voicingIndex: 0 } as const;

describe('ChordMini piano card — inversions', () => {
  it('draws Gm and Gm/D differently', () => {
    const root = piano({ ...gm, midis: [G, Bb, D5] }).outerHTML;
    const slash = piano({ ...gm, midis: [D4, G, Bb] }).outerHTML;
    expect(root).not.toEqual(slash);
  });

  it('names the bass in the accessible label, and it is the lowest note', () => {
    expect(piano({ ...gm, midis: [D4, G, Bb] }).getAttribute('aria-label')).toBe(
      'Chord keys, bass D',
    );
    expect(piano({ ...gm, midis: [G, Bb, D5] }).getAttribute('aria-label')).toBe(
      'Chord keys, bass G',
    );
  });

  it('derives the bass from the stored inversion when no midis were captured', () => {
    // Every chord saved before `midis` existed takes this path. `inversion`
    // is coarser than a real voicing but still says which tone is on the
    // bottom, which is all the card needs to stop drawing root position.
    expect(piano({ ...gm, inversion: 2 }).getAttribute('aria-label')).toBe(
      'Chord keys, bass D',
    );
    expect(piano({ ...gm, inversion: 0 }).getAttribute('aria-label')).toBe(
      'Chord keys, bass G',
    );
  });

  it('draws two octaves whether or not the voicing needs them', () => {
    // Key count is the readable proxy for octaves drawn: 12 keys per octave.
    //
    // This used to fit the board to the voicing, so a closed triad drew one
    // octave and anything crossing a C drew two. Both are rendered at the
    // same fixed width, so the two cases came out at different key sizes and
    // a progression strip looked like it mixed two different diagrams. The
    // floor is 2 now: consistent, and the room an inversion needs to put its
    // bass below the rest.
    const keys = (svg: SVGElement) => svg.querySelectorAll('rect').length;
    // A closed C triad — fits in one octave, still drawn across two.
    expect(keys(piano({ root: 'C', quality: 'maj', inversion: 0, voicingIndex: 0 }))).toBe(24);
    // G4-A#4-D5 straddles C5, so it needed two octaves either way.
    expect(keys(piano({ ...gm, midis: [G, Bb, D5] }))).toBe(24);
  });

  it('still grows past two octaves for a voicing that spans further', () => {
    // The floor is a minimum, not a cap — a spread wide enough to cross two
    // Cs has to keep every note on the board.
    const keys = (svg: SVGElement) => svg.querySelectorAll('rect').length;
    const D6 = midiFromPitchOctave('D', 6);
    expect(keys(piano({ ...gm, midis: [G, Bb, D6] }))).toBe(36);
  });
});
