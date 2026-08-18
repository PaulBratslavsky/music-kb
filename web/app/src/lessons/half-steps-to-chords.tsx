// /lessons/half-steps-to-chords — the "counting" lesson.
//
// Part 1 of the theory track states the 9 principles; this one shows the
// arithmetic underneath them. Everything here is one idea applied over
// and over: measure in half steps.
//
//   half steps → the major + minor scale recipes (WWHWWWH / WHWWHWW)
//   the recipe → the same 7 notes on one string or across all six
//   the shape  → degrees 1-7
//   degrees    → major vs minor triads (4+3 vs 3+4)
//   triads     → the 7 chords of the key
//   the key    → its slice of the circle of fifths
//
// Every concept is shown on piano, guitar AND bass, inline, because the
// point is that the counting is identical on all three — only the
// geometry changes. Diagrams come from MiniKeyboard / MiniNeck /
// ChordDiagram so the reader never leaves the page.

import { useState } from 'react';
import { Link } from './components/Link';
import { Callout, Step } from './components/Step';
import { MiniKeyboard, type KeyMark } from './components/MiniKeyboard';
import { MiniNeck, type NeckDot } from './components/MiniNeck';
import { scaleNoteLabels } from './components/labels';
import { ChordDiagram } from './components/LessonChordDiagram';
import { CircleOfFifths } from '../music/CircleOfFifths';
import { getScalePitchClasses } from '../theory/scales';
import { getDiatonicTriads } from '../theory/diatonic';
import { realizeCagedShape } from '../theory/positions';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { STANDARD_BASS_TUNING_MIDI } from '../instruments/bass/layout';
import { pitchClassFromMidi } from '../theory/notes';
import { PITCH_CLASSES, type PitchClass } from '../types';

/* ========================================================================== */
/*  Theory helpers — local to this lesson.                                     */
/* ========================================================================== */

const semitonesBetween = (a: PitchClass, b: PitchClass) =>
  ((PITCH_CLASSES.indexOf(b) - PITCH_CLASSES.indexOf(a) + 12) % 12);

type TriadQuality = 'maj' | 'min' | 'dim' | 'aug';

const QUALITY_META: Record<
  TriadQuality,
  { suffix: string; recipe: string; label: string }
> = {
  maj: { suffix: '', recipe: '4 + 3', label: 'major' },
  min: { suffix: 'm', recipe: '3 + 4', label: 'minor' },
  dim: { suffix: 'dim', recipe: '3 + 3', label: 'diminished' },
  aug: { suffix: 'aug', recipe: '4 + 4', label: 'augmented' },
};

/**
 * The seven triads of a major key, in the shape this page renders them.
 *
 * The stacking + quality-from-intervals logic lives in getDiatonicTriads
 * (theory/diatonic.ts) so the reference page and this lesson can't disagree;
 * this only adds the note-name spelling and the /builder deep link.
 */
function lessonTriads(root: PitchClass, preferFlats: boolean) {
  const label = scaleNoteLabels({ root, type: 'major' }, preferFlats);
  return getDiatonicTriads({ root, type: 'major' }, preferFlats).map((t) => ({
    ...t,
    noteNames: t.pitchClasses.map(label),
    theory: `chord:${t.root}:${t.quality}`,
  }));
}

/* ========================================================================== */
/*  Static diagram data                                                        */
/* ========================================================================== */

const C_MAJOR = { root: 'C' as PitchClass, type: 'major' as const };
const G_MAJOR = { root: 'G' as PitchClass, type: 'major' as const };
const A_MINOR = { root: 'A' as PitchClass, type: 'minor' as const };

const cLabel = scaleNoteLabels(C_MAJOR);
const gLabel = scaleNoteLabels(G_MAJOR);
const aLabel = scaleNoteLabels(A_MINOR);

const DEGREE_LABELS = ['1', '2', '3', '4', '5', '6', '7'];

function scaleMarks(
  selection: { root: PitchClass; type: 'major' | 'minor' },
  label: (pc: PitchClass) => string,
  mode: 'notes' | 'degrees',
): KeyMark[] {
  const pcs = getScalePitchClasses(selection);
  return pcs.map((pc, i) => ({
    pc,
    label: mode === 'notes' ? label(pc) : DEGREE_LABELS[i],
    root: i === 0,
  }));
}

// The two natural half steps — the pairs with no black key between them.
const HALF_STEP_PAIRS: KeyMark[] = [
  { pc: 'E', label: 'E', flag: true },
  { pc: 'F', label: 'F', flag: true },
  { pc: 'B', label: 'B', flag: true },
  { pc: 'C', label: 'C', flag: true },
];

/** Chromatic ruler along one string: every fret is one half step. */
function chromaticString(
  stringIdx: number,
  openMidi: number,
  frets: number,
): NeckDot[] {
  return Array.from({ length: frets + 1 }, (_, fret) => {
    const pc = pitchClassFromMidi(openMidi + fret);
    return {
      string: stringIdx,
      fret,
      label: pc.replace('#', '♯'),
      root: fret === 0 || fret === 12,
    };
  });
}

const GUITAR_CHROMATIC = chromaticString(5, STANDARD_TUNING_MIDI[5], 12);
const BASS_CHROMATIC = chromaticString(3, STANDARD_BASS_TUNING_MIDI[3], 12);

/**
 * A scale walked up a single string, so the recipe is literally visible as
 * fret gaps — 2 2 1 2 2 2 1 for major, 2 1 2 2 1 2 2 for minor.
 */
function scaleOnOneString(
  stringIdx: number,
  openMidi: number,
  selection: { root: PitchClass; type: 'major' | 'minor' },
  degreeLabels: string[] = DEGREE_LABELS,
): NeckDot[] {
  const pcs = getScalePitchClasses(selection);
  const openPc = pitchClassFromMidi(openMidi);
  const startFret = semitonesBetween(openPc, pcs[0]) || 12;
  const dots: NeckDot[] = [];
  let fret = startFret;
  for (let i = 0; i < pcs.length; i++) {
    dots.push({
      string: stringIdx,
      fret,
      label: degreeLabels[i],
      root: i === 0,
    });
    const step = semitonesBetween(pcs[i], pcs[(i + 1) % pcs.length]) || 12;
    fret += step;
  }
  // Close the octave so the last half step (7 → 1) is on screen.
  dots.push({ string: stringIdx, fret, label: '1', root: true });
  return dots;
}

/** Scale-degree spelling for the natural minor scale. */
const MINOR_DEGREE_LABELS = ['1', '2', '♭3', '4', '5', '♭6', '♭7'];

/** The two recipes, as the step sequence between consecutive degrees. */
const MAJOR_RECIPE = ['W', 'W', 'H', 'W', 'W', 'W', 'H'] as const;
const MINOR_RECIPE = ['W', 'H', 'W', 'W', 'H', 'W', 'W'] as const;

const GUITAR_G_MAJOR_LINE = scaleOnOneString(5, STANDARD_TUNING_MIDI[5], G_MAJOR);
const BASS_G_MAJOR_LINE = scaleOnOneString(3, STANDARD_BASS_TUNING_MIDI[3], G_MAJOR);

const GUITAR_A_MINOR_LINE = scaleOnOneString(
  5,
  STANDARD_TUNING_MIDI[5],
  A_MINOR,
  MINOR_DEGREE_LABELS,
);
const BASS_A_MINOR_LINE = scaleOnOneString(
  3,
  STANDARD_BASS_TUNING_MIDI[3],
  A_MINOR,
  MINOR_DEGREE_LABELS,
);

/**
 * Parallel major vs parallel minor — same root, so the only difference is
 * which degrees got lowered. This is the comparison that makes "minor =
 * major with a flat 3, 6 and 7" concrete instead of a slogan.
 */
const A_MAJOR = { root: 'A' as PitchClass, type: 'major' as const };
const aMajorLabel = scaleNoteLabels(A_MAJOR);
const A_MAJOR_PCS = getScalePitchClasses(A_MAJOR);
const A_MINOR_PCS = getScalePitchClasses(A_MINOR);

const PARALLEL_ROWS = A_MAJOR_PCS.map((pc, i) => ({
  majorDegree: DEGREE_LABELS[i],
  minorDegree: MINOR_DEGREE_LABELS[i],
  majorNote: aMajorLabel(pc),
  minorNote: aLabel(A_MINOR_PCS[i]),
  lowered: A_MAJOR_PCS[i] !== A_MINOR_PCS[i],
}));

// Degrees table — computed, not hand-typed, so it can't drift.
const C_MAJOR_PCS = getScalePitchClasses(C_MAJOR);
const G_MAJOR_PCS = getScalePitchClasses(G_MAJOR);

/* ---- One string vs across the strings ------------------------------------ */

const degreeOfG = (pc: PitchClass) => {
  const i = G_MAJOR_PCS.indexOf(pc);
  return i >= 0 ? DEGREE_LABELS[i] : '';
};

/** The same G major scale folded into one position across all six strings. */
const GUITAR_G_MAJOR_BOX: NeckDot[] = realizeCagedShape(
  1,
  'G',
  G_MAJOR_PCS,
  'major',
).map((p) => {
  const pc = pitchClassFromMidi(STANDARD_TUNING_MIDI[p.string] + p.fret);
  return {
    string: p.string,
    fret: p.fret,
    label: degreeOfG(pc),
    root: pc === 'G',
  };
});

/**
 * What a whole step and a half step LOOK like, on one string and when the
 * move crosses to the next string. Standard tuning stacks perfect 4ths (5
 * frets) everywhere except G→B, which is a major 3rd (4 frets) — so every
 * cross-string move loses one fret of "back-step" on that pair.
 */
const INTERVAL_SHAPES: Array<{
  id: string;
  title: string;
  geometry: string;
  dots: NeckDot[];
  note: string;
}> = [
  {
    id: 'same-whole',
    title: 'Whole step · same string',
    geometry: '+2 frets',
    dots: [
      { string: 5, fret: 5, label: 'A', root: true },
      { string: 5, fret: 7, label: 'B' },
    ],
    note: 'Two frets up. The easy one — this is the picture everybody starts with.',
  },
  {
    id: 'same-half',
    title: 'Half step · same string',
    geometry: '+1 fret',
    dots: [
      { string: 5, fret: 5, label: 'A', root: true },
      { string: 5, fret: 6, label: 'A♯' },
    ],
    note: 'One fret up. Also easy — and also the last time it looks this obvious.',
  },
  {
    id: 'cross-whole',
    title: 'Whole step · to the next string',
    geometry: '3 frets back',
    dots: [
      { string: 5, fret: 5, label: 'A', root: true },
      { string: 4, fret: 2, label: 'B' },
    ],
    note: 'The next string up sounds 5 frets higher, so a whole step lands 5 − 2 = 3 frets back.',
  },
  {
    id: 'cross-half',
    title: 'Half step · to the next string',
    geometry: '4 frets back',
    dots: [
      { string: 5, fret: 5, label: 'A', root: true },
      { string: 4, fret: 1, label: 'A♯' },
    ],
    note: 'Same logic: 5 − 1 = 4 frets back. Nearly a whole hand-span diagonally.',
  },
  {
    id: 'gb-whole',
    title: 'Whole step · crossing G → B',
    geometry: '2 frets back',
    dots: [
      { string: 2, fret: 5, label: 'C', root: true },
      { string: 1, fret: 3, label: 'D' },
    ],
    note: 'The G→B pair is only 4 frets apart, so everything shifts one fret: 4 − 2 = 2.',
  },
  {
    id: 'gb-half',
    title: 'Half step · crossing G → B',
    geometry: '3 frets back',
    dots: [
      { string: 2, fret: 5, label: 'C', root: true },
      { string: 1, fret: 2, label: 'C♯' },
    ],
    note: 'The trap: 4 − 1 = 3 frets back — which is exactly what a whole step looks like everywhere else.',
  },
];

const DEGREE_NAMES = [
  'root (tonic)',
  'major 2nd',
  'major 3rd',
  'perfect 4th',
  'perfect 5th',
  'major 6th',
  'major 7th (leading tone)',
];
const DEGREE_ROWS = C_MAJOR_PCS.map((pc, i) => ({
  degree: i + 1,
  semitones: semitonesBetween('C', pc),
  inC: cLabel(pc),
  inG: gLabel(G_MAJOR_PCS[i]),
  name: DEGREE_NAMES[i],
}));

/* ---- The four triad types, all rooted on C so only the 3rd/5th move ------- */

const TRIAD_TYPES: Array<{
  quality: TriadQuality;
  name: string;
  chord: string;
  formula: string;
  intervals: [number, number];
  sound: string;
}> = [
  {
    quality: 'maj',
    name: 'Major',
    chord: 'C',
    formula: '1 – 3 – 5',
    intervals: [4, 7],
    sound: 'Bright, settled, "happy".',
  },
  {
    quality: 'min',
    name: 'Minor',
    chord: 'Cm',
    formula: '1 – ♭3 – 5',
    intervals: [3, 7],
    sound: 'Dark, heavy, "sad". Only the 3rd moved.',
  },
  {
    quality: 'dim',
    name: 'Diminished',
    chord: 'Cdim',
    formula: '1 – ♭3 – ♭5',
    intervals: [3, 6],
    sound: 'Tense and unstable — wants to resolve.',
  },
  {
    quality: 'aug',
    name: 'Augmented',
    chord: 'Caug',
    formula: '1 – 3 – ♯5',
    intervals: [4, 8],
    sound: 'Floating, unresolved. Rare, but it completes the set.',
  },
];

const TRIAD_DEGREE_LABEL: Record<TriadQuality, [string, string, string]> = {
  maj: ['1', '3', '5'],
  min: ['1', '♭3', '5'],
  dim: ['1', '♭3', '♭5'],
  aug: ['1', '3', '♯5'],
};

function triadMarks(quality: TriadQuality, intervals: [number, number]): KeyMark[] {
  const [third, fifth] = intervals;
  const labels = TRIAD_DEGREE_LABEL[quality];
  return [
    { pc: 'C', label: labels[0], root: true },
    { pc: PITCH_CLASSES[third], label: labels[1] },
    { pc: PITCH_CLASSES[fifth], label: labels[2] },
  ];
}

// Guitar: the same E-shape barre at fret 8 (root C on the low E string).
// Major → minor is one finger lifting off the G string. Strings are
// indexed [high e, B, G, D, A, low E] to match ChordDiagram.
const C_MAJOR_BARRE = [
  { kind: 'fretted' as const, fret: 8 },
  { kind: 'fretted' as const, fret: 8 },
  { kind: 'fretted' as const, fret: 9 },
  { kind: 'fretted' as const, fret: 10 },
  { kind: 'fretted' as const, fret: 10 },
  { kind: 'fretted' as const, fret: 8, isRoot: true },
];
const C_MINOR_BARRE = [
  { kind: 'fretted' as const, fret: 8 },
  { kind: 'fretted' as const, fret: 8 },
  { kind: 'fretted' as const, fret: 8 },
  { kind: 'fretted' as const, fret: 10 },
  { kind: 'fretted' as const, fret: 10 },
  { kind: 'fretted' as const, fret: 8, isRoot: true },
];

// Bass: a C arpeggio. String 2 = A string, string 1 = D string.
const BASS_C_MAJOR: NeckDot[] = [
  { string: 2, fret: 3, label: '1', root: true },
  { string: 1, fret: 2, label: '3' },
  { string: 1, fret: 5, label: '5' },
];
const BASS_C_MINOR: NeckDot[] = [
  { string: 2, fret: 3, label: '1', root: true },
  { string: 1, fret: 1, label: '♭3' },
  { string: 1, fret: 5, label: '5' },
];

/* ---- Key picker for the "all 7 chords" section --------------------------- */

const KEY_OPTIONS: Array<{ pc: PitchClass; display: string; flats: boolean }> = [
  { pc: 'C', display: 'C', flats: false },
  { pc: 'G', display: 'G', flats: false },
  { pc: 'D', display: 'D', flats: false },
  { pc: 'A', display: 'A', flats: false },
  { pc: 'E', display: 'E', flats: false },
  { pc: 'F', display: 'F', flats: true },
  { pc: 'A#', display: 'B♭', flats: true },
  { pc: 'D#', display: 'E♭', flats: true },
];

// Circle-of-fifths order of the C major scale: stack perfect 5ths and the
// key's 7 notes come out as 7 adjacent wheel slots.
const WHEEL_ORDER = [
  { note: 'F', degree: '4', roman: 'IV', quality: 'major' },
  { note: 'C', degree: '1', roman: 'I', quality: 'major' },
  { note: 'G', degree: '5', roman: 'V', quality: 'major' },
  { note: 'D', degree: '2', roman: 'ii', quality: 'minor' },
  { note: 'A', degree: '6', roman: 'vi', quality: 'minor' },
  { note: 'E', degree: '3', roman: 'iii', quality: 'minor' },
  { note: 'B', degree: '7', roman: 'vii°', quality: 'diminished' },
];

/* ========================================================================== */

export default function HalfStepsToChordsPage() {
  const [keyIdx, setKeyIdx] = useState(0);
  const activeKey = KEY_OPTIONS[keyIdx];
  const triads = lessonTriads(activeKey.pc, activeKey.flats);

  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-10 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson · fundamentals · counting
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          Half steps, whole steps, and every chord in a key
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          One skill — counting half steps — builds the whole system. It
          gives you the major <em>and</em> minor scales, the numbers{' '}
          <strong className="text-[var(--ink)]">1 2 3 4 5 6 7</strong>,
          the difference between a major and a minor chord, all seven
          chords in any key, and finally the circle of fifths. Every idea
          is shown on piano, guitar and bass, because the counting is
          identical on all three — only the shape of the instrument
          changes.
        </p>
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          Pairs with{' '}
          <Link
            to="/lessons/music-theory-fundamentals"
            className="underline hover:text-[var(--ink)]"
          >
            Music theory fundamentals
          </Link>{' '}
          — that lesson states the principles, this one shows the
          arithmetic they rest on.
        </p>
      </header>

      {/* --------------------------------------------------------- Step 1 */}
      <Step
        number={1}
        title="The half step is the smallest move in music"
        lede="A half step is the shortest distance between two notes. On a
          piano it's the very next key — black or white, no skipping. On
          a guitar or bass it's one fret. A whole step is just two half
          steps: skip one key, or move two frets. That's the entire
          measuring system."
      >
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DiagramCard
            instrument="Piano"
            caption="Twelve keys per octave — 7 white, 5 black. Every neighbour
              is one half step. The two red pairs are the trap: E→F and
              B→C have no black key between them, so those naturals are
              a half step apart while every other natural pair is a whole
              step."
          >
            <MiniKeyboard
              octaves={1}
              marks={HALF_STEP_PAIRS}
              ariaLabel="One octave of piano keys with the E–F and B–C half-step pairs highlighted"
            />
          </DiagramCard>

          <DiagramCard
            instrument="Guitar · low E string"
            caption="One fret = one half step, with no exceptions and nothing
              to memorize. Twelve frets later you're back to the note you
              started on, an octave higher."
          >
            <MiniNeck
              dots={GUITAR_CHROMATIC}
              fromFret={0}
              toFret={12}
              ariaLabel="Chromatic notes on the guitar low E string from the open string to fret 12"
            />
          </DiagramCard>
        </div>

        <div className="mt-4">
          <DiagramCard
            instrument="Bass · E string"
            caption="Identical to the guitar's low E string, one octave down.
              A bassist counting frets and a pianist counting keys are
              doing the same arithmetic."
          >
            <MiniNeck
              instrument="bass"
              dots={BASS_CHROMATIC}
              fromFret={0}
              toFret={12}
              ariaLabel="Chromatic notes on the bass E string from the open string to fret 12"
            />
          </DiagramCard>
        </div>

        <Callout>
          <strong>Why this one matters more than it looks.</strong>{' '}
          Everything downstream is a count of half steps: a scale is a
          pattern of them, a chord is a stack of them, a key signature is
          the consequence of them. Players who "can't remember theory"
          are almost always missing this layer — they memorized shapes
          without the ruler that explains why the shapes work. Get the
          E→F and B→C exception into your fingers and the rest of this
          lesson is arithmetic you can do in your head.
        </Callout>
      </Step>

      {/* --------------------------------------------------------- Step 2 */}
      <Step
        number={2}
        title="Scales are recipes — major and minor differ only in where the half steps land"
        lede="Pick any note and follow a fixed pattern of whole and half
          steps until you're back where you started, an octave up. Those
          7 notes are a scale. Major and minor use the same ingredients
          and the same 7 slots — all that changes is which gaps are the
          tight ones. Move two half steps and 'happy' becomes 'sad'."
      >
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Major scale
            </h3>
            <p className="mt-0.5 font-mono text-xs text-[var(--ink-muted)]">
              W W H W W W H
            </p>
            <div className="mt-3">
              <RecipeStrip
                degrees={[...DEGREE_LABELS, '1']}
                steps={MAJOR_RECIPE}
                tone="major"
              />
            </div>
            <p className="mt-3 text-xs text-[var(--ink-soft)]">
              The two half steps sit at{' '}
              <strong className="text-[var(--ink)]">3→4</strong> and{' '}
              <strong className="text-[var(--ink)]">7→1</strong>. That
              7→1 half step is why the 7th is called the leading tone —
              it's one half step from home and it pulls there.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Natural minor scale
            </h3>
            <p className="mt-0.5 font-mono text-xs text-[var(--ink-muted)]">
              W H W W H W W
            </p>
            <div className="mt-3">
              <RecipeStrip
                degrees={[...MINOR_DEGREE_LABELS, '1']}
                steps={MINOR_RECIPE}
                tone="minor"
              />
            </div>
            <p className="mt-3 text-xs text-[var(--ink-soft)]">
              The half steps moved to{' '}
              <strong className="text-[var(--ink)]">2→3</strong> and{' '}
              <strong className="text-[var(--ink)]">5→6</strong>. Compared
              to major, three degrees dropped by a half step — the{' '}
              <strong className="text-[var(--ink)]">3rd, 6th and 7th</strong>.
              The flat 3rd is the one your ear hears as "minor".
            </p>
          </div>
        </div>

        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          Now watch both recipes play out on real instruments. Start with
          major:
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DiagramCard
            instrument="C major on piano"
            caption="Start on C and follow the recipe and you never touch a
              black key — that's the only reason C major is 'the easy
              one'. The two half steps (red) land between 3→4 and 7→1."
          >
            <MiniKeyboard
              octaves={2}
              marks={scaleMarks(C_MAJOR, cLabel, 'notes')}
              showSteps
              ariaLabel="C major scale on a two-octave keyboard with whole-step and half-step brackets"
            />
          </DiagramCard>

          <DiagramCard
            instrument="G major on piano"
            caption="Same recipe from G. Following it forces one black key —
              F♯ — because a natural F would put a half step in the wrong
              place. Nobody 'decided' G major has an F♯; the recipe did."
          >
            <MiniKeyboard
              octaves={2}
              marks={scaleMarks(G_MAJOR, gLabel, 'notes')}
              showSteps
              ariaLabel="G major scale on a two-octave keyboard with whole-step and half-step brackets"
            />
          </DiagramCard>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DiagramCard
            instrument="G major · guitar low E string"
            caption="On one string the recipe is a picture: gaps of 2, 2, 1, 2,
              2, 2, 1 frets. The two single-fret gaps are the half steps."
          >
            <MiniNeck
              dots={GUITAR_G_MAJOR_LINE}
              fromFret={2}
              toFret={18}
              ariaLabel="G major scale walked up the guitar low E string showing fret gaps"
            />
          </DiagramCard>

          <DiagramCard
            instrument="G major · bass E string"
            caption="The exact same fret gaps on bass. Scales are not a
              guitar thing or a piano thing — they're a counting thing."
          >
            <MiniNeck
              instrument="bass"
              dots={BASS_G_MAJOR_LINE}
              fromFret={2}
              toFret={18}
              ariaLabel="G major scale walked up the bass E string showing fret gaps"
            />
          </DiagramCard>
        </div>

        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          And now the minor recipe, on the same three instruments. Compare
          each diagram with its major counterpart above — the dots are in
          the same places except three of them, and each of those three
          moved back by exactly one fret or one key.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DiagramCard
            instrument="A minor on piano"
            caption="W H W W H W W from A — and once again you never touch a
              black key. Same white keys as C major, different starting
              note, so the half steps fall in different places. That's why
              A minor is C major's relative minor."
          >
            <MiniKeyboard
              octaves={2}
              marks={scaleMarks(A_MINOR, aLabel, 'notes')}
              showSteps
              ariaLabel="A natural minor scale on a two-octave keyboard with whole-step and half-step brackets"
            />
          </DiagramCard>

          <DiagramCard
            instrument="A minor · guitar low E string"
            caption="Fret gaps of 2, 1, 2, 2, 1, 2, 2. Play this straight after
              the G major line above and you'll hear the whole difference
              without knowing a single chord."
          >
            <MiniNeck
              dots={GUITAR_A_MINOR_LINE}
              fromFret={2}
              toFret={18}
              ariaLabel="A natural minor scale walked up the guitar low E string showing fret gaps"
            />
          </DiagramCard>
        </div>

        <div className="mt-4">
          <DiagramCard
            instrument="A minor · bass E string"
            caption="Same gaps again. Whatever you're holding, a minor scale
              is 'whole, half, whole, whole, half, whole, whole'."
          >
            <MiniNeck
              instrument="bass"
              dots={BASS_A_MINOR_LINE}
              fromFret={2}
              toFret={18}
              ariaLabel="A natural minor scale walked up the bass E string showing fret gaps"
            />
          </DiagramCard>
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full min-w-[520px] text-left text-sm">
            <caption className="px-4 pt-4 text-left text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              A major vs A minor — same root, so only the changes show
            </caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <th className="px-4 py-3 font-semibold">Major degree</th>
                <th className="px-4 py-3 font-semibold">A major</th>
                <th className="px-4 py-3 font-semibold">Minor degree</th>
                <th className="px-4 py-3 font-semibold">A minor</th>
                <th className="px-4 py-3 font-semibold">Change</th>
              </tr>
            </thead>
            <tbody>
              {PARALLEL_ROWS.map((r) => (
                <tr
                  key={r.majorDegree}
                  className="border-b border-[var(--line)] last:border-0"
                >
                  <td className="px-4 py-2.5 font-bold text-[var(--accent)]">
                    {r.majorDegree}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-[var(--ink)]">
                    {r.majorNote}
                  </td>
                  <td
                    className={`px-4 py-2.5 font-bold ${
                      r.lowered
                        ? 'text-[var(--band-red-text)]'
                        : 'text-[var(--accent)]'
                    }`}
                  >
                    {r.minorDegree}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-[var(--ink)]">
                    {r.minorNote}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ink-soft)]">
                    {r.lowered ? 'down one half step' : 'unchanged'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Callout>
          <strong>Two different questions, two different answers.</strong>{' '}
          <em>Parallel</em> minor keeps the root and lowers the 3rd, 6th
          and 7th — A major → A minor, which is the table above and the
          fastest way to convert a scale you already know.{' '}
          <em>Relative</em> minor keeps the notes and moves the root to
          the 6th degree — C major → A minor, same white keys. Both are
          true at once, and mixing them up is the single most common
          beginner tangle. Parallel changes the notes; relative changes
          the home base.
        </Callout>
      </Step>

      {/* --------------------------------------------------------- Step 3 */}
      <Step
        number={3}
        title="One string or all six — the recipe never changes, only its shape does"
        lede="Every scale diagram so far has run along a single string, where
          the recipe is obvious: 2 frets, 2 frets, 1 fret. But nobody plays
          scales that way — you'd be sliding up and down 12 frets. Real
          playing folds the same 7 notes into one hand position across all
          six strings. The notes, the order and the recipe are identical;
          only the geometry changes, and that's the part worth learning."
      >
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DiagramCard
            instrument="G major · laid out along one string"
            caption="Easy to read, awful to play. The recipe is right there as
              fret gaps — 2, 2, 1, 2, 2, 2, 1 — but your hand has to travel
              12 frets to get through it."
          >
            <MiniNeck
              dots={GUITAR_G_MAJOR_LINE}
              fromFret={2}
              toFret={18}
              ariaLabel="G major along the low E string"
            />
          </DiagramCard>

          <DiagramCard
            instrument="G major · folded across all six strings"
            caption="The exact same 7 notes, same 1-to-7 order, now inside a
              four-fret box your hand never leaves. This is the shape most
              players memorize — but it's just the one-string line wrapped
              onto six strings."
          >
            <MiniNeck
              dots={GUITAR_G_MAJOR_BOX}
              fromFret={0}
              toFret={8}
              ariaLabel="G major as a position box across all six strings"
            />
          </DiagramCard>
        </div>

        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          So how do you know whether a move is a whole step or a half step
          when it jumps to the next string? You count the same way — you
          just have to know what those two distances{' '}
          <em>look like</em> diagonally. In standard tuning the next string
          up sounds <strong className="text-[var(--ink)]">5 frets higher</strong>,
          so crossing a string means going backwards to compensate:
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {INTERVAL_SHAPES.map((s) => (
            <article
              key={s.id}
              className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--ink)]">
                  {s.title}
                </h3>
              </div>
              <p className="mt-0.5 font-mono text-xs font-semibold text-[var(--accent)]">
                {s.geometry}
              </p>
              <div className="mt-3 overflow-x-auto">
                <MiniNeck
                  dots={s.dots}
                  fromFret={0}
                  toFret={9}
                  ariaLabel={`${s.title} — ${s.geometry}`}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--ink-soft)]">{s.note}</p>
            </article>
          ))}
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full min-w-[540px] text-left text-sm">
            <caption className="px-4 pt-4 text-left text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              The whole cheat sheet
            </caption>
            <thead>
              <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <th className="px-4 py-3 font-semibold">Move</th>
                <th className="px-4 py-3 font-semibold">Same string</th>
                <th className="px-4 py-3 font-semibold">
                  Next string (E→A, A→D, D→G, B→e)
                </th>
                <th className="px-4 py-3 font-semibold">Next string (G→B)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--line)]">
                <td className="px-4 py-2.5 font-semibold text-[var(--ink)]">
                  Half step
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink-soft)]">
                  1 fret up
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink-soft)]">
                  4 frets back
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--band-red-text)]">
                  3 frets back
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-[var(--ink)]">
                  Whole step
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink-soft)]">
                  2 frets up
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink-soft)]">
                  3 frets back
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--band-red-text)]">
                  2 frets back
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <Callout>
          <strong>Watch the G→B pair.</strong> It's the one string change
          tuned a major 3rd apart instead of a 4th, so every shape shifts
          one fret. The nastiest consequence: crossing onto the B string, a{' '}
          <strong className="text-[var(--ink)]">half step is 3 frets back</strong>{' '}
          — which is precisely what a <em>whole</em> step looks like on
          every other pair. Play the shape without thinking and you'll put
          the wrong note in the scale.
        </Callout>

        <div className="mt-5 max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-5 text-sm text-[var(--ink-soft)]">
          <p className="font-semibold text-[var(--ink)]">
            Why bother, if you could just memorize the box?
          </p>
          <p className="mt-2">
            Because a memorized box only works in the positions you
            memorized it in. If you know what a whole step and a half step
            look like from string to string, you can <em>build</em> the
            scale anywhere on the neck — starting on any note, in any
            position, in any key — without having pre-learned that
            particular shape. The box becomes something you can derive
            instead of something you have to remember.
          </p>
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            This is the whole argument of{' '}
            <Link
              to="/learn/$videoId"
              params={{ videoId: '_A-h4Ji3xXM' }}
              className="underline hover:text-[var(--ink)]"
            >
              "Understanding Whole Steps and Half Steps on Guitar" (Guitar
              Union)
            </Link>{' '}
            in the library — it walks the same G major scale across the neck
            and stops at each string change to ask whether the move was a
            whole step or a half step. Once you can see those two shapes,
            the patterns in{' '}
            <Link
              to="/lessons/scale-systems-on-the-neck"
              className="underline hover:text-[var(--ink)]"
            >
              part 2 of the neck-mapping track
            </Link>{' '}
            stop being arbitrary and start being obvious.
          </p>
        </div>
      </Step>

      {/* --------------------------------------------------------- Step 4 */}
      <Step
        number={4}
        title="Number the 7 notes: 1 2 3 4 5 6 7"
        lede="Once a key has 7 notes in order, stop calling them by name and
          start calling them by number. The number is the note's job in
          the key, and the job survives changing keys — that's what makes
          the numbers worth more than the names."
      >
        <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <th className="px-4 py-3 font-semibold">Degree</th>
                <th className="px-4 py-3 font-semibold">Half steps from 1</th>
                <th className="px-4 py-3 font-semibold">In C major</th>
                <th className="px-4 py-3 font-semibold">In G major</th>
                <th className="px-4 py-3 font-semibold">Interval name</th>
              </tr>
            </thead>
            <tbody>
              {DEGREE_ROWS.map((r) => (
                <tr
                  key={r.degree}
                  className="border-b border-[var(--line)] last:border-0"
                >
                  <td className="px-4 py-2.5 font-bold text-[var(--accent)]">
                    {r.degree}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink-soft)]">
                    {r.semitones}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-[var(--ink)]">
                    {r.inC}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-[var(--ink)]">
                    {r.inG}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ink-soft)]">
                    {r.name}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DiagramCard
            instrument="C major as numbers"
            caption="Same keys as before, labelled by job instead of by name."
          >
            <MiniKeyboard
              octaves={2}
              marks={scaleMarks(C_MAJOR, cLabel, 'degrees')}
              showSteps
              showUnmarkedLabels={false}
              ariaLabel="C major scale labelled with scale degrees 1 through 7"
            />
          </DiagramCard>
          <DiagramCard
            instrument="G major as numbers"
            caption="Different notes, identical numbers — and identical
              distances. That's transposition, and it's free once you
              think in numbers."
          >
            <MiniKeyboard
              octaves={2}
              marks={scaleMarks(G_MAJOR, gLabel, 'degrees')}
              showSteps
              showUnmarkedLabels={false}
              ariaLabel="G major scale labelled with scale degrees 1 through 7"
            />
          </DiagramCard>
        </div>

        <Callout>
          "Go to the 5" means something in every key — G in C major, D in
          G major, B in E major — and it's always 7 half steps above the
          1. On guitar and bass that's why one memorized shape works in
          all 12 keys: slide the shape, the numbers travel with it. Note
          names are local; numbers are portable.
        </Callout>
      </Step>

      {/* --------------------------------------------------------- Step 5 */}
      <Step
        number={5}
        title="Major or minor is decided by one note — the 3rd"
        lede="A basic chord (a triad) is three notes: 1, 3 and 5 of a scale
          starting on the chord's root. Count the half steps between them
          and the chord names itself. Major is 4 then 3. Minor is 3 then
          4. Same two numbers, swapped — and that swap is the entire
          difference between 'happy' and 'sad'."
      >
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TRIAD_TYPES.map((t) => (
            <article
              key={t.quality}
              className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--ink)]">
                  {t.name}
                </h3>
                <span className="font-mono text-xs text-[var(--ink-muted)]">
                  {t.chord}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                {t.formula} · {QUALITY_META[t.quality].recipe} half steps
              </p>
              <div className="mt-3">
                <MiniKeyboard
                  octaves={1}
                  marks={triadMarks(t.quality, t.intervals)}
                  showUnmarkedLabels={false}
                  ariaLabel={`${t.chord} triad on the keyboard`}
                />
              </div>
              <p className="mt-2 text-xs text-[var(--ink-soft)]">{t.sound}</p>
            </article>
          ))}
        </div>

        <p className="mt-6 text-sm text-[var(--ink-soft)]">
          Now the same major/minor flip on the other two instruments. The
          root and the 5th never move — only the 3rd does, by exactly one
          half step.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DiagramCard
            instrument="Guitar · C and Cm at the 8th fret"
            caption="Same barre shape, root C on the low E string at fret 8.
              Going from major to minor is lifting one finger off the G
              string — that finger was holding the 3rd."
          >
            <div className="flex flex-wrap items-start gap-6">
              <figure className="m-0">
                <ChordDiagram
                  strings={C_MAJOR_BARRE}
                  barre={{ fret: 8, fromString: 0, toString: 5 }}
                />
                <figcaption className="mt-1 text-center text-xs font-medium text-[var(--ink)]">
                  C major
                </figcaption>
              </figure>
              <figure className="m-0">
                <ChordDiagram
                  strings={C_MINOR_BARRE}
                  barre={{ fret: 8, fromString: 0, toString: 5 }}
                />
                <figcaption className="mt-1 text-center text-xs font-medium text-[var(--ink)]">
                  C minor
                </figcaption>
              </figure>
            </div>
          </DiagramCard>

          <DiagramCard
            instrument="Bass · C and Cm as an arpeggio"
            caption="A bass usually plays one note at a time, so it spells the
              chord out: 1, 3, 5. Move that middle note back one fret and
              the band sounds minor — the bassist alone can decide it."
          >
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--ink)]">
                  C major — 1, 3, 5
                </p>
                <MiniNeck
                  instrument="bass"
                  dots={BASS_C_MAJOR}
                  fromFret={0}
                  toFret={7}
                  ariaLabel="C major arpeggio on bass"
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-[var(--ink)]">
                  C minor — 1, ♭3, 5
                </p>
                <MiniNeck
                  instrument="bass"
                  dots={BASS_C_MINOR}
                  fromFret={0}
                  toFret={7}
                  ariaLabel="C minor arpeggio on bass"
                />
              </div>
            </div>
          </DiagramCard>
        </div>

        <Callout>
          <strong>The rule, in one line.</strong> Count from the root:{' '}
          <strong className="text-[var(--ink)]">4 then 3</strong> half
          steps = major. <strong className="text-[var(--ink)]">3 then 4</strong>{' '}
          = minor. <strong className="text-[var(--ink)]">3 then 3</strong>{' '}
          = diminished. <strong className="text-[var(--ink)]">4 then 4</strong>{' '}
          = augmented. Every other chord you'll ever meet — 7ths, sus
          chords, 9ths — is one of these four with notes added or swapped.
        </Callout>
      </Step>

      {/* --------------------------------------------------------- Step 6 */}
      <Step
        number={6}
        title="Find all 7 chords in the key"
        lede="Stand on each of the 7 scale notes in turn and stack every
          other note twice — that's the 1, 3 and 5 measured inside the
          scale. Do it seven times and you have the key's whole chord
          family. You never add a note from outside the scale, which is
          why these chords all sound like they belong together."
      >
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-[var(--ink-muted)]">
            Key of
          </span>
          {KEY_OPTIONS.map((k, i) => (
            <button
              key={k.pc}
              type="button"
              onClick={() => setKeyIdx(i)}
              aria-pressed={i === keyIdx}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                i === keyIdx
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink)] hover:border-[var(--line-strong)]'
              }`}
            >
              {k.display} major
            </button>
          ))}
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <th className="px-4 py-3 font-semibold">Degree</th>
                <th className="px-4 py-3 font-semibold">Roman</th>
                <th className="px-4 py-3 font-semibold">Chord</th>
                <th className="px-4 py-3 font-semibold">Notes (1 · 3 · 5)</th>
                <th className="px-4 py-3 font-semibold">Half steps</th>
                <th className="px-4 py-3 font-semibold">Quality</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {triads.map((t) => (
                <tr
                  key={t.degree}
                  className="border-b border-[var(--line)] last:border-0"
                >
                  <td className="px-4 py-2.5 font-bold text-[var(--accent)]">
                    {t.degree}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink-soft)]">
                    {t.roman}
                  </td>
                  <td className="px-4 py-2.5 font-semibold text-[var(--ink)]">
                    {t.chordName}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ink-soft)]">
                    {t.noteNames.join(' · ')}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink-soft)]">
                    {t.stackedThirds}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ink-soft)]">
                    {QUALITY_META[t.quality].label}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to="/builder"
                      search={{ theory: t.theory }}
                      className="text-xs font-medium text-[var(--accent)] no-underline hover:underline"
                    >
                      Hear it →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-5 text-sm text-[var(--ink-soft)]">
          <p className="font-semibold text-[var(--ink)]">
            Switch keys and only the note names change
          </p>
          <p className="mt-2">
            The quality column is frozen:{' '}
            <strong className="text-[var(--ink)]">
              major · minor · minor · major · major · minor · diminished
            </strong>
            {' '}— in every major key, forever. That's not a coincidence to
            memorize, it's the half steps doing their work. The scale's
            two half steps sit between 3→4 and 7→1, and where they land
            inside each stack decides whether that chord comes out major,
            minor or diminished. Degree 7 is the odd one out because it's
            the only stack that catches both half steps, which shrinks its
            5th to 6 half steps.
          </p>
          <p className="mt-2">
            This is why Roman numerals are worth learning: I–V–vi–IV is a
            progression you can play in any key the moment you can build
            these seven chords.
          </p>
        </div>
      </Step>

      {/* --------------------------------------------------------- Step 7 */}
      <Step
        number={7}
        title="Why 1–7 lands on the circle of fifths"
        lede="A perfect 5th is 7 half steps. Start on the 1 and keep going
          up a 5th — 1, 5, 2, 6, 3, 7 — and with the 4 (a 5th below the
          1) you've generated all 7 notes of the key. The circle of
          fifths is just those 7 notes laid out in that order, which is
          why a key occupies one continuous slice of it."
      >
        <div className="mt-5 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <th className="px-4 py-3 font-semibold">
                  Wheel order (C major)
                </th>
                <th className="px-4 py-3 font-semibold">Degree</th>
                <th className="px-4 py-3 font-semibold">Chord</th>
                <th className="px-4 py-3 font-semibold">Where it sits</th>
              </tr>
            </thead>
            <tbody>
              {WHEEL_ORDER.map((w) => (
                <tr
                  key={w.note}
                  className="border-b border-[var(--line)] last:border-0"
                >
                  <td className="px-4 py-2.5 font-semibold text-[var(--ink)]">
                    {w.note}
                  </td>
                  <td className="px-4 py-2.5 font-bold text-[var(--accent)]">
                    {w.degree}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--ink-soft)]">
                    {w.roman}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--ink-soft)]">
                    {w.quality === 'major'
                      ? 'Outer ring — the 3 major chords, side by side'
                      : w.quality === 'minor'
                        ? 'Inner ring — the 3 relative minors, side by side'
                        : 'The leftover — the diminished chord'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-5 text-sm text-[var(--ink-soft)]">
            <p className="font-semibold text-[var(--ink)]">
              Three things the wheel tells you at a glance
            </p>
            <ol className="mt-3 space-y-2.5">
              <li>
                <strong className="text-[var(--ink)]">
                  The chord family is a cluster.
                </strong>{' '}
                Your tonic plus the wedge either side gives IV, I and V —
                the three major chords. The inner ring under them gives
                ii, vi and iii — the three minors. Six wedges, six chords,
                no counting required.
              </li>
              <li>
                <strong className="text-[var(--ink)]">
                  Neighbouring keys differ by exactly one note.
                </strong>{' '}
                One step clockwise raises the 4th by a half step and it
                becomes the new key's 7th. Do that repeatedly and you're
                spelling out the order of sharps; counter-clockwise gives
                you the flats. The key signature is a by-product of half
                steps, not a separate thing to memorize.
              </li>
              <li>
                <strong className="text-[var(--ink)]">
                  Distance on the wheel = distance in sound.
                </strong>{' '}
                Keys next to each other share 6 of their 7 notes, so
                changing between them feels smooth. Keys opposite each
                other share very few, which is why that jump sounds
                dramatic.
              </li>
            </ol>
            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              Click any wedge on the wheel to move the tonic — the roman
              numerals and the diatonic highlighting follow.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
            <CircleOfFifths />
          </div>
        </div>
      </Step>

      <footer className="mt-12 max-w-3xl rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-6">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Where to take it next
        </h2>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          You can now build any major or minor chord from scratch and work
          out every chord in any key. The next question is a practical
          one: where do those chords live on the neck, and how do you
          move between them without stopping to count?
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/lessons/find-any-chord"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-1.5 text-sm font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
          >
            Find any chord with 2 strings + 4 shapes →
          </Link>
          <Link
            to="/lessons/caged-and-roman-numerals"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-4 py-1.5 text-sm font-medium text-[var(--ink-muted)] no-underline hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            CAGED + Roman numerals
          </Link>
          <Link
            to="/lessons"
            className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-4 py-1.5 text-sm font-medium text-[var(--ink-muted)] no-underline hover:border-[var(--accent)] hover:text-[var(--ink)]"
          >
            Back to lessons
          </Link>
        </div>
      </footer>
    </main>
  );
}

/**
 * A scale recipe as a readable strip: degree pills with the W / H step
 * between each pair. Half steps are red and heavier so the two (major) or
 * two (minor) tight spots jump out — that placement is the entire
 * difference between the two scales.
 */
function RecipeStrip({
  degrees,
  steps,
  tone,
}: {
  degrees: string[];
  steps: readonly ('W' | 'H')[];
  tone: 'major' | 'minor';
}) {
  return (
    // Deliberately not wrapping: the strip only reads as a sequence if it
    // stays on one line, so it scrolls sideways on a narrow screen instead.
    <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
      {degrees.map((d, i) => (
        <span key={`${d}-${i}`} className="flex flex-shrink-0 items-center gap-0.5">
          <span
            className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[11px] font-bold ${
              i === 0 || i === degrees.length - 1
                ? 'bg-[var(--accent)] text-white'
                : tone === 'minor' && d.startsWith('♭')
                  ? 'bg-[var(--band-red-bg)] text-[var(--band-red-text)]'
                  : 'bg-[var(--bg-subtle)] text-[var(--ink)]'
            }`}
          >
            {d}
          </span>
          {i < steps.length && (
            <span
              className={`px-0.5 text-[11px] font-bold ${
                steps[i] === 'H'
                  ? 'text-[var(--band-red-dot)]'
                  : 'text-[var(--ink-faint)]'
              }`}
            >
              {steps[i]}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/** Titled frame around one inline diagram — used throughout this lesson so
 *  the piano / guitar / bass versions of an idea read as a set. */
function DiagramCard({
  instrument,
  caption,
  children,
}: {
  instrument: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="m-0 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-5">
      <figcaption className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        {instrument}
      </figcaption>
      <div className="mt-3 overflow-x-auto">{children}</div>
      <p className="mt-3 text-xs text-[var(--ink-soft)]">{caption}</p>
    </figure>
  );
}
