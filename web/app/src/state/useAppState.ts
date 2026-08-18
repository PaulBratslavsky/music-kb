import { useCallback, useEffect, useRef, useState } from 'react';
import { synth } from '../audio/synth';
import {
  PITCH_CLASSES,
  CHORD_QUALITIES,
  SCALE_TYPES,
  INSTRUMENTS,
  type AppState,
  type ChordQuality,
  type ChordSelection,
  type GameModeState,
  type GuessPosition,
  type GuessResult,
  type Instrument,
  type PitchClass,
  type ScalePosition,
  type ScaleSelection,
  type ScaleType,
  type ViewMode,
} from '../types';
import { STANDARD_TUNING_MIDI } from '../instruments/guitar/layout';
import { PUSH_BASE_MIDI } from '../instruments/push/layout';
import { pitchClassFromMidi } from '../theory/notes';
import { loadBestStreak, saveBestStreak } from './gameModeStorage';

const DEFAULT_STATE: AppState = {
  mode: 'chord',
  chord: { root: 'C', quality: 'maj', inversion: 0, voicingIndex: 0 },
  scale: { root: 'C', type: 'major' },
  singleNote: 'C',
  scalePosition: 'all',
  preferFlats: false,
};

function parseScalePosition(s: string | null): ScalePosition {
  if (s === '2oct') return '2oct';
  if (s === '1' || s === '2' || s === '3' || s === '4' || s === '5') {
    return Number(s) as ScalePosition;
  }
  return 'all';
}

function isPitchClass(s: string | null): s is PitchClass {
  return s != null && (PITCH_CLASSES as readonly string[]).includes(s);
}
function isChordQuality(s: string | null): s is ChordQuality {
  return s != null && (CHORD_QUALITIES as readonly string[]).includes(s);
}
function isScaleType(s: string | null): s is ScaleType {
  return s != null && (SCALE_TYPES as readonly string[]).includes(s);
}
function isViewMode(s: string | null): s is ViewMode {
  return s === 'chord' || s === 'scale' || s === 'note' || s === 'all';
}

function parseIntSafe(s: string | null, fallback: number): number {
  if (s == null) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function stateFromUrl(search: string): AppState {
  const params = new URLSearchParams(search);
  const mode = isViewMode(params.get('mode')) ? (params.get('mode') as ViewMode) : DEFAULT_STATE.mode;

  const chordRoot = isPitchClass(params.get('root')) ? (params.get('root') as PitchClass) : DEFAULT_STATE.chord.root;
  const quality = isChordQuality(params.get('quality')) ? (params.get('quality') as ChordQuality) : DEFAULT_STATE.chord.quality;
  const inversion = parseIntSafe(params.get('inv'), DEFAULT_STATE.chord.inversion);
  const voicingIndex = parseIntSafe(params.get('v'), DEFAULT_STATE.chord.voicingIndex);

  const scaleRoot = isPitchClass(params.get('root')) ? (params.get('root') as PitchClass) : DEFAULT_STATE.scale.root;
  const scaleType = isScaleType(params.get('type')) ? (params.get('type') as ScaleType) : DEFAULT_STATE.scale.type;

  const singleNote = isPitchClass(params.get('note')) ? (params.get('note') as PitchClass) : DEFAULT_STATE.singleNote;
  const scalePosition = parseScalePosition(params.get('pos'));
  const preferFlats = params.get('flats') === '1';

  return {
    mode,
    chord: { root: chordRoot, quality, inversion, voicingIndex },
    scale: { root: scaleRoot, type: scaleType },
    singleNote,
    scalePosition,
    preferFlats,
  };
}

export function urlFromState(state: AppState): string {
  const params = new URLSearchParams();
  params.set('mode', state.mode);
  if (state.mode === 'chord') {
    params.set('root', state.chord.root);
    params.set('quality', state.chord.quality);
    params.set('inv', String(state.chord.inversion));
    params.set('v', String(state.chord.voicingIndex));
  } else if (state.mode === 'scale') {
    params.set('root', state.scale.root);
    params.set('type', state.scale.type);
    if (state.scalePosition !== 'all') {
      params.set('pos', String(state.scalePosition));
    }
  } else {
    params.set('note', state.singleNote);
  }
  if (state.mode !== 'all' && state.preferFlats) {
    params.set('flats', '1');
  }
  return `?${params.toString()}`;
}

// ----- Game-mode helpers -----

const emptyGameState = (): GameModeState => ({
  enabled: false,
  currentQuestion: null,
  currentQuestionDisplay: null,
  pendingGuesses: [],
  pendingExpected: [],
  checkedResults: null,
  currentStreak: 0,
  bestStreak: 0,
  lastQuestion: null,
});

// Flat-spelling enharmonic for the 5 accidentals. Naturals don't get respelled.
const FLAT_NAMES: Partial<Record<PitchClass, string>> = {
  'C#': 'Db',
  'D#': 'Eb',
  'F#': 'Gb',
  'G#': 'Ab',
  'A#': 'Bb',
};

function pickQuestion(prev: PitchClass | null): { pc: PitchClass; display: string } {
  const pool = prev == null ? PITCH_CLASSES : PITCH_CLASSES.filter((pc) => pc !== prev);
  const pc = pool[Math.floor(Math.random() * pool.length)];
  const flat = FLAT_NAMES[pc];
  // 50/50 between sharp and flat spelling for accidentals; naturals are unique.
  const display = flat && Math.random() < 0.5 ? flat : pc;
  return { pc, display };
}

function samePosition(a: GuessPosition, b: GuessPosition): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'piano' && b.kind === 'piano') return a.midi === b.midi;
  if (a.kind === 'guitar' && b.kind === 'guitar') return a.string === b.string && a.fret === b.fret;
  if (a.kind === 'push' && b.kind === 'push') return a.row === b.row && a.col === b.col;
  return false;
}

function pcAtPosition(pos: GuessPosition): PitchClass {
  if (pos.kind === 'piano') return pitchClassFromMidi(pos.midi);
  if (pos.kind === 'guitar') return pitchClassFromMidi(STANDARD_TUNING_MIDI[pos.string] + pos.fret);
  return pitchClassFromMidi(PUSH_BASE_MIDI + pos.row * 5 + pos.col);
}

export function useAppState() {
  const [state, setState] = useState<AppState>(() =>
    stateFromUrl(typeof window !== 'undefined' ? window.location.search : ''),
  );
  const [focusedPitchClass, setFocusedPitchClassRaw] = useState<PitchClass | null>(null);
  const [labelMode, setLabelMode] = useState<'name' | 'degree'>('name');
  const [showNaturals, setShowNaturals] = useState(false);
  const [audioMuted, setAudioMutedRaw] = useState(false);
  /** When in scale mode, lets the user "preview" a diatonic chord by lighting up
   *  its notes within the scale. null = nothing previewed. Value = scale degree (1..7). */
  const [previewedChordDegree, setPreviewedChordDegreeRaw] = useState<number | null>(null);

  /** Toggle a diatonic-chord preview in scale mode. Same degree clears it. */
  const togglePreviewedChordDegree = useCallback((degree: number) => {
    setPreviewedChordDegreeRaw((prev) => (prev === degree ? null : degree));
  }, []);

  const clearPreviewedChordDegree = useCallback(() => {
    setPreviewedChordDegreeRaw(null);
  }, []);

  const setAudioMuted = useCallback((muted: boolean) => {
    setAudioMutedRaw(muted);
    synth.setMuted(muted);
  }, []);

  const toggleAudio = useCallback(() => {
    setAudioMutedRaw((m) => {
      synth.setMuted(!m);
      return !m;
    });
  }, []);

  // Push to URL whenever state changes
  useEffect(() => {
    const next = urlFromState(state);
    if (window.location.search !== next) {
      window.history.replaceState(null, '', next);
    }
  }, [state]);

  // Listen for back/forward
  useEffect(() => {
    const onPop = () => setState(stateFromUrl(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setMode = useCallback((mode: ViewMode) => {
    setState((s) => ({ ...s, mode }));
    if (mode !== 'scale') setPreviewedChordDegreeRaw(null);
  }, []);

  const setChord = useCallback((updater: (c: ChordSelection) => ChordSelection) => {
    setState((s) => ({ ...s, chord: updater(s.chord) }));
  }, []);

  const setScale = useCallback((updater: (sc: ScaleSelection) => ScaleSelection) => {
    setState((s) => ({ ...s, scale: updater(s.scale) }));
    setPreviewedChordDegreeRaw(null);
  }, []);

  const setSingleNote = useCallback((pc: PitchClass) => {
    setState((s) => ({ ...s, singleNote: pc }));
  }, []);

  /**
   * Pick a root from the SelectionBar, carrying the chosen spelling. `preferFlats`
   * records whether the user clicked the flat-named button (e.g. "Bb" vs "A#") so
   * the whole key is spelled with the right accidentals. Sets the root on
   * whichever selection the current mode is editing.
   */
  const pickRoot = useCallback((pc: PitchClass, preferFlats: boolean) => {
    setState((s) => {
      if (s.mode === 'chord') {
        return { ...s, preferFlats, chord: { ...s.chord, root: pc, inversion: 0 } };
      }
      if (s.mode === 'scale') {
        return { ...s, preferFlats, scale: { ...s.scale, root: pc } };
      }
      return { ...s, preferFlats, singleNote: pc };
    });
    if (state.mode === 'scale') setPreviewedChordDegreeRaw(null);
  }, [state.mode]);

  /** Switch to chord mode with a specific root + quality (used by the diatonic-chord chips). */
  const selectChord = useCallback((root: PitchClass, quality: ChordQuality) => {
    setState((s) => ({
      ...s,
      mode: 'chord',
      chord: { root, quality, inversion: 0, voicingIndex: 0 },
    }));
  }, []);

  /** Switch to scale mode with a specific root + type (used by the containing-scale chips). */
  const selectScale = useCallback((root: PitchClass, type: ScaleType) => {
    setState((s) => ({
      ...s,
      mode: 'scale',
      scale: { root, type },
    }));
    setPreviewedChordDegreeRaw(null);
  }, []);

  const setScalePosition = useCallback((pos: ScalePosition) => {
    setState((s) => ({ ...s, scalePosition: pos }));
  }, []);

  /** Click-to-focus: clicking the same PC clears the focus. */
  const toggleFocusedPitchClass = useCallback((pc: PitchClass) => {
    setFocusedPitchClassRaw((cur) => (cur === pc ? null : pc));
  }, []);

  const clearFocusedPitchClass = useCallback(() => {
    setFocusedPitchClassRaw(null);
  }, []);

  // ----- Game mode (per-instrument independent) -----
  const [gameMode, setGameMode] = useState<Record<Instrument, GameModeState>>(() => ({
    piano: emptyGameState(),
    guitar: emptyGameState(),
    push: emptyGameState(),
  }));
  // Track which best-streak values we've already persisted so we only write on growth.
  const lastSavedBest = useRef<Record<Instrument, number>>({ piano: 0, guitar: 0, push: 0 });

  // Hydrate best streaks from localStorage on mount
  useEffect(() => {
    const loaded: Record<Instrument, number> = {
      piano: loadBestStreak('piano'),
      guitar: loadBestStreak('guitar'),
      push: loadBestStreak('push'),
    };
    lastSavedBest.current = { ...loaded };
    setGameMode((g) => ({
      piano: { ...g.piano, bestStreak: loaded.piano },
      guitar: { ...g.guitar, bestStreak: loaded.guitar },
      push: { ...g.push, bestStreak: loaded.push },
    }));
  }, []);

  const toggleGameMode = useCallback((instrument: Instrument) => {
    setGameMode((g) => {
      const cur = g[instrument];
      if (cur.enabled) {
        return {
          ...g,
          [instrument]: {
            ...emptyGameState(),
            bestStreak: cur.bestStreak,
          },
        };
      }
      const q = pickQuestion(null);
      return {
        ...g,
        [instrument]: {
          ...emptyGameState(),
          enabled: true,
          currentQuestion: q.pc,
          currentQuestionDisplay: q.display,
          lastQuestion: q.pc,
          bestStreak: cur.bestStreak,
        },
      };
    });
  }, []);

  const submitGuess = useCallback((instrument: Instrument, position: GuessPosition) => {
    setGameMode((g) => {
      const cur = g[instrument];
      if (!cur.enabled || cur.currentQuestion == null) return g;

      // If previous results are still showing, the next click starts a fresh round.
      const startingFresh = cur.checkedResults != null;
      const base: GameModeState = startingFresh
        ? { ...cur, checkedResults: null, pendingGuesses: [], pendingExpected: [] }
        : cur;

      // Toggle: clicking an already-pending position un-selects it.
      const dupIndex = base.pendingGuesses.findIndex((p) => samePosition(p, position));
      if (dupIndex !== -1 && !startingFresh) {
        const guesses = base.pendingGuesses.slice();
        const expected = base.pendingExpected.slice();
        guesses.splice(dupIndex, 1);
        expected.splice(dupIndex, 1);
        return { ...g, [instrument]: { ...base, pendingGuesses: guesses, pendingExpected: expected } };
      }

      const nextQuestion = pickQuestion(base.currentQuestion);
      return {
        ...g,
        [instrument]: {
          ...base,
          pendingGuesses: [...base.pendingGuesses, position],
          pendingExpected: [...base.pendingExpected, base.currentQuestion],
          currentQuestion: nextQuestion.pc,
          currentQuestionDisplay: nextQuestion.display,
          lastQuestion: nextQuestion.pc,
        },
      };
    });
  }, []);

  const checkGame = useCallback((instrument: Instrument) => {
    setGameMode((g) => {
      const cur = g[instrument];
      if (!cur.enabled || cur.pendingGuesses.length === 0) return g;

      const results: GuessResult[] = cur.pendingGuesses.map((pos, i) => {
        const actualPC = pcAtPosition(pos);
        const expectedPC = cur.pendingExpected[i];
        return { position: pos, actualPC, expectedPC, correct: actualPC === expectedPC };
      });

      // Streak: add 1 for each leading correct guess; first wrong ends the run.
      let running = cur.currentStreak;
      let best = cur.bestStreak;
      for (const r of results) {
        if (r.correct) {
          running += 1;
          if (running > best) best = running;
        } else {
          running = 0;
          break;
        }
      }

      if (best > lastSavedBest.current[instrument]) {
        saveBestStreak(instrument, best);
        lastSavedBest.current[instrument] = best;
      }

      return {
        ...g,
        [instrument]: {
          ...cur,
          checkedResults: results,
          pendingGuesses: [],
          pendingExpected: [],
          currentStreak: running,
          bestStreak: best,
        },
      };
    });
  }, []);

  const resetGameRound = useCallback((instrument: Instrument) => {
    setGameMode((g) => {
      const cur = g[instrument];
      if (!cur.enabled) return g;
      return {
        ...g,
        [instrument]: {
          ...cur,
          pendingGuesses: [],
          pendingExpected: [],
          checkedResults: null,
        },
      };
    });
  }, []);

  // Convenience: tell App.tsx whether ANY instrument is in game mode so it can
  // suppress global affordances (focus rings, etc.) if needed.
  const anyGameModeOn = INSTRUMENTS.some((i) => gameMode[i].enabled);

  return {
    state,
    setMode,
    setChord,
    setScale,
    setSingleNote,
    pickRoot,
    selectChord,
    selectScale,
    setScalePosition,
    focusedPitchClass,
    toggleFocusedPitchClass,
    clearFocusedPitchClass,
    labelMode,
    setLabelMode,
    showNaturals,
    setShowNaturals,
    previewedChordDegree,
    togglePreviewedChordDegree,
    clearPreviewedChordDegree,
    audioMuted,
    setAudioMuted,
    toggleAudio,
    gameMode,
    toggleGameMode,
    submitGuess,
    checkGame,
    resetGameRound,
    anyGameModeOn,
  };
}
