// The Reference tab on /theory — the lookup surface.
//
// The other theory tabs are things you *play with*; this is the one you
// never read end to end. You come to answer "what's the formula for m7♭5?"
// or "what are the chords in E major?" and leave. Dense on purpose.
//
// IMPORTANT: nothing here is transcribed from a chart. Every formula,
// chord spelling and key table is COMPUTED from the app's own theory layer
// (tonal, via getScalePitchClasses / getChordPitchClasses / degrees /
// getDiatonicTriads) at module load. That means it can't drift from what
// /builder shows you, it covers all 30 chord qualities the app supports
// rather than a printable subset, and the key picker can re-spell the
// whole page into any of the 12 keys.

import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { MiniNeck, type NeckDot } from '#/components/lesson/MiniNeck';
import { MiniKeyboard, type KeyMark } from '#/components/lesson/MiniKeyboard';
import { DegreeChips } from '#/components/lesson/DegreeChips';
import { ChordMini } from '#/components/ChordMini';
import { guitarVoicing } from '#/lib/music/theory/voicings/guitar';
import { prettyAccidentals } from '#/components/lesson/labels';
import { getScalePitchClasses } from '#/lib/music/theory/scales';
import {
  getChordNoteNames,
  getChordPitchClasses,
} from '#/lib/music/theory/chords';
import { chordDegrees, scaleDegrees } from '#/lib/music/theory/degrees';
import { getDiatonicTriads } from '#/lib/music/theory/diatonic';
import { QUALITY_LABELS } from '#/lib/music/theory/quality-labels';
import { SCALE_TYPE_LABELS, getScaleNoteNames } from '#/lib/music/theory/scales';
import { STANDARD_TUNING_MIDI } from '#/lib/music/instruments/guitar/layout';
import { pitchClassFromMidi, spelledRoot } from '#/lib/music/theory/notes';
import {
  PITCH_CLASSES,
  type ChordQuality,
  type PitchClass,
  type ScaleType,
} from '#/lib/music/types';

/* ========================================================================== */
/*  Generated reference data                                                   */
/* ========================================================================== */

const pretty = (s: string) => prettyAccidentals(s);

/** Ordered degree formula for a chord quality, e.g. ['1','♭3','5','♭7']. */
function chordFormula(quality: ChordQuality): string[] {
  const pcs = getChordPitchClasses('C', quality);
  const degrees = chordDegrees('C', quality);
  return pcs.map((pc) => pretty(degrees[pc] ?? '?'));
}

/** Ordered degree formula for a scale type. */
function scaleFormula(type: ScaleType): string[] {
  const pcs = getScalePitchClasses({ root: 'C', type });
  const degrees = scaleDegrees({ root: 'C', type });
  return pcs.map((pc) => pretty(degrees[pc] ?? '?'));
}

// Spell notes by their FUNCTION, not by pitch class: the ♯5 of B♭aug is
// F♯, not G♭, and only tonal's chord/scale spelling knows that. Going
// through spelledRoot() would print the enharmonic twin and read wrong on
// a reference page.
function chordNotes(root: PitchClass, quality: ChordQuality, flats: boolean) {
  return getChordNoteNames(root, quality, flats).map(pretty);
}

function scaleNotes(root: PitchClass, type: ScaleType, flats: boolean) {
  return getScaleNoteNames({ root, type }, flats).map(pretty);
}

/** Keyboard marks for a scale, labelled by degree rather than note name. */
function scaleKeyMarks(root: PitchClass, type: ScaleType): KeyMark[] {
  const pcs = getScalePitchClasses({ root, type });
  const degrees = scaleDegrees({ root, type });
  return pcs.map((pc, i) => ({
    pc,
    label: pretty(degrees[pc] ?? ''),
    root: i === 0,
  }));
}

/**
 * Whether this quality has a defined guitar fingering. The exotic
 * extensions have no one canonical shape, and ChordMini renders nothing for
 * them — so the card needs to say that rather than leave a hole.
 */
function hasGuitarShape(root: PitchClass, quality: ChordQuality): boolean {
  const v = guitarVoicing({ root, quality, inversion: 0, voicingIndex: 0 });
  return v.positions != null && v.positions.size > 0;
}

/**
 * Every scale tone across the neck, nut to 12th fret, labelled by degree.
 * This is the guitar counterpart to the keyboard on each scale card — on a
 * guitar-first KB, "where is it on the neck" is the question being asked.
 */
function scaleNeckDots(root: PitchClass, type: ScaleType): NeckDot[] {
  const degrees = scaleDegrees({ root, type });
  const dots: NeckDot[] = [];
  for (let string = 0; string < STANDARD_TUNING_MIDI.length; string++) {
    for (let fret = 0; fret <= 12; fret++) {
      const pc = pitchClassFromMidi(STANDARD_TUNING_MIDI[string] + fret);
      const degree = degrees[pc];
      if (!degree) continue;
      dots.push({ string, fret, label: pretty(degree), root: pc === root });
    }
  }
  return dots;
}

/** Keyboard marks for a chord, labelled by degree. */
function chordKeyMarks(root: PitchClass, quality: ChordQuality): KeyMark[] {
  const pcs = getChordPitchClasses(root, quality);
  const degrees = chordDegrees(root, quality);
  return pcs.map((pc, i) => ({
    pc,
    label: pretty(degrees[pc] ?? ''),
    root: i === 0,
  }));
}

/* ---- Scales --------------------------------------------------------------- */

// Ordered for lookup, not alphabetically: the ones you actually reach for
// first, then the modes, then the shortened scales.
const SCALE_ORDER: ScaleType[] = [
  'major',
  'minor',
  'harmonicMinor',
  'melodicMinor',
  'majorPentatonic',
  'minorPentatonic',
  'blues',
];

// Brightest to darkest — the ordering that makes the modes make sense, since
// each step down flattens exactly one more degree than the one above it.
const MODE_ORDER: Array<{ type: ScaleType; alias: string; character: string }> = [
  { type: 'lydian', alias: 'IV', character: 'Major, but dreamier — the ♯4 floats.' },
  { type: 'major', alias: 'I · Ionian', character: 'The plain major scale.' },
  { type: 'mixolydian', alias: 'V', character: 'Major with a ♭7 — bluesy, dominant.' },
  { type: 'dorian', alias: 'II', character: 'Minor with a bright 6th — funk, jazz.' },
  { type: 'minor', alias: 'VI · Aeolian', character: 'The plain natural minor scale.' },
  { type: 'phrygian', alias: 'III', character: 'Minor with a ♭2 — Spanish, metal.' },
  { type: 'locrian', alias: 'VII', character: 'Minor with ♭2 and ♭5 — no stable home.' },
];

/* ---- Chords --------------------------------------------------------------- */

const CHORD_GROUPS: Array<{ title: string; note?: string; qualities: ChordQuality[] }> = [
  {
    title: 'Triads (and the power chord)',
    qualities: ['5', 'maj', 'min', 'dim', 'aug'],
  },
  {
    title: 'Suspended',
    note: 'No 3rd at all, so they are neither major nor minor.',
    qualities: ['sus2', 'sus4', '7sus4'],
  },
  { title: 'Sixths', qualities: ['6', 'm6'] },
  {
    title: 'Sevenths',
    note: 'Add a 4th note a third above the 5th. The workhorses of jazz and blues.',
    qualities: ['maj7', 'min7', 'dom7', 'm7b5', 'dim7', 'mMaj7'],
  },
  {
    title: 'Added and extended',
    note: 'add9 adds the 9th without the 7th; a true 9/11/13 stacks everything below it. The plain 11 conventionally drops the 3rd, which clashes with the 11.',
    qualities: ['add9', 'madd9', '9', 'maj9', 'm9', '11', 'm11', '13', 'm13'],
  },
  {
    title: 'Altered dominants',
    note: 'A dominant 7 with a bent 5th or 9th — tension chords that want to resolve.',
    qualities: ['7b5', '7#5', '7b9', '7#9', 'alt'],
  },
];

/* ---- Progressions --------------------------------------------------------- */

// Roman numerals are 1-indexed into the diatonic triads of the key, so they
// render into whatever key the picker is set to.
const MAJOR_PROGRESSIONS: Array<{ label: string; degrees: number[]; note: string }> = [
  { label: 'I – IV – V', degrees: [1, 4, 5], note: 'Blues, rock, folk. The three major chords.' },
  { label: 'I – V – vi – IV', degrees: [1, 5, 6, 4], note: 'The pop progression. Thousands of songs.' },
  { label: 'ii – V – I', degrees: [2, 5, 1], note: 'The jazz cadence. Usually played as 7th chords.' },
  { label: 'I – vi – IV – V', degrees: [1, 6, 4, 5], note: "'50s doo-wop." },
  { label: 'vi – IV – I – V', degrees: [6, 4, 1, 5], note: 'The pop progression started on the minor.' },
  { label: 'I – iii – IV – V', degrees: [1, 3, 4, 5], note: 'Softer than I–vi–IV–V; the iii bridges it.' },
];

const MINOR_PROGRESSIONS: Array<{ label: string; degrees: number[]; note: string }> = [
  { label: 'i – VI – VII', degrees: [1, 6, 7], note: 'Rock and metal staple. All three are easy shapes.' },
  { label: 'i – iv – v', degrees: [1, 4, 5], note: 'The all-minor cadence — natural minor keeps v minor.' },
  { label: 'i – iv – VII', degrees: [1, 4, 7], note: 'Modal and open-sounding.' },
  { label: 'i – VI – III – VII', degrees: [1, 6, 3, 7], note: "The minor 'pop' four-chord loop." },
  { label: 'i – VII – VI – VII', degrees: [1, 7, 6, 7], note: 'Descending vamp that never resolves.' },
];

/* ---- Intervals ------------------------------------------------------------ */

const INTERVALS: Array<{ semitones: number; name: string; degree: string }> = [
  { semitones: 0, name: 'Unison / root', degree: '1' },
  { semitones: 1, name: 'Minor 2nd', degree: '♭2' },
  { semitones: 2, name: 'Major 2nd', degree: '2' },
  { semitones: 3, name: 'Minor 3rd', degree: '♭3' },
  { semitones: 4, name: 'Major 3rd', degree: '3' },
  { semitones: 5, name: 'Perfect 4th', degree: '4' },
  { semitones: 6, name: 'Tritone', degree: '♭5 / ♯4' },
  { semitones: 7, name: 'Perfect 5th', degree: '5' },
  { semitones: 8, name: 'Minor 6th', degree: '♭6 / ♯5' },
  { semitones: 9, name: 'Major 6th', degree: '6' },
  { semitones: 10, name: 'Minor 7th', degree: '♭7' },
  { semitones: 11, name: 'Major 7th', degree: '7' },
  { semitones: 12, name: 'Octave', degree: '8 / 1' },
];

/**
 * The interval table as a picture: walk one string a fret at a time from
 * the key's root and every row of INTERVALS is one dot.
 */
const INTERVAL_RULER = (root: PitchClass): NeckDot[] => {
  // Anchor on the low E string at the first fret that sounds the root.
  const openPc = pitchClassFromMidi(STANDARD_TUNING_MIDI[5]);
  const start =
    (PITCH_CLASSES.indexOf(root) - PITCH_CLASSES.indexOf(openPc) + 12) % 12;
  return INTERVALS.map((iv) => ({
    string: 5,
    fret: start + iv.semitones,
    label: iv.degree.split(' / ')[0],
    root: iv.semitones === 0 || iv.semitones === 12,
  }));
};

/** The same twelve intervals as keyboard marks. */
const INTERVAL_KEYS = (root: PitchClass): KeyMark[] =>
  INTERVALS.slice(0, 12).map((iv) => ({
    pc: PITCH_CLASSES[(PITCH_CLASSES.indexOf(root) + iv.semitones) % 12],
    label: iv.degree.split(' / ')[0],
    root: iv.semitones === 0,
  }));

/* ---- Tunings -------------------------------------------------------------- */

// Written low-to-high, the way a tuner reads them.
const TUNINGS: Array<{ name: string; strings: string; note: string }> = [
  { name: 'Standard', strings: 'E A D G B E', note: 'Everything else on this page assumes it.' },
  { name: 'Drop D', strings: 'D A D G B E', note: 'Low E down a whole step. One-finger power chords.' },
  { name: 'Double drop D', strings: 'D A D G B D', note: 'Both E strings down a whole step.' },
  { name: 'Drop C', strings: 'C G C F A D', note: 'Drop D, then everything down another whole step.' },
  { name: 'DADGAD', strings: 'D A D G A D', note: 'Modal and unresolved — Celtic and folk fingerstyle.' },
  { name: 'Open D', strings: 'D A D F♯ A D', note: 'Strums a D major chord open. Slide staple.' },
  { name: 'Open G', strings: 'D G D G B D', note: 'Strums a G major chord open. Keith Richards territory.' },
  { name: 'Open C', strings: 'C G C G C E', note: 'Big, ringing low end.' },
  { name: 'Open E', strings: 'E B E G♯ B E', note: 'Open D shapes at concert pitch — raises string tension.' },
  { name: 'Half step down', strings: 'E♭ A♭ D♭ G♭ B♭ E♭', note: 'Standard, all down one fret. Easier on the voice.' },
];

/* ---- Fretboard map -------------------------------------------------------- */

// Every note from the nut to the 12th fret, where the pattern repeats.
const FRETBOARD_MAP: NeckDot[] = STANDARD_TUNING_MIDI.flatMap((openMidi, string) =>
  Array.from({ length: 13 }, (_, fret) => {
    const pc = pitchClassFromMidi(openMidi + fret);
    return {
      string,
      fret,
      label: pretty(pc),
      // Naturals only get the accent so the sharps recede into the background.
      root: !pc.includes('#'),
    };
  }),
);

/* ---- Key picker ----------------------------------------------------------- */

const KEYS: Array<{ pc: PitchClass; display: string; flats: boolean }> = [
  { pc: 'C', display: 'C', flats: false },
  { pc: 'G', display: 'G', flats: false },
  { pc: 'D', display: 'D', flats: false },
  { pc: 'A', display: 'A', flats: false },
  { pc: 'E', display: 'E', flats: false },
  { pc: 'B', display: 'B', flats: false },
  { pc: 'F#', display: 'F♯', flats: false },
  { pc: 'C#', display: 'D♭', flats: true },
  { pc: 'G#', display: 'A♭', flats: true },
  { pc: 'D#', display: 'E♭', flats: true },
  { pc: 'A#', display: 'B♭', flats: true },
  { pc: 'F', display: 'F', flats: true },
];

/* ========================================================================== */

export function TheoryReference() {
  const [keyIdx, setKeyIdx] = useState(0);
  const key = KEYS[keyIdx];

  const majorTriads = getDiatonicTriads({ root: key.pc, type: 'major' }, key.flats);
  // The relative minor sits on the 6th degree and shares all seven notes.
  const relativeMinorPc = PITCH_CLASSES[
    (PITCH_CLASSES.indexOf(key.pc) + 9) % 12
  ];
  const minorTriads = getDiatonicTriads(
    { root: relativeMinorPc, type: 'minor' },
    key.flats,
  );
  const relativeMinorName = pretty(spelledRoot(relativeMinorPc, key.flats));

  return (
    <div>
      <div className="mb-8 max-w-3xl">
        <p className="text-sm text-[var(--ink-soft)]">
          The lookup tab. Scale and chord formulas, the modes, every chord
          in every key, the progressions worth knowing, intervals, tunings
          and the fretboard map — all in one place. The other tabs are for
          exploring; this one is for answering. If you want the{' '}
          <em>why</em> behind any of it, start with{' '}
          <Link to="/lessons/half-steps-to-chords" className="underline">
            half steps → every chord in a key
          </Link>
          .
        </p>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Everything below is generated from the same theory engine that
          drives the{' '}
          <Link to="/builder" className="underline hover:text-[var(--ink)]">
            fretboard explorer
          </Link>
          , so it always agrees with what the app plays.
        </p>
      </div>

      {/* Key picker — drives every section that names actual notes. */}
      <div className="sticky top-14 z-10 -mx-4 mb-8 border-y border-[var(--line)] bg-[var(--bg)]/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Key
          </span>
          {KEYS.map((k, i) => (
            <button
              key={k.pc}
              type="button"
              onClick={() => setKeyIdx(i)}
              aria-pressed={i === keyIdx}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                i === keyIdx
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--line-strong)]'
              }`}
            >
              {k.display}
            </button>
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------- Scales */}
      <RefSection
        title="Scale formulas"
        blurb={`Degrees relative to the major scale, then the same scale mapped across the neck and lit up on a keyboard. Notes shown in ${key.display}.`}
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {SCALE_ORDER.map((type) => (
            <ScaleCard
              key={type}
              title={SCALE_TYPE_LABELS[type]}
              formula={scaleFormula(type)}
              notes={scaleNotes(key.pc, type, key.flats)}
              marks={scaleKeyMarks(key.pc, type)}
              neckDots={scaleNeckDots(key.pc, type)}
              theory={`scale:${key.pc}:${type}`}
            />
          ))}
        </div>
      </RefSection>

      {/* -------------------------------------------------------- Modes */}
      <RefSection
        title="The seven modes"
        blurb="Same seven notes, seven starting points — ordered brightest to darkest. Read the chip rows top to bottom and watch the red creep in: each mode flattens one more degree than the one above it."
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {MODE_ORDER.map((m, i) => (
            <ScaleCard
              key={m.type}
              title={SCALE_TYPE_LABELS[m.type]}
              badge={m.alias}
              brightness={MODE_ORDER.length - i}
              brightnessMax={MODE_ORDER.length}
              formula={scaleFormula(m.type)}
              notes={scaleNotes(key.pc, m.type, key.flats)}
              marks={scaleKeyMarks(key.pc, m.type)}
              neckDots={scaleNeckDots(key.pc, m.type)}
              caption={m.character}
              theory={`scale:${key.pc}:${m.type}`}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          The badge is which note of the parent major scale the mode starts
          on — so D Dorian and C major hold identical notes.
        </p>
      </RefSection>

      {/* ------------------------------------------------------- Chords */}
      <RefSection
        title="Chord formulas"
        blurb={`Every chord quality the app can build — ${CHORD_GROUPS.reduce(
          (n, g) => n + g.qualities.length,
          0,
        )} of them. Notes shown rooted on ${key.display}.`}
      >
        <div className="space-y-6">
          {CHORD_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-[var(--ink)]">
                {group.title}
              </h3>
              {group.note && (
                <p className="mt-0.5 max-w-3xl text-xs text-[var(--ink-muted)]">
                  {group.note}
                </p>
              )}
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.qualities.map((q) => (
                  <ChordCard
                    key={q}
                    name={`${key.display}${
                      QUALITY_LABELS[q] === 'maj' ? '' : QUALITY_LABELS[q]
                    }`}
                    formula={chordFormula(q)}
                    notes={chordNotes(key.pc, q, key.flats)}
                    root={key.pc}
                    quality={q}
                    theory={`chord:${key.pc}:${q}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </RefSection>

      {/* ------------------------------------------------ Chords in key */}
      <RefSection
        title="Chords in the key"
        blurb={`${key.display} major and its relative minor, ${relativeMinorName} minor — the same seven chords, renumbered from a different home note.`}
      >
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              {key.display} major
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              {majorTriads.map((t) => (
                <DiatonicCard
                  key={t.degree}
                  roman={t.roman}
                  name={pretty(t.chordName)}
                  notes={t.pitchClasses.map((pc) =>
                    pretty(spelledRoot(pc, key.flats)),
                  )}
                  thirds={t.stackedThirds}
                  root={t.root}
                  quality={t.quality}
                />
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              {relativeMinorName} minor
            </h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              {minorTriads.map((t) => (
                <DiatonicCard
                  key={t.degree}
                  roman={t.roman}
                  name={pretty(t.chordName)}
                  notes={t.pitchClasses.map((pc) =>
                    pretty(spelledRoot(pc, key.flats)),
                  )}
                  thirds={t.stackedThirds}
                  root={t.root}
                  quality={t.quality}
                />
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          Quality follows the degree, not the key: major keys always run
          major · minor · minor · major · major · minor · diminished. Swap to
          seventh chords by stacking one more third —{' '}
          <Link to="/lessons/caged-and-roman-numerals" className="underline hover:text-[var(--ink)]">
            Roman numerals
          </Link>{' '}
          explains why this makes progressions portable.
        </p>
      </RefSection>

      {/* ------------------------------------------------- Progressions */}
      <RefSection
        title="Common progressions"
        blurb={`Written as Roman numerals, then spelled out in ${key.display} major and ${relativeMinorName} minor.`}
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">Major key</h3>
            <div className="mt-2">
              <RefTable head={['Progression', `In ${key.display}`, 'Where you hear it']}>
                {MAJOR_PROGRESSIONS.map((p) => (
                  <tr key={p.label} className="border-b border-[var(--line)] last:border-0">
                    <Td mono accent nowrap>{p.label}</Td>
                    <Td bold nowrap>
                      {p.degrees
                        .map((d) => pretty(majorTriads[d - 1].chordName))
                        .join(' – ')}
                    </Td>
                    <Td>{p.note}</Td>
                  </tr>
                ))}
              </RefTable>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--ink)]">Minor key</h3>
            <div className="mt-2">
              <RefTable head={['Progression', `In ${relativeMinorName}m`, 'Where you hear it']}>
                {MINOR_PROGRESSIONS.map((p) => (
                  <tr key={p.label} className="border-b border-[var(--line)] last:border-0">
                    <Td mono accent nowrap>{p.label}</Td>
                    <Td bold nowrap>
                      {p.degrees
                        .map((d) => pretty(minorTriads[d - 1].chordName))
                        .join(' – ')}
                    </Td>
                    <Td>{p.note}</Td>
                  </tr>
                ))}
              </RefTable>
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          Minor-key progressions often raise the 7th to make the v chord
          major (V), which gives a stronger pull home — that's harmonic
          minor, listed in the scale table above.
        </p>
      </RefSection>

      {/* ---------------------------------------------------- Intervals */}
      <RefSection
        title="Intervals"
        blurb="The ruler everything else is measured with. One half step = one fret = one piano key."
      >
        <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              All 12 intervals, one string
            </p>
            <div className="mt-3 overflow-x-auto">
              <MiniNeck
                dots={INTERVAL_RULER(key.pc)}
                fromFret={0}
                toFret={12}
                ariaLabel={`Every interval measured up from ${key.display} on one string`}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              Each fret is the next row of the table. Twelve frets later
              you're back on {key.display}, an octave up.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              The same twelve on a keyboard
            </p>
            <div className="mt-3 overflow-x-auto">
              <MiniKeyboard
                octaves={2}
                marks={INTERVAL_KEYS(key.pc)}
                showUnmarkedLabels={false}
                ariaLabel={`Every interval measured up from ${key.display} on the keyboard`}
              />
            </div>
            <p className="mt-2 text-xs text-[var(--ink-soft)]">
              Same twelve steps, no gaps — black keys included.
            </p>
          </div>
        </div>

        <RefTable head={['Half steps', 'Interval', 'Degree', `From ${key.display}`]}>
          {INTERVALS.map((iv) => (
            <tr key={iv.semitones} className="border-b border-[var(--line)] last:border-0">
              <Td mono accent>{iv.semitones}</Td>
              <Td bold>{iv.name}</Td>
              <Td mono>{iv.degree}</Td>
              <Td>
                {pretty(
                  spelledRoot(
                    PITCH_CLASSES[
                      (PITCH_CLASSES.indexOf(key.pc) + iv.semitones) % 12
                    ],
                    key.flats,
                  ),
                )}
              </Td>
            </tr>
          ))}
        </RefTable>
      </RefSection>

      {/* ------------------------------------------------------ Tunings */}
      <RefSection
        title="Alternate tunings"
        blurb="Written low string to high, the way a tuner reads them."
      >
        <RefTable head={['Tuning', 'Strings (low → high)', 'What it buys you']}>
          {TUNINGS.map((t) => (
            <tr key={t.name} className="border-b border-[var(--line)] last:border-0">
              <Td bold>{t.name}</Td>
              <Td mono>{t.strings}</Td>
              <Td>{t.note}</Td>
            </tr>
          ))}
        </RefTable>
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          The diagrams everywhere else in the app assume standard tuning.
        </p>
      </RefSection>

      {/* ---------------------------------------------------- Fretboard */}
      <RefSection
        title="Notes of the fretboard"
        blurb="Nut to the 12th fret, where everything repeats an octave higher. Naturals are highlighted; the sharps between them are one fret either side."
      >
        <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
          <MiniNeck
            dots={FRETBOARD_MAP}
            fromFret={0}
            toFret={12}
            ariaLabel="Every note on the guitar fretboard from the nut to the 12th fret"
          />
        </div>
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          Learning all six strings at once is the slow way.{' '}
          <Link to="/lessons/find-any-chord" className="underline hover:text-[var(--ink)]">
            Two strings and four shapes
          </Link>{' '}
          gets you every major and minor chord from just the low E and A
          strings.
        </p>
      </RefSection>

      <footer className="mt-12 max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-6">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Want the reasoning instead of the answer?
        </h2>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          This tab assumes you know what you're looking for. The lessons
          build the same material from the ground up, and the other theory
          tabs let you hear it.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/lessons"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-1.5 text-sm font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
          >
            All lessons →
          </Link>
          <Link
            to="/builder"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-4 py-1.5 text-sm font-medium text-[var(--ink-muted)] no-underline hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            Fretboard explorer
          </Link>
        </div>
      </footer>
    </div>
  );
}

/* ---- Small presentational helpers ---------------------------------------- */

/**
 * A scale or mode: formula chips over a lit-up keyboard. The keyboard is
 * what makes two modes comparable at a glance — the chip row tells you
 * *which* degree moved, the keys tell you what that sounds like shaped.
 */
function ScaleCard({
  title,
  badge,
  brightness,
  brightnessMax,
  formula,
  notes,
  marks,
  neckDots,
  caption,
  theory,
}: {
  title: string;
  badge?: string;
  brightness?: number;
  brightnessMax?: number;
  formula: string[];
  notes: string[];
  marks: KeyMark[];
  neckDots: NeckDot[];
  caption?: string;
  theory: string;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
        {badge && (
          <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
            {badge}
          </span>
        )}
      </div>

      {brightness != null && brightnessMax != null && (
        <div
          className="mt-2 flex gap-0.5"
          role="img"
          aria-label={`Brightness ${brightness} of ${brightnessMax}`}
        >
          {Array.from({ length: brightnessMax }, (_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${
                i < brightness ? 'bg-[var(--accent)]' : 'bg-[var(--bg-subtle)]'
              }`}
            />
          ))}
        </div>
      )}

      <div className="mt-3">
        <DegreeChips degrees={formula} size="sm" />
      </div>

      <div className="mt-3 overflow-x-auto">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Guitar · nut to 12th fret
        </p>
        <MiniNeck
          dots={neckDots}
          fromFret={0}
          toFret={12}
          ariaLabel={`${title} across the guitar neck`}
        />
      </div>

      <div className="mt-3 overflow-x-auto">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Piano
        </p>
        <MiniKeyboard
          octaves={2}
          marks={marks}
          showUnmarkedLabels={false}
          ariaLabel={`${title} on the keyboard`}
        />
      </div>

      <p className="mt-2 text-xs text-[var(--ink-soft)]">{notes.join(' · ')}</p>
      {caption && (
        <p className="mt-1 text-xs text-[var(--ink-muted)]">{caption}</p>
      )}
      <div className="mt-auto pt-3">
        <BuilderLink theory={theory} />
      </div>
    </article>
  );
}

/**
 * A chord quality: formula chips, the guitar shape, and the same notes on a
 * keyboard. Qualities with no defined guitar fingering (the exotic
 * extensions) fall back to the keyboard alone rather than an empty box.
 */
function ChordCard({
  name,
  formula,
  notes,
  root,
  quality,
  theory,
}: {
  name: string;
  formula: string[];
  notes: string[];
  root: PitchClass;
  quality: ChordQuality;
  theory: string;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-bold text-[var(--ink)]">{name}</h4>
      </div>
      <div className="mt-2">
        <DegreeChips degrees={formula} size="sm" />
      </div>

      <div className="mt-3 flex min-h-[140px] items-center justify-center">
        {hasGuitarShape(root, quality) ? (
          <ChordMini
            chord={{ root, quality, inversion: 0, voicingIndex: 0 }}
            instrument="guitar"
          />
        ) : (
          <p className="max-w-[10rem] text-center text-xs text-[var(--ink-muted)]">
            No single standard guitar fingering — voice it from the notes
            below, or open it on the fretboard.
          </p>
        )}
      </div>
      <div className="mt-2 overflow-x-auto">
        <MiniKeyboard
          octaves={2}
          marks={chordKeyMarks(root, quality)}
          showUnmarkedLabels={false}
          ariaLabel={`${name} on the keyboard`}
        />
      </div>

      <p className="mt-2 text-xs text-[var(--ink-soft)]">{notes.join(' · ')}</p>
      <div className="mt-auto pt-3">
        <BuilderLink theory={theory} />
      </div>
    </article>
  );
}

/** One chord of the key — Roman numeral badge over its guitar shape. */
function DiatonicCard({
  roman,
  name,
  notes,
  thirds,
  root,
  quality,
}: {
  roman: string;
  name: string;
  notes: string[];
  thirds: string;
  root: PitchClass;
  quality: ChordQuality;
}) {
  return (
    <article className="flex flex-col items-center rounded-2xl border border-[var(--line)] bg-[var(--card)] p-3 text-center">
      <span className="font-mono text-xs font-bold text-[var(--accent)]">
        {roman}
      </span>
      <span className="mt-0.5 text-sm font-bold text-[var(--ink)]">{name}</span>
      <div className="my-2">
        <ChordMini
          chord={{ root, quality, inversion: 0, voicingIndex: 0 }}
          instrument="guitar"
        />
      </div>
      <span className="text-[11px] text-[var(--ink-soft)]">
        {notes.join(' · ')}
      </span>
      <span className="mt-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
        {thirds}
      </span>
      <div className="mt-2">
        <BuilderLink theory={`chord:${root}:${quality}`} />
      </div>
    </article>
  );
}

function RefSection({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12 max-w-6xl">
      <h2 className="text-lg font-semibold text-[var(--ink)] sm:text-xl">
        {title}
      </h2>
      <p className="mt-1 mb-4 max-w-3xl text-sm text-[var(--ink-soft)]">{blurb}</p>
      {children}
    </section>
  );
}

function RefTable({
  head,
  children,
}: {
  head: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className="px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  bold,
  mono,
  accent,
  right,
  nowrap,
}: {
  children?: React.ReactNode;
  bold?: boolean;
  mono?: boolean;
  accent?: boolean;
  right?: boolean;
  nowrap?: boolean;
}) {
  const cls = [
    'px-4 py-2.5',
    mono ? 'font-mono text-xs' : 'text-sm',
    bold ? 'font-semibold text-[var(--ink)]' : '',
    accent ? 'font-bold text-[var(--accent)]' : '',
    !bold && !accent ? 'text-[var(--ink-soft)]' : '',
    right ? 'text-right' : '',
    // Chord sequences must never break mid-progression — the table scrolls
    // sideways instead.
    nowrap ? 'whitespace-nowrap' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return <td className={cls}>{children}</td>;
}

function BuilderLink({ theory }: { theory: string }) {
  return (
    <Link
      to="/builder"
      search={{ theory }}
      className="text-xs font-medium text-[var(--accent)] no-underline hover:underline"
    >
      Play →
    </Link>
  );
}
