// "How this chord is built" — the stack, spelled out.
//
// The instrument views show WHERE the chord tones are. This shows HOW you
// get to them: the scale degrees, and the half-step gap between each
// adjacent pair. Once you can read "4 then 3" you can build a major triad
// from any root without looking anything up.
//
// Root position only — in an inversion the notes are re-stacked, so the
// gaps you'd read off belong to the inversion, not the chord's formula.

import { getChordPitchClasses } from '../theory/chords';
import { chordDegrees } from '../theory/degrees';
import { PITCH_CLASSES } from '../types';
import type { ChordQuality, PitchClass } from '../types';

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
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        background: 'var(--panel-2)',
        padding: 12,
        marginTop: 12,
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-dim)',
        }}
      >
        How it's built
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 8 }}>
        {pcs.map((pc, i) => (
          <span key={`${pc}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'center',
                lineHeight: 1.15,
                padding: '3px 7px',
                borderRadius: 8,
                background: 'var(--panel)',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                {pretty(pc)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: i === 0 ? 'var(--accent)' : 'var(--text-dim)',
                }}
              >
                {pretty(degrees[pc] ?? '?')}
              </span>
            </span>
            {i < steps.length && (
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 2px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>
                  +{steps[i]}
                </span>
                <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>
                  {STEP_SHORT[steps[i]] ?? steps[i]}
                </span>
              </span>
            )}
          </span>
        ))}
      </div>

      <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-dim)' }}>
        Stack from the root:{' '}
        <strong style={{ color: 'var(--text)' }}>
          {steps.join(' + ')} half steps
        </strong>{' '}
        ({steps.map((s) => STEP_NAME[s] ?? `${s} semitones`).join(', then a ')}).
        From the root that lands on{' '}
        <strong style={{ color: 'var(--text)' }}>{fromRoot.join(', ')}</strong>{' '}
        half steps up.
      </p>
    </div>
  );
}
