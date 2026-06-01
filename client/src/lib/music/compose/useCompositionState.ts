// Progression Composer — editor state. Owns the composition plus the two
// pieces of edit state tightly coupled to it (the insertion `cursor` and
// the `selectedId`), so every mutation is one atomic, centralized
// transition. All span/note maths route through the pure helpers in
// spans.ts. Action callbacks are stable (dispatch-backed), which lets the
// lanes be memoized, and the reducer shape leaves room for an undo/redo
// wrapper later.
//
// Ephemeral UI that isn't composition data (tempo-picker duration, mute,
// loop, persistence/docId) stays in the Composer.

import { useMemo, useReducer } from 'react';
import {
  addChord,
  addNote,
  moveSpan,
  removeById,
  resizeSpan,
  setChordDegree,
  spanAt,
} from './spans';
import {
  DEFAULT_CHORD_TICKS,
  TOTAL_TICKS,
  emptyComposition,
  type Composition,
  type Degree,
  type KeyMode,
  type NoteSpan,
} from './types';

export type Lane = 'melody' | 'bass';

export type EditorState = {
  comp: Composition;
  /** Insertion cursor (tick) where the next palette chord lands. */
  cursor: number;
  /** Selected chord or note id (shared id space; ids are prefix-unique). */
  selectedId: string | null;
};

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${(idCounter += 1)}`;

/** Fresh span/note ids on load so they can't collide with later-minted ids. */
function reidentify(comp: Composition): Composition {
  return {
    ...comp,
    chords: comp.chords.map((s) => ({ ...s, id: nextId('span') })),
    melody: comp.melody.map((n) => ({ ...n, id: nextId('note') })),
    bass: comp.bass.map((n) => ({ ...n, id: nextId('note') })),
  };
}

type Action =
  | { type: 'setKeyRoot'; root: Composition['key']['root'] }
  | { type: 'setKeyMode'; mode: KeyMode }
  | { type: 'setBpm'; bpm: number }
  | { type: 'setName'; name: string }
  | { type: 'selectBar'; tick: number }
  | { type: 'select'; id: string }
  | { type: 'deselect' }
  | { type: 'pickDegree'; degree: Degree; newId: string }
  | { type: 'moveChord'; id: string; start: number }
  | { type: 'resizeChord'; id: string; length: number }
  | { type: 'removeChord'; id: string }
  | { type: 'placeNote'; lane: Lane; degree: Degree; tick: number; length: number; newId: string }
  | { type: 'moveNote'; lane: Lane; id: string; start: number; degree: Degree }
  | { type: 'resizeNote'; lane: Lane; id: string; length: number }
  | { type: 'removeNote'; lane: Lane; id: string }
  | { type: 'clearAll' }
  | { type: 'load'; comp: Composition }
  | { type: 'replace'; comp: Composition };

function reducer(s: EditorState, a: Action): EditorState {
  const { comp } = s;
  switch (a.type) {
    case 'setKeyRoot':
      return { ...s, comp: { ...comp, key: { ...comp.key, root: a.root } } };
    case 'setKeyMode':
      return { ...s, comp: { ...comp, key: { ...comp.key, mode: a.mode } } };
    case 'setBpm':
      return { ...s, comp: { ...comp, bpm: a.bpm } };
    case 'setName':
      return { ...s, comp: { ...comp, name: a.name } };

    case 'selectBar':
      return { ...s, cursor: a.tick, selectedId: null };
    case 'select':
      return { ...s, selectedId: a.id };
    case 'deselect':
      return { ...s, selectedId: null };

    case 'pickDegree': {
      // A selected chord is re-colored; otherwise drop a new chord at the
      // cursor and advance the cursor past it.
      if (s.selectedId && comp.chords.some((c) => c.id === s.selectedId)) {
        return { ...s, comp: { ...comp, chords: setChordDegree(comp.chords, s.selectedId, a.degree) } };
      }
      const chords = addChord(comp.chords, a.newId, a.degree, s.cursor, DEFAULT_CHORD_TICKS);
      const placed = spanAt(chords, s.cursor);
      const cursor = placed
        ? Math.min(placed.start + placed.length, TOTAL_TICKS - 1)
        : s.cursor;
      return { ...s, comp: { ...comp, chords }, cursor };
    }
    case 'moveChord':
      return { ...s, comp: { ...comp, chords: moveSpan(comp.chords, a.id, a.start) } };
    case 'resizeChord':
      return { ...s, comp: { ...comp, chords: resizeSpan(comp.chords, a.id, a.length) } };
    case 'removeChord':
      return {
        ...s,
        comp: { ...comp, chords: removeById(comp.chords, a.id) },
        selectedId: s.selectedId === a.id ? null : s.selectedId,
      };

    case 'placeNote': {
      const cell: NoteSpan = { id: a.newId, degree: a.degree, octave: 0, start: a.tick, length: a.length };
      return { ...s, comp: { ...comp, [a.lane]: addNote(comp[a.lane], cell.id, cell.degree, cell.octave, cell.start, cell.length) } };
    }
    case 'moveNote':
      return {
        ...s,
        comp: {
          ...comp,
          [a.lane]: moveSpan(comp[a.lane], a.id, a.start).map((n) =>
            n.id === a.id ? { ...n, degree: a.degree } : n,
          ),
        },
      };
    case 'resizeNote':
      return { ...s, comp: { ...comp, [a.lane]: resizeSpan(comp[a.lane], a.id, a.length) } };
    case 'removeNote':
      return {
        ...s,
        comp: { ...comp, [a.lane]: removeById(comp[a.lane], a.id) },
        selectedId: s.selectedId === a.id ? null : s.selectedId,
      };

    case 'clearAll':
      return { comp: { ...comp, chords: [], melody: [], bass: [] }, cursor: 0, selectedId: null };
    case 'load':
      return { comp: reidentify(a.comp), cursor: 0, selectedId: null };
    case 'replace':
      return { comp: a.comp, cursor: 0, selectedId: null };
    default:
      return s;
  }
}

export type CompositionActions = {
  setKeyRoot: (root: Composition['key']['root']) => void;
  setKeyMode: (mode: KeyMode) => void;
  setBpm: (bpm: number) => void;
  setName: (name: string) => void;
  selectBar: (tick: number) => void;
  select: (id: string) => void;
  deselect: () => void;
  pickDegree: (degree: Degree) => void;
  moveChord: (id: string, start: number) => void;
  resizeChord: (id: string, length: number) => void;
  removeChord: (id: string) => void;
  placeNote: (lane: Lane, degree: Degree, tick: number, length: number) => void;
  moveNote: (lane: Lane, id: string, start: number, degree: Degree) => void;
  resizeNote: (lane: Lane, id: string, length: number) => void;
  removeNote: (lane: Lane, id: string) => void;
  clearAll: () => void;
  /** Load a stored composition (mints fresh span ids). */
  load: (comp: Composition) => void;
  /** Start a fresh empty composition in the given key. */
  reset: (root: Composition['key']['root'], mode: KeyMode) => void;
};

export function useCompositionState(initialRoot: Composition['key']['root']) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    comp: emptyComposition(nextId('comp'), 'Untitled', initialRoot, 'major'),
    cursor: 0,
    selectedId: null as string | null,
  }));

  // Stable across renders (dispatch is stable) → lets lanes be memoized.
  const actions = useMemo<CompositionActions>(
    () => ({
      setKeyRoot: (root) => dispatch({ type: 'setKeyRoot', root }),
      setKeyMode: (mode) => dispatch({ type: 'setKeyMode', mode }),
      setBpm: (bpm) => dispatch({ type: 'setBpm', bpm }),
      setName: (name) => dispatch({ type: 'setName', name }),
      selectBar: (tick) => dispatch({ type: 'selectBar', tick }),
      select: (id) => dispatch({ type: 'select', id }),
      deselect: () => dispatch({ type: 'deselect' }),
      pickDegree: (degree) => dispatch({ type: 'pickDegree', degree, newId: nextId('span') }),
      moveChord: (id, start) => dispatch({ type: 'moveChord', id, start }),
      resizeChord: (id, length) => dispatch({ type: 'resizeChord', id, length }),
      removeChord: (id) => dispatch({ type: 'removeChord', id }),
      placeNote: (lane, degree, tick, length) =>
        dispatch({ type: 'placeNote', lane, degree, tick, length, newId: nextId('note') }),
      moveNote: (lane, id, start, degree) => dispatch({ type: 'moveNote', lane, id, start, degree }),
      resizeNote: (lane, id, length) => dispatch({ type: 'resizeNote', lane, id, length }),
      removeNote: (lane, id) => dispatch({ type: 'removeNote', lane, id }),
      clearAll: () => dispatch({ type: 'clearAll' }),
      load: (comp) => dispatch({ type: 'load', comp }),
      reset: (root, mode) => dispatch({ type: 'replace', comp: emptyComposition(nextId('comp'), 'Untitled', root, mode) }),
    }),
    [],
  );

  return { ...state, actions };
}
