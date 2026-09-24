// The Builder home page's chord builder — collect the chord you're looking
// at into a progression, export a diagram, save the result.
//
// Unlike ChordsPanel (the player's version, which owns a private selection
// and renders its own SelectionBar + boards), this panel renders NO
// instrument of its own. The home page already has the SelectionBar and all
// four boards above it, so the panel drives that same `useAppState` — "add
// chord" takes whatever the page is showing, and clicking a chord in the
// strip sends it back to every board and into the `?mode=chord&root=…` URL.
// That also sidesteps a real constraint: web's useAppState has no syncUrl
// flag, so a second instance on this page would fight the first one over
// the query string.
//
// Progressions saved here are standalone (videoId: null) — they belong to
// no song and are listed only by this panel.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChordMini } from './ChordMini';
import { ProgressionSheet } from './ProgressionSheet';
import { chordLabel } from './chordShapes';
import { chordToCapture } from './capture-chord';
import { exportFretboardPng } from './png-export';
import {
  addProgression,
  deleteProgression,
  standaloneProgressions,
  updateProgression,
} from './storage';
import type { ProgressionChord, SavedProgression } from './types';
import type { useAppState } from '../state/useAppState';

type AppStateApi = ReturnType<typeof useAppState>;

/** The boards this panel can export. Order matches the page's layout so the
 *  buttons read left-to-right the way the panels do. */
const BOARDS = [
  { key: 'piano', label: 'Piano' },
  { key: 'guitar', label: 'Guitar' },
  { key: 'bass', label: 'Bass' },
  { key: 'push', label: 'Push' },
] as const;

type BoardKey = (typeof BOARDS)[number]['key'];

// The progression strip and its sheet export only speak guitar and piano —
// ChordDiagram and the mini keyboard are the only two chord renderers that
// take a ProgressionChord. Board export is separate and covers all four.
type StripInstrument = 'guitar' | 'piano';

function safeFilePart(s: string): string {
  return s.replace(/[^A-Za-z0-9#°+-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function ChordBuilderPanel({
  appState,
  boardsRef,
  currentLabel,
}: {
  appState: AppStateApi;
  /** The page's `.instruments` grid — the panel exports the SVGs already
   *  rendered inside it rather than drawing its own copies. */
  boardsRef: React.RefObject<HTMLDivElement | null>;
  /** `resolved.label` from the page, e.g. "C major triad" — shown as the
   *  thing "+ Add chord" would capture. */
  currentLabel: string;
}) {
  const [chords, setChords] = useState<ProgressionChord[]>([]);
  const [name, setName] = useState('');
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [stripInstrument, setStripInstrument] = useState<StripInstrument>('guitar');
  const [saved, setSaved] = useState<SavedProgression[]>([]);

  // localStorage is read on mount rather than during render so the first
  // paint doesn't depend on it — matches how LibraryPage loads.
  const reload = useCallback(() => setSaved(standaloneProgressions()), []);
  useEffect(reload, [reload]);

  // Chord and arpeggio modes both resolve to a chord worth adding; every
  // other mode leaves this null and the button disabled.
  const capturable = chordToCapture(appState.state);
  const defaultName = chords.map(chordLabel).join(' ').slice(0, 60);

  const addChord = () => {
    if (!capturable) return;
    setChords((prev) => [...prev, capturable]);
  };

  const removeAt = (i: number) =>
    setChords((prev) => prev.filter((_, idx) => idx !== i));

  const moveBy = (i: number, delta: -1 | 1) =>
    setChords((prev) => {
      const j = i + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // Send a chord in the strip back to the page: every board redraws and the
  // URL updates, so the strip doubles as a way to step through what you
  // saved. Inversion and voicing come along, so the board shows the shape
  // the chord was captured with rather than a default re-voicing.
  const selectChord = (c: ProgressionChord) => {
    // Arpeggio mode already shows a chord, so a card click there should
    // change which chord is on screen, not drop the user back into chord
    // mode. Every other mode switches.
    if (appState.state.mode !== 'arpeggio') appState.setMode('chord');
    appState.setChord(() => ({
      root: c.root,
      quality: c.quality,
      inversion: c.inversion ?? 0,
      voicingIndex: c.voicingIndex ?? 0,
    }));
  };

  // --- Export --------------------------------------------------------------
  const sheetRef = useRef<HTMLDivElement>(null);

  const exportBoard = async (board: BoardKey) => {
    const svg = boardsRef.current?.querySelector(
      `[data-board="${board}"] svg.instrument-svg`,
    ) as SVGSVGElement | null;
    if (!svg) return;
    const base = safeFilePart(currentLabel) || 'selection';
    await exportFretboardPng({
      svg,
      themeRoot: document.body,
      filename: `${base}-${board}.png`,
      // Cropping keys off the r=9 highlight markers, which only the
      // fretboards draw enough of to make a tight box worth having.
      cropToShape: board === 'guitar' || board === 'bass',
    });
  };

  const exportProgression = async () => {
    const svg = sheetRef.current?.querySelector(
      'svg.instrument-svg',
    ) as SVGSVGElement | null;
    if (!svg) return;
    const base = safeFilePart(name.trim() || defaultName) || 'progression';
    await exportFretboardPng({
      svg,
      themeRoot: document.body,
      filename: `${base}-${stripInstrument}.png`,
      cropToShape: false,
    });
  };

  // --- Save / load ---------------------------------------------------------
  const save = (asNew: boolean) => {
    if (chords.length === 0) return;
    const finalName = name.trim() || defaultName || 'Untitled';
    if (loadedId && !asNew) {
      updateProgression(loadedId, { name: finalName, chords });
    } else {
      const record = addProgression({ videoId: null, name: finalName, chords });
      setLoadedId(record.id);
    }
    setName(finalName);
    reload();
  };

  const commitRename = (p: SavedProgression) => {
    const next = renameValue.trim();
    setRenamingId(null);
    if (!next || next === p.name) return;
    updateProgression(p.id, { name: next });
    reload();
  };

  const addTitle = capturable
    ? `Add ${chordLabel(capturable)} to the progression`
    : 'Switch Mode to Chord or Arpeggio to add a chord';

  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <h2 className="panel-title">Chord builder</h2>

      {/* ------------------------------------------- Export what's on screen */}
      <div style={rowStyle}>
        <span style={rowLabelStyle}>Export diagram</span>
        {BOARDS.map((b) => (
          <button
            key={b.key}
            type="button"
            className="chip"
            onClick={() => void exportBoard(b.key)}
            title={`Download the ${b.label.toLowerCase()} board as a PNG`}
          >
            ⬇ {b.label}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-dim)' }}>
          {currentLabel}
        </span>
      </div>

      {/* ------------------------------------------------------- Progression */}
      <div style={{ ...rowStyle, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <button
          type="button"
          className="chip active"
          onClick={addChord}
          disabled={!capturable}
          title={addTitle}
        >
          + Add chord
        </button>
        {(['guitar', 'piano'] as const).map((i) => (
          <button
            key={i}
            type="button"
            className={`chip${stripInstrument === i ? ' active' : ''}`}
            onClick={() => setStripInstrument(i)}
            title={`Draw the progression as ${i} diagrams`}
          >
            {i === 'guitar' ? 'Guitar' : 'Piano'}
          </button>
        ))}
        {chords.length > 0 && (
          <>
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
            <button
              type="button"
              className="chip"
              onClick={() => void exportProgression()}
              title="Export every chord in the progression as a single PNG"
            >
              ⬇ Export progression
            </button>
          </>
        )}
      </div>

      {chords.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '10px 0 0' }}>
          {capturable
            ? 'No chords yet — pick a chord above, then “Add chord”.'
            : 'No chords yet — switch Mode to Chord or Arpeggio above to start building one.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '12px 0 0' }}>
          {chords.map((c, i) => (
            <figure key={`${c.root}-${c.quality}-${i}`} style={cardStyle}>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${chordLabel(c)}`}
                style={removeStyle}
              >
                ×
              </button>
              <button
                type="button"
                onClick={() => selectChord(c)}
                title={`Show ${chordLabel(c)} on the boards above`}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'center',
                  minHeight: 60,
                }}
              >
                <ChordMini chord={c} instrument={stripInstrument} />
              </button>
              <figcaption style={captionStyle}>{chordLabel(c)}</figcaption>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => moveBy(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${chordLabel(c)} earlier`}
                  style={linkStyle}
                >
                  ◀
                </button>
                <button
                  type="button"
                  onClick={() => moveBy(i, 1)}
                  disabled={i === chords.length - 1}
                  aria-label={`Move ${chordLabel(c)} later`}
                  style={linkStyle}
                >
                  ▶
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      {/* -------------------------------------------------------------- Save */}
      <div style={{ ...rowStyle, marginTop: 12 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={defaultName || 'Name this progression…'}
          maxLength={100}
          aria-label="Progression name"
          style={{ ...inputStyle, minWidth: 190 }}
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

      {saved.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <h3 style={savedHeadingStyle}>Saved progressions</h3>
          <ul style={listStyle}>
            {saved.map((p) => (
              <li
                key={p.id}
                style={{
                  ...listItemStyle,
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
                        reload();
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

      {/* The sheet the progression export serializes. Rendered off-screen so
          the panel isn't duplicating the strip that's already visible. */}
      <div ref={sheetRef} aria-hidden style={offscreenStyle}>
        <ProgressionSheet chords={chords} instrument={stripInstrument} />
      </div>
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
};

const rowLabelStyle: React.CSSProperties = {
  fontSize: 11,
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

const removeStyle: React.CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 5,
  all: 'unset',
  cursor: 'pointer',
  color: 'var(--text-dim)',
  fontSize: 12,
};

const captionStyle: React.CSSProperties = {
  marginTop: 4,
  textAlign: 'center',
  fontSize: 13,
  fontWeight: 700,
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

const savedHeadingStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-dim)',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const listItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  padding: '4px 6px',
  borderRadius: 6,
};

const offscreenStyle: React.CSSProperties = {
  position: 'absolute',
  left: -99999,
  top: 0,
  pointerEvents: 'none',
};
