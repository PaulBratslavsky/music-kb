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

import { useState } from 'react';
import { getDiatonicChords, type DiatonicChord } from '@music-kb/music/theory/diatonic';
import {
  useProgressionPlayback,
  type ChordStep,
} from '#/components/practice/useProgressionPlayback';
import { PITCH_CLASSES, type ChordQuality, type PitchClass } from '@music-kb/music/types';
import {
  generateProgression,
  STYLE_OPTIONS,
  type ProgressionStyle,
} from '@music-kb/music/theory/progression-generator';

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
  const [style, setStyle] = useState<ProgressionStyle>('pop');
  const [genLength, setGenLength] = useState(4);
  const [rationale, setRationale] = useState<string | null>(null);

  const diatonic = getDiatonicChords({ root: keyRoot, type: keyMode });

  /**
   * Roll a new progression. The musical rules live in
   * generateProgression (functional harmony + a real cadence); this only
   * maps the returned scale degrees onto the key's actual chords.
   */
  const generate = () => {
    const result = generateProgression({ mode: keyMode, style, length: genLength });
    const steps: ChordStep[] = [];
    for (const degree of result.degrees) {
      const d = diatonic[degree - 1];
      if (!d) continue;
      // A raised 7th turns the minor v into a major V — the whole point of
      // the borrow, so the chord has to change with it.
      if (result.raisedSeventh && degree === 5) {
        steps.push({ root: d.root, quality: 'maj', chordName: `${d.rootDisplay}` });
        continue;
      }
      const q = triadQualityOf(d);
      if (!q) continue;
      steps.push({ root: d.root, quality: q, chordName: d.chordName });
    }
    setProgression(steps);
    setRationale(result.rationale);
  };

  const addChord = (d: DiatonicChord) => {
    const q = triadQualityOf(d);
    if (!q) return;
    setProgression((prev) => [
      ...prev,
      { root: d.root, quality: q, chordName: d.chordName },
    ]);
    setRationale(null);
  };

  const removeAt = (i: number) => {
    setProgression((prev) => prev.filter((_, idx) => idx !== i));
    setRationale(null);
  };

  const clear = () => {
    setIsPlaying(false);
    setProgression([]);
    setRationale(null);
  };

  const { currentIdx } = useProgressionPlayback({
    steps: progression,
    bpm,
    beatsPerChord,
    isPlaying,
  });

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

      {/* Generator. Sits between the chips and the progression strip: the
          chips are for building by hand, this is for being handed a starting
          point that already obeys functional harmony. */}
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={generate}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-hover)]"
          >
            <span aria-hidden>🎲</span> Generate
          </button>

          <div
            className="inline-flex flex-wrap items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5 text-xs"
            role="radiogroup"
            aria-label="Progression style"
          >
            {STYLE_OPTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={style === s.id}
                onClick={() => setStyle(s.id)}
                className={`rounded-full px-3 py-1 font-medium transition ${
                  style === s.id
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div
            className="inline-flex items-center gap-1 text-xs"
            role="radiogroup"
            aria-label="Number of chords"
          >
            <span className="mr-1 font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Bars
            </span>
            <div className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] p-0.5">
              {[2, 4, 8].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={genLength === n}
                  onClick={() => setGenLength(n)}
                  className={`rounded-full px-2.5 py-1 font-medium transition ${
                    genLength === n
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--ink-soft)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        {rationale ? (
          <p className="mt-2.5 text-xs text-[var(--ink-soft)]">
            <span className="font-semibold text-[var(--ink)]">Why it works:</span>{' '}
            {rationale}
          </p>
        ) : (
          <p className="mt-2.5 text-xs text-[var(--ink-muted)]">
            Rolls a progression that follows functional harmony — starts on the
            tonic, moves tonic → predominant → dominant, and lands on a real
            cadence instead of stopping wherever a random walk happened to end.
          </p>
        )}
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
