// The diatonic chord palette — "Chords in {key}". One chip per scale
// degree (I, ii, iii, IV, V, vi, vii°), colored to match the chord
// blocks. Clicking a chip either re-colors the selected block's degree
// or drops a new chord at the cursor (the Composer decides which).

import { useMemo } from 'react';
import type { Composition, Degree } from '#/lib/music/compose/types';
import { keyToScaleSelection } from '#/lib/music/compose/playback';
import { getDiatonicChords } from '@music-kb/music/theory/diatonic';
import { triadLabel } from '#/lib/music/compose/labels';
import { degreeColor } from '#/lib/music/compose/colors';
import { resolveChordMidis } from '#/lib/music/compose/playback';
import { synth } from '#/lib/music/audio/synth';
import { SCALE_TYPE_LABELS } from '@music-kb/music/theory/scales';

export function ChordPalette({
  comp,
  seventh,
  onPick,
}: {
  comp: Composition;
  /** Whether a placed/previewed chord sounds as a four-note seventh. */
  seventh: boolean;
  onPick: (degree: Degree) => void;
}) {
  const diatonic = useMemo(
    () => getDiatonicChords(keyToScaleSelection(comp)),
    [comp],
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-[var(--ink-muted)]">
        Chords in{' '}
        <span className="font-semibold text-[var(--ink)]">
          {comp.key.root} {SCALE_TYPE_LABELS[comp.key.mode === 'major' ? 'major' : 'minor']}
        </span>
      </span>
      {diatonic.map((c) => {
        const label = triadLabel(c);
        return (
          <button
            key={c.degree}
            type="button"
            onClick={() => {
              onPick(c.degree as Degree);
              const midis = resolveChordMidis(comp, c.degree as Degree, seventh);
              if (midis.length) synth.playChord(midis, 700, 'string');
            }}
            className="flex min-w-[2.75rem] flex-col items-center rounded px-2 py-1 text-white transition hover:opacity-90"
            style={{ backgroundColor: degreeColor(c.degree) }}
            title={`${label.name} — click a bar first to place, or a block to change it`}
          >
            <span className="text-sm font-bold leading-none">{label.roman}</span>
            <span className="text-[10px] leading-tight opacity-90">
              {label.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
