// Progression Player.
//
// User picks a key (root + major/minor), clicks diatonic chord chips to
// append them to a progression, then hits Play to hear it cycle at a
// chosen tempo. Each chord plays as a closed triad via the global synth
// singleton. The currently-playing chord pulses in the progression strip
// so the user can see + hear the position.
//
// Intentionally minimal:
//   - No save/load (ephemeral; the LoopBuilder owns persistent
//     progressions tied to videos).
//   - No swing / accent / metronome — just steady downbeats.
//   - No chord-out-of-key entry; click the 7 diatonic chips only.
//
// The chip set is what `getDiatonicChords` returns — major key gets the
// 7 sevenths (Imaj7, iim7, ...); minor key gets the natural-minor 7ths.

import { useEffect, useRef, useState } from 'react';
import { getDiatonicChords, type DiatonicChord } from '#/lib/music/theory/diatonic';
import { getChordPitchClasses, stackAscending } from '#/lib/music/theory/chords';
import { midiFromPitchOctave } from '#/lib/music/theory/notes';
import { synth } from '#/lib/music/audio/synth';
import { PITCH_CLASSES, type ChordQuality, type PitchClass } from '#/lib/music/types';

type ChordStep = {
  root: PitchClass;
  /** ChordQuality used by getChordPitchClasses to compute the triad. */
  quality: ChordQuality;
  /** Display chord name (e.g. "Cmaj7", "Dm7"). */
  chordName: string;
};

// Pick a sensible triad-level quality for each diatonic chord. We use the
// triad (not the 7th) so playback sounds clean — adding a 7th to every
// chord makes a I-IV-V cycle muddy. The chip still displays the 7th
// chord name so the user knows what they're picking.
function triadQualityOf(d: DiatonicChord): ChordQuality | null {
  const s = d.qualitySuffix;
  if (s === 'maj7' || s === '7') return 'maj';
  if (s === 'm7') return 'min';
  if (s === 'm7b5') return 'dim'; // approximate — half-dim's triad is dim
  if (s === 'dim7') return 'dim';
  if (s === 'mMaj7') return 'min';
  return d.quality; // for plain triads if anything ever lands here
}

export function ProgressionPlayer() {
  const [keyRoot, setKeyRoot] = useState<PitchClass>('C');
  const [keyMode, setKeyMode] = useState<'major' | 'minor'>('major');
  const [progression, setProgression] = useState<ChordStep[]>([]);
  const [bpm, setBpm] = useState(90);
  const [beatsPerChord, setBeatsPerChord] = useState(2);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);

  const diatonic = getDiatonicChords({ root: keyRoot, type: keyMode });

  const addChord = (d: DiatonicChord) => {
    const q = triadQualityOf(d);
    if (!q) return;
    setProgression((prev) => [
      ...prev,
      { root: d.root, quality: q, chordName: d.chordName },
    ]);
  };

  const removeAt = (i: number) =>
    setProgression((prev) => prev.filter((_, idx) => idx !== i));

  const clear = () => {
    setIsPlaying(false);
    setProgression([]);
    setCurrentIdx(null);
  };

  // Play loop. We re-arm the setInterval each time bpm/beats/progression
  // change while playing so live tempo + progression edits take effect on
  // the next beat boundary.
  const idxRef = useRef(0);
  useEffect(() => {
    if (!isPlaying || progression.length === 0) {
      setCurrentIdx(null);
      return;
    }
    const tickMs = (60_000 / bpm) * beatsPerChord;
    idxRef.current = 0;
    const playChord = (step: ChordStep) => {
      const pcs = getChordPitchClasses(step.root, step.quality);
      const notes = stackAscending(pcs, 4);
      synth.playChord(notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave)));
    };
    setCurrentIdx(0);
    playChord(progression[0]);
    const id = setInterval(() => {
      idxRef.current = (idxRef.current + 1) % progression.length;
      setCurrentIdx(idxRef.current);
      playChord(progression[idxRef.current]);
    }, tickMs);
    return () => clearInterval(id);
  }, [isPlaying, progression, bpm, beatsPerChord]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--ink-soft)]">
        Pick a key, click the diatonic chord chips to build a progression,
        then press Play. Each chord cycles at your chosen tempo.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Key
          </span>
          <div className="inline-flex flex-wrap gap-1">
            {PITCH_CLASSES.map((pc) => (
              <button
                key={pc}
                type="button"
                onClick={() => setKeyRoot(pc)}
                className={`rounded border px-2 py-0.5 text-xs font-medium transition ${
                  keyRoot === pc
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                    : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink-soft)] hover:border-[var(--accent)]'
                }`}
              >
                {pc}
              </button>
            ))}
          </div>
        </div>
        <div
          className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-xs"
          role="radiogroup"
          aria-label="Key mode"
        >
          {(['major', 'minor'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={keyMode === m}
              onClick={() => setKeyMode(m)}
              className={`rounded-full px-3 py-1 font-medium transition ${
                keyMode === m
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
              }`}
            >
              {m === 'major' ? 'Major' : 'Minor'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Diatonic chords in {keyRoot} {keyMode}
        </span>
        <div className="mt-2 flex flex-wrap gap-2">
          {diatonic.map((d) => (
            <button
              key={d.degree}
              type="button"
              onClick={() => addChord(d)}
              className="inline-flex items-baseline gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white"
              title={`Add ${d.chordName} to the progression`}
            >
              <span className="font-mono text-xs text-[var(--ink-muted)] group-hover:text-white">
                {d.roman}
              </span>
              <span className="font-semibold">{d.chordName}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Progression
          </span>
          {progression.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="text-xs text-[var(--ink-muted)] underline hover:text-[var(--ink)]"
            >
              clear
            </button>
          )}
        </div>
        {progression.length === 0 ? (
          <p className="text-xs italic text-[var(--ink-muted)]">
            Click a chord chip above to add it to the progression.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {progression.map((step, i) => {
              const isActive = isPlaying && currentIdx === i;
              return (
                <span
                  key={`${step.chordName}-${i}`}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm font-medium transition ${
                    isActive
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink)]'
                  }`}
                >
                  {step.chordName}
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className={`ml-1 rounded-full px-1 text-xs ${
                      isActive
                        ? 'text-white/70 hover:text-white'
                        : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                    }`}
                    aria-label={`Remove ${step.chordName}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setIsPlaying((p) => !p)}
          disabled={progression.length === 0}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
            progression.length === 0
              ? 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]'
              : isPlaying
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white'
          }`}
        >
          {isPlaying ? '◼ Stop' : '▶ Play'}
        </button>

        <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span className="font-semibold uppercase tracking-wide">Tempo</span>
          <input
            type="range"
            min={60}
            max={180}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-32"
          />
          <span className="font-mono text-sm text-[var(--ink)]">{bpm} BPM</span>
        </label>

        <div
          className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-xs"
          role="radiogroup"
          aria-label="Beats per chord"
        >
          <span className="px-2 text-[var(--ink-muted)]">Beats/chord</span>
          {[1, 2, 4].map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={beatsPerChord === b}
              onClick={() => setBeatsPerChord(b)}
              className={`rounded-full px-3 py-1 font-medium transition ${
                beatsPerChord === b
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
              }`}
            >
              {b}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
