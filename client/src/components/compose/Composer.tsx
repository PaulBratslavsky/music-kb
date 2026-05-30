// Progression Composer — top-level. Owns the Composition and assembles
// the Hookpad-style stacked layout: transport, chord palette, then a
// shared 8-bar timeline with a melody piano-roll, the draggable chord
// lane, and a bass piano-roll. Span/cell mutations go through the pure
// helpers in spans.ts; this component only wires state to UI.

import { useEffect, useRef, useState } from 'react';
import { PITCH_CLASSES, type PitchClass } from '#/lib/music/types';
import {
  emptyComposition,
  type Composition,
  type Degree,
  type DegreeCell,
  type KeyMode,
} from '#/lib/music/compose/types';
import {
  addChord,
  moveChord,
  removeChord,
  resizeChord,
  setChordDegree,
  spanAtBeat,
} from '#/lib/music/compose/spans';
import { useCompositionPlayback } from '#/lib/music/compose/useCompositionPlayback';
import { synth } from '#/lib/music/audio/synth';
import { BeatRuler } from './BeatRuler';
import { ChordPalette } from './ChordPalette';
import { ChordLane } from './ChordLane';
import { NoteGrid } from './NoteGrid';

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

const MELODY_COLOR = '#2563eb';
const BASS_COLOR = '#9333ea';
const DEFAULT_CHORD_LEN = 4; // one bar

export function Composer({ initialRoot = 'C' }: { initialRoot?: PitchClass }) {
  const [comp, setComp] = useState<Composition>(() =>
    emptyComposition(nextId('comp'), 'Untitled', initialRoot, 'major'),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [muted, setMuted] = useState(false);

  const { isPlaying, currentStep, toggle, stop } = useCompositionPlayback(comp);

  useEffect(() => {
    synth.setMuted(muted);
  }, [muted]);

  // ---- key / tempo ----
  const setKeyRoot = (root: PitchClass) =>
    setComp((c) => ({ ...c, key: { ...c.key, root } }));
  const setKeyMode = (mode: KeyMode) =>
    setComp((c) => ({ ...c, key: { ...c.key, mode } }));
  const setBpm = (bpm: number) => setComp((c) => ({ ...c, bpm }));

  // ---- chords ----
  // A palette chip either re-colors the selected block or drops a new
  // chord at the cursor (advancing the cursor past it).
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const pickDegree = (degree: Degree) => {
    if (selectedId) {
      setComp((c) => ({ ...c, chords: setChordDegree(c.chords, selectedId, degree) }));
      return;
    }
    setComp((c) => {
      const id = nextId('span');
      const chords = addChord(c.chords, id, degree, cursorRef.current, DEFAULT_CHORD_LEN);
      const placed = spanAtBeat(chords, cursorRef.current);
      if (placed) {
        const next = Math.min(placed.start + placed.length, c.melody.length - 1);
        setCursor(next);
      }
      return { ...c, chords };
    });
  };

  const moveSpan = (id: string, newStart: number) =>
    setComp((c) => ({ ...c, chords: moveChord(c.chords, id, newStart) }));
  const resizeSpan = (id: string, newLength: number) =>
    setComp((c) => ({ ...c, chords: resizeChord(c.chords, id, newLength) }));
  const removeSpan = (id: string) => {
    setComp((c) => ({ ...c, chords: removeChord(c.chords, id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // ---- melody / bass (monophonic per beat) ----
  const toggleCell = (lane: 'melody' | 'bass', step: number, degree: Degree) =>
    setComp((c) => {
      const arr = [...c[lane]];
      const current = arr[step];
      const next: DegreeCell | null =
        current?.degree === degree ? null : { degree, octave: 0 };
      arr[step] = next;
      return { ...c, [lane]: arr };
    });

  const clearAll = () => {
    stop();
    setSelectedId(null);
    setCursor(0);
    setComp((c) => ({
      ...c,
      chords: [],
      melody: c.melody.map(() => null),
      bass: c.bass.map(() => null),
    }));
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
            className="w-28"
          />
          <span className="w-12 tabular-nums text-[var(--ink-soft)]">
            {comp.bpm} BPM
          </span>
        </label>

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
        {selectedId
          ? 'A chord is selected — pick a palette chip to change it, drag its body to move, drag the right edge to extend, or × to remove.'
          : 'Click a beat in the chord lane to set where the next chord lands, then pick a palette chip.'}
      </p>

      {/* Timeline */}
      <div className="overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card)] p-3">
        <div className="min-w-[640px]">
          <BeatRuler />
          <div className="mt-1">
            <NoteGrid
              comp={comp}
              lane="melody"
              cells={comp.melody}
              currentStep={currentStep}
              color={MELODY_COLOR}
              onToggle={(step, degree) => toggleCell('melody', step, degree)}
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
              onMove={moveSpan}
              onResize={resizeSpan}
              onRemove={removeSpan}
            />
          </div>
          <NoteGrid
            comp={comp}
            lane="bass"
            cells={comp.bass}
            currentStep={currentStep}
            color={BASS_COLOR}
            onToggle={(step, degree) => toggleCell('bass', step, degree)}
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
