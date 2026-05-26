// Ear Trainer.
//
// Three drill modes — interval ID, chord-quality ID, cadence ID — share
// the same shell: a Play button, multiple-choice answer chips, a
// reveal-on-click feedback row, and a current/best streak counter.
//
// Each drill generates a question, plays it via the synth, presents
// answer choices. User clicks an answer → feedback locks in (correct
// chip in green, wrong chip in red + correct one highlighted), then
// "Next" advances to a fresh question.
//
// Streaks are kept in-memory only — no localStorage persistence (the
// existing visualizer Game Mode persists best streaks per-instrument;
// this is a separate drill not tied to an instrument view).

import { useEffect, useRef, useState } from 'react';
import { synth } from '#/lib/music/audio/synth';
import { getChordPitchClasses, stackAscending } from '#/lib/music/theory/chords';
import { midiFromPitchOctave } from '#/lib/music/theory/notes';
import {
  PITCH_CLASSES,
  type ChordQuality,
  type PitchClass,
} from '#/lib/music/types';

type DrillMode = 'interval' | 'chord-quality' | 'cadence';

// ---------------------------------------------------------------------------
// Drill 1: Interval ID
// ---------------------------------------------------------------------------

// Each entry carries:
//   - `label`: the short notation shown on the chip (m = minor, M = major,
//     P = perfect, TT = tritone). Standard music-theory shorthand.
//   - `name`: the full interval name for the tooltip + legend.
//   - `hint`: a familiar song reference so beginners can anchor the sound.
const INTERVAL_CHOICES: Array<{
  semitones: number;
  label: string;
  name: string;
  hint: string;
}> = [
  { semitones: 1, label: 'm2', name: 'Minor 2nd', hint: 'half step — Jaws theme' },
  { semitones: 2, label: 'M2', name: 'Major 2nd', hint: 'whole step — Happy Birthday (1→2)' },
  { semitones: 3, label: 'm3', name: 'Minor 3rd', hint: 'minor-chord 3rd — Greensleeves opening' },
  { semitones: 4, label: 'M3', name: 'Major 3rd', hint: 'major-chord 3rd — Oh When the Saints' },
  { semitones: 5, label: 'P4', name: 'Perfect 4th', hint: 'Here Comes the Bride' },
  { semitones: 6, label: 'TT (♭5)', name: 'Tritone / ♭5', hint: 'restless — The Simpsons theme' },
  { semitones: 7, label: 'P5', name: 'Perfect 5th', hint: 'power chord — Twinkle Twinkle (1→5)' },
  { semitones: 8, label: 'm6', name: 'Minor 6th', hint: 'The Entertainer first leap' },
  { semitones: 9, label: 'M6', name: 'Major 6th', hint: 'My Bonnie Lies Over the Ocean' },
  { semitones: 10, label: 'm7', name: 'Minor 7th', hint: 'Star Trek theme opening' },
  { semitones: 11, label: 'M7', name: 'Major 7th', hint: 'leans up to the octave — tense' },
  { semitones: 12, label: 'P8', name: 'Octave', hint: 'Over the Rainbow opening leap' },
];

// ---------------------------------------------------------------------------
// Drill 2: Chord Quality ID
// ---------------------------------------------------------------------------

// Each entry carries the chord-tone formula (1 = root, 3 = major 3rd,
// ♭3 = minor 3rd, etc.) and a one-line vibe description for the legend.
const CHORD_QUALITY_CHOICES: Array<{
  q: ChordQuality;
  label: string;
  formula: string;
  hint: string;
}> = [
  { q: 'maj', label: 'Major', formula: '1 – 3 – 5', hint: 'bright, stable' },
  { q: 'min', label: 'Minor', formula: '1 – ♭3 – 5', hint: 'darker, mellow' },
  { q: 'dim', label: 'Diminished', formula: '1 – ♭3 – ♭5', hint: 'tense, unstable' },
  { q: 'aug', label: 'Augmented', formula: '1 – 3 – ♯5', hint: 'restless, otherworldly' },
  { q: 'dom7', label: 'Dominant 7', formula: '1 – 3 – 5 – ♭7', hint: 'classic "tension into resolution"' },
  { q: 'maj7', label: 'Major 7', formula: '1 – 3 – 5 – 7', hint: 'jazzy, dreamy' },
  { q: 'min7', label: 'Minor 7', formula: '1 – ♭3 – 5 – ♭7', hint: 'smooth jazz / R&B staple' },
];

// ---------------------------------------------------------------------------
// Drill 3: Cadence ID
// ---------------------------------------------------------------------------

// All cadences played in C major for v1 — keeps the question recognizable
// across rounds (constant tonal center). Each cadence is a 2-chord
// progression. The "answer" is the cadence type.
const CADENCE_CHOICES: Array<{
  id: string;
  label: string;
  chords: Array<[PitchClass, ChordQuality]>;
  hint: string;
}> = [
  {
    id: 'authentic',
    label: 'Authentic (V → I)',
    chords: [['G', 'dom7'], ['C', 'maj']],
    hint: 'strong resolution — the "amen" of song endings',
  },
  {
    id: 'plagal',
    label: 'Plagal (IV → I)',
    chords: [['F', 'maj'], ['C', 'maj']],
    hint: 'softer resolution — the literal "amen" cadence',
  },
  {
    id: 'deceptive',
    label: 'Deceptive (V → vi)',
    chords: [['G', 'dom7'], ['A', 'min']],
    hint: 'unresolved twist — sets up V→I, lands on the relative minor',
  },
  {
    id: 'half',
    label: 'Half (I → V)',
    chords: [['C', 'maj'], ['G', 'dom7']],
    hint: 'stops on the dominant — feels like a question',
  },
];

// ---------------------------------------------------------------------------
// Question generators + play functions
// ---------------------------------------------------------------------------

type Question =
  | { drill: 'interval'; rootMidi: number; semitones: number }
  | { drill: 'chord-quality'; rootPc: PitchClass; quality: ChordQuality }
  | { drill: 'cadence'; cadenceId: string };

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateQuestion(drill: DrillMode): Question {
  if (drill === 'interval') {
    // Root in the C3–C5 range so target stays in audible mid-range.
    const rootMidi = 48 + Math.floor(Math.random() * 24);
    const semitones = randomItem(INTERVAL_CHOICES).semitones;
    return { drill, rootMidi, semitones };
  }
  if (drill === 'chord-quality') {
    const rootPc = randomItem(PITCH_CLASSES);
    const quality = randomItem(CHORD_QUALITY_CHOICES).q;
    return { drill, rootPc, quality };
  }
  return { drill, cadenceId: randomItem(CADENCE_CHOICES).id };
}

function correctAnswerOf(q: Question): string {
  if (q.drill === 'interval') return String(q.semitones);
  if (q.drill === 'chord-quality') return q.quality;
  return q.cadenceId;
}

function playQuestion(q: Question): void {
  if (q.drill === 'interval') {
    // Ascending two-note play so the interval is unambiguous.
    synth.playNote(q.rootMidi, 500);
    setTimeout(() => synth.playNote(q.rootMidi + q.semitones, 500), 550);
    return;
  }
  if (q.drill === 'chord-quality') {
    const pcs = getChordPitchClasses(q.rootPc, q.quality);
    const notes = stackAscending(pcs, 4);
    synth.playChord(notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave)));
    return;
  }
  // Cadence — play each chord in sequence with ~750ms spacing.
  const cadence = CADENCE_CHOICES.find((c) => c.id === q.cadenceId);
  if (!cadence) return;
  cadence.chords.forEach(([root, quality], i) => {
    setTimeout(() => {
      const pcs = getChordPitchClasses(root, quality);
      const notes = stackAscending(pcs, 4);
      synth.playChord(notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave)));
    }, i * 800);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EarTrainer() {
  const [drill, setDrill] = useState<DrillMode>('interval');
  const [question, setQuestion] = useState<Question>(() => generateQuestion('interval'));
  const [userAnswer, setUserAnswer] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const autoplayRef = useRef(false);

  // Whenever the drill mode changes, reset and start a fresh question.
  // Don't auto-play on initial mount — wait for the user to press Play
  // so the AudioContext isn't created without a user gesture.
  useEffect(() => {
    setQuestion(generateQuestion(drill));
    setUserAnswer(null);
    autoplayRef.current = false;
  }, [drill]);

  const next = () => {
    setQuestion(generateQuestion(drill));
    setUserAnswer(null);
    // Re-play after a brief delay so the user sees the new question card
    // before the audio fires.
    setTimeout(() => {
      // Read the freshly-set question from a ref-snapshot to avoid stale
      // closure — we just generated above so it's safe to call directly.
    }, 50);
  };

  const answer = (id: string) => {
    if (userAnswer !== null) return; // already answered this round
    setUserAnswer(id);
    if (id === correctAnswerOf(question)) {
      setStreak((s) => {
        const next = s + 1;
        if (next > best) setBest(next);
        return next;
      });
    } else {
      setStreak(0);
    }
  };

  const correct = correctAnswerOf(question);
  const isAnswered = userAnswer !== null;
  const wasCorrect = isAnswered && userAnswer === correct;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--ink-soft)]">
        Listen carefully and pick the right answer. Streak resets on a
        wrong guess.
      </p>

      {/* Drill picker */}
      <div
        className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-xs"
        role="radiogroup"
        aria-label="Drill mode"
      >
        {(
          [
            { id: 'interval' as const, label: 'Interval' },
            { id: 'chord-quality' as const, label: 'Chord quality' },
            { id: 'cadence' as const, label: 'Cadence' },
          ] as const
        ).map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={drill === d.id}
            onClick={() => setDrill(d.id)}
            className={`rounded-full px-3 py-1 font-medium transition ${
              drill === d.id
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Play + Next + Score */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => playQuestion(question)}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[var(--accent-strong,var(--accent))]"
        >
          ▶ Play
        </button>
        <button
          type="button"
          onClick={next}
          className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 py-1.5 text-sm font-medium text-[var(--ink)] hover:border-[var(--accent)]"
        >
          Next question
        </button>
        <div className="ml-auto flex items-center gap-4 text-xs text-[var(--ink-muted)]">
          <span>
            Streak: <span className="font-mono font-bold text-[var(--ink)]">{streak}</span>
          </span>
          <span>
            Best: <span className="font-mono font-bold text-[var(--ink)]">{best}</span>
          </span>
        </div>
      </div>

      {/* Answer chips — switch per drill */}
      <div>
        <div className="flex items-center justify-between">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            What did you hear?
          </span>
          <button
            type="button"
            onClick={() => setShowLegend((s) => !s)}
            className="text-xs text-[var(--ink-muted)] underline hover:text-[var(--ink)]"
          >
            {showLegend ? 'hide legend' : 'what do these mean?'}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {drill === 'interval' &&
            INTERVAL_CHOICES.map((c) => {
              const id = String(c.semitones);
              const state = chipState(id, userAnswer, correct);
              return (
                <AnswerChip
                  key={id}
                  label={c.label}
                  title={`${c.name} — ${c.semitones} semitone${c.semitones === 1 ? '' : 's'} (${c.hint})`}
                  state={state}
                  onClick={() => answer(id)}
                />
              );
            })}
          {drill === 'chord-quality' &&
            CHORD_QUALITY_CHOICES.map((c) => {
              const state = chipState(c.q, userAnswer, correct);
              return (
                <AnswerChip
                  key={c.q}
                  label={c.label}
                  title={`${c.label} — ${c.formula} — ${c.hint}`}
                  state={state}
                  onClick={() => answer(c.q)}
                />
              );
            })}
          {drill === 'cadence' &&
            CADENCE_CHOICES.map((c) => {
              const state = chipState(c.id, userAnswer, correct);
              return (
                <AnswerChip
                  key={c.id}
                  label={c.label}
                  title={c.hint}
                  state={state}
                  onClick={() => answer(c.id)}
                />
              );
            })}
        </div>
        {showLegend && <Legend drill={drill} />}
      </div>

      {isAnswered && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            wasCorrect
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-rose-300 bg-rose-50 text-rose-800'
          }`}
        >
          {wasCorrect ? '✓ Correct! ' : '✗ Not quite — '}
          <button
            type="button"
            onClick={next}
            className="ml-2 underline hover:opacity-80"
          >
            try another →
          </button>
        </div>
      )}
    </div>
  );
}

type ChipState = 'idle' | 'selected-wrong' | 'selected-correct' | 'reveal-correct' | 'disabled';

function chipState(
  id: string,
  userAnswer: string | null,
  correct: string,
): ChipState {
  if (userAnswer === null) return 'idle';
  if (id === userAnswer && id === correct) return 'selected-correct';
  if (id === userAnswer && id !== correct) return 'selected-wrong';
  if (id === correct) return 'reveal-correct';
  return 'disabled';
}

function AnswerChip({
  label,
  title,
  state,
  onClick,
}: {
  label: string;
  title?: string;
  state: ChipState;
  onClick: () => void;
}) {
  const className = (() => {
    switch (state) {
      case 'selected-correct':
        return 'border-emerald-500 bg-emerald-500 text-white';
      case 'selected-wrong':
        return 'border-rose-500 bg-rose-500 text-white';
      case 'reveal-correct':
        return 'border-emerald-500 bg-emerald-50 text-emerald-800';
      case 'disabled':
        return 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)] opacity-60';
      default:
        return 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--accent)]';
    }
  })();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state !== 'idle'}
      title={title}
      className={`rounded-full border px-3 py-1 text-sm font-medium transition ${className}`}
    >
      {label}
    </button>
  );
}

/** Per-drill explanatory legend. Toggled on by "what do these mean?". */
function Legend({ drill }: { drill: DrillMode }) {
  return (
    <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-4 text-xs text-[var(--ink-soft)]">
      {drill === 'interval' && (
        <>
          <p className="mb-2 font-semibold text-[var(--ink)]">
            Interval shorthand
          </p>
          <p className="mb-3 text-[var(--ink-muted)]">
            <strong className="text-[var(--ink)]">m</strong> = minor,{' '}
            <strong className="text-[var(--ink)]">M</strong> = major,{' '}
            <strong className="text-[var(--ink)]">P</strong> = perfect,{' '}
            <strong className="text-[var(--ink)]">TT</strong> = tritone (the
            "diabolical" diminished 5th). The number is the scale degree
            you'd land on if you counted up the major scale.
          </p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {INTERVAL_CHOICES.map((c) => (
              <li key={c.semitones} className="flex items-baseline gap-2">
                <span className="inline-block w-16 font-mono font-semibold text-[var(--ink)]">
                  {c.label}
                </span>
                <span>
                  {c.name} — <em>{c.hint}</em>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {drill === 'chord-quality' && (
        <>
          <p className="mb-2 font-semibold text-[var(--ink)]">
            Chord quality formulas
          </p>
          <p className="mb-3 text-[var(--ink-muted)]">
            Built off the major scale: 1 = root, 3 = major 3rd,{' '}
            <strong>♭3</strong> = minor 3rd, 5 = perfect 5th,{' '}
            <strong>♭5</strong> = diminished 5th, <strong>♯5</strong> =
            augmented 5th, 7 = major 7th, <strong>♭7</strong> = minor 7th.
          </p>
          <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {CHORD_QUALITY_CHOICES.map((c) => (
              <li key={c.q} className="flex items-baseline gap-2">
                <span className="inline-block w-24 font-mono font-semibold text-[var(--ink)]">
                  {c.label}
                </span>
                <span>
                  {c.formula} — <em>{c.hint}</em>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {drill === 'cadence' && (
        <>
          <p className="mb-2 font-semibold text-[var(--ink)]">
            Cadence types
          </p>
          <p className="mb-3 text-[var(--ink-muted)]">
            A cadence is a 2-chord harmonic motion that creates a sense of
            arrival (or deliberately denies it). All examples here are in C
            major; Roman numerals tell you the same shape works in any key.
          </p>
          <ul className="grid grid-cols-1 gap-1">
            {CADENCE_CHOICES.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2">
                <span className="inline-block w-44 font-mono font-semibold text-[var(--ink)]">
                  {c.label}
                </span>
                <span>{c.hint}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
