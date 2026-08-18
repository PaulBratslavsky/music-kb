// The selected section's chords, sitting directly under the player.
//
// This is the play-along surface: loop a section and its chords are right
// there under the video, with the one you should be playing lit up as the
// playhead moves. No transport of its own — the video IS the transport.
//
// Timing is per BAR, not per chord. See activeIndex.

import { ChordMini } from './ChordMini';
import { chordLabel } from './chordShapes';
import { usePlayerControl } from './Player';
import type { PlayAlongInstrument } from './usePlayAlongInstrument';
import type { SavedLoop, SavedProgression } from './types';

/**
 * Which chord the playhead is on.
 *
 * Splitting the section evenly by chord count is wrong the moment the
 * section is longer than the progression: an 8-bar section with a 4-chord
 * progression would stretch each chord across two bars instead of cycling
 * the progression twice. With `bars` set, each chord gets one bar and the
 * progression repeats to fill the section.
 *
 * Falls back to the even split when `bars` is unset.
 */
export function activeIndex(
  seconds: number,
  startSec: number,
  endSec: number,
  count: number,
  bars: number | null | undefined,
): number | null {
  if (count === 0 || endSec <= startSec) return null;
  if (seconds < startSec || seconds >= endSec) return null;
  const elapsed = seconds - startSec;
  const total = endSec - startSec;
  if (bars && bars > 0) {
    const barDuration = total / bars;
    return Math.floor(elapsed / barDuration) % count;
  }
  return Math.min(count - 1, Math.floor(elapsed / (total / count)));
}

const fmt = (sec: number) => {
  const t = Math.max(0, Math.round(sec));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
};

export function SectionChordStrip({
  loop,
  progression,
  onBarsChange,
  onTimesSave,
  instrument,
  onInstrumentChange,
}: {
  loop: SavedLoop | null;
  progression: SavedProgression | null;
  /** Owned by the page so the scale board below reads the same value —
   *  two calls to usePlayAlongInstrument would be two React states. */
  instrument: PlayAlongInstrument;
  onInstrumentChange: (next: PlayAlongInstrument) => void;
  onBarsChange: (bars: number) => void;
  onTimesSave: (startSec: number, endSec: number) => void;
}) {
  const { currentSeconds, loopStartSec, loopEndSec } = usePlayerControl();

  if (!loop) return null;

  const chords = progression?.chords ?? [];
  const active = activeIndex(
    currentSeconds,
    loop.startSec,
    loop.endSec,
    chords.length,
    loop.bars,
  );

  // The A/B fields above already edit the player's region; offer to write
  // it back to the section explicitly rather than auto-saving every nudge.
  const start = loopStartSec;
  const end = loopEndSec;
  const timesChanged =
    start != null &&
    end != null &&
    end > start &&
    (Math.round(start) !== loop.startSec || Math.round(end) !== loop.endSec);

  const bars = loop.bars ?? chords.length;
  const cycles =
    chords.length > 0 && bars % chords.length === 0
      ? `${bars / chords.length}× through`
      : 'partial cycle';

  return (
    <div className="panel mt-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--text-dim)]">
          {loop.label}
        </span>
        <span className="font-mono text-xs text-[var(--text-dim)]">
          {fmt(loop.startSec)}–{fmt(loop.endSec)}
        </span>

        {chords.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
            Bars
            <input
              type="number"
              min={1}
              max={512}
              value={bars}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 512) onBarsChange(n);
              }}
              title="How many bars this section runs for. The progression repeats to fill it — 4 chords over 8 bars plays twice."
              className="w-14 rounded border border-[var(--border)] bg-[var(--panel-2)] px-1 py-0.5 font-[inherit] text-xs text-[var(--text)]"
            />
            <span className="text-[11px]">
              {chords.length} chords · {cycles}
            </span>
          </label>
        )}

        {timesChanged && (
          <button
            type="button"
            className="chip active px-2.5 py-0.5 text-xs"
            onClick={() => onTimesSave(Math.round(start), Math.round(end))}
            title="Write the loop region above back to this section"
          >
            Update section to {fmt(start)}–{fmt(end)}
          </button>
        )}

        {chords.length > 0 && (
          <span className="inline-flex gap-1">
            {(['guitar', 'piano', 'push'] as const).map((i) => (
              <button
                key={i}
                type="button"
                className={`chip px-2 py-0.5 text-[11px]${instrument === i ? ' active' : ''}`}
                onClick={() => onInstrumentChange(i)}
              >
                {i === 'guitar' ? 'Guitar' : i === 'piano' ? 'Piano' : 'Push'}
              </button>
            ))}
          </span>
        )}

        {chords.length === 0 && (
          <span className="text-xs text-[var(--text-dim)]">
            No progression linked — pick one on the section in the Loops panel.
          </span>
        )}
      </div>

      {chords.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {chords.map((c, i) => {
            const isActive = active === i;
            return (
              <figure
                key={`${c.root}-${c.quality}-${c.voicingIndex ?? 0}-${i}`}
                className={`m-0 rounded-[10px] border px-2 pb-1.5 pt-2 ${
                  isActive
                    ? 'border-[var(--accent)] bg-[var(--chip-hover)]'
                    : 'border-[var(--border)] bg-[var(--panel-2)]'
                }`}
              >
                <div className="flex min-h-[60px] justify-center">
                  <ChordMini
                    chord={c}
                    // Bass reads the same chord charts a guitarist does, so
                    // it falls back to the guitar box; piano and Push each
                    // have their own picture.
                    instrument={
                      instrument === 'piano' || instrument === 'push'
                        ? instrument
                        : 'guitar'
                    }
                    size="fill"
                  />
                </div>
                <figcaption
                  className={`mt-1 text-center text-[13px] font-bold ${
                    isActive ? 'text-[var(--accent)]' : 'text-[var(--text)]'
                  }`}
                >
                  {chordLabel(c)}
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}
