// Progression Composer — top-level. Owns the Composition and assembles
// the Hookpad-style stacked layout: transport, chord palette, then a
// shared 8-bar timeline with a melody piano-roll, the draggable chord
// lane, and a bass piano-roll. Span/note mutations go through the pure
// helpers in spans.ts; this component only wires state to UI.
//
// Time is in ticks (sixteenth resolution). A duration picker sets the
// length of newly-placed chords and notes; everything is draggable and
// resizable afterwards.

import { useEffect, useState } from 'react';
import { PITCH_CLASSES, type PitchClass } from '#/lib/music/types';
import {
  DURATIONS,
  TOTAL_TICKS,
  type Degree,
  type KeyMode,
} from '#/lib/music/compose/types';
import { LABEL_W } from './laneLayout';
import { useCompositionState } from '#/lib/music/compose/useCompositionState';
import { useCompositionPlayback } from '#/lib/music/compose/useCompositionPlayback';
import { synth } from '#/lib/music/audio/synth';
import {
  listCompositions,
  saveComposition as saveCompositionFn,
  deleteComposition as deleteCompositionFn,
} from '#/data/server-functions/compositions';
import type { StrapiComposition } from '#/lib/services/compositions';
import { chordToneDegrees } from '#/lib/music/compose/labels';
import { degreeColor, hexToRgba } from '#/lib/music/compose/colors';
import type { ChordToneHighlight } from './chordHighlight';
import { BeatRuler } from './BeatRuler';
import { ChordPalette } from './ChordPalette';
import { ChordLane } from './ChordLane';
import { NoteLane } from './NoteLane';

const MELODY_COLOR = '#2563eb';
const BASS_COLOR = '#9333ea';

export function Composer({ initialRoot = 'C' }: { initialRoot?: PitchClass }) {
  // Composition + edit state (comp, cursor, selectedId) live in the
  // reducer; only ephemeral UI + persistence state stays local here.
  const { comp, cursor, selectedId, actions } = useCompositionState(initialRoot);

  const [muted, setMuted] = useState(false);
  const [durTicks, setDurTicks] = useState(4); // default 1/4 note
  const [loop, setLoop] = useState(true);

  // Strapi persistence: documentId of the currently-loaded row (null =
  // unsaved), the saved-list for the picker, and a transient status line.
  const [docId, setDocId] = useState<string | null>(null);
  const [saved, setSaved] = useState<StrapiComposition[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const { isPlaying, currentStep, toggle, stop } = useCompositionPlayback(comp, {
    loop,
  });

  useEffect(() => {
    synth.setMuted(muted);
  }, [muted]);

  const refreshSaved = async () => {
    try {
      const r = await listCompositions();
      if (r.status === 'ok') setSaved(r.compositions);
    } catch {
      /* backend down — leave the list as-is */
    }
  };
  useEffect(() => {
    void refreshSaved();
  }, []);

  // ---- note placement carries the duration-picker length ----
  const placeNote = (lane: 'melody' | 'bass', degree: Degree, tick: number) =>
    actions.placeNote(lane, degree, tick, durTicks);

  // Lanes pass `string | null`; route to select/deselect.
  const handleSelect = (id: string | null) =>
    id ? actions.select(id) : actions.deselect();

  // ---- keyboard: delete selected, escape to deselect ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (e.key === 'Escape') {
        actions.deselect();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !typing) {
        e.preventDefault();
        if (comp.chords.some((s) => s.id === selectedId)) actions.removeChord(selectedId);
        else if (comp.melody.some((n) => n.id === selectedId)) actions.removeNote('melody', selectedId);
        else if (comp.bass.some((n) => n.id === selectedId)) actions.removeNote('bass', selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, comp, actions]);

  // ---- selected-chord tone highlight in the melody grid ----
  const selectedChord = selectedId
    ? comp.chords.find((s) => s.id === selectedId)
    : undefined;
  const melodyHighlight: ChordToneHighlight | null = selectedChord
    ? {
        degrees: new Set(chordToneDegrees(selectedChord.degree)),
        start: selectedChord.start,
        length: selectedChord.length,
        color: hexToRgba(degreeColor(selectedChord.degree), 0.28),
      }
    : null;

  const clearAll = () => {
    stop();
    actions.clearAll();
  };

  // ---- persistence ----
  const onSave = async () => {
    setStatus('Saving…');
    try {
      const r = await saveCompositionFn({ data: { documentId: docId, composition: comp } });
      if (r.status === 'ok') {
        setDocId(r.composition.documentId);
        setStatus(`Saved "${r.composition.title}"`);
        await refreshSaved();
      } else {
        setStatus(`Save failed: ${r.error}`);
      }
    } catch {
      setStatus('Save failed — backend unreachable');
    }
  };

  const onLoad = (documentId: string) => {
    const row = saved.find((s) => s.documentId === documentId);
    if (!row) return;
    stop();
    actions.load(row.data);
    setDocId(documentId);
    setStatus(`Loaded "${row.title}"`);
  };

  const onNew = () => {
    stop();
    actions.reset(comp.key.root, comp.key.mode);
    setDocId(null);
    setStatus(null);
  };

  const onDelete = async () => {
    if (!docId) return;
    try {
      const r = await deleteCompositionFn({ data: { documentId: docId } });
      if (r.status === 'ok') {
        await refreshSaved();
        onNew();
        setStatus('Deleted');
      } else {
        setStatus(`Delete failed: ${r.error}`);
      }
    } catch {
      setStatus('Delete failed — backend unreachable');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Transport */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
        <button
          type="button"
          onClick={toggle}
          className="rounded-full bg-[var(--accent)] px-5 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          {isPlaying ? '■ Stop' : '▶ Play'}
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Key
          </span>
          <div className="inline-flex flex-wrap gap-1">
            {PITCH_CLASSES.map((pc) => (
              <button
                key={pc}
                type="button"
                onClick={() => actions.setKeyRoot(pc)}
                className={`rounded border px-1.5 py-0.5 text-xs font-medium transition ${
                  comp.key.root === pc
                    ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                    : 'border-[var(--line)] bg-[var(--card)] text-[var(--ink-soft)] hover:border-[var(--accent)]'
                }`}
              >
                {pc}
              </button>
            ))}
          </div>
        </div>

        <div className="inline-flex overflow-hidden rounded border border-[var(--line)]">
          {(['major', 'minor'] as KeyMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => actions.setKeyMode(m)}
              className={`px-2.5 py-0.5 text-xs font-medium capitalize transition ${
                comp.key.mode === m
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--card)] text-[var(--ink-soft)] hover:bg-[var(--accent-soft)]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span className="font-semibold uppercase tracking-wide">Tempo</span>
          <input
            type="range"
            min={60}
            max={180}
            value={comp.bpm}
            onChange={(e) => actions.setBpm(Number(e.target.value))}
            className="w-24"
          />
          <span className="w-12 tabular-nums text-[var(--ink-soft)]">
            {comp.bpm} BPM
          </span>
        </label>

        <div className="flex items-center gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Note
          </span>
          <div className="inline-flex overflow-hidden rounded border border-[var(--line)]">
            {DURATIONS.map((d) => (
              <button
                key={d.ticks}
                type="button"
                onClick={() => setDurTicks(d.ticks)}
                className={`px-2 py-0.5 text-xs font-medium transition ${
                  durTicks === d.ticks
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--card)] text-[var(--ink-soft)] hover:bg-[var(--accent-soft)]'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className="rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--ink-soft)] hover:border-[var(--accent)]"
        >
          {muted ? '🔇 Muted' : '🔊 Sound'}
        </button>

        <button
          type="button"
          onClick={() => setLoop((l) => !l)}
          className={`rounded border px-2 py-0.5 text-xs transition ${
            loop
              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
              : 'border-[var(--line)] text-[var(--ink-soft)] hover:border-[var(--accent)]'
          }`}
          title="Loop playback"
        >
          ↻ Loop {loop ? 'on' : 'off'}
        </button>

        <button
          type="button"
          onClick={clearAll}
          className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
        >
          Clear
        </button>
      </div>

      {/* Save / load bar */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          type="text"
          value={comp.name}
          onChange={(e) => actions.setName(e.target.value)}
          placeholder="Composition name"
          className="w-44 rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-[var(--ink)] placeholder:text-[var(--ink-muted)]"
        />
        <button
          type="button"
          onClick={onSave}
          className="rounded border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white"
        >
          {docId ? 'Save' : 'Save new'}
        </button>
        <button
          type="button"
          onClick={onNew}
          className="rounded border border-[var(--line)] px-2 py-1 text-[var(--ink-soft)] hover:border-[var(--accent)]"
        >
          New
        </button>
        <select
          value={docId ?? ''}
          onChange={(e) => e.target.value && onLoad(e.target.value)}
          className="rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-[var(--ink-soft)]"
        >
          <option value="">Load saved…</option>
          {saved.map((s) => (
            <option key={s.documentId} value={s.documentId}>
              {s.title}
            </option>
          ))}
        </select>
        {docId && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded border border-[var(--line)] px-2 py-1 text-[var(--ink-muted)] hover:border-red-500 hover:text-red-500"
          >
            Delete
          </button>
        )}
        {status && <span className="text-[var(--ink-muted)]">{status}</span>}
      </div>

      {/* Palette */}
      <ChordPalette comp={comp} onPick={actions.pickDegree} />
      <p className="-mt-2 text-[11px] text-[var(--ink-muted)]">
        {selectedChord
          ? 'Chord selected — pick a palette chip to change it, drag its body to move, drag the right edge to extend, or × to remove.'
          : 'Click a beat in the chord lane to set where the next chord lands, then a palette chip. Click melody/bass cells to add notes at the chosen duration (drag to move, right edge to resize, double-click to remove).'}
      </p>

      {/* Timeline */}
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
        <div className="relative min-w-[820px]">
          {/* Moving playhead — spans all lanes at the current tick. The
              track starts after the LABEL_W gutter, so offset by it. */}
          {currentStep != null && (
            <div
              className="pointer-events-none absolute bottom-0 top-4 z-10 w-0.5 bg-[var(--accent)] opacity-70"
              style={{
                left: `calc(${LABEL_W} + (100% - ${LABEL_W}) * ${(currentStep + 0.5) / TOTAL_TICKS})`,
              }}
            />
          )}
          <BeatRuler />
          <div className="mt-1">
            <NoteLane
              comp={comp}
              lane="melody"
              notes={comp.melody}
              currentStep={currentStep}
              color={MELODY_COLOR}
              highlight={melodyHighlight}
              selectedId={selectedId}
              onPlace={(degree, tick) => placeNote('melody', degree, tick)}
              onSelect={handleSelect}
              onMove={(id, s, degree) => actions.moveNote('melody', id, s, degree)}
              onResize={(id, l) => actions.resizeNote('melody', id, l)}
              onRemove={(id) => actions.removeNote('melody', id)}
            />
          </div>
          <div className="my-1.5">
            <ChordLane
              comp={comp}
              selectedId={selectedId}
              cursor={cursor}
              currentStep={currentStep}
              onSelect={handleSelect}
              onSetCursor={actions.selectBar}
              onMove={actions.moveChord}
              onResize={actions.resizeChord}
              onRemove={actions.removeChord}
            />
          </div>
          <NoteLane
            comp={comp}
            lane="bass"
            notes={comp.bass}
            currentStep={currentStep}
            color={BASS_COLOR}
            selectedId={selectedId}
            onPlace={(degree, tick) => placeNote('bass', degree, tick)}
            onSelect={handleSelect}
            onMove={(id, s, degree) => actions.moveNote('bass', id, s, degree)}
            onResize={(id, l) => actions.resizeNote('bass', id, l)}
            onRemove={(id) => actions.removeNote('bass', id)}
          />
          <div className="mt-2 flex gap-4 text-[10px] text-[var(--ink-muted)]">
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: MELODY_COLOR }} />
              Melody
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: BASS_COLOR }} />
              Bass
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
