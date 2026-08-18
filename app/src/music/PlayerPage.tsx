// Player page — the practice-along surface for a saved YouTube video.
//
// Layout: big embed + LoopControls on the left; tabbed right column
// flips between Loops (named saved-section list + Save button) and
// Wheel (Circle of Fifths). Clicking a saved loop hydrates the player
// via the same `?loopId=` convention as music-kb — except here it's
// hash-based: navigate to #/video/<id> with the loop id selected by
// state (no URL bar entry for individual loops since we already store
// the selection in-page).

import { useEffect, useState } from 'react';
import { PlayerProvider, YouTubePlayer, usePlayerControl } from './Player';
import { LoopControls } from './LoopControls';
import { CircleOfFifths } from './CircleOfFifths';
import {
  addLoop,
  deleteLoop,
  getVideo,
  loopsForVideo,
  progressionsForVideo,
  updateLoop,
  updateVideo,
} from './storage';
import { SectionChordStrip } from './SectionChordStrip';
import { SectionScalePicker } from './SectionScalePicker';
import { usePlayAlongInstrument } from './usePlayAlongInstrument';
import { ChordsPanel } from './ChordsPanel';
import { chordLabel } from './chordShapes';
import { navigate } from './useHashRoute';
import type { SavedLoop, SavedProgression, SavedVideo } from './types';

export function PlayerPage({ videoId }: { videoId: string }) {
  const video = getVideo(videoId);
  if (!video) {
    return (
      <main
        className="panel"
        style={{ padding: 40, maxWidth: 600, margin: '40px auto', textAlign: 'center' }}
      >
        <h1 style={{ marginTop: 0 }}>Video not found</h1>
        <p style={{ color: 'var(--text-dim)' }}>
          The saved video for id <code>{videoId}</code> isn't in your library.
        </p>
        <button
          type="button"
          className="chip active"
          onClick={() => navigate({ kind: 'library' })}
        >
          Back to music
        </button>
      </main>
    );
  }
  return (
    <PlayerProvider>
      <PlayerInner video={video} />
    </PlayerProvider>
  );
}

type SideTab = 'loops' | 'wheel';

function PlayerInner({ video }: { video: SavedVideo }) {
  const [loops, setLoops] = useState<SavedLoop[]>(() => loopsForVideo(video.id));
  const [progressions, setProgressions] = useState<SavedProgression[]>(() =>
    progressionsForVideo(video.id),
  );
  // The section loaded into the player — drives the chord strip below it.
  const [selectedLoopId, setSelectedLoopId] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('loops');
  const [editingTitle, setEditingTitle] = useState(!video.title);
  const [titleDraft, setTitleDraft] = useState(video.title);

  const refresh = () => setLoops(loopsForVideo(video.id));
  const refreshProgressions = () => {
    setProgressions(progressionsForVideo(video.id));
    // A delete unlinks sections, so the loop rows need re-reading too.
    setLoops(loopsForVideo(video.id));
  };

  // One instrument for the whole play-along block (chord cards + scale
  // board) so the two can never disagree; persisted because it's a property
  // of the player, not of the video.
  const [playInstrument, setPlayInstrument] = usePlayAlongInstrument();

  const selectedLoop = loops.find((l) => l.id === selectedLoopId) ?? null;
  const selectedProgression =
    progressions.find((p) => p.id === selectedLoop?.progressionId) ?? null;

  const patchLoop = (id: string, patch: Parameters<typeof updateLoop>[1]) => {
    updateLoop(id, patch);
    refresh();
  };

  return (
    <main
      style={{
        width: '100%',
        padding: '8px 0 40px',
      }}
    >
      <header style={{ marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => navigate({ kind: 'library' })}
          style={{
            all: 'unset',
            cursor: 'pointer',
            color: 'var(--text-dim)',
            fontSize: 13,
          }}
        >
          ← Back to music
        </button>
        {editingTitle ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = titleDraft.trim();
              if (trimmed) updateVideo(video.id, { title: trimmed });
              setEditingTitle(false);
            }}
            style={{ marginTop: 6, display: 'flex', gap: 8 }}
          >
            <input
              type="text"
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Title (e.g. Radiohead — Creep)"
              style={{
                flex: 1,
                fontSize: 22,
                fontWeight: 700,
                padding: '4px 8px',
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--panel-2)',
                color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            />
            <button type="submit" className="chip active" style={{ padding: '4px 12px' }}>
              Save
            </button>
          </form>
        ) : (
          <h1
            style={{
              marginTop: 6,
              fontSize: 24,
              fontWeight: 700,
              cursor: 'pointer',
            }}
            onClick={() => {
              setTitleDraft(video.title);
              setEditingTitle(true);
            }}
            title="Click to edit"
          >
            {video.title || '(Untitled — click to edit)'}
          </h1>
        )}
        {video.author && (
          <p style={{ margin: '2px 0 0', color: 'var(--text-dim)', fontSize: 13 }}>
            {video.author}
          </p>
        )}
      </header>

      <div
        style={{
          display: 'grid',
          gap: 24,
          gridTemplateColumns: 'minmax(0, 7fr) minmax(0, 3fr)',
          alignItems: 'stretch',
        }}
      >
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div
            style={{
              overflow: 'hidden',
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: '#000',
            }}
          >
            <div style={{ position: 'relative', aspectRatio: '16 / 9', width: '100%' }}>
              <YouTubePlayer
                videoId={video.youtubeVideoId}
                className="player-iframe"
              />
              <style>{`
                .player-iframe, .player-iframe iframe {
                  position: absolute;
                  inset: 0;
                  width: 100%;
                  height: 100%;
                }
              `}</style>
            </div>
            <LoopControls />
          </div>
          {selectedLoop && (
            <>
            <SectionChordStrip
              loop={selectedLoop}
              progression={selectedProgression}
              onBarsChange={(bars) => patchLoop(selectedLoop.id, { bars })}
              onTimesSave={(startSec, endSec) =>
                patchLoop(selectedLoop.id, { startSec, endSec })
              }
              instrument={playInstrument}
              onInstrumentChange={setPlayInstrument}
            />
            <SectionScalePicker
              chords={selectedProgression?.chords ?? []}
              instrument={playInstrument}
              loopDocumentId={selectedLoop.id}
              savedKey={selectedLoop.key ?? null}
              timing={{
                startSec: selectedLoop.startSec,
                endSec: selectedLoop.endSec,
                bars: selectedLoop.bars ?? null,
              }}
              onScaleSaved={() => refresh()}
            />
            </>
          )}
        </section>

        <aside
          className="panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--panel)',
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <div
            style={{
              padding: '8px 8px 0',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              gap: 4,
              flexShrink: 0,
            }}
          >
            <TabButton
              active={sideTab === 'loops'}
              onClick={() => setSideTab('loops')}
            >
              Loops
            </TabButton>
            <TabButton
              active={sideTab === 'wheel'}
              onClick={() => setSideTab('wheel')}
            >
              Wheel
            </TabButton>
          </div>
          {/* Scroll the content area if it overflows the matched-height
              left column (esp. when the wheel SVG + toggles are taller
              than the video). Keeps the panel height locked to the
              video's height instead of pushing the page taller. */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {sideTab === 'loops' ? (
              <LoopsPanel
                videoId={video.id}
                loops={loops}
                progressions={progressions}
                selectedLoopId={selectedLoopId}
                onSelect={setSelectedLoopId}
                onPatch={patchLoop}
                onSaved={refresh}
                onDeleted={refresh}
              />
            ) : (
              <div style={{ padding: 12 }}>
                <CircleOfFifths
                  showDirectionToggle={false}
                  showEnharmonicToggle={false}
                />
              </div>
            )}
          </div>
        </aside>
      </div>

      <ChordsPanel
        videoId={video.id}
        progressions={progressions}
        onChanged={refreshProgressions}
      />
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        padding: '8px 14px',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 500,
        color: active ? 'var(--text)' : 'var(--text-dim)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
  );
}

function LoopsPanel({
  videoId,
  loops,
  progressions,
  selectedLoopId,
  onSelect,
  onPatch,
  onSaved,
  onDeleted,
}: {
  videoId: string;
  loops: SavedLoop[];
  progressions: SavedProgression[];
  selectedLoopId: string | null;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<SavedLoop>) => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  return (
    <div style={{ padding: 12 }}>
      <SaveLoopRow videoId={videoId} onSaved={onSaved} />
      {loops.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)' }}>
          Mark a section with the A / B buttons under the player, then
          click Save loop to keep it.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {loops.map((l) => (
            <LoopRow
              key={l.id}
              loop={l}
              progressions={progressions}
              selected={selectedLoopId === l.id}
              onSelect={() => onSelect(l.id)}
              onPatch={(patch) => onPatch(l.id, patch)}
              onDeleted={() => {
                deleteLoop(l.id);
                onDeleted();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function fmt(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, '0')}`;
}

function LoopRow({
  loop,
  progressions,
  selected,
  onSelect,
  onPatch,
  onDeleted,
}: {
  loop: SavedLoop;
  progressions: SavedProgression[];
  selected: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<SavedLoop>) => void;
  onDeleted: () => void;
}) {
  const { setLoopStart, setLoopEnd, seekTo, loopActive, toggleLoopActive } =
    usePlayerControl();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(loop.label);

  const linked = progressions.find((p) => p.id === loop.progressionId) ?? null;
  const summary = linked
    ? linked.chords.slice(0, 4).map(chordLabel).join(' ') +
      (linked.chords.length > 4 ? ' …' : '')
    : 'no progression';

  const load = () => {
    setLoopStart(loop.startSec);
    setLoopEnd(loop.endSec);
    seekTo(loop.startSec);
    if (!loopActive) toggleLoopActive();
    onSelect();
  };

  const commitRename = () => {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== loop.label) onPatch({ label: next });
  };
  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '6px 8px',
        borderRadius: 6,
        background: 'var(--panel-2)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {renaming ? (
          <>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              aria-label={`Rename ${loop.label}`}
              maxLength={120}
              style={{
                flex: 1, minWidth: 0, padding: '2px 6px', fontSize: 12,
                border: '1px solid var(--accent)', borderRadius: 4,
                background: 'var(--panel)', color: 'var(--text)',
                fontFamily: 'inherit',
              }}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={commitRename}
              style={{ all: 'unset', cursor: 'pointer', color: 'var(--accent)' }}
            >
              save
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={load}
              style={{
                all: 'unset', flex: 1, minWidth: 0, cursor: 'pointer',
                display: 'flex', gap: 8, alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600 }}>{loop.label}</span>
              <span style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--text-dim)' }}>
                {fmt(loop.startSec)}–{fmt(loop.endSec)}
              </span>
              <span
                style={{
                  color: 'var(--text-dim)', flex: 1, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {summary}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(loop.label);
                setRenaming(true);
              }}
              aria-label={`Rename loop ${loop.label}`}
              title="Rename this section"
              style={{ all: 'unset', cursor: 'pointer', padding: '0 4px', color: 'var(--text-dim)' }}
            >
              ✎
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onDeleted}
          aria-label={`Delete loop ${loop.label}`}
          style={{
            all: 'unset',
            cursor: 'pointer',
            padding: '0 4px',
            color: 'var(--text-dim)',
          }}
        >
        ×
        </button>
      </div>

      {selected && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.04em', color: 'var(--text-dim)',
            }}
          >
            Progression
          </span>
          <select
            value={loop.progressionId ?? ''}
            onChange={(e) => onPatch({ progressionId: e.target.value || null })}
            aria-label="Progression for this section"
            style={{
              flex: 1, minWidth: 0, padding: '2px 4px', fontSize: 12,
              border: '1px solid var(--border)', borderRadius: 4,
              background: 'var(--panel)', color: 'var(--text)',
              fontFamily: 'inherit',
            }}
          >
            <option value="">— none —</option>
            {progressions.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}

function SaveLoopRow({
  videoId,
  onSaved,
}: {
  videoId: string;
  onSaved: () => void;
}) {
  const { loopStartSec, loopEndSec } = usePlayerControl();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const canSave = loopEndSec != null && loopEndSec > (loopStartSec ?? 0);

  const reset = () => {
    setOpen(false);
    setLabel('');
  };

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed || !canSave) return;
    addLoop({
      videoId,
      label: trimmed,
      startSec: loopStartSec ?? 0,
      endSec: loopEndSec!,
    });
    reset();
    onSaved();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!canSave}
        className="chip"
        title={
          canSave
            ? 'Save the current A/B section as a named loop'
            : 'Mark a section with the A / B buttons under the player first'
        }
        style={{ width: '100%', padding: '6px 12px' }}
      >
        + Save loop
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ display: 'flex', gap: 6 }}
    >
      <input
        type="text"
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="e.g. Verse 1, Chorus"
        maxLength={120}
        onKeyDown={(e) => {
          if (e.key === 'Escape') reset();
        }}
        style={{
          flex: 1,
          padding: '6px 10px',
          fontSize: 13,
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--panel-2)',
          color: 'var(--text)',
          fontFamily: 'inherit',
        }}
      />
      <button type="submit" className="chip active" style={{ padding: '6px 12px' }}>
        Save
      </button>
      <button
        type="button"
        onClick={reset}
        className="chip"
        style={{ padding: '6px 12px' }}
      >
        Cancel
      </button>
    </form>
  );
}

// Force-include useEffect import (no-op — keeps tree-shaker honest).
void useEffect;
