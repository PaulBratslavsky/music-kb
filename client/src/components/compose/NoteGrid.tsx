// A piano-roll lane for melody or bass. Rows are the seven scale degrees
// (degree 7 on top, degree 1 at the bottom, each labeled with its note
// name in the current key); columns are the 32 beats. Monophonic per
// column: clicking a cell sets that beat's note, clicking the active cell
// again clears it. Hovering a cell auditions the pitch.

import type { Composition, Degree, DegreeCell } from '#/lib/music/compose/types';
import { TOTAL_STEPS } from '#/lib/music/compose/types';
import { keyToScaleSelection, resolveMelodyMidi, resolveBassMidi } from '#/lib/music/compose/playback';
import { getScalePitchClasses } from '#/lib/music/theory/scales';
import { synth } from '#/lib/music/audio/synth';
import { LABEL_W, TRACK_COLS, isBarStart } from './laneLayout';

const DEGREES: Degree[] = [7, 6, 5, 4, 3, 2, 1];

export function NoteGrid({
  comp,
  lane,
  cells,
  currentStep,
  color,
  onToggle,
}: {
  comp: Composition;
  lane: 'melody' | 'bass';
  cells: (DegreeCell | null)[];
  currentStep: number | null;
  color: string;
  onToggle: (step: number, degree: Degree) => void;
}) {
  const pcs = getScalePitchClasses(keyToScaleSelection(comp)); // index 0 = degree 1
  const resolve = lane === 'melody' ? resolveMelodyMidi : resolveBassMidi;

  const preview = (degree: Degree) => {
    const midi = resolve(comp, { degree, octave: 0 });
    if (midi != null) synth.playNote(midi, 260);
  };

  return (
    <div className="flex flex-col">
      {DEGREES.map((degree) => (
        <div key={degree} className="flex items-stretch" style={{ height: 18 }}>
          <div
            style={{ width: LABEL_W }}
            className="flex flex-shrink-0 items-center justify-end gap-1 pr-1.5 text-[9px] leading-none text-[var(--ink-muted)]"
          >
            <span className="tabular-nums">{degree}</span>
            <span className="font-medium text-[var(--ink-soft)]">
              {pcs[degree - 1] ?? ''}
            </span>
          </div>
          <div
            className="grid flex-1"
            style={{ gridTemplateColumns: TRACK_COLS }}
          >
            {Array.from({ length: TOTAL_STEPS }, (_, step) => {
              const active = cells[step]?.degree === degree;
              const isPlayhead = step === currentStep;
              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => onToggle(step, degree)}
                  onMouseEnter={() => preview(degree)}
                  className={`border-b border-r transition ${
                    isBarStart(step)
                      ? 'border-l border-l-[var(--line)]'
                      : ''
                  } ${
                    isPlayhead
                      ? 'bg-[var(--accent-soft)]'
                      : 'hover:bg-[var(--bg-subtle)]'
                  }`}
                  style={{
                    borderColor: 'var(--line)',
                    backgroundColor: active ? color : undefined,
                  }}
                  aria-label={`${lane} degree ${degree} beat ${step + 1}`}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
