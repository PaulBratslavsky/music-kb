// Progression Composer — top-level. Owns the Composition and assembles
// the Hookpad-style stacked layout: transport, chord palette, then a
// shared 8-bar timeline with a melody piano-roll, the draggable chord
// lane, and a bass piano-roll. Span/note mutations go through the pure
// helpers in spans.ts; this component only wires state to UI.
//
// Time is in ticks (sixteenth resolution). A duration picker sets the
// length of newly-placed chords and notes; everything is draggable and
// resizable afterwards.

import { useEffect, useRef, useState } from 'react';
import { PITCH_CLASSES, type PitchClass } from '#/lib/music/types';
import {
  emptyComposition,
  DURATIONS,
  DEFAULT_CHORD_TICKS,
  type Composition,
  type Degree,
  type KeyMode,
} from '#/lib/music/compose/types';
import {
  addChord,
  addNote,
  moveSpan,
  removeById,
  resizeSpan,
  setChordDegree,
  spanAt,
} from '#/lib/music/compose/spans';
import { useCompositionPlayback } from '#/lib/music/compose/useCompositionPlayback';
import { synth } from '#/lib/music/audio/synth';
import { chordToneDegrees } from '#/lib/music/compose/labels';
import { degreeColor, hexToRgba } from '#/lib/music/compose/colors';
import type { ChordToneHighlight } from './chordHighlight';
import { BeatRuler } from './BeatRuler';
import { ChordPalette } from './ChordPalette';
import { ChordLane } from './ChordLane';
import { NoteLane } from './NoteLane';

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

const MELODY_COLOR = '#2563eb';
const BASS_COLOR = '#9333ea';

export function Composer({ initialRoot = 'C' }: { initialRoot?: PitchClass }) {
  const [comp, setComp] = useState<Composition>(() =>
    emptyComposition(nextId('comp'), 'Untitled', initialRoot, 'major'),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [muted, setMuted] = useState(false);
  const [durTicks, setDurTicks] = useState(4); // default 1/4 note

  const { isPlaying, currentStep, toggle, stop } = useCompositionPlayback(comp);

  useEffect(() => {
    synth.setMuted(muted);
  }, [muted]);

  // ---- key / tempo / duration ----
  const setKeyRoot = (root: PitchClass) =>
    setComp((c) => ({ ...c, key: { ...c.key, root } }));
  const setKeyMode = (mode: KeyMode) =>
    setComp((c) => ({ ...c, key: { ...c.key, mode } }));
  const setBpm = (bpm: number) => setComp((c) => ({ ...c, bpm }));

  // ---- chords ----
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const pickDegree = (degree: Degree) => {
    if (selectedId) {
      // Only re-color a selected *chord*; ignore if a note is selected.
      setComp((c) =>
        c.chords.some((s) => s.id === selectedId)
          ? { ...c, chords: setChordDegree(c.chords, selectedId, degree) }
          : c,
      );
      return;
    }
    setComp((c) => {
      const id = nextId('span');
      const chords = addChord(c.chords, id, degree, cursorRef.current, DEFAULT_CHORD_TICKS);
      const placed = spanAt(chords, cursorRef.current);
      if (placed) setCursor(Math.min(placed.start + placed.length, 127));
      return { ...c, chords };
    });
  };
  const moveChordSpan = (id: string, s: number) =>
    setComp((c) => ({ ...c, chords: moveSpan(c.chords, id, s) }));
  const resizeChordSpan = (id: string, l: number) =>
    setComp((c) => ({ ...c, chords: resizeSpan(c.chords, id, l) }));
  const removeChordSpan = (id: string) => {
    setComp((c) => ({ ...c, chords: removeById(c.chords, id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // ---- melody / bass notes ----
  const placeNote = (lane: 'melody' | 'bass', degree: Degree, tick: number) =>
    setComp((c) => ({
      ...c,
      [lane]: addNote(c[lane], nextId('note'), degree, 0, tick, durTicks),
    }));
  const moveNote = (lane: 'melody' | 'bass', id: string, s: number) =>
    setComp((c) => ({ ...c, [lane]: moveSpan(c[lane], id, s) }));
  const resizeNote = (lane: 'melody' | 'bass', id: string, l: number) =>
    setComp((c) => ({ ...c, [lane]: resizeSpan(c[lane], id, l) }));
  const removeNote = (lane: 'melody' | 'bass', id: string) => {
    setComp((c) => ({ ...c, [lane]: removeById(c[lane], id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

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
    setSelectedId(null);
    setCursor(0);
    setComp((c) => ({ ...c, chords: [], melody: [], bass: [] }));
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
                onClick={() => setKeyRoot(pc)}
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
              onClick={() => setKeyMode(m)}
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
            onChange={(e) => setBpm(Number(e.target.value))}
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
          onClick={clearAll}
          className="ml-auto rounded border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
        >
          Clear
        </button>
      </div>

      {/* Palette */}
      <ChordPalette comp={comp} onPick={pickDegree} />
      <p className="-mt-2 text-[11px] text-[var(--ink-muted)]">
        {selectedChord
          ? 'Chord selected — pick a palette chip to change it, drag its body to move, drag the right edge to extend, or × to remove.'
          : 'Click a beat in the chord lane to set where the next chord lands, then a palette chip. Click melody/bass cells to add notes at the chosen duration (drag to move, right edge to resize, double-click to remove).'}
      </p>

      {/* Timeline */}
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
        <div className="min-w-[820px]">
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
              onSelect={setSelectedId}
              onMove={(id, s) => moveNote('melody', id, s)}
              onResize={(id, l) => resizeNote('melody', id, l)}
              onRemove={(id) => removeNote('melody', id)}
            />
          </div>
          <div className="my-1.5">
            <ChordLane
              comp={comp}
              selectedId={selectedId}
              cursor={cursor}
              currentStep={currentStep}
              onSelect={setSelectedId}
              onSetCursor={setCursor}
              onMove={moveChordSpan}
              onResize={resizeChordSpan}
              onRemove={removeChordSpan}
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
            onSelect={setSelectedId}
            onMove={(id, s) => moveNote('bass', id, s)}
            onResize={(id, l) => resizeNote('bass', id, l)}
            onRemove={(id) => removeNote('bass', id)}
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
