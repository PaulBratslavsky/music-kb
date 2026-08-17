// The instrument the play-along block is drawn for.
//
// Why this is one shared setting rather than a toggle per panel: the chord
// strip and the scale board under it are two views of the same moment. If
// each owned its own instrument they could disagree — piano chords over a
// guitar neck — and you'd have to set it twice on every video.
//
// Why localStorage rather than route state: the instrument is a property of
// the PLAYER, not of the video. A pianist should not re-pick piano on every
// track they open. It deliberately does not live in the builder's
// useAppState, which is page-scoped and carries game-mode state this has no
// business inheriting.

import { useCallback, useEffect, useState } from 'react';

export type PlayAlongInstrument = 'guitar' | 'piano' | 'bass';

const STORAGE_KEY = 'tv:playalong-instrument';
const VALID: PlayAlongInstrument[] = ['guitar', 'piano', 'bass'];

function isValid(v: unknown): v is PlayAlongInstrument {
  return typeof v === 'string' && (VALID as string[]).includes(v);
}

export function usePlayAlongInstrument(): [
  PlayAlongInstrument,
  (next: PlayAlongInstrument) => void,
] {
  // Always start on the SSR-safe default and adopt the stored value after
  // mount. Reading localStorage during the first render would make the
  // server and client trees disagree and trip hydration.
  const [instrument, setInstrument] = useState<PlayAlongInstrument>('guitar');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (isValid(stored)) setInstrument(stored);
    } catch {
      // Private mode / storage disabled — the default is fine.
    }
  }, []);

  const update = useCallback((next: PlayAlongInstrument) => {
    setInstrument(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal: the choice just won't survive a reload.
    }
  }, []);

  return [instrument, update];
}
