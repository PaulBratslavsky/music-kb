import {
  PITCH_CLASSES,
  SCALE_TYPES,
  type PitchClass,
  type ScalePosition,
  type ScaleType,
  type ViewMode,
} from '@music-kb/music/types';
import { SCALE_TYPE_LABELS } from '@music-kb/music/theory/scales';
import { availablePositions } from '@music-kb/music/theory/positions';
import { useAppState } from '../state/useAppState';
import { ChordControlPanel } from './ChordControlPanel';
import { FLAT_NAMES } from '@music-kb/music/theory/notes';

type Props = ReturnType<typeof useAppState>;

export function SelectionBar({
  state,
  setMode,
  setChord,
  setScale,
  pickRoot,
  setScalePosition,
  setChordDepth,
  labelMode,
  setLabelMode,
  showNaturals,
  setShowNaturals,
}: Props) {
  const modes: ViewMode[] = ['chord', 'scale', 'note', 'all'];

  return (
    <div className="panel selection-bar">
      <div className="selection-group">
        <span className="group-label">Mode</span>
        <div className="btn-row">
          {modes.map((m) => (
            <button
              key={m}
              className={`chip${state.mode === m ? ' active' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'chord' ? 'Chord' : m === 'scale' ? 'Scale' : m === 'note' ? 'Note' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {state.mode !== 'all' && (() => {
        const currentRoot: PitchClass =
          state.mode === 'chord'
            ? state.chord.root
            : state.mode === 'scale'
            ? state.scale.root
            : state.singleNote;
        return (
          <div className="selection-group">
            <span className="group-label">Root</span>
            <div className="btn-row">
              {PITCH_CLASSES.map((pc) => {
                const flatName = FLAT_NAMES[pc];
                if (!flatName) {
                  // Natural note — single, unambiguous button.
                  const active = currentRoot === pc;
                  return (
                    <button
                      key={pc}
                      className={`chip${active ? ' active' : ''}`}
                      onClick={() => pickRoot(pc, false)}
                    >
                      {pc}
                    </button>
                  );
                }
                // Accidental — stacked flat (top) / sharp (bottom) so flat keys
                // like Bb are directly selectable and spelled correctly.
                const sharpActive = currentRoot === pc && !state.preferFlats;
                const flatActive = currentRoot === pc && state.preferFlats;
                return (
                  <div key={pc} className="root-accidental">
                    <button
                      className={`chip chip-sm${flatActive ? ' active' : ''}`}
                      onClick={() => pickRoot(pc, true)}
                      title={`${flatName} (flat spelling)`}
                    >
                      {flatName}
                    </button>
                    <button
                      className={`chip chip-sm${sharpActive ? ' active' : ''}`}
                      onClick={() => pickRoot(pc, false)}
                      title={`${pc} (sharp spelling)`}
                    >
                      {pc}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {state.mode === 'chord' && (
        <ChordControlPanel chord={state.chord} setChord={setChord} />
      )}

      {state.mode === 'scale' && (
        <>
          <div className="selection-group">
            <span className="group-label">Scale</span>
            <div className="btn-row">
              {SCALE_TYPES.map((t) => (
                <button
                  key={t}
                  className={`chip${state.scale.type === t ? ' active' : ''}`}
                  onClick={() => setScale((s) => ({ ...s, type: t as ScaleType }))}
                >
                  {SCALE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>
          {/* (music-kb fork) Toggle the diatonic-chord-chip display between
              triads (C, Cm, C°) and seventh chords (Cmaj7, Cm7, m7b5). Default
              triad — matches what gets saved to the loop's progression. */}
          <div className="selection-group">
            <span className="group-label">Chord depth</span>
            <div className="btn-row">
              <button
                className={`chip${state.chordDepth === 'triad' ? ' active' : ''}`}
                onClick={() => setChordDepth('triad')}
                title="Display triads: C, Cm, C°, C+"
              >
                Triad
              </button>
              <button
                className={`chip${state.chordDepth === 'seventh' ? ' active' : ''}`}
                onClick={() => setChordDepth('seventh')}
                title="Display seventh chords: Cmaj7, Cm7, C7, m7b5"
              >
                7th
              </button>
            </div>
          </div>
          {/* '2-oct' works for every scale (incl. modes); numbered boxes only
              for scales guitarscale.org ships box images for. */}
          <div className="selection-group">
            <span
              className="group-label"
              title="Filter the guitar fretboard to one position. '2-oct' is the compact two-octave box from the 6th-string root (works for every scale); numbered shapes are guitarscale.org's boxes."
            >
              Guitar shape
            </span>
            <div className="btn-row">
              {(['all', '2oct', ...availablePositions(state.scale.type)] as ScalePosition[]).map((p) => (
                <button
                  key={String(p)}
                  className={`chip${state.scalePosition === p ? ' active' : ''}`}
                  onClick={() => setScalePosition(p)}
                  title={
                    p === 'all'
                      ? 'Show every scale note across the neck'
                      : p === '2oct'
                      ? 'Compact two-octave box on the 6th-string root'
                      : `Position ${p} (guitarscale.org box ${p})`
                  }
                >
                  {p === 'all' ? 'All' : p === '2oct' ? '2-oct' : `Shape ${p}`}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {state.mode !== 'note' && state.mode !== 'all' && (
        <div className="selection-group">
          <span className="group-label">Labels</span>
          <div className="btn-row">
            <button
              className={`chip${labelMode === 'name' ? ' active' : ''}`}
              onClick={() => setLabelMode('name')}
              title="Show note names (C, D, E…)"
            >
              Notes
            </button>
            <button
              className={`chip${labelMode === 'degree' ? ' active' : ''}`}
              onClick={() => setLabelMode('degree')}
              title="Show scale-degree numbers (1, 2, b3…)"
            >
              Degrees
            </button>
          </div>
        </div>
      )}

      <div className="selection-group">
        <span className="group-label">Guitar overlay</span>
        <div className="btn-row">
          <button
            className={`chip${showNaturals ? ' active' : ''}`}
            onClick={() => setShowNaturals(!showNaturals)}
            title="Show all natural notes (C, D, E, F, G, A, B) on the guitar fretboard"
          >
            Naturals
          </button>
        </div>
      </div>
    </div>
  );
}

