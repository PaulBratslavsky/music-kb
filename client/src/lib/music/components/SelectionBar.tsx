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
import { currentGuitarShapeName } from '../theory/voicings/guitar';
import { FLAT_NAMES } from '../theory/notes';

const QUALITY_DISPLAY: Record<ChordQuality, string> = {
  '5': '5',
  maj: 'maj',
  min: 'm',
  dim: 'dim',
  aug: 'aug',
  sus2: 'sus2',
  sus4: 'sus4',
  '6': '6',
  m6: 'm6',
  maj7: 'maj7',
  min7: 'm7',
  dom7: '7',
  m7b5: 'm7♭5',
  dim7: 'dim7',
  mMaj7: 'mMaj7',
  '7sus4': '7sus4',
  add9: 'add9',
  madd9: 'm(add9)',
  '9': '9',
  maj9: 'maj9',
  m9: 'm9',
  '11': '11',
  m11: 'm11',
  '13': '13',
  m13: 'm13',
  '7b5': '7♭5',
  '7#5': '7♯5',
  '7b9': '7♭9',
  '7#9': '7♯9',
  alt: 'alt',
};

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
        <>
          <div className="selection-group">
            <span className="group-label">Quality</span>
            <div className="btn-row">
              {CHORD_QUALITIES.map((q) => (
                <button
                  key={q}
                  className={`chip${state.chord.quality === q ? ' active' : ''}`}
                  onClick={() =>
                    setChord((c) => ({
                      ...c,
                      quality: q as ChordQuality,
                      inversion: 0,
                      // Reset voicingIndex on quality change too — the new
                      // quality has its own voicing list (might be shorter,
                      // might lack an open shape), so starting from 0 lands
                      // on the canonical fingering instead of a stale barre.
                      voicingIndex: 0,
                    }))
                  }
                >
                  {QUALITY_DISPLAY[q]}
                </button>
              ))}
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
            {/* Shape-name badge: surfaces the active voicing's identity
                ("Open C", "E-shape barre", "A-string power chord") so the
                user can tell at a glance whether they're on an open shape,
                a barre, or a power chord — without reading the long label
                below the SelectionBar. Empty when the quality has no
                named shape (the pitch-class-flood fallback). */}
            {(() => {
              const name = currentGuitarShapeName(state.chord);
              if (!name) return null;
              const isBarre = name.toLowerCase().includes('barre');
              const isPower = name.toLowerCase().includes('power');
              const badgeColor = isBarre || isPower
                ? 'var(--accent)'
                : 'var(--ink-muted)';
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
