// Quick-start row that sits above the SelectionBar in TheoryCompanion.
//
// One-click shortcuts to the two specific chord types that are otherwise
// buried in the mode → quality → voicing dance:
//
//   • Power chord — switches to chord mode + sets quality to '5'. The
//     visualizer-resolved voicing is three-note (root + 5th + octave).
//     Piano and Push show the two pitch classes; the guitar shape adds
//     the doubled-root octave.
//
//   • Barre chord — switches to chord mode and jumps voicingIndex to the
//     first shape whose `barre` annotation is set. Skips the open voicing
//     when one exists. Falls back to 'maj' when the current quality has
//     no barre forms (e.g. '5', dim, aug, sus2, sus4).
//
// Self-contained: the host passes the useAppState return object and the
// component picks out exactly the slices it needs. Stays presentational —
// no business logic lives here beyond mapping chip clicks to state
// transitions defined in useAppState.

import type { useAppState } from '../state/useAppState';
import { firstBarreVoicingIndex } from '../theory/voicings/guitar';

type Props = ReturnType<typeof useAppState>;

export function QuickStartRow(props: Props) {
  const { state, selectChord, setChord } = props;

  const showPowerChord = () => {
    selectChord(state.chord.root, '5');
  };

  const showBarreChord = () => {
    const currentSel = state.chord;
    let target = currentSel;
    if (firstBarreVoicingIndex(currentSel) === -1) {
      // Current quality has no barre forms — fall back to maj barre.
      target = { ...currentSel, quality: 'maj' };
      selectChord(currentSel.root, 'maj');
    } else if (state.mode !== 'chord') {
      // Need chord mode active before voicingIndex matters.
      selectChord(currentSel.root, currentSel.quality);
    }
    const idx = firstBarreVoicingIndex(target);
    if (idx >= 0) {
      setChord((c) => ({ ...c, voicingIndex: idx, inversion: 0 }));
    }
  };

  return (
    <div className="panel quick-start-row">
      <span className="quick-start-label">Quick start:</span>
      <button
        type="button"
        className="chip"
        onClick={showPowerChord}
        title="Switch to chord mode and pick the power chord quality (root + 5th)"
      >
        Power chord
      </button>
      <button
        type="button"
        className="chip"
        onClick={showBarreChord}
        title="Switch to chord mode and jump to the first barre voicing"
      >
        Barre chord
      </button>
    </div>
  );
}
