// YouTube player + reactive playback signal — frontend-only, no
// react-player dependency.
//
// Loads the YouTube IFrame API on demand (just the script tag — the API
// object is shared globally once it's loaded). The PlayerProvider owns
// the YT.Player instance via a ref; consumers read currentSeconds /
// isPlaying / loop region via usePlayerControl() and can call seekTo,
// play, pause, setLoopStart/End, toggleLoopActive.
//
// A/B loop engine: when loopActive is on and both endpoints are set,
// the polling loop checks `getCurrentTime()` ~4x/sec and seeks back to
// loopStartSec the moment it crosses loopEndSec. No polling when the
// loop is off — just plays through normally.

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

// ----- YT IFrame API loader (idempotent) -------------------------------------

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// Subset of the YT IFrame API we use. Avoids needing @types/youtube.
declare namespace YT {
  class Player {
    constructor(elt: HTMLElement | string, opts: PlayerOptions);
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    getCurrentTime(): number;
    getPlayerState(): number;
    destroy(): void;
  }
  type PlayerOptions = {
    videoId: string;
    height?: string | number;
    width?: string | number;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (e: { target: Player }) => void;
      onStateChange?: (e: { target: Player; data: number }) => void;
    };
  };
}

const YT_API_URL = 'https://www.youtube.com/iframe_api';
let apiReadyPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT?.Player) return Promise.resolve();
  if (apiReadyPromise) return apiReadyPromise;
  apiReadyPromise = new Promise<void>((resolve) => {
    // Chain onto any existing onYouTubeIframeAPIReady (other instances).
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        prev?.();
      } finally {
        resolve();
      }
    };
    // Inject the script tag if no one else has yet.
    if (!document.querySelector(`script[src="${YT_API_URL}"]`)) {
      const tag = document.createElement('script');
      tag.src = YT_API_URL;
      document.head.appendChild(tag);
    }
  });
  return apiReadyPromise;
}

// ----- Public Interface ------------------------------------------------------

export type PlayerControl = {
  seekTo: (seconds: number) => void;
  play: () => void;
  pause: () => void;
  currentSeconds: number;
  isPlaying: boolean;
  isReady: boolean;

  loopStartSec: number | null;
  loopEndSec: number | null;
  loopActive: boolean;
  setLoopStart: (seconds: number | null) => void;
  setLoopEnd: (seconds: number | null) => void;
  toggleLoopActive: () => void;
  clearLoop: () => void;
};

const PlayerContext = createContext<PlayerControl | null>(null);

export function usePlayerControl(): PlayerControl {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayerControl must be used inside <PlayerProvider>');
  return ctx;
}

// Internal channel from <YouTubePlayer> back into the provider so it
// can wire up the IFrame events.
type PlayerInternals = {
  registerPlayer: (player: YT.Player) => void;
};
const InternalsContext = createContext<PlayerInternals | null>(null);

function useInternals(): PlayerInternals {
  const ctx = useContext(InternalsContext);
  if (!ctx) throw new Error('YouTubePlayer must be rendered inside <PlayerProvider>');
  return ctx;
}

// ----- Provider --------------------------------------------------------------

export function PlayerProvider({ children }: Readonly<{ children: ReactNode }>) {
  const playerRef = useRef<YT.Player | null>(null);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);

  const [loopStartSec, setLoopStartState] = useState<number | null>(null);
  const [loopEndSec, setLoopEndState] = useState<number | null>(null);
  const [loopActive, setLoopActive] = useState(false);

  // Stable callbacks
  const seekTo = useCallback((s: number) => {
    playerRef.current?.seekTo(Math.max(0, s), true);
    playerRef.current?.playVideo();
  }, []);
  const play = useCallback(() => playerRef.current?.playVideo(), []);
  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);

  const setLoopStart = useCallback((s: number | null) => setLoopStartState(s), []);
  const setLoopEnd = useCallback((s: number | null) => setLoopEndState(s), []);
  const toggleLoopActive = useCallback(() => setLoopActive((v) => !v), []);
  const clearLoop = useCallback(() => {
    setLoopStartState(null);
    setLoopEndState(null);
    setLoopActive(false);
  }, []);

  // Polling: read currentTime ~4x/s while playing. Drives both
  // currentSeconds (reactive) and the loop wrap-around.
  useEffect(() => {
    if (!isReady) return;
    let raf: number | null = null;
    let lastTick = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastTick < 250) return;
      lastTick = now;
      const p = playerRef.current;
      if (!p) return;
      let t = 0;
      try {
        t = p.getCurrentTime();
      } catch {
        return;
      }
      // Loop wrap-around: when active + both endpoints set + we've
      // crossed loopEnd, seek back to loopStart in the same frame.
      if (
        loopActive &&
        loopStartSec != null &&
        loopEndSec != null &&
        loopEndSec > loopStartSec &&
        t >= loopEndSec
      ) {
        p.seekTo(loopStartSec, true);
        t = loopStartSec;
      }
      setCurrentSeconds(t);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [isReady, loopActive, loopStartSec, loopEndSec]);

  const registerPlayer = useCallback((player: YT.Player) => {
    playerRef.current = player;
    setIsReady(true);
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

  // The YouTubePlayer reports state-change events via this internals
  // channel; we update isPlaying so consumers can render a play/pause
  // indicator without needing their own listener.
  const internals = useMemo<PlayerInternals>(
    () => ({
      registerPlayer: (p) => {
        registerPlayer(p);
      },
    }),
    [registerPlayer],
  );

  // YT player state codes: -1 unstarted, 0 ended, 1 playing, 2 paused,
  // 3 buffering, 5 cued. We treat "playing" as exactly 1.
  const handleStateChange = useCallback((data: number) => {
    setIsPlaying(data === 1);
  }, []);

  // Expose handleStateChange to YouTubePlayer via a ref-like channel.
  // Simpler than adding to internals — only one consumer.
  (internals as PlayerInternals & { handleStateChange: (n: number) => void }).handleStateChange =
    handleStateChange;

  return (
    <PlayerContext.Provider value={control}>
      <InternalsContext.Provider value={internals}>
        {children}
      </InternalsContext.Provider>
    </PlayerContext.Provider>
  );
}

// ----- YouTubePlayer ---------------------------------------------------------

export function YouTubePlayer({
  videoId,
  className,
}: Readonly<{ videoId: string; className?: string }>) {
  const internals = useInternals();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YT.Player | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeAPI().then(() => {
      if (cancelled || !containerRef.current || !window.YT) return;
      // Clear any prior iframe (e.g., when videoId changes).
      containerRef.current.innerHTML = '';
      const player = new window.YT.Player(containerRef.current, {
        videoId,
        height: '100%',
        width: '100%',
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
        },
        events: {
          onReady: () => {
            playerRef.current = player;
            internals.registerPlayer(player);
          },
          onStateChange: (e) => {
            const handler = (internals as PlayerInternals & {
              handleStateChange?: (n: number) => void;
            }).handleStateChange;
            handler?.(e.data);
          },
        },
      });
    });
    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [videoId, internals]);

  return <div ref={containerRef} className={className} />;
}
