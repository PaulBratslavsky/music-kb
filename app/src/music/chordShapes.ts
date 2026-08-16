// Chord selection → chord-box diagram props.
//
// guitarVoicing gives us the exact fretted positions for a voicing; this
// turns that into the per-string states ChordDiagram renders. A string
// absent from the voicing is muted, fret 0 is open, anything else is a
// fretted dot — accented when its pitch class is the chord root.

import { guitarVoicing } from '../theory/voicings/guitar';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { pitchClassFromMidi } from '../theory/notes';
import { getChordPitchClasses } from '../theory/chords';
import { QUALITY_LABELS } from '../theory/quality-labels';
import type { ChordQuality, ChordSelection, PitchClass } from '../types';
import type { ChordDiagramProps } from './ChordDiagram';
import type { ProgressionChord } from './types';

const STRING_COUNT = 6;

/** "C" / "Am" / "Cmaj7" — root glued to the short quality label. */
export function chordLabel(c: { root: PitchClass; quality: ChordQuality }): string {
  const suffix = QUALITY_LABELS[c.quality] ?? c.quality;
  return `${c.root}${suffix === 'maj' ? '' : suffix}`;
}

export function toSelection(c: ProgressionChord): ChordSelection {
  return {
    root: c.root,
    quality: c.quality,
    inversion: c.inversion ?? 0,
    voicingIndex: c.voicingIndex ?? 0,
  };
}

/**
 * Diagram props for a chord, or null when the quality has no defined
 * fingering (the exotic extensions fall back to a pitch-class flood, which
 * is not a shape anyone can play off a box).
 */
export function chordDiagramProps(
  chord: ProgressionChord,
): ChordDiagramProps | null {
  const selection = toSelection(chord);
  const voicing = guitarVoicing(selection);
  if (!voicing.positions || voicing.positions.size === 0) return null;

  const fretByString = new Map<number, number>();
  for (const key of voicing.positions) {
    const [s, f] = key.split('-').map(Number);
    fretByString.set(s, f);
  }

  const rootPcs = getChordPitchClasses(selection.root, selection.quality);
  const root = rootPcs[0];

  const strings: ChordDiagramProps['strings'] = Array.from(
    { length: STRING_COUNT },
    (_, s) => {
      const fret = fretByString.get(s);
      if (fret === undefined) return { kind: 'muted' as const };
      if (fret === 0) return { kind: 'open' as const };
      const pc = pitchClassFromMidi(STANDARD_TUNING_MIDI[s] + fret);
      return { kind: 'fretted' as const, fret, isRoot: pc === root };
    },
  );

  const frets = [...fretByString.values()].filter((f) => f > 0);
  const span = frets.length ? Math.max(...frets) - Math.min(...frets) + 1 : 5;

  return {
    strings,
    barre: voicing.barre ?? undefined,
    fretCount: Math.max(5, span),
  };
}
