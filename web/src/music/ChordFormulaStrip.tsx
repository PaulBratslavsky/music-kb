// "How this chord is built" — the stack, spelled out.
//
// The instrument views show WHERE the chord tones are. This shows HOW you
// get to them: the scale degrees, and the half-step gap between each
// adjacent pair. Once you can read "4 then 3" you can build a major triad
// from any root without looking anything up.
//
// Root position only — in an inversion the notes are re-stacked, so the
// gaps you'd read off belong to the inversion, not the chord's formula.

import { getChordPitchClasses } from '@music-kb/music/theory/chords';
import { chordDegrees } from '@music-kb/music/theory/degrees';
import { PITCH_CLASSES } from '@music-kb/music/types';
import type { ChordQuality, PitchClass } from '@music-kb/music/types';

/** "F#" → "F♯", "Bb" → "B♭". */
const pretty = (name: string) => name.replace(/#/g, '♯').replace(/b/g, '♭');

/**
 * Short interval labels. Half and whole steps get H/W because that is how
 * they are counted; anything wider gets its interval name, because "1.5
 * whole steps" is not how a minor 3rd is ever thought about.
 */
const STEP_SHORT: Record<number, string> = {
  1: 'H', 2: 'W', 3: 'm3', 4: 'M3', 5: 'P4', 6: 'TT',
  7: 'P5', 8: 'm6', 9: 'M6', 10: 'm7', 11: 'M7',
};

const STEP_NAME: Record<number, string> = {
  1: 'half step', 2: 'whole step', 3: 'minor 3rd', 4: 'major 3rd',
  5: 'perfect 4th', 6: 'tritone', 7: 'perfect 5th', 8: 'minor 6th',
  9: 'major 6th', 10: 'minor 7th', 11: 'major 7th',
};

const semitonesUp = (from: PitchClass, to: PitchClass) =>
  (PITCH_CLASSES.indexOf(to) - PITCH_CLASSES.indexOf(from) + 12) % 12;

export function ChordFormulaStrip({
  root,
  quality,
}: {
  root: PitchClass;
  quality: ChordQuality;
}) {
  const pcs = getChordPitchClasses(root, quality);
  if (pcs.length < 2) return null;

  const degrees = chordDegrees(root, quality);
  // Gaps between ADJACENT tones as stacked — the recipe you follow with
  // your fingers, not the interval from the root.
  const steps = pcs.slice(1).map((pc, i) => semitonesUp(pcs[i], pc));
  const fromRoot = pcs.slice(1).map((pc) => semitonesUp(root, pc));

  return (
    <div className="mt-3 rounded-[10px] border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-[var(--text-dim)]">
        How it's built
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {pcs.map((pc, i) => (
          <span key={`${pc}-${i}`} className="flex items-center gap-1">
            <span className="inline-flex flex-col items-center rounded-lg bg-[var(--panel)] px-[7px] py-[3px] leading-[1.15]">
              <span className="text-xs font-bold text-[var(--text)]">
                {pretty(pc)}
              </span>
              <span
                className={`text-[10px] font-bold ${
                  i === 0 ? 'text-[var(--accent)]' : 'text-[var(--text-dim)]'
                }`}
              >
                {pretty(degrees[pc] ?? '?')}
              </span>
            </span>
            {i < steps.length && (
              <span className="flex flex-col items-center px-0.5">
                <span className="text-[11px] font-bold text-[var(--accent)]">
                  +{steps[i]}
                </span>
                <span className="text-[9px] text-[var(--text-dim)]">
                  {STEP_SHORT[steps[i]] ?? steps[i]}
                </span>
              </span>
            )}
          </span>
        ))}
      </div>

      <p className="mb-0 mt-2 text-[11px] text-[var(--text-dim)]">
        Stack from the root:{' '}
        <strong className="text-[var(--text)]">
          {steps.join(' + ')} half steps
        </strong>{' '}
        ({steps.map((s) => STEP_NAME[s] ?? `${s} semitones`).join(', then a ')}).
        From the root that lands on{' '}
        <strong className="text-[var(--text)]">{fromRoot.join(', ')}</strong>{' '}
        half steps up.
      </p>
    </div>
  );
}
