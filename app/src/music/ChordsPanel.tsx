// The Chords panel under the player — the same surface as the main
// visualizer, plus the progression builder.
//
// This deliberately reuses the app's real selection UI (SelectionBar) and
// instrument views rather than a reduced picker: you pick a chord exactly
// the way you do everywhere else — mode, root, quality, inversion,
// voicing — see it on the fretboard, see how it's built, and then
// "+ Add chord" appends *the chord you're looking at*, voicing and all.
//
// Progressions are saved per video in localStorage. Sections link to one
// rather than owning chords, so this is the only place chords get built.

import { useMemo, useState } from 'react';
import { SelectionBar } from '../components/SelectionBar';
import { GuitarView } from '../instruments/guitar/GuitarView';
import { PianoView } from '../instruments/piano/PianoView';
import { useAppState } from '../state/useAppState';
import { resolveSelection } from '../state/resolve';
import { synth } from '../audio/synth';
import { ChordDiagram } from './ChordDiagram';
import { ChordFormulaStrip } from './ChordFormulaStrip';
import { chordDiagramProps, chordLabel } from './chordShapes';
import { addProgression, deleteProgression, updateProgression } from './storage';
import type { ProgressionChord, SavedProgression } from './types';

type Instrument = 'guitar' | 'piano';

export function ChordsPanel({
  videoId,
  progressions,
  onChanged,
}: {
  videoId: string;
  progressions: SavedProgression[];
  onChanged: () => void;
}) {
  // A panel-local selection — independent of the main visualizer page so
  // navigating here doesn't clobber whatever was set there.
  const appState = useAppState();
  const [instrument, setInstrument] = useState<Instrument>('guitar');
  const [chords, setChords] = useState<ProgressionChord[]>([]);
  const [name, setName] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const resolved = useMemo(
    () => resolveSelection(appState.state, appState.previewedChordDegree),
    [appState.state, appState.previewedChordDegree],
  );
  const pcLabels =
    appState.labelMode === 'degree' ? resolved.pcDegrees : resolved.pcDisplay;

  const current = appState.state.chord;
  const inChordMode = appState.state.mode === 'chord';

  const addChord = () =>
    setChords((prev) => [
      ...prev,
      {
        root: current.root,
        quality: current.quality,
        inversion: current.inversion,
        voicingIndex: current.voicingIndex,
      },
    ]);

  const defaultName = chords.map(chordLabel).join(' ').slice(0, 60);

  const save = (asNew: boolean) => {
    if (chords.length === 0) return;
    const finalName = name.trim() || defaultName || 'Untitled';
    if (!asNew && loadedId) {
      updateProgression(loadedId, { name: finalName, chords });
    } else {
      setLoadedId(addProgression({ videoId, name: finalName, chords }).id);
    }
    setName(finalName);
    onChanged();
  };

  const commitRename = (p: SavedProgression) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!next || next === p.name) return;
    updateProgression(p.id, { name: next });
    onChanged();
  };

  return (
    <section style={{ marginTop: 16 }}>
      <SelectionBar {...appState} />

      <div className="panel" style={panelStyle}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {(['guitar', 'piano'] as const).map((i) => (
            <button
              key={i}
              type="button"
              className={`chip${instrument === i ? ' active' : ''}`}
              onClick={() => setInstrument(i)}
            >
              {i === 'guitar' ? 'Guitar' : 'Piano'}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}>
            {resolved.label}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          {instrument === 'guitar' ? (
            <GuitarView
              highlighted={resolved.guitar}
              rootPitchClass={resolved.rootPitchClass}
              matchByPitchClass={resolved.guitarMatchByPitchClass}
              focusedPitchClass={appState.focusedPitchClass}
              onPickPitchClass={appState.toggleFocusedPitchClass}
              onPlayNote={(midi) => synth.playNote(midi)}
              pcLabels={pcLabels}
              shapePositions={resolved.guitarShapePositions}
              barre={resolved.guitarBarre}
              showNaturals={appState.showNaturals}
              emphasizedPitchClasses={resolved.previewedChordPCs}
            />
          ) : (
            <PianoView
              highlighted={resolved.piano}
              rootPitchClass={resolved.rootPitchClass}
              matchByPitchClass={resolved.pianoMatchByPitchClass}
              focusedPitchClass={appState.focusedPitchClass}
              onPickPitchClass={appState.toggleFocusedPitchClass}
              onPlayNote={(midi) => synth.playNote(midi)}
              pcLabels={pcLabels}
              emphasizedPitchClasses={resolved.previewedChordPCs}
            />
          )}
        </div>

        {inChordMode && current.inversion === 0 && (
          <ChordFormulaStrip root={current.root} quality={current.quality} />
        )}
      </div>

      {/* ------------------------------------------------ Progression */}
      <div className="panel" style={panelStyle}>
        <h2 style={headingStyle}>Chord progression</h2>

        {chords.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 10px' }}>
            No chords yet — pick a chord above, then “Add chord”.
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10 }}>
            {chords.map((c, i) => {
              const props = chordDiagramProps(c);
              return (
                <figure key={`${c.root}-${c.quality}-${i}`} style={cardStyle}>
                  <button
                    type="button"
                    onClick={() => setChords((p) => p.filter((_, idx) => idx !== i))}
                    aria-label={`Remove ${chordLabel(c)}`}
                    style={{
                      position: 'absolute', top: 2, right: 5, all: 'unset',
                      cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12,
                    }}
                  >
                    ×
                  </button>
                  <div style={{ display: 'flex', justifyContent: 'center', minHeight: 60 }}>
                    {props ? (
                      <ChordDiagram {...props} orientation="horizontal" />
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>No shape</span>
                    )}
                  </div>
                  <figcaption
                    style={{ marginTop: 4, textAlign: 'center', fontSize: 13, fontWeight: 700 }}
                  >
                    {chordLabel(c)}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="chip active"
            onClick={addChord}
            disabled={!inChordMode}
            title={
              inChordMode
                ? `Add ${chordLabel(current)} to the progression`
                : 'Switch Mode to Chord to add a chord'
            }
          >
            + Add chord
          </button>
          {chords.length > 0 && (
            <button
              type="button"
              className="chip"
              onClick={() => {
                setChords([]);
                setLoadedId(null);
                setName('');
              }}
            >
              Clear
            </button>
          )}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName || 'Name this progression…'}
            maxLength={100}
            aria-label="Progression name"
            style={{ ...inputStyle, marginLeft: 'auto', minWidth: 190 }}
          />
          <button
            type="button"
            className="chip active"
            disabled={chords.length === 0}
            onClick={() => save(false)}
          >
            {loadedId ? 'Save' : 'Save progression'}
          </button>
          {loadedId && (
            <button type="button" className="chip" onClick={() => save(true)}>
              Save as new
            </button>
          )}
        </div>

        {progressions.length > 0 && (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <h3 style={{ ...headingStyle, fontSize: 11, margin: '0 0 8px' }}>
              Saved progressions
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {progressions.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                    padding: '4px 6px', borderRadius: 6,
                    background: loadedId === p.id ? 'var(--chip-hover)' : 'transparent',
                  }}
                >
                  {renamingId === p.id ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(p);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        aria-label={`Rename ${p.name}`}
                        maxLength={100}
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button type="button" className="chip" onClick={() => commitRename(p)}>
                        save
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setChords(p.chords);
                          setName(p.name);
                          setLoadedId(p.id);
                        }}
                        title="Load into the builder"
                        style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}
                      >
                        <strong style={{ color: 'var(--text)' }}>{p.name}</strong>{' '}
                        <span style={{ color: 'var(--text-dim)' }}>
                          {p.chords.map(chordLabel).join(' ')}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(p.id);
                          setRenameValue(p.name);
                        }}
                        aria-label={`Rename progression ${p.name}`}
                        style={linkStyle}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          deleteProgression(p.id);
                          if (loadedId === p.id) setLoadedId(null);
                          onChanged();
                        }}
                        aria-label={`Delete progression ${p.name}`}
                        style={linkStyle}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 12,
  background: 'var(--panel)',
  padding: 16,
  marginTop: 12,
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-dim)',
};

const cardStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 8px 6px',
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--panel-2)',
  position: 'relative',
};

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--panel-2)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
};

const linkStyle: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  color: 'var(--text-dim)',
  fontSize: 11,
};
