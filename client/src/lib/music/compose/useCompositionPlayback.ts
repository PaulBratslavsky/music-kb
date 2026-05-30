// Progression Composer — playback hook. Owns the beat clock and is the
// only piece that touches the synth. Mirrors ProgressionPlayer's pattern
// of re-arming the interval on tempo/content changes so live edits take
// effect on the next beat. The pure schedule comes from buildSchedule;
// this just walks the step cursor and fires the synth.

import { useEffect, useMemo, useRef, useState } from 'react';
import { synth } from '../audio/synth';
import type { Composition } from './types';
import { TOTAL_STEPS } from './types';
import { buildSchedule, msPerBeat } from './playback';

export type CompositionPlayback = {
  isPlaying: boolean;
  /** Current beat cursor 0..TOTAL_STEPS-1, or null when stopped. */
  currentStep: number | null;
  play: () => void;
  stop: () => void;
  toggle: () => void;
};

export function useCompositionPlayback(
  comp: Composition,
  opts: { loop?: boolean } = {},
): CompositionPlayback {
  const loop = opts.loop ?? true;
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState<number | null>(null);

  // Index events by step for O(1) lookup as the cursor advances.
  const eventsByStep = useMemo(() => {
    const map = new Map<number, ReturnType<typeof buildSchedule>[number]>();
    for (const e of buildSchedule(comp)) map.set(e.step, e);
    return map;
  }, [comp]);

  const tickMs = msPerBeat(comp.bpm);
  const stepRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      setCurrentStep(null);
      return;
    }

    const fire = (step: number) => {
      const e = eventsByStep.get(step);
      if (!e) return;
      // Chord sustains for its span length; melody/bass for ~one beat.
      // Each lane gets its own voice: strings for chords, piano for
      // melody, bass for bass.
      if (e.chord) synth.playChord(e.chord, tickMs * (e.chordBeats ?? 1) * 0.95, 'string');
      if (e.melody != null) synth.playNote(e.melody, tickMs * 0.9, 'piano');
      if (e.bass != null) synth.playNote(e.bass, tickMs * 0.95, 'bass');
    };

    stepRef.current = 0;
    setCurrentStep(0);
    fire(0);

    const id = setInterval(() => {
      const next = stepRef.current + 1;
      if (next >= TOTAL_STEPS) {
        if (!loop) {
          clearInterval(id);
          setIsPlaying(false);
          setCurrentStep(null);
          return;
        }
        stepRef.current = 0;
      } else {
        stepRef.current = next;
      }
      setCurrentStep(stepRef.current);
      fire(stepRef.current);
    }, tickMs);

    return () => clearInterval(id);
  }, [isPlaying, eventsByStep, tickMs, loop]);

  return {
    isPlaying,
    currentStep,
    play: () => setIsPlaying(true),
    stop: () => setIsPlaying(false),
    toggle: () => setIsPlaying((p) => !p),
  };
}
