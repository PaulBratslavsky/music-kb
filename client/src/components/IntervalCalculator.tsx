// Interval calculator — pick two notes, see the interval name + inversion
// + an example of where it's used. A small Play button auditions the
// two notes through the existing synth so the user can hear what they
// chose.
//
// Within an octave we treat the higher note as the destination from the
// lower; if the user picks low > high (e.g. B → C), we wrap to the next
// octave (B → C an octave up = m2). Keeps the calculator focused on
// "intervals within an octave" without confusing direction-of-attack.

import { useState } from 'react';
import {
  invertInterval,
  intervalFromSemitones,
  semitonesBetween,
} from '#/lib/music/intervals';
import { PITCH_CLASSES, type PitchClass } from '#/lib/music/types';
import { synth } from '#/lib/music/audio/synth';

// Sharp + flat display per chromatic position; we keep the sharp spelling
// in state but show both labels on the buttons so picking accidentals
// feels familiar to readers of either system.
const PC_LABEL: Record<PitchClass, string> = {
  C: 'C',
  'C#': 'C♯/D♭',
  D: 'D',
  'D#': 'D♯/E♭',
  E: 'E',
  F: 'F',
  'F#': 'F♯/G♭',
  G: 'G',
  'G#': 'G♯/A♭',
  A: 'A',
  'A#': 'A♯/B♭',
  B: 'B',
};

export function IntervalCalculator() {
  const [low, setLow] = useState<PitchClass>('C');
  const [high, setHigh] = useState<PitchClass>('E');
  const semis = semitonesBetween(low, high);
  const interval = intervalFromSemitones(semis);
  const inversion = invertInterval(interval);

  // Play the two notes one after the other. Both start in octave 4 so
  // they're audible; the upper note wraps an octave if the user picked
  // pitch classes that descend.
  const playPair = () => {
    const lowMidi = midiFor(low, 4);
    const highMidi =
      semis === 0 ? lowMidi : midiFor(high, semis < 0 ? 4 : 4) + (semis < 0 ? 12 : 0);
    // First the lower note, then the upper.
    synth.playNote(lowMidi);
    window.setTimeout(() => synth.playNote(highMidi), 380);
    window.setTimeout(() => {
      // Then both together.
      synth.playChord([lowMidi, highMidi]);
    }, 900);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <NoteRow
          label="Low note"
          value={low}
          onChange={setLow}
        />
        <NoteRow
          label="High note"
          value={high}
          onChange={setHigh}
        />
      </div>

      <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-3xl font-bold text-[var(--ink)]">
            {interval.long}
          </span>
          <span className="rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-0.5 font-mono text-sm text-[var(--ink-soft)]">
            {interval.short}
          </span>
          <span className="text-sm text-[var(--ink-muted)]">
            {interval.semitones} semitones
          </span>
          <button
            type="button"
            onClick={playPair}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            ▶ Hear it
          </button>
        </div>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">{interval.example}</p>
        {interval.semitones > 0 && interval.semitones < 12 && (
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            Inverts to: <span className="font-semibold text-[var(--ink)]">{inversion.long}</span>{' '}
            ({inversion.short}, {inversion.semitones} semitones)
          </p>
        )}
      </div>
    </div>
  );
}

function NoteRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PitchClass;
  onChange: (next: PitchClass) => void;
}) {
  return (
    <div>
      <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        {label}
      </span>
      <div className="mt-2 flex flex-wrap gap-1">
        {PITCH_CLASSES.map((pc) => (
          <button
            key={pc}
            type="button"
            onClick={() => onChange(pc)}
            className={`inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs font-medium transition ${
              value === pc
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink)] hover:border-[var(--line-strong)]'
            }`}
            title={PC_LABEL[pc]}
          >
            {pc}
          </button>
        ))}
      </div>
    </div>
  );
}

// midi number for `pc` in the given octave. C4 is midi 60.
function midiFor(pc: PitchClass, octave: number): number {
  const semi = PITCH_CLASSES.indexOf(pc);
  return semi + (octave + 1) * 12;
}
