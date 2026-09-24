// Compact visual for one chord in the progression strip. Follows the
// builder's instrument toggle:
//   - guitar → the songbook chord-box (reuses <ChordDiagram/>), built from
//     the saved voicing (voicingIndex picks the exact shape).
//   - piano  → a mini keyboard fitted to the voicing, drawn from absolute
//     MIDI so an inversion reads as an inversion.
//
// Read-only. Falls back to null when guitar has no specific shape (the
// pitch-class fallback voicing) so the caller can show the name alone.
import { ChordDiagram, type ChordDiagramProps } from './ChordDiagram';
import { MiniPush } from './lesson/MiniPush';
import { pushChordShape } from '@music-kb/music/theory/push-shapes';
import { pianoVoicing } from '@music-kb/music/theory/voicings/piano';
import { midiFromNote } from '@music-kb/music/theory/notes';
import { guitarVoicing } from '@music-kb/music/theory/voicings/guitar';
import { STANDARD_TUNING_MIDI } from '@music-kb/music/instruments/guitar/layout';
import { pitchClassFromMidi } from '@music-kb/music/theory/notes';
import { fitPianoRange } from '@music-kb/music/theory/piano-range';
import type { ChordSelection, PitchClass } from '@music-kb/music/types';

// A chord as the progression stores it — a ChordSelection plus, for shapes
// captured via the reverse-detect fretboard, the exact tapped `positions`.
type MiniChord = ChordSelection & {
  positions?: string[];
  /** The notes that actually sounded — see ProgressionChord.midis. */
  midis?: number[];
};

// A `${string}-${fret}` key map → ChordDiagram per-string states. Keys use
// string 0 = high E … 5 = low E, the same convention ChordDiagram expects.
// A string absent from the map is muted; fret 0 is open; otherwise a fretted
// dot, accented when its pitch class is the chord root.
function stringsFromFretMap(
  fretByString: Map<number, number>,
  root: PitchClass,
): ChordDiagramProps['strings'] {
  return Array.from({ length: 6 }, (_, s) => {
    const fret = fretByString.get(s);
    if (fret === undefined) return { kind: 'muted' as const };
    const pc = pitchClassFromMidi(STANDARD_TUNING_MIDI[s] + fret);
    // Every sounding string carries its note name so the shape reads as
    // notes, not just finger positions — including open strings, which are
    // often most of the chord in first position (Em is E-B-E-G-B-E).
    // Strings absent from the map stay muted and render the conventional x.
    if (fret === 0) return { kind: 'open' as const, note: pc };
    return { kind: 'fretted' as const, fret, isRoot: pc === root, note: pc };
  });
}

function parsePositions(positions: string[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const key of positions) {
    const [s, f] = key.split('-').map(Number);
    m.set(s, f);
  }
  return m;
}

// MiniChord → ChordDiagram props. A detect-captured chord (with `positions`)
// renders its exact shape verbatim; otherwise the shape is recomputed from
// root+quality+voicingIndex via guitarVoicing.
function guitarDiagram(chord: MiniChord): ChordDiagramProps | null {
  if (chord.positions && chord.positions.length > 0) {
    const fretByString = parsePositions(chord.positions);
    const frets = [...fretByString.values()].filter((f) => f > 0);
    const span = frets.length ? Math.max(...frets) - Math.min(...frets) + 1 : 5;
    return {
      strings: stringsFromFretMap(fretByString, chord.root),
      fretCount: Math.max(5, span),
    };
  }
  const v = guitarVoicing(chord);
  if (!v.positions || v.positions.size === 0) return null;
  return {
    strings: stringsFromFretMap(parsePositions([...v.positions]), chord.root),
    barre: v.barre ?? undefined,
    fretCount: 5,
  };
}

// --- Mini piano (fitted to the voicing) ----------------------------------
// Drawn from absolute MIDI, never pitch classes. Gm and Gm/D light the
// identical three pitch classes; the only thing that separates them is which
// note is at the bottom, so a pitch-class picture is structurally incapable
// of telling them apart. Same reasoning as fitPianoRange, which sizes the
// board so the bass has somewhere to sit.
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
 */
function soundingMidis(chord: MiniChord): number[] {
  const asc = (ns: number[]) => [...ns].sort((a, b) => a - b);
  if (chord.midis && chord.midis.length > 0) return asc(chord.midis);
  if (chord.positions && chord.positions.length > 0) {
    return asc(
      [...parsePositions(chord.positions).entries()].map(
        ([s, f]) => STANDARD_TUNING_MIDI[s] + f,
      ),
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
    }).map(midiFromNote),
  );
}

function MiniPiano({ chord, responsive }: { chord: MiniChord; responsive?: boolean }) {
  const midis = soundingMidis(chord);
  // minOctaves 2, so every card draws the same board.
  //
  // Fitting the window to the voicing (minOctaves 1) made a closed triad one
  // octave and anything crossing a C two, at the same overall width — so C
  // and Am sat side by side with visibly different key sizes, and the strip
  // read as though the two chords were drawn to different scales. The second
  // octave is also the room an inversion needs: the bass has to sit below the
  // rest, and a one-octave board has nowhere to put it.
  const { baseMidi, octaves } = fitPianoRange(midis, { minOctaves: 2 });
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
        ? 'var(--accent)'
        : 'var(--note-lit, #6aa9ff)'
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
      className="select-none"
    >
      {whites.map(({ id, midi, x }) => (
        <rect
          key={id}
          x={x}
          y={0}
          width={ww - 1}
          height={H}
          rx={2}
          fill={fill(midi, 'var(--card)')}
          stroke="var(--line)"
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
          fill={fill(midi, '#1b1d22')}
          stroke="var(--line)"
          strokeWidth={0.75}
        />
      ))}
      {bassWhite && (
        <circle
          cx={bassWhite.x + (ww - 1) / 2}
          cy={H - Math.max(6, ww * 0.5)}
          r={Math.max(2.5, ww * 0.32)}
          fill="none"
          stroke="var(--card)"
          strokeWidth={1.75}
        />
      )}
      {bassBlack && (
        <circle
          cx={bassBlack.x + bw / 2}
          cy={bh - Math.max(5, bw * 0.7)}
          r={Math.max(2, bw * 0.34)}
          fill="none"
          stroke="var(--card)"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
}

export function ChordMini({
  chord,
  instrument,
  orientation = 'vertical',
  size = 'fixed',
}: {
  chord: MiniChord;
  instrument: 'guitar' | 'piano' | 'push';
  /** 'fill' lets a grid cell size the diagram — see ChordDiagram.size. */
  size?: 'fixed' | 'fill';
  /** Passed straight to ChordDiagram — see its `orientation` prop. */
  orientation?: 'vertical' | 'horizontal';
}) {
  if (instrument === 'push') {
    // ONE voicing, placed on real pads — not every pitch-class match. The
    // scale board lights repeats on purpose; a chord card must show the
    // grip you'd actually play, so it goes through pushChordShape.
    // The notes that actually sounded, when we have them — same reason as
    // the piano board: a re-derived voicing loses the spacing.
    const midis =
      chord.midis && chord.midis.length > 0
        ? chord.midis
        : pianoVoicing({
            root: chord.root,
            quality: chord.quality,
            inversion: chord.inversion ?? 0,
            // voicingIndex is a GUITAR index and means nothing to a pad
            // layout (see SectionScalePicker for the same trap).
            voicingIndex: 0,
          }).map(midiFromNote);
    const rows = 4;
    const cols = 5;
    const shape = pushChordShape(midis, rows, cols);
    const rootPad = shape[0];
    return (
      <MiniPush
        rows={rows}
        cols={cols}
        pads={shape.map((p, i) => ({
          ...p,
          label: pitchClassFromMidi(midis[i]),
          root: p === rootPad,
        }))}
        ariaLabel={`${chord.root} chord on the Push grid`}
      />
    );
  }
  if (instrument === 'piano') return <MiniPiano chord={chord} responsive={size === 'fill'} />;
  const diagram = guitarDiagram(chord);
  // No specific shape (pitch-class fallback) → render nothing; caller shows
  // the chord name on its own.
  return diagram ? (
    <ChordDiagram {...diagram} orientation={orientation} size={size} />
  ) : null;
}
