// Progression Composer — playback hook. Owns the tick clock (sixteenth
// resolution) and is the only piece that touches the synth. Re-arms the
// interval on tempo/content changes so live edits take effect on the
// next tick. The pure schedule comes from buildSchedule; this walks the
// tick cursor and fires the synth with each layer's own voice + sustain.

import { useEffect, useMemo, useRef, useState } from 'react';
import { synth } from '../audio/synth';
import type { Composition } from './types';
import { TOTAL_TICKS } from './types';
import { buildSchedule, msPerTick } from './playback';

export type CompositionPlayback = {
  isPlaying: boolean;
  /** Current tick cursor 0..TOTAL_TICKS-1, or null when stopped. */
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

  const eventsByStep = useMemo(() => {
    const map = new Map<number, ReturnType<typeof buildSchedule>[number]>();
    for (const e of buildSchedule(comp)) map.set(e.step, e);
    return map;
  }, [comp]);

  const tickMs = msPerTick(comp.bpm);
  const stepRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      setCurrentStep(null);
      return;
    }

    const fire = (step: number) => {
      const e = eventsByStep.get(step);
      if (!e) return;
      // Each layer sustains for its span length and uses its own voice.
      if (e.chord) synth.playChord(e.chord, tickMs * (e.chordTicks ?? 1) * 0.97, 'string');
      if (e.melody != null) synth.playNote(e.melody, tickMs * (e.melodyTicks ?? 1) * 0.95, 'piano');
      if (e.bass != null) synth.playNote(e.bass, tickMs * (e.bassTicks ?? 1) * 0.97, 'bass');
    };

    stepRef.current = 0;
    setCurrentStep(0);
    fire(0);

    const id = setInterval(() => {
      const next = stepRef.current + 1;
      if (next >= TOTAL_TICKS) {
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
