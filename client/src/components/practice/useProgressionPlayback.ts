// Shared chord-progression playback.
//
// Extracted from ProgressionPlayer so the loop-section editor plays its
// progression exactly the same way — one timing implementation, one place
// where "how a chord is voiced for playback" is decided.
//
// Re-arms the interval whenever tempo / chords / beats change, so live
// edits take effect on the next beat boundary instead of needing a stop.

import { useEffect, useRef, useState } from 'react';
import { getChordPitchClasses, stackAscending } from '@music-kb/music/theory/chords';
import { midiFromPitchOctave } from '@music-kb/music/theory/notes';
import { synth } from '#/lib/music/audio/synth';
import type { ChordQuality, PitchClass } from '@music-kb/music/types';

export type ChordStep = {
  root: PitchClass;
  /** Quality used to compute the voiced triad. */
  quality: ChordQuality;
  /** Display name (e.g. "Cmaj7") — may differ from `quality`, which is
   *  deliberately reduced to a triad so cycling chords stay clean. */
  chordName: string;
};

export function useProgressionPlayback({
  steps,
  bpm,
  beatsPerChord,
  isPlaying,
}: {
  steps: ChordStep[];
  bpm: number;
  beatsPerChord: number;
  isPlaying: boolean;
}): { currentIdx: number | null } {
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const idxRef = useRef(0);

  useEffect(() => {
    if (!isPlaying || steps.length === 0) {
      setCurrentIdx(null);
      return;
    }
    const tickMs = (60_000 / bpm) * beatsPerChord;
    idxRef.current = 0;
    const playChord = (step: ChordStep) => {
      const pcs = getChordPitchClasses(step.root, step.quality);
      const notes = stackAscending(pcs, 4);
      synth.playChord(
        notes.map((n) => midiFromPitchOctave(n.pitchClass, n.octave)),
      );
    };
    setCurrentIdx(0);
    playChord(steps[0]);
    const id = setInterval(() => {
      idxRef.current = (idxRef.current + 1) % steps.length;
      setCurrentIdx(idxRef.current);
      playChord(steps[idxRef.current]);
    }, tickMs);
    return () => clearInterval(id);
  }, [isPlaying, steps, bpm, beatsPerChord]);

  return { currentIdx };
}
