// Progression Composer — playback hook. Owns the tick clock (sixteenth
// resolution) and is the only piece that touches the synth. The pure
// schedule comes from buildSchedule; this walks the tick cursor and
// fires the synth with each layer's own voice + sustain.
//
// The schedule and tempo are read through refs so that editing the
// composition *while it plays* takes effect on the next tick WITHOUT
// re-arming the interval (which would snap the cursor back to tick 0).
// Only starting/stopping and the loop flag re-arm the clock.

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

  // Latest schedule + tempo, read live by the running interval so edits
  // (and tempo nudges) apply on the next tick without resetting position.
  const eventsRef = useRef(eventsByStep);
  eventsRef.current = eventsByStep;
  const tickMsRef = useRef(msPerTick(comp.bpm));
  tickMsRef.current = msPerTick(comp.bpm);

  const stepRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) {
      setCurrentStep(null);
      return;
    }

    const fire = (step: number) => {
      const e = eventsRef.current.get(step);
      if (!e) return;
      const tickMs = tickMsRef.current;
      // Each layer sustains for its span length and uses its own voice.
      if (e.chord) synth.playChord(e.chord, tickMs * (e.chordTicks ?? 1) * 0.97, 'string');
      if (e.melody != null) synth.playNote(e.melody, tickMs * (e.melodyTicks ?? 1) * 0.95, 'piano');
      if (e.bass != null) synth.playNote(e.bass, tickMs * (e.bassTicks ?? 1) * 0.97, 'bass');
    };

    stepRef.current = 0;
    setCurrentStep(0);
    fire(0);

    // Self-scheduling timeout (re-read tickMs each tick) so a live tempo
    // change takes effect without re-arming and losing the cursor.
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      const next = stepRef.current + 1;
      if (next >= TOTAL_TICKS) {
        if (!loop) {
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
      timer = setTimeout(advance, tickMsRef.current);
    };
    timer = setTimeout(advance, tickMsRef.current);

    return () => clearTimeout(timer);
  }, [isPlaying, loop]);

  return {
    isPlaying,
    currentStep,
    play: () => setIsPlaying(true),
    stop: () => setIsPlaying(false),
    toggle: () => setIsPlaying((p) => !p),
  };
}
