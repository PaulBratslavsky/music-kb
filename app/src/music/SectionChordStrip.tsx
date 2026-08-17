// The selected section's chords, sitting directly under the player.
//
// This is the play-along surface: loop a section and its chords are right
// there under the video, with the one you should be playing lit up as the
// playhead moves. No transport of its own — the video IS the transport.
//
// Timing is per BAR, not per chord. See activeIndex.

import { useState } from 'react';
import { ChordMini } from './ChordMini';
import { chordLabel } from './chordShapes';
import { usePlayerControl } from './Player';
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
}: {
  loop: SavedLoop | null;
  progression: SavedProgression | null;
  onBarsChange: (bars: number) => void;
  onTimesSave: (startSec: number, endSec: number) => void;
}) {
  const { currentSeconds, loopStartSec, loopEndSec } = usePlayerControl();
  // Play-along on either instrument — the chords are the same, only the
  // picture changes.
  const [instrument, setInstrument] = useState<'guitar' | 'piano'>('guitar');
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
    <div
      className="panel"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--panel)',
        padding: 16,
        marginTop: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--text-dim)',
          }}
        >
          {loop.label}
        </span>
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: 'var(--text-dim)' }}>
          {fmt(loop.startSec)}–{fmt(loop.endSec)}
        </span>

        {chords.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
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
              style={{
                width: 56,
                padding: '2px 4px',
                border: '1px solid var(--border)',
                borderRadius: 4,
                background: 'var(--panel-2)',
                color: 'var(--text)',
                fontFamily: 'inherit',
                fontSize: 12,
              }}
            />
            <span style={{ fontSize: 11 }}>
              {chords.length} chords · {cycles}
            </span>
          </label>
        )}

        {timesChanged && (
          <button
            type="button"
            className="chip active"
            onClick={() => onTimesSave(Math.round(start), Math.round(end))}
            title="Write the loop region above back to this section"
            style={{ fontSize: 12, padding: '2px 10px' }}
          >
            Update section to {fmt(start)}–{fmt(end)}
          </button>
        )}

        {chords.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {(['guitar', 'piano'] as const).map((i) => (
              <button
                key={i}
                type="button"
                className={`chip${instrument === i ? ' active' : ''}`}
                onClick={() => setInstrument(i)}
                style={{ fontSize: 11, padding: '2px 8px' }}
              >
                {i === 'guitar' ? 'Guitar' : 'Piano'}
              </button>
            ))}
          </span>
        )}

        {chords.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            No progression linked — pick one on the section in the Loops panel.
          </span>
        )}
      </div>

      {chords.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {chords.map((c, i) => {
            const isActive = active === i;
            return (
              <figure
                key={`${c.root}-${c.quality}-${c.voicingIndex ?? 0}-${i}`}
                style={{
                  margin: 0,
                  padding: '8px 8px 6px',
                  borderRadius: 10,
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'var(--chip-hover)' : 'var(--panel-2)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', minHeight: 60 }}>
                  <ChordMini chord={c} instrument={instrument} />
                </div>
                <figcaption
                  style={{
                    marginTop: 4,
                    textAlign: 'center',
                    fontSize: 13,
                    fontWeight: 700,
                    color: isActive ? 'var(--accent)' : 'var(--text)',
                  }}
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
