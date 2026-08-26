// One chord, drawn small — the unit the progression strip is built from.
//
// Follows the panel's instrument toggle: a guitar chord box, or a mini
// keyboard fitted to the voicing and drawn from absolute MIDI, so an
// inversion reads as an inversion. Both read the same ProgressionChord, so a
// progression built on guitar reads correctly on piano and vice versa.

import { ChordDiagram } from './ChordDiagram';
import { MiniPush } from '../lessons/components/MiniPush';
import { pushChordShape } from '@music-kb/music/theory/push-shapes';
import { pianoVoicing } from '@music-kb/music/theory/voicings/piano';
import { stackAscending } from '@music-kb/music/theory/chords';
import { midiFromPitchOctave } from '@music-kb/music/theory/notes';
import { chordDiagramProps } from './chordShapes';
import { fitPianoRange } from '@music-kb/music/theory/piano-range';
import { pitchClassFromMidi } from '@music-kb/music/theory/notes';
import { STANDARD_TUNING_MIDI } from '@music-kb/music/instruments/guitar/layout';
import type { PitchClass } from '@music-kb/music/types';
import type { ProgressionChord } from './types';

const OCTAVE_WHITE: Array<{ pc: PitchClass; semi: number }> = [
  { pc: 'C', semi: 0 },
  { pc: 'D', semi: 2 },
  { pc: 'E', semi: 4 },
  { pc: 'F', semi: 5 },
  { pc: 'G', semi: 7 },
  { pc: 'A', semi: 9 },
  { pc: 'B', semi: 11 },
];
// Black keys sit between specific whites; `after` is the index of the white
// key within the octave that each one follows.
const OCTAVE_BLACK: Array<{ pc: PitchClass; after: number; semi: number }> = [
  { pc: 'C#', after: 0, semi: 1 },
  { pc: 'D#', after: 1, semi: 3 },
  { pc: 'F#', after: 3, semi: 6 },
  { pc: 'G#', after: 4, semi: 8 },
  { pc: 'A#', after: 5, semi: 10 },
];

/**
 * Every note this chord sounds, as absolute MIDI, ascending.
 *
 * Precedence matches pushPadsFor so the two pictures of one chord can't
 * disagree: what actually sounded, then what was fretted, then a voicing
 * derived from root + quality + inversion. Only the first preserves real
 * spacing, but all three put the right note in the bass — which is the
 * whole difference between drawing Gm/D and drawing Gm.
 *
 * `pitchClasses` sits third because it is a keyboard capture saved BEFORE
 * `midis` existed. A pitch-class list cannot express an inversion on its
 * own, but it is stored bass-first, so stacking it in order recovers one —
 * and that is more faithful than re-deriving from root + quality for a
 * detected shape that never mapped cleanly onto a quality.
 */
function soundingMidis(chord: ProgressionChord): number[] {
  const asc = (ns: number[]) => [...ns].sort((a, b) => a - b);
  if (chord.midis && chord.midis.length > 0) return asc(chord.midis);
  if (chord.positions && chord.positions.length > 0) {
    return asc(
      chord.positions.map((key) => {
        const [s, f] = key.split('-').map(Number);
        return STANDARD_TUNING_MIDI[s] + f;
      }),
    );
  }
  if (chord.pitchClasses && chord.pitchClasses.length > 0) {
    return stackAscending(chord.pitchClasses, 4).map((n) =>
      midiFromPitchOctave(n.pitchClass, n.octave),
    );
  }
  return asc(
    pianoVoicing({
      root: chord.root,
      quality: chord.quality,
      inversion: chord.inversion ?? 0,
      // voicingIndex is a GUITAR index — the same trap pushPadsFor documents.
      // A closed stack is what the card wants anyway: it shows which tone is
      // in the bass without inventing a spread nobody played.
      voicingIndex: 0,
    }).map((n) => midiFromPitchOctave(n.pitchClass, n.octave)),
  );
}

/**
 * ONE voicing placed on real pads — not every pitch-class match, which
 * scatters a 3-note chord across a dozen pads and loses the shape.
 * Prefers the notes that actually sounded; falls back to a closed voicing
 * for chords built by hand or saved before `midis` existed.
 */
function pushPadsFor(chord: ProgressionChord) {
  const midis =
    chord.midis && chord.midis.length > 0
      ? chord.midis
      : pianoVoicing({
          root: chord.root,
          quality: chord.quality,
          inversion: chord.inversion ?? 0,
          // voicingIndex is a GUITAR index and means nothing to a pad grid.
          voicingIndex: 0,
        }).map((n) => midiFromPitchOctave(n.pitchClass, n.octave));
  const shape = pushChordShape(midis, 4, 5);
  const rootPad = shape[0];
  return shape.map((p, i) => ({
    ...p,
    label: pitchClassFromMidi(midis[i]),
    root: p === rootPad,
  }));
}

function MiniPiano({ chord, responsive }: { chord: ProgressionChord; responsive?: boolean }) {
  const midis = soundingMidis(chord);
  // minOctaves 1: a closed triad still draws one octave. The second octave
  // appears only when the voicing actually needs it — a drop-2, a wide
  // spread, or any shape that crosses a C.
  const { baseMidi, octaves } = fitPianoRange(midis, { minOctaves: 1 });
  const lit = new Set(midis);
  const bassMidi = midis.length > 0 ? midis[0] : null;

  const W = 112;
  const H = 64;
  const ww = W / (7 * octaves);
  const bw = ww * 0.6;
  const bh = H * 0.62;

  const fill = (midi: number, base: string) =>
    lit.has(midi)
      ? pitchClassFromMidi(midi) === chord.root
        ? 'var(--root)'
        : 'var(--highlight)'
      : base;

  const whites: Array<{ id: string; midi: number; x: number }> = [];
  const blacks: Array<{ id: string; midi: number; x: number }> = [];
  for (let o = 0; o < octaves; o++) {
    OCTAVE_WHITE.forEach(({ pc, semi }, i) => {
      whites.push({ id: `${o}-${pc}`, midi: baseMidi + o * 12 + semi, x: (o * 7 + i) * ww });
    });
    for (const { pc, after, semi } of OCTAVE_BLACK) {
      blacks.push({
        id: `${o}-${pc}`,
        midi: baseMidi + o * 12 + semi,
        x: (o * 7 + after + 1) * ww - bw / 2,
      });
    }
  }

  // The bass ring, adapted from PianoView. There the key stays unfilled and a
  // coloured dot sits on it, so the ring is coloured too. Here the bass key is
  // ALWAYS filled — it is by definition one of the sounding notes — and a ring
  // in the root colour disappears entirely whenever the bass IS the root,
  // which is root position, the commonest case of all. So the ring takes the
  // background token instead: light on a light theme, dark on a dark one,
  // contrasting against every lit fill either way.
  // Sized to the key it sits on, since a two-octave board halves the width.
  const bassWhite = bassMidi != null ? whites.find((k) => k.midi === bassMidi) : undefined;
  const bassBlack = bassMidi != null ? blacks.find((k) => k.midi === bassMidi) : undefined;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={responsive ? '100%' : W}
      height={responsive ? undefined : H}
      role="img"
      aria-label={
        bassMidi != null ? `Chord keys, bass ${pitchClassFromMidi(bassMidi)}` : 'Chord keys'
      }
    >
      {whites.map(({ id, midi, x }) => (
        <rect
          key={id}
          x={x}
          y={0}
          width={ww - 1}
          height={H}
          rx={2}
          fill={fill(midi, 'var(--white-key)')}
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}
      {blacks.map(({ id, midi, x }) => (
        <rect
          key={id}
          x={x}
          y={0}
          width={bw}
          height={bh}
          rx={1.5}
          fill={fill(midi, 'var(--black-key)')}
          stroke="var(--border)"
          strokeWidth={0.75}
        />
      ))}
      {bassWhite && (
        <circle
          cx={bassWhite.x + (ww - 1) / 2}
          cy={H - Math.max(6, ww * 0.5)}
          r={Math.max(2.5, ww * 0.32)}
          fill="none"
          stroke="var(--white-key)"
          strokeWidth={1.75}
        />
      )}
      {bassBlack && (
        <circle
          cx={bassBlack.x + bw / 2}
          cy={bh - Math.max(5, bw * 0.7)}
          r={Math.max(2, bw * 0.34)}
          fill="none"
          stroke="var(--white-key)"
          strokeWidth={1.5}
        />
      )}
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
  instrument: 'guitar' | 'piano' | 'push';
  /** 'fill' lets a grid cell size the diagram — see ChordDiagram.size. */
  size?: 'fixed' | 'fill';
  /** Guitar only. Defaults to horizontal (nut on the left), matching the
   *  full fretboard view. */
  orientation?: 'vertical' | 'horizontal';
}) {
  if (instrument === 'push') {
    // A chord card only needs enough grid to show the shape once; the pads
    // repeat every row anyway (+5 semitones), so 5x4 carries the pattern.
    return (
      <MiniPush
        rows={4}
        cols={5}
        pads={pushPadsFor(chord)}
        ariaLabel="Chord on the Push grid"
      />
    );
  }
  if (instrument === 'piano') return <MiniPiano chord={chord} responsive={size === 'fill'} />;
  const props = chordDiagramProps(chord);
  // No defined fingering (the exotic extensions) — the caller shows the
  // chord name on its own.
  return props ? (
    <ChordDiagram {...props} orientation={orientation} size={size} />
  ) : null;
}
