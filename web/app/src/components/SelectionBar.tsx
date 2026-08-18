import {
  CHORD_QUALITIES,
  PITCH_CLASSES,
  SCALE_TYPES,
  type ChordQuality,
  type PitchClass,
  type ScalePosition,
  type ScaleType,
  type ViewMode,
} from '../types';
import { SCALE_TYPE_LABELS } from '../theory/scales';
import { availablePositions } from '../theory/positions';
import { useAppState } from '../state/useAppState';
import { chordInversionCount, chordVoicingCount } from '../state/resolve';
import {
  currentGuitarShapeName,
  qualityHasAnyShape,
} from '../theory/voicings/guitar';
import { QUALITY_LABELS } from '../theory/quality-labels';
import { FLAT_NAMES } from '../theory/notes';

type Props = ReturnType<typeof useAppState>;

export function SelectionBar({
  state,
  setMode,
  setChord,
  setScale,
  pickRoot,
  setScalePosition,
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
        <>
          <div className="selection-group">
            <span className="group-label">Quality</span>
            <div className="btn-row">
              {CHORD_QUALITIES.map((q) => {
                // Dim chips for qualities with no named guitar shape —
                // piano + Push still work but the guitar fretboard falls
                // back to "every matching position" instead of a clean
                // fingering. Tooltip explains the fallback.
                const hasShape = qualityHasAnyShape(q);
                const isActive = state.chord.quality === q;
                return (
                  <button
                    key={q}
                    className={`chip${isActive ? ' active' : ''}`}
                    style={!hasShape && !isActive ? { opacity: 0.55 } : undefined}
                    title={
                      hasShape
                        ? undefined
                        : 'No named guitar shape — fretboard shows every matching position (piano + Push still work as expected)'
                    }
                    onClick={() =>
                      setChord((c) => ({
                        ...c,
                        quality: q as ChordQuality,
                        inversion: 0,
                        // Reset voicingIndex on quality change so we land
                        // on the canonical fingering for the new quality
                        // rather than carrying over a stale barre index.
                        voicingIndex: 0,
                      }))
                    }
                  >
                    {QUALITY_LABELS[q]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="selection-group">
            <span className="group-label">Inversion</span>
            <Stepper
              value={state.chord.inversion}
              max={Math.max(0, chordInversionCount(state.chord) - 1)}
              onChange={(n) => setChord((c) => ({ ...c, inversion: n }))}
            />
          </div>

          <div className="selection-group">
            <span className="group-label">Voicing</span>
            <Stepper
              value={state.chord.voicingIndex}
              max={Math.max(0, chordVoicingCount(state.chord) - 1)}
              onChange={(n) => setChord((c) => ({ ...c, voicingIndex: n }))}
            />
            {/* Shape-name badge — surfaces the active voicing's identity
                ("Open C", "E-shape barre", "A-string power chord") next
                to the stepper. Accent color for barre/power shapes; muted
                for open shapes. */}
            {(() => {
              const name = currentGuitarShapeName(state.chord);
              if (!name) return null;
              const isBarre = name.toLowerCase().includes('barre');
              const isPower = name.toLowerCase().includes('power');
              const badgeColor = isBarre || isPower
                ? 'var(--accent)'
                : 'var(--text-dim)';
              return (
                <span
                  style={{
                    marginLeft: 8,
                    padding: '2px 8px',
                    borderRadius: 12,
                    border: `1px solid ${badgeColor}`,
                    color: badgeColor,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {name}
                </span>
              );
            })()}
          </div>
        </>
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

function Stepper({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const wrap = (n: number) => {
    if (max <= 0) return 0;
    const span = max + 1;
    return ((n % span) + span) % span;
  };
  return (
    <div className="stepper">
      <button onClick={() => onChange(wrap(value - 1))} aria-label="previous">
        ‹
      </button>
      <span className="stepper-value">{value}</span>
      <button onClick={() => onChange(wrap(value + 1))} aria-label="next">
        ›
      </button>
    </div>
  );
}
