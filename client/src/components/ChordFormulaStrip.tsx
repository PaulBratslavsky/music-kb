// "How this chord is built" — the stack, spelled out.
//
// The instrument views show you WHERE the chord tones are. This shows HOW
// you get to them: the scale degrees, and the half-step gap between each
// adjacent pair. Once you can read "4 then 3" you can build a major triad
// from any root without looking anything up, which is the whole point.
//
// Root position only. In an inversion the notes are re-stacked, so the
// gaps you'd read off are the inversion's, not the chord's formula — the
// caller hides this rather than teach the wrong number.

import { getChordPitchClasses } from '@music-kb/music/theory/chords';
import { chordDegrees } from '@music-kb/music/theory/degrees';
import { prettyAccidentals } from '#/components/lesson/labels';
import { PITCH_CLASSES, type ChordQuality, type PitchClass } from '@music-kb/music/types';

/**
 * Short interval labels. Half and whole steps get H/W because that is how
 * they are counted; anything wider gets its interval name, because "1.5
 * whole steps" is not how a minor 3rd is ever thought about.
 */
const STEP_SHORT: Record<number, string> = {
  1: 'H',
  2: 'W',
  3: 'm3',
  4: 'M3',
  5: 'P4',
  6: 'TT',
  7: 'P5',
  8: 'm6',
  9: 'M6',
  10: 'm7',
  11: 'M7',
};

/** Interval names by semitone count, as used between stacked chord tones. */
const STEP_NAME: Record<number, string> = {
  1: 'half step',
  2: 'whole step',
  3: 'minor 3rd',
  4: 'major 3rd',
  5: 'perfect 4th',
  6: 'tritone',
  7: 'perfect 5th',
  8: 'minor 6th',
  9: 'major 6th',
  10: 'minor 7th',
  11: 'major 7th',
};

const semitonesUp = (from: PitchClass, to: PitchClass) =>
  (PITCH_CLASSES.indexOf(to) - PITCH_CLASSES.indexOf(from) + 12) % 12;

export function ChordFormulaStrip({
  root,
  quality,
  preferFlats = false,
}: {
  root: PitchClass;
  quality: ChordQuality;
  preferFlats?: boolean;
}) {
  const pcs = getChordPitchClasses(root, quality);
  if (pcs.length < 2) return null;

  const degrees = chordDegrees(root, quality);
  const label = (pc: PitchClass) =>
    prettyAccidentals(
      preferFlats
        ? (PITCH_CLASSES[PITCH_CLASSES.indexOf(pc)] ?? pc)
        : pc,
    );

  // Gaps between ADJACENT tones as stacked — this is the recipe you follow
  // with your fingers, not the interval from the root.
  const steps = pcs.slice(1).map((pc, i) => semitonesUp(pcs[i], pc));
  const totalFromRoot = pcs.map((pc) => semitonesUp(root, pc));

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        How it's built
      </p>

      {/* The stack: note, gap, note, gap … */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {pcs.map((pc, i) => (
          <span key={`${pc}-${i}`} className="flex items-center gap-1">
            <span className="inline-flex flex-col items-center rounded-lg bg-[var(--card)] px-2 py-1 leading-tight">
              <span className="text-xs font-bold text-[var(--ink)]">
                {label(pc)}
              </span>
              <span
                className={`text-[0.6rem] font-bold ${
                  i === 0 ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'
                }`}
              >
                {prettyAccidentals(degrees[pc] ?? '?')}
              </span>
            </span>
            {i < steps.length && (
              <span className="flex flex-col items-center px-0.5">
                <span className="text-[0.7rem] font-bold text-[var(--accent)]">
                  +{steps[i]}
                </span>
                <span className="text-[0.55rem] text-[var(--ink-muted)]">
                  {STEP_SHORT[steps[i]] ?? `${steps[i]}`}
                </span>
              </span>
            )}
          </span>
        ))}
      </div>

      <p className="mt-2 text-[0.7rem] text-[var(--ink-soft)]">
        Stack from the root:{' '}
        <strong className="text-[var(--ink)]">
          {steps.join(' + ')} half steps
        </strong>
        {steps.length > 0 && (
          <>
            {' '}
            ({steps.map((s) => STEP_NAME[s] ?? `${s} semitones`).join(', then a ')})
          </>
        )}
        . From the root that lands on{' '}
        {totalFromRoot.slice(1).map((n, i) => (
          <span key={n}>
            {i > 0 && ', '}
            <strong className="text-[var(--ink)]">{n}</strong>
          </span>
        ))}{' '}
        half steps up.
      </p>
    </div>
  );
}
