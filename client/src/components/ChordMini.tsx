// Compact visual for one chord in the progression strip. Follows the
// builder's instrument toggle:
//   - guitar → the songbook chord-box (reuses <ChordDiagram/>), built from
//     the saved voicing (voicingIndex picks the exact shape).
//   - piano  → a one-octave mini keyboard with the chord's pitch classes lit.
//
// Read-only. Falls back to null when guitar has no specific shape (the
// pitch-class fallback voicing) so the caller can show the name alone.
import { ChordDiagram, type ChordDiagramProps } from './ChordDiagram';
import { guitarVoicing } from '#/lib/music/theory/voicings/guitar';
import { STANDARD_TUNING_MIDI } from '#/lib/music/instruments/guitar/layout';
import { pitchClassFromMidi } from '#/lib/music/theory/notes';
import { getChordPitchClasses } from '#/lib/music/theory/chords';
import type { ChordSelection, PitchClass } from '#/lib/music/types';

// ChordSelection → ChordDiagram props. `positions` are `${string}-${fret}`
// keys with string 0 = high E … 5 = low E — the same convention ChordDiagram
// expects, so they map straight across. A string absent from `positions` is
// muted; fret 0 is open; otherwise a fretted dot, accented when it's the root.
function guitarDiagram(chord: ChordSelection): ChordDiagramProps | null {
  const v = guitarVoicing(chord);
  if (!v.positions || v.positions.size === 0) return null;
  const fretByString = new Map<number, number>();
  for (const key of v.positions) {
    const [s, f] = key.split('-').map(Number);
    fretByString.set(s, f);
  }
  const strings: ChordDiagramProps['strings'] = Array.from({ length: 6 }, (_, s) => {
    const fret = fretByString.get(s);
    if (fret === undefined) return { kind: 'muted' as const };
    if (fret === 0) return { kind: 'open' as const };
    const pc = pitchClassFromMidi(STANDARD_TUNING_MIDI[s] + fret);
    return { kind: 'fretted' as const, fret, isRoot: pc === chord.root };
  });
  return { strings, barre: v.barre ?? undefined, fretCount: 5 };
}

// --- Mini piano (one octave, C → B) --------------------------------------
const WHITE: PitchClass[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// Black keys sit between specific whites; offset is the white-key index they
// follow (C#=after C(0), D#=after D(1), F#=after F(3), G#=after G(4), A#=after A(5)).
const BLACK: Array<{ pc: PitchClass; after: number }> = [
  { pc: 'C#', after: 0 },
  { pc: 'D#', after: 1 },
  { pc: 'F#', after: 3 },
  { pc: 'G#', after: 4 },
  { pc: 'A#', after: 5 },
];

function MiniPiano({ chord }: { chord: ChordSelection }) {
  const lit = new Set<PitchClass>(getChordPitchClasses(chord.root, chord.quality));
  const W = 112;
  const H = 64;
  const ww = W / 7;
  const bw = ww * 0.6;
  const bh = H * 0.62;
  const fill = (pc: PitchClass, base: string) =>
    lit.has(pc) ? (pc === chord.root ? 'var(--accent)' : 'var(--note-lit, #6aa9ff)') : base;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Chord keys" className="select-none">
      {WHITE.map((pc, i) => (
        <rect
          key={pc}
          x={i * ww}
          y={0}
          width={ww - 1}
          height={H}
          rx={2}
          fill={fill(pc, 'var(--card)')}
          stroke="var(--line)"
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
          fill={fill(pc, '#1b1d22')}
          stroke="var(--line)"
          strokeWidth={0.75}
        />
      ))}
    </svg>
  );
}

export function ChordMini({
  chord,
  instrument,
}: {
  chord: ChordSelection;
  instrument: 'guitar' | 'piano';
}) {
  if (instrument === 'piano') return <MiniPiano chord={chord} />;
  const diagram = guitarDiagram(chord);
  // No specific shape (pitch-class fallback) → render nothing; caller shows
  // the chord name on its own.
  return diagram ? <ChordDiagram {...diagram} /> : null;
}
