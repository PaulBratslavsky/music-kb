// One chord, drawn small — the unit the progression strip is built from.
//
// Follows the panel's instrument toggle: a guitar chord box, or a
// one-octave mini keyboard. Both read the same ProgressionChord, so a
// progression built on guitar reads correctly on piano and vice versa.

import { ChordDiagram } from './ChordDiagram';
import { chordDiagramProps } from './chordShapes';
import { getChordPitchClasses } from '../theory/chords';
import { pitchClassFromMidi } from '../theory/notes';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import type { PitchClass } from '../types';
import type { ProgressionChord } from './types';

const WHITE: PitchClass[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK: Array<{ pc: PitchClass; after: number }> = [
  { pc: 'C#', after: 0 },
  { pc: 'D#', after: 1 },
  { pc: 'F#', after: 3 },
  { pc: 'G#', after: 4 },
  { pc: 'A#', after: 5 },
];

function MiniPiano({ chord, responsive }: { chord: ProgressionChord; responsive?: boolean }) {
  // A detect-captured shape lights the exact played pitch classes —
  // straight from the keyboard capture, or derived from the fretted
  // positions. Everything else lights root + quality's theoretical tones.
  const lit = new Set<PitchClass>(
    chord.pitchClasses && chord.pitchClasses.length > 0
      ? chord.pitchClasses
      : chord.positions && chord.positions.length > 0
        ? chord.positions.map((key) => {
            const [s, f] = key.split('-').map(Number);
            return pitchClassFromMidi(STANDARD_TUNING_MIDI[s] + f);
          })
        : getChordPitchClasses(chord.root, chord.quality),
  );

  const W = 112;
  const H = 64;
  const ww = W / 7;
  const bw = ww * 0.6;
  const bh = H * 0.62;
  const fill = (pc: PitchClass, base: string) =>
    lit.has(pc)
      ? pc === chord.root
        ? 'var(--root)'
        : 'var(--highlight)'
      : base;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={responsive ? '100%' : W}
      height={responsive ? undefined : H}
      role="img"
      aria-label="Chord keys"
    >
      {WHITE.map((pc, i) => (
        <rect
          key={pc}
          x={i * ww}
          y={0}
          width={ww - 1}
          height={H}
          rx={2}
          fill={fill(pc, 'var(--white-key)')}
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}
      {BLACK.map(({ pc, after }) => (
        <rect
          key={pc}
          x={(after + 1) * ww - bw / 2}
          y={0}
          width={bw}
          height={bh}
          rx={1.5}
          fill={fill(pc, 'var(--black-key)')}
          stroke="var(--border)"
          strokeWidth={0.75}
        />
      ))}
    </svg>
  );
}

export function ChordMini({
  chord,
  instrument,
  orientation = 'horizontal',
  size = 'fixed',
}: {
  chord: ProgressionChord;
  instrument: 'guitar' | 'piano';
  /** 'fill' lets a grid cell size the diagram — see ChordDiagram.size. */
  size?: 'fixed' | 'fill';
  /** Guitar only. Defaults to horizontal (nut on the left), matching the
   *  full fretboard view. */
  orientation?: 'vertical' | 'horizontal';
}) {
  if (instrument === 'piano') return <MiniPiano chord={chord} responsive={size === 'fill'} />;
  const props = chordDiagramProps(chord);
  // No defined fingering (the exotic extensions) — the caller shows the
  // chord name on its own.
  return props ? (
    <ChordDiagram {...props} orientation={orientation} size={size} />
  ) : null;
}
