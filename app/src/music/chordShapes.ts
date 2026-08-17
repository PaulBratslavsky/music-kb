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

/**
 * "C" / "Am" / "Cmaj7" — root glued to the short quality label. A
 * detect-captured chord shows tonal's own name (e.g. "Cmaj7/E"), since
 * root + quality can't express a slash chord.
 */
export function chordLabel(c: {
  root: PitchClass;
  quality: ChordQuality;
  detectedLabel?: string;
}): string {
  if (c.detectedLabel) return c.detectedLabel;
  const suffix = QUALITY_LABELS[c.quality] ?? c.quality;
  return `${c.root}${suffix === 'maj' ? '' : suffix}`;
}

/** Parse `${string}-${fret}` keys into a string → fret map. */
function fretMapFrom(positions: string[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const key of positions) {
    const [s, f] = key.split('-').map(Number);
    m.set(s, f);
  }
  return m;
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

  // A detect-captured chord pins the exact shape the user fretted; only
  // fall back to a generated voicing when there is none.
  let fretByString: Map<number, number>;
  let barre: ChordDiagramProps['barre'];
  if (chord.positions && chord.positions.length > 0) {
    fretByString = fretMapFrom(chord.positions);
  } else {
    const voicing = guitarVoicing(selection);
    if (!voicing.positions || voicing.positions.size === 0) return null;
    fretByString = fretMapFrom([...voicing.positions]);
    barre = voicing.barre ?? undefined;
  }

  const rootPcs = getChordPitchClasses(selection.root, selection.quality);
  const root = rootPcs[0];

  const strings: ChordDiagramProps['strings'] = Array.from(
    { length: STRING_COUNT },
    (_, s) => {
      const fret = fretByString.get(s);
      if (fret === undefined) return { kind: 'muted' as const };
      const pc = pitchClassFromMidi(STANDARD_TUNING_MIDI[s] + fret);
      // Every sounding string carries its note name so the shape reads as
      // notes, not just finger positions — including open strings, which are
      // often most of the chord in first position (Em is E-B-E-G-B-E).
      // Strings absent from the map stay muted and render the conventional x.
      if (fret === 0) return { kind: 'open' as const, note: pc };
      return { kind: 'fretted' as const, fret, isRoot: pc === root, note: pc };
    },
  );

  const frets = [...fretByString.values()].filter((f) => f > 0);
  const span = frets.length ? Math.max(...frets) - Math.min(...frets) + 1 : 5;

  return { strings, barre, fretCount: Math.max(5, span) };
}
