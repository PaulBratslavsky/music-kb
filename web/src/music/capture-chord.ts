// What the Builder's "+ Add chord" captures from the current selection.
//
// Split out of ChordBuilderPanel so the rule is a pure function with its own
// tests — the arpeggio case is subtle enough to be worth pinning rather than
// leaving inline in JSX.

import type { AppState } from '@music-kb/music/types';
import type { ProgressionChord } from './types';

/**
 * The chord to append for the current view mode, or null when the mode has
 * no single chord to add (scale / note / all).
 *
 * Chord mode captures the selection verbatim: `inversion` and `voicingIndex`
 * pin the exact grip on screen, which is the whole point of saving it.
 *
 * Arpeggio mode shares chord mode's root + quality picker but has no single
 * voicing — `urlFromState` omits `inv` and `v` for exactly that reason. The
 * in-memory `state.chord` still holds whatever chord mode last set, so those
 * two are normalised to 0 here; carrying them over would save a grip the
 * arpeggio view never drew.
 */
export function chordToCapture(state: AppState): ProgressionChord | null {
  if (state.mode === 'chord') return { ...state.chord };
  if (state.mode === 'arpeggio') {
    return {
      root: state.chord.root,
      quality: state.chord.quality,
      inversion: 0,
      voicingIndex: 0,
    };
  }
  return null;
}
