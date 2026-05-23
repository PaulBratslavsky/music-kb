// LoopBuilderProvider — shared in-flight state for the play-along
// discovery flow. Lives at the route level so both columns can read
// and write to the same draft:
//
//   • Left column (Theory tab):    LoopBuilder panel + TheoryCompanion
//   • Right column (below player): saved-loops list, "save loop" form
//
// The draft is just three things: a candidate key, an ordered chord
// progression, and a recordMode flag that flips diatonic-chord clicks
// inside TheoryCompanion from "preview only" to "preview + append."
//
// Loop region (startSec/endSec) lives in PlayerProvider — same idea,
// different concern: player state is about the iframe's time; this is
// about the musical content being discovered.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ChordEntry, KeySig } from '#/lib/services/loops';

export type LoopBuilderState = {
  candidateKey: KeySig | null;
  progression: ChordEntry[];
  recordMode: boolean;
};

export type LoopBuilderActions = {
  setCandidateKey: (key: KeySig | null) => void;
  appendChord: (chord: { root: string; quality: string }) => void;
  removeChordAt: (index: number) => void;
  clearDraft: () => void;
  setRecordMode: (on: boolean) => void;
  toggleRecordMode: () => void;
  /** Replace the entire draft state — used when opening a saved loop. */
  hydrateFromSaved: (snapshot: {
    candidateKey: KeySig | null;
    progression: ChordEntry[];
  }) => void;
};

type LoopBuilderContextValue = LoopBuilderState & LoopBuilderActions;

const LoopBuilderContext = createContext<LoopBuilderContextValue | null>(null);

export function useLoopBuilder(): LoopBuilderContextValue {
  const ctx = useContext(LoopBuilderContext);
  if (!ctx) {
    throw new Error(
      'useLoopBuilder must be used inside <LoopBuilderProvider>',
    );
  }
  return ctx;
}

export function LoopBuilderProvider({ children }: { children: ReactNode }) {
  const [candidateKey, setCandidateKeyRaw] = useState<KeySig | null>(null);
  const [progression, setProgression] = useState<ChordEntry[]>([]);
  const [recordMode, setRecordModeRaw] = useState(false);

  const setCandidateKey = useCallback((key: KeySig | null) => {
    setCandidateKeyRaw(key);
  }, []);

  const appendChord = useCallback(
    (chord: { root: string; quality: string }) => {
      setProgression((prev) => [
        ...prev,
        { root: chord.root, quality: chord.quality, durationBeats: null },
      ]);
    },
    [],
  );

  const removeChordAt = useCallback((index: number) => {
    setProgression((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const clearDraft = useCallback(() => {
    setCandidateKeyRaw(null);
    setProgression([]);
    setRecordModeRaw(false);
  }, []);

  const setRecordMode = useCallback((on: boolean) => {
    setRecordModeRaw(on);
  }, []);

  const toggleRecordMode = useCallback(() => {
    setRecordModeRaw((prev) => !prev);
  }, []);

  const hydrateFromSaved = useCallback(
    (snapshot: {
      candidateKey: KeySig | null;
      progression: ChordEntry[];
    }) => {
      setCandidateKeyRaw(snapshot.candidateKey);
      setProgression(snapshot.progression);
      setRecordModeRaw(false);
    },
    [],
  );

  const value = useMemo<LoopBuilderContextValue>(
    () => ({
      candidateKey,
      progression,
      recordMode,
      setCandidateKey,
      appendChord,
      removeChordAt,
      clearDraft,
      setRecordMode,
      toggleRecordMode,
      hydrateFromSaved,
    }),
    [
      candidateKey,
      progression,
      recordMode,
      setCandidateKey,
      appendChord,
      removeChordAt,
      clearDraft,
      setRecordMode,
      toggleRecordMode,
      hydrateFromSaved,
    ],
  );

  return (
    <LoopBuilderContext.Provider value={value}>
      {children}
    </LoopBuilderContext.Provider>
  );
}
