// Chord Progression panel — the one place chords get built and saved.
//
// Sections don't own chords; they LINK to a progression saved here. That
// keeps a single build surface, and lets one progression back several
// sections (verse 1 / verse 2) so editing it updates all of them.
//
// Progressions are scoped to the video and persisted in localStorage.

import { useState } from 'react';
import { ChordDiagram } from './ChordDiagram';
import { chordDiagramProps, chordLabel } from './chordShapes';
import {
  addProgression,
  deleteProgression,
  updateProgression,
} from './storage';
import { guitarVoicingCount } from '../theory/voicings/guitar';
import { QUALITY_LABELS } from '../theory/quality-labels';
import { CHORD_QUALITIES, PITCH_CLASSES } from '../types';
import type { ChordQuality, PitchClass } from '../types';
import type { ProgressionChord, SavedProgression } from './types';

// The qualities worth offering in a compact picker. The full 30-quality
// list is available in the main visualizer; a progression builder wants
// the ones people actually write chord charts with.
const COMMON_QUALITIES: ChordQuality[] = CHORD_QUALITIES.filter((q) =>
  ['maj', 'min', '5', 'dim', 'aug', 'sus2', 'sus4', 'maj7', 'min7', 'dom7', '6', 'm6'].includes(q),
);

export function ProgressionPanel({
  videoId,
  progressions,
  onChanged,
}: {
  videoId: string;
  progressions: SavedProgression[];
  onChanged: () => void;
}) {
  const [chords, setChords] = useState<ProgressionChord[]>([]);
  const [root, setRoot] = useState<PitchClass>('C');
  const [quality, setQuality] = useState<ChordQuality>('maj');
  const [name, setName] = useState('');
  // documentId of the saved row loaded into the working list — Save
  // updates it in place; null means Save creates a new row.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const addChord = () =>
    setChords((prev) => [...prev, { root, quality, inversion: 0, voicingIndex: 0 }]);

  const removeAt = (i: number) =>
    setChords((prev) => prev.filter((_, idx) => idx !== i));

  /** Cycle a chord through its available guitar voicings. */
  const cycleVoicing = (i: number, dir: 1 | -1) =>
    setChords((prev) =>
      prev.map((c, idx) => {
        if (idx !== i) return c;
        const count = guitarVoicingCount({
          root: c.root,
          quality: c.quality,
          inversion: c.inversion ?? 0,
          voicingIndex: 0,
        });
        const next = (((c.voicingIndex ?? 0) + dir) % count + count) % count;
        return { ...c, voicingIndex: next };
      }),
    );

  const defaultName = chords.map(chordLabel).join(' ').slice(0, 60);

  const save = (asNew: boolean) => {
    if (chords.length === 0) return;
    const finalName = name.trim() || defaultName || 'Untitled';
    if (!asNew && loadedId) {
      updateProgression(loadedId, { name: finalName, chords });
    } else {
      const created = addProgression({ videoId, name: finalName, chords });
      setLoadedId(created.id);
    }
    setName(finalName);
    onChanged();
  };

  const load = (p: SavedProgression) => {
    setChords(p.chords);
    setName(p.name);
    setLoadedId(p.id);
  };

  const commitRename = (p: SavedProgression) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!next || next === p.name) return;
    updateProgression(p.id, { name: next });
    onChanged();
  };

  return (
    <section
      className="panel"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--panel)',
        padding: 16,
        marginTop: 16,
      }}
    >
      <h2
        style={{
          margin: '0 0 12px',
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-dim)',
        }}
      >
        Chord progression
      </h2>

      {/* Picker */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <select
          value={root}
          onChange={(e) => setRoot(e.target.value as PitchClass)}
          aria-label="Chord root"
          style={selectStyle}
        >
          {PITCH_CLASSES.map((pc) => (
            <option key={pc} value={pc}>{pc}</option>
          ))}
        </select>
        <select
          value={quality}
          onChange={(e) => setQuality(e.target.value as ChordQuality)}
          aria-label="Chord quality"
          style={selectStyle}
        >
          {COMMON_QUALITIES.map((q) => (
            <option key={q} value={q}>{QUALITY_LABELS[q] ?? q}</option>
          ))}
        </select>
        <button type="button" className="chip active" onClick={addChord}>
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
      </div>

      {/* Working list */}
      {chords.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 12px' }}>
          Pick a root and quality, then Add chord. Save it with a name and
          you can attach it to any section of this song.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          {chords.map((c, i) => {
            const props = chordDiagramProps(c);
            return (
              <figure
                key={`${c.root}-${c.quality}-${i}`}
                style={{
                  margin: 0,
                  padding: '8px 8px 6px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  position: 'relative',
                }}
              >
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  aria-label={`Remove ${chordLabel(c)}`}
                  style={{
                    position: 'absolute', top: 2, right: 4, all: 'unset',
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
                  style={{
                    marginTop: 4, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 700,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => cycleVoicing(i, -1)}
                    aria-label={`Lower voicing for ${chordLabel(c)}`}
                    style={arrowStyle}
                  >
                    ‹
                  </button>
                  {chordLabel(c)}
                  <button
                    type="button"
                    onClick={() => cycleVoicing(i, 1)}
                    aria-label={`Higher voicing for ${chordLabel(c)}`}
                    style={arrowStyle}
                  >
                    ›
                  </button>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}

      {/* Save */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName || 'Name this progression…'}
          maxLength={100}
          aria-label="Progression name"
          style={{ ...selectStyle, minWidth: 200 }}
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

      {/* Saved list */}
      {progressions.length > 0 && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <h3
            style={{
              margin: '0 0 8px', fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-dim)',
            }}
          >
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
                      style={{ ...selectStyle, flex: 1 }}
                    />
                    <button type="button" className="chip" onClick={() => commitRename(p)}>
                      save
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => load(p)}
                      style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}
                      title="Load into the builder"
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
    </section>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--panel-2)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
};

const arrowStyle: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  color: 'var(--text-dim)',
  padding: '0 2px',
};

const linkStyle: React.CSSProperties = {
  all: 'unset',
  cursor: 'pointer',
  color: 'var(--text-dim)',
  fontSize: 11,
};
