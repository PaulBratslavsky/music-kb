// The selected section's chords, sitting directly under the player.
//
// This is the play-along surface: you loop a section, the chords for that
// section are right there under the video at full width, and the one you
// should be playing lights up as the playhead moves. No transport of its
// own — the video IS the transport, so a second play button would just be
// a way to get two clocks out of sync.
//
// Chords come from the saved Progression linked to the loop; they are
// built and named in the Chord Progression panel further down the page.

import { useState } from 'react';
import { ChordMini } from '#/components/ChordMini';
import { usePlayerControl } from '#/components/player';
import { updateLoop } from '#/data/server-functions/loops';
import { QUALITY_LABELS } from '#/lib/music/theory/quality-labels';
import { PITCH_CLASSES, type ChordQuality, type PitchClass } from '#/lib/music/types';
import type { StrapiLoop } from '#/lib/services/loops';
import type { ProgressionChord } from '#/lib/services/progressions';
import type { PlayAlongInstrument } from '#/components/usePlayAlongInstrument';

const isPitchClass = (v: unknown): v is PitchClass =>
  typeof v === 'string' && (PITCH_CLASSES as readonly string[]).includes(v);

/**
 * Same labelling rule as the Chord Progression panel: a detect-captured
 * shape shows its detected name (e.g. "Cmaj7/E"), otherwise root + quality.
 */
function chordLabel(c: ProgressionChord): string {
  if (c.detectedLabel) return c.detectedLabel;
  return `${c.root}${QUALITY_LABELS[c.quality as ChordQuality] ?? c.quality}`;
}

/**
 * The saved chords, untouched. inversion / voicingIndex / positions all
 * ride along so the diagram here is the same one the panel drew — dropping
 * them silently re-voiced every chord (an open Cmaj7/E became an 8th-fret
 * barre).
 */
function chordsOf(loop: StrapiLoop | null): ProgressionChord[] {
  const raw = loop?.savedProgression?.chords;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => isPitchClass(c.root));
}

/**
 * Which chord the playhead is on.
 *
 * Timing is per BAR, not per chord. Splitting the section evenly by chord
 * count is wrong the moment the section is longer than the progression: an
 * 8-bar section with a 4-chord progression would stretch each chord to two
 * bars instead of cycling the progression twice. With `bars` set, each
 * chord gets one bar and the progression repeats to fill the section.
 *
 * Falls back to the even split when `bars` is unset, which is the same
 * one-cycle behaviour as before.
 */
export function activeIndex(
  seconds: number,
  startSec: number,
  endSec: number,
  count: number,
  bars: number | null,
): number | null {
  if (count === 0 || endSec <= startSec) return null;
  if (seconds < startSec || seconds >= endSec) return null;
  const elapsed = seconds - startSec;
  const total = endSec - startSec;
  if (bars && bars > 0) {
    const barDuration = total / bars;
    const barIndex = Math.floor(elapsed / barDuration);
    return barIndex % count;
  }
  return Math.min(count - 1, Math.floor(elapsed / (total / count)));
}

const fmt = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
};

export function SectionChordStrip({
  loop,
  onTimesSaved,
  instrument,
  onInstrumentChange,
}: {
  loop: StrapiLoop | null;
  /** Bump the loops list so the row shows the new range. */
  onTimesSaved?: () => void;
  /** Shared with the scale panel — see usePlayAlongInstrument. */
  instrument: PlayAlongInstrument;
  onInstrumentChange: (next: PlayAlongInstrument) => void;
}) {
  const { currentSeconds, loopStartSec, loopEndSec } = usePlayerControl();
  const [saving, setSaving] = useState(false);
  const chords = chordsOf(loop);

  if (!loop) return null;

  // The A/B fields above already edit the player's region. Offer to write
  // that region back to the section, explicitly — auto-saving would rewrite
  // a saved section every time the handles were nudged while scrubbing.
  const start = loopStartSec;
  const end = loopEndSec;
  const timesChanged =
    start != null &&
    end != null &&
    end > start &&
    (Math.round(start) !== loop.startSec || Math.round(end) !== loop.endSec);

  const saveTimes = () => {
    if (!timesChanged) return;
    setSaving(true);
    void updateLoop({
      data: {
        documentId: loop.documentId,
        startSec: Math.round(start),
        endSec: Math.round(end),
      },
    })
      .then(() => onTimesSaved?.())
      .finally(() => setSaving(false));
  };

  const active =
    chords.length > 0
      ? activeIndex(
          currentSeconds,
          loop.startSec,
          loop.endSec,
          chords.length,
          loop.bars ?? null,
        )
      : null;

  const saveBars = (bars: number | null) => {
    setSaving(true);
    void updateLoop({ data: { documentId: loop.documentId, bars } })
      .then(() => onTimesSaved?.())
      .finally(() => setSaving(false));
  };

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          {loop.label}
        </span>
        <span className="font-mono text-xs text-[var(--ink-muted)]">
          {fmt(loop.startSec)}–{fmt(loop.endSec)}
        </span>
        {timesChanged && (
          <button
            type="button"
            onClick={saveTimes}
            disabled={saving}
            className="rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent)] hover:text-white disabled:opacity-50"
            title="Write the loop region above back to this section"
          >
            {saving
              ? 'saving…'
              : `Update section to ${fmt(start!)}–${fmt(end!)}`}
          </button>
        )}
        {chords.length > 0 && (
          <label className="flex items-center gap-1 text-xs text-[var(--ink-muted)]">
            Bars
            <input
              type="number"
              min={1}
              max={512}
              value={loop.bars ?? chords.length}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 512) saveBars(n);
              }}
              title="How many bars this section runs for. The progression repeats to fill it — 4 chords over 8 bars plays twice."
              className="w-14 rounded border border-[var(--line)] bg-[var(--card)] px-1 py-0.5 text-xs text-[var(--ink)]"
            />
            <span className="text-[0.65rem]">
              {chords.length} chords ·{' '}
              {(loop.bars ?? chords.length) % chords.length === 0
                ? `${(loop.bars ?? chords.length) / chords.length}× through`
                : 'partial cycle'}
            </span>
          </label>
        )}
        <div className="ml-auto flex items-center gap-1">
          {(['guitar', 'piano', 'bass'] as const).map((inst) => (
            <button
              key={inst}
              type="button"
              aria-pressed={instrument === inst}
              onClick={() => onInstrumentChange(inst)}
              className={`rounded-lg px-2 py-1 text-xs font-medium capitalize ${
                instrument === inst
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              {inst}
            </button>
          ))}
        </div>
        {chords.length === 0 && (
          <span className="text-xs text-[var(--ink-muted)]">
            No progression linked — pick one on the section in the Loops panel.
          </span>
        )}
      </div>

      {chords.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {chords.map((c, i) => (
            <figure
              key={`${c.root}-${c.quality}-${c.voicingIndex ?? 0}-${i}`}
              className={`m-0 rounded-xl border px-2 pb-1.5 pt-2 transition ${
                active === i
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-[var(--line)] bg-[var(--bg-subtle)]'
              }`}
            >
              <div className="flex w-full justify-center">
                <ChordMini
                  chord={c}
                  instrument={instrument === 'piano' ? 'piano' : 'guitar'}
                  orientation="horizontal"
                  size="fill"
                />
              </div>
              <figcaption
                className={`mt-1 text-center text-sm font-bold ${
                  active === i ? 'text-[var(--accent)]' : 'text-[var(--ink)]'
                }`}
              >
                {chordLabel(c)}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
