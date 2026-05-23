// YouTube player Module — owns the protocol, the ref, and the
// reactive playback signal. Consumers (TranscriptPane, NotesPane,
// VideoChat, TimecodeMarkdown, SectionTimecodeEditor) read via
// `usePlayerControl()` instead of receiving an `onSeek` prop or
// reaching into the iframe directly.
//
// Today's Implementation: `react-player` v3 (HTML5-video-semantics
// ref). The Interface is library-agnostic — switching to a different
// player backend (Vimeo, custom <video>, plain iframe) only changes
// this file.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactPlayer from 'react-player';

// -----------------------------------------------------------------------------
// Public Interface
// -----------------------------------------------------------------------------

export type PlayerControl = {
  // Seek the player to `seconds` and start playback if currently paused.
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  // Reactive — updates ~4x/second via the player's timeupdate event.
  // Subscribers re-render when this changes; that's the primary
  // signal for transcript auto-highlight + section follow.
  currentSeconds: number;
  // Reactive playing/paused state from the player.
  isPlaying: boolean;
  // True once the player is mounted in the DOM and the ref is live.
  // Lets callers (e.g. SectionTimecodeEditor's "use current time"
  // button) suppress UI that depends on a working player.
  isReady: boolean;

  // ---- A/B loop ------------------------------------------------------------
  // Marked region for play-along discovery. Null = unset on that side.
  loopStartSec: number | null;
  loopEndSec: number | null;
  // When true and both endpoints are set, the player auto-seeks back to
  // loopStartSec the moment currentSeconds crosses loopEndSec. The seek
  // happens off the same onTimeUpdate event that drives `currentSeconds`,
  // so the engine is reactive — no polling.
  loopActive: boolean;
  setLoopStart: (seconds: number | null) => void;
  setLoopEnd: (seconds: number | null) => void;
  toggleLoopActive: () => void;
  /** Clears A, B, and turns the loop off. */
  clearLoop: () => void;
};

const PlayerContext = createContext<PlayerControl | null>(null);

// Hook for any descendant of <PlayerProvider>. Throws if used outside
// the provider — surfaces wiring mistakes loudly during development.
export function usePlayerControl(): PlayerControl {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayerControl must be used inside <PlayerProvider>');
  }
  return ctx;
}

// -----------------------------------------------------------------------------
// Provider
// -----------------------------------------------------------------------------

// Internal handle the YouTubePlayer component uses to write back into
// the context. Not exported — only the player component in this file
// touches it.
type PlayerInternals = {
  refSetter: (el: HTMLVideoElement | null) => void;
  notifyTimeUpdate: (seconds: number) => void;
  notifyPlay: () => void;
  notifyPause: () => void;
};

const InternalsContext = createContext<PlayerInternals | null>(null);

function useInternals(): PlayerInternals {
  const ctx = useContext(InternalsContext);
  if (!ctx) {
    throw new Error('YouTubePlayer must be rendered inside <PlayerProvider>');
  }
  return ctx;
}

export function PlayerProvider({ children }: Readonly<{ children: ReactNode }>) {
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Loop state. Two-stage to allow either endpoint to be set without the
  // other (player UI can show "Set A" filled, "Set B" empty).
  const [loopStartSec, setLoopStartSec] = useState<number | null>(null);
  const [loopEndSec, setLoopEndSec] = useState<number | null>(null);
  const [loopActive, setLoopActive] = useState(false);
  // Suppresses re-firing the loop seek inside the same timeupdate burst.
  // Without it, the seek-then-onTimeUpdate cycle can briefly see
  // `currentSeconds >= loopEndSec` again before the player applies the
  // new currentTime, causing a thrash. 250ms is enough for the iframe
  // to acknowledge the seek; anything shorter than the natural loop
  // length is invisible to the user.
  const lastLoopSeekAtRef = useRef(0);

  const seekTo = useCallback((seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime = seconds;
    if (player.paused) {
      // The play() promise can reject (autoplay policy, no user
      // gesture, etc.). Swallow — seek + best-effort play matches
      // the previous postMessage behaviour.
      player.play().catch(() => {});
    }
  }, []);

  const play = useCallback(() => {
    playerRef.current?.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const refSetter = useCallback((el: HTMLVideoElement | null) => {
    playerRef.current = el;
    setIsReady(el !== null);
  }, []);

  const notifyTimeUpdate = useCallback((seconds: number) => {
    setCurrentSeconds(seconds);
  }, []);

  const notifyPlay = useCallback(() => setIsPlaying(true), []);
  const notifyPause = useCallback(() => setIsPlaying(false), []);

  // Loop engine. Reactive off currentSeconds — every player timeupdate (~4Hz)
  // we check whether we've crossed loopEndSec; if so, seek back to loopStartSec.
  // Deactivated automatically if either endpoint is null.
  useEffect(() => {
    if (!loopActive) return;
    if (loopStartSec == null || loopEndSec == null) return;
    if (loopEndSec <= loopStartSec) return;
    if (currentSeconds < loopEndSec) return;
    if (Date.now() - lastLoopSeekAtRef.current < 250) return;
    lastLoopSeekAtRef.current = Date.now();
    seekTo(loopStartSec);
  }, [loopActive, loopStartSec, loopEndSec, currentSeconds, seekTo]);

  const setLoopStart = useCallback((seconds: number | null) => {
    setLoopStartSec(seconds == null ? null : Math.max(0, Math.floor(seconds)));
  }, []);

  const setLoopEnd = useCallback((seconds: number | null) => {
    setLoopEndSec(seconds == null ? null : Math.max(0, Math.floor(seconds)));
  }, []);

  const toggleLoopActive = useCallback(() => {
    setLoopActive((prev) => !prev);
  }, []);

  const clearLoop = useCallback(() => {
    setLoopStartSec(null);
    setLoopEndSec(null);
    setLoopActive(false);
  }, []);

  const control = useMemo<PlayerControl>(
    () => ({
      seekTo,
      play,
      pause,
      currentSeconds,
      isPlaying,
      isReady,
      loopStartSec,
      loopEndSec,
      loopActive,
      setLoopStart,
      setLoopEnd,
      toggleLoopActive,
      clearLoop,
    }),
    [
      seekTo,
      play,
      pause,
      currentSeconds,
      isPlaying,
      isReady,
      loopStartSec,
      loopEndSec,
      loopActive,
      setLoopStart,
      setLoopEnd,
      toggleLoopActive,
      clearLoop,
    ],
  );

  const internals = useMemo<PlayerInternals>(
    () => ({ refSetter, notifyTimeUpdate, notifyPlay, notifyPause }),
    [refSetter, notifyTimeUpdate, notifyPlay, notifyPause],
  );

  return (
    <PlayerContext.Provider value={control}>
      <InternalsContext.Provider value={internals}>
        {children}
      </InternalsContext.Provider>
    </PlayerContext.Provider>
  );
}

// -----------------------------------------------------------------------------
// Player component
// -----------------------------------------------------------------------------

export type YouTubePlayerProps = {
  videoId: string;
  // Optional `?t=<sec>` deep-link offset. The player loads paused at
  // this position; clicking play (or the first seekTo from a chip)
  // starts playback.
  startSec?: number;
  // Visual frame styling — passed through to the player's wrapper.
  className?: string;
};

// Renders the actual player and wires HTML5 media events into the
// provider's reactive state. Must be a descendant of <PlayerProvider>.
export function YouTubePlayer({
  videoId,
  startSec,
  className,
}: Readonly<YouTubePlayerProps>) {
  const { refSetter, notifyTimeUpdate, notifyPlay, notifyPause } = useInternals();

  // Apply the start offset once on mount. react-player handles the
  // YouTube embed under the hood; we hand it an HTML5-video-shaped
  // ref and use `currentTime` for seeking — same semantics as the
  // reference media-player.tsx pattern.
  const onLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (typeof startSec === 'number' && startSec > 0) {
        e.currentTarget.currentTime = startSec;
      }
    },
    [startSec],
  );

  const onTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      notifyTimeUpdate(e.currentTarget.currentTime);
    },
    [notifyTimeUpdate],
  );

  return (
    <ReactPlayer
      ref={refSetter}
      src={`https://www.youtube.com/watch?v=${videoId}`}
      controls
      playsInline
      // `width="100%" height="100%"` is required for react-player v3 to
      // fill its wrapper. Without these the underlying YouTube embed
      // sizes itself to its intrinsic dimensions, leaving the wrapper
      // letterboxed (visible as a small video centered in a much larger
      // black box).
      width="100%"
      height="100%"
      className={className}
      onLoadedMetadata={onLoadedMetadata}
      onTimeUpdate={onTimeUpdate}
      onPlay={notifyPlay}
      onPause={notifyPause}
    />
  );
}

// -----------------------------------------------------------------------------
// Hook utility
// -----------------------------------------------------------------------------

// Returns the index of the row in `rows` whose timecode matches
// `currentSeconds` — the row's `startMs` <= currentSeconds*1000 and
// the next row's `startMs` > currentSeconds*1000. Returns -1 if no
// row applies (before the first row's start). Stable across renders;
// callers can call this directly inside the render path.
//
// Used by TranscriptPane for active-row highlighting; the binary
// search keeps it O(log n) for transcripts with thousands of rows.
export function findActiveRowIndex(
  rows: ReadonlyArray<{ startMs: number }>,
  currentSeconds: number,
): number {
  if (rows.length === 0) return -1;
  const targetMs = currentSeconds * 1000;
  if (targetMs < rows[0].startMs) return -1;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (rows[mid].startMs <= targetMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
