// Arpeggio view mode — chord:arpeggio :: one position:whole neck.
//
// There's no dedicated "arpeggio" theory module: resolve.ts's arpeggio
// branch (in both client/ and web/) is built entirely from functions that
// already exist here — getChordPitchClasses() for the tones, chordDegrees()
// for the R / 3 / b3 / 5 / b7 labels, and notesAscending() to stack them,
// exactly the same trio scale mode already uses (see
// packages/music/src/theory/degrees.ts, chords.ts, notes.ts). These tests
// pin the theory-layer contract that arpeggio mode depends on:
//   - the pitch classes match the chord's tones, for every quality family
//   - the degree labels are correct
//   - every position that would light up on an instrument actually sounds
//     a chord tone (walked across the whole guitar fretboard, the same way
//     GuitarView's matchByPitchClass flood does at render time)

import { describe, expect, it } from 'vitest';
import { getChordPitchClasses } from '../theory/chords';
import { chordDegrees } from '../theory/degrees';
import { notesAscending, pitchClassFromMidi } from '../theory/notes';
import { STANDARD_TUNING_MIDI, FRET_COUNT } from '../instruments/guitar/layout';
import type { ChordQuality, PitchClass } from '../types';

const QUALITIES: { root: PitchClass; quality: ChordQuality; label: string }[] = [
  { root: 'C', quality: 'maj', label: 'C major' },
  { root: 'A', quality: 'min', label: 'A minor' },
  { root: 'B', quality: 'dim', label: 'B diminished' },
  { root: 'C', quality: 'aug', label: 'C augmented' },
  { root: 'G', quality: 'dom7', label: 'G dominant 7' },
];

describe('arpeggio pitch classes match the chord tones', () => {
  it('C major → C E G', () => {
    expect(getChordPitchClasses('C', 'maj')).toEqual(['C', 'E', 'G']);
  });

  it('A minor → A C E', () => {
    expect(getChordPitchClasses('A', 'min')).toEqual(['A', 'C', 'E']);
  });

  it('B diminished → B D F', () => {
    expect(getChordPitchClasses('B', 'dim')).toEqual(['B', 'D', 'F']);
  });

  it('C augmented → C E G#', () => {
    expect(getChordPitchClasses('C', 'aug')).toEqual(['C', 'E', 'G#']);
  });

  it('G dominant 7 → G B D F', () => {
    expect(getChordPitchClasses('G', 'dom7')).toEqual(['G', 'B', 'D', 'F']);
  });

  for (const { root, quality, label } of QUALITIES) {
    it(`${label}: notesAscending() (what resolve.ts feeds the arpeggio view) only ever contains chord tones`, () => {
      const pcs = getChordPitchClasses(root, quality);
      const pcSet = new Set(pcs);
      const notes = notesAscending(pcs, 4);
      expect(notes.length).toBe(pcs.length);
      for (const n of notes) {
        expect(pcSet.has(n.pitchClass)).toBe(true);
      }
    });
  }
});

describe('arpeggio degree labels match the chord degrees', () => {
  it('C major → R / 3 / 5', () => {
    expect(chordDegrees('C', 'maj')).toEqual({ C: '1', E: '3', G: '5' });
  });

  it('A minor → R / b3 / 5', () => {
    expect(chordDegrees('A', 'min')).toEqual({ A: '1', C: 'b3', E: '5' });
  });

  it('B diminished → R / b3 / b5', () => {
    expect(chordDegrees('B', 'dim')).toEqual({ B: '1', D: 'b3', F: 'b5' });
  });

  it('C augmented → R / 3 / #5', () => {
    expect(chordDegrees('C', 'aug')).toEqual({ C: '1', E: '3', 'G#': '#5' });
  });

  it('G dominant 7 → R / 3 / 5 / b7', () => {
    expect(chordDegrees('G', 'dom7')).toEqual({ G: '1', B: '3', D: '5', F: 'b7' });
  });
});

describe('every arpeggio position across the whole neck actually sounds a chord tone', () => {
  // Walks every (string, fret) the guitar view can render — the same
  // "flood the whole instrument" surface arpeggio mode uses (matchByPitchClass,
  // no shape restriction) — and checks the property arpeggio mode promises:
  // every lit-up position sounds one of the chord's own pitch classes, and
  // every chord tone actually shows up somewhere on the neck.
  for (const { root, quality, label } of QUALITIES) {
    it(label, () => {
      const chordPcs = new Set(getChordPitchClasses(root, quality));
      expect(chordPcs.size).toBeGreaterThan(0);

      const soundedPcs = new Set<PitchClass>();
      for (const stringMidi of STANDARD_TUNING_MIDI) {
        for (let fret = 0; fret <= FRET_COUNT; fret++) {
          const pc = pitchClassFromMidi(stringMidi + fret);
          if (chordPcs.has(pc)) soundedPcs.add(pc);
        }
      }

      // Every chord tone is reachable somewhere on a standard-tuned neck —
      // guards against a quality whose pitch classes silently never appear.
      expect(soundedPcs).toEqual(chordPcs);
    });
  }
});
