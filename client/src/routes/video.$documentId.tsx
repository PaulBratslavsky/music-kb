import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { BackendErrorPanel } from '#/components/BackendErrorPanel';
import { Button } from '#/components/ui/button';
import { VideoCard } from '#/components/VideoCard';
import { getVideoByDocumentId } from '#/data/server-functions/videos';
import { getLoop as getLoopServerFn } from '#/data/server-functions/loops';
import {
  PlayerProvider,
  YouTubePlayer,
  usePlayerControl,
} from '#/components/player';
import { LoopControls } from '#/components/LoopControls';
import { LoopBuilderProvider } from '#/components/LoopBuilderProvider';
import { SavedLoopsList } from '#/components/SavedLoopsList';
import { SaveLoopButton } from '#/components/SaveLoopButton';
import { CircleOfFifths } from '#/components/CircleOfFifths';
import { SongContent } from '#/components/SongContent';
import { ViewTabs } from '#/components/ViewTabs';
import TheoryCompanion from '#/lib/music/TheoryCompanion';
import { PianoView } from '#/lib/music/instruments/piano/PianoView';
import { synth } from '#/lib/music/audio/synth';
import { midiFromNote, midiFromPitchOctave } from '#/lib/music/theory/notes';
import { PITCH_CLASSES, type PitchClass } from '#/lib/music/types';
import type { StrapiVideo } from '#/lib/services/videos';

const VideoSearchSchema = z.object({
  /** Optional documentId of a saved Loop to hydrate into the player on
   *  load — set/seekTo the A/B times + activate looping. */
  loopId: z.string().optional(),
});

export const Route = createFileRoute('/video/$documentId')({
  validateSearch: VideoSearchSchema,
  loader: async ({ params }) => {
    const lookup = await getVideoByDocumentId({
      data: { documentId: params.documentId },
    });
    return lookup;
  },
  component: VideoPage,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.video?.videoTitle
          ? `${loaderData.video.videoTitle} · Music KB`
          : 'Video · Music KB',
      },
    ],
  }),
});

function VideoPage() {
  const { video, error } = Route.useLoaderData();
  if (error) {
    return (
      <main className="page-wrap flex min-h-[60vh] items-center justify-center px-4 py-14">
        <BackendErrorPanel message={error} />
      </main>
    );
  }
  if (!video) return <NotFound />;

  // Music videos get the loop-practice layout (big player + A/B loop
  // controls + saved-loops list). Lesson videos fall back to the simple
  // VideoCard view that links to /learn for the full transcript flow.
  if (video.videoType === 'music') {
    return <MusicVideoPage video={video} />;
  }

  return (
    <main className="page-wrap px-4 pb-20 pt-10 sm:pt-14">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6">
          <Link to="/feed" className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]">
            ← Back to feed
          </Link>
        </div>
        <VideoCard video={video} />
      </div>
    </main>
  );
}

// Right-column tabs — compact tools the user wants next to the player
// while practicing. Default = loops (the most-used surface).
type SideTab = 'loops' | 'wheel';
const SIDE_TABS: Array<{ id: SideTab; label: string }> = [
  { id: 'loops', label: 'Loops' },
  { id: 'wheel', label: 'Wheel' },
];

// Bottom-section tabs — wider reference content that needs more room
// than the right column gives. Default = piano (the most-used "I want
// to play along" surface).
type BottomTab = 'piano' | 'visualizer' | 'song';
const BOTTOM_TABS: Array<{ id: BottomTab; label: string }> = [
  { id: 'piano', label: 'Piano' },
  { id: 'visualizer', label: 'Visualizer' },
  { id: 'song', label: 'Tab & lyrics' },
];

function MusicVideoPage({ video }: { video: StrapiVideo }) {
  // Bumped after a save so SavedLoopsList refetches.
  const [loopsRefreshKey, setLoopsRefreshKey] = useState(0);
  const [sideTab, setSideTab] = useState<SideTab>('loops');
  const [bottomTab, setBottomTab] = useState<BottomTab>('piano');
  const search = Route.useSearch();

  return (
    <PlayerProvider>
      <LoopBuilderProvider>
        <LoopHydrator loopId={search.loopId} />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-8 sm:py-10">
          <header className="mb-6 flex items-start justify-between gap-4">
            <div>
              <Link
                to="/music"
                className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                ← Back to music
              </Link>
              <h1 className="display-title mt-2 text-2xl text-[var(--ink)] sm:text-3xl">
                {video.videoTitle ?? 'Untitled track'}
              </h1>
              {video.videoAuthor && (
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {video.videoAuthor}
                </p>
              )}
            </div>
            <Link
              to="/theory"
              search={{ tab: 'visualizer' }}
              className="hidden shrink-0 items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white sm:inline-flex"
            >
              Open visualizer →
            </Link>
          </header>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(320px,400px)]">
            {/* Left column — player + loop controls */}
            <section className="flex flex-col gap-4">
              <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-black">
                <div className="relative aspect-video w-full">
                  <YouTubePlayer
                    videoId={video.youtubeVideoId}
                    className="absolute inset-0 h-full w-full"
                  />
                </div>
                <LoopControls />
              </div>
              {video.caption && (
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 text-sm text-[var(--ink-soft)]">
                  {video.caption}
                </div>
              )}
            </section>

            {/* Right column — Loops / Wheel toggle. Compact tools that
                live next to the player while the user is practicing. */}
            <aside className="flex flex-col rounded-2xl border border-[var(--line)] bg-[var(--card)]">
              <header className="border-b border-[var(--line)] px-4 py-3">
                <ViewTabs<SideTab>
                  active={sideTab}
                  tabs={SIDE_TABS}
                  onChange={setSideTab}
                />
              </header>
              {sideTab === 'loops' ? (
                <>
                  <div className="px-5 py-3">
                    <SaveLoopButton
                      videoDocumentId={video.documentId}
                      onSaved={() => setLoopsRefreshKey((k) => k + 1)}
                    />
                  </div>
                  <SavedLoopsList
                    videoDocumentId={video.documentId}
                    refreshKey={loopsRefreshKey}
                    target="video"
                  />
                </>
              ) : (
                <div className="px-4 py-4">
                  <p className="mb-3 text-xs text-[var(--ink-muted)]">
                    Click a wedge until the highlighted chords match what
                    you hear in the loop. Outer ring = major; inner ring =
                    minor. Sound is on by default.
                  </p>
                  <div className="flex justify-center">
                    <div className="max-w-full">
                      <CircleOfFifths compact />
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>

          {/* Bottom section — wider reference content that doesn't fit
              comfortably in the right column. Visualizer (piano + guitar
              + bass + Push) needs the full width; tab & lyrics is paged
              text that benefits from generous reading width too. */}
          <section className="mt-8">
            <div className="mb-4">
              <ViewTabs<BottomTab>
                active={bottomTab}
                tabs={BOTTOM_TABS}
                onChange={setBottomTab}
              />
            </div>
            {bottomTab === 'piano' && <PracticePiano />}
            {bottomTab === 'visualizer' && (
              <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
                <TheoryCompanion compact />
              </div>
            )}
            {bottomTab === 'song' && (
              <SongContent
                documentId={video.documentId}
                initialTab={video.tabContent}
                initialLyrics={video.lyricsContent}
                initialSourceUrl={video.tabSourceUrl}
              />
            )}
          </section>
        </main>
      </LoopBuilderProvider>
    </PlayerProvider>
  );
}

function NotFound() {
  return (
    <main className="page-wrap flex min-h-[60vh] items-center justify-center px-4 py-14">
      <div className="rise-in mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-[var(--card)] p-10 text-center">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
          Not found
        </p>
        <h1 className="display-title mt-2 text-3xl text-[var(--ink)]">
          That video isn't here.
        </h1>
        <Button asChild size="pill" className="mt-6">
          <Link to="/feed">Back to feed</Link>
        </Button>
      </div>
    </main>
  );
}

/** Reads the `?loopId=` search param and hydrates the player on mount
 *  — fetches the saved Loop, sets the A/B markers, seeks to start, and
 *  activates looping. Lives as a child of PlayerProvider so it has
 *  access to usePlayerControl. Effect is keyed on loopId; revisiting
 *  the same URL doesn't refire (the saved-loops list passes new IDs
 *  by navigating to a new URL). */
function LoopHydrator({ loopId }: { loopId?: string }) {
  const { setLoopStart, setLoopEnd, seekTo, toggleLoopActive, loopActive } =
    usePlayerControl();
  useEffect(() => {
    if (!loopId) return;
    let cancelled = false;
    void getLoopServerFn({ data: { documentId: loopId } }).then((raw) => {
      if (cancelled) return;
      // Server-fn return type widens to unknown; narrow back to what we need.
      const res = raw as { status: 'ok' | 'error'; loop?: { startSec: number; endSec: number } | null };
      if (res.status === 'error' || !res.loop) return;
      const loop = res.loop;
      setLoopStart(loop.startSec);
      setLoopEnd(loop.endSec);
      seekTo(loop.startSec);
      if (!loopActive) toggleLoopActive();
    });
    return () => {
      cancelled = true;
    };
    // Intentionally only re-run when loopId changes — re-running on
    // loopActive flip would loop us back on after the user paused it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopId]);
  return null;
}

/** Standalone one-octave click-to-play piano. Lets the user audition
 *  notes while the video loops — no SelectionBar / chord-mode chrome,
 *  just a keyboard. Clicked notes also highlight (focus ring) so the
 *  user can track what they last played by ear. */
function PracticePiano() {
  const [focused, setFocused] = useState<PitchClass | null>(null);
  const [octave, setOctave] = useState(4);

  // Build a one-octave Note[] for the highlighted prop — empty here
  // (PianoView lights nothing by default); we just need the keyboard
  // rendered and clickable. PianoView's onPickPitchClass + onPlayNote
  // do the work.
  const handlePlay = (midi: number) => synth.playNote(midi);
  const handlePick = (pc: PitchClass) =>
    setFocused((prev) => (prev === pc ? null : pc));

  // Quick "play scale up" affordance — fires the 7 natural notes
  // ascending from C in the current octave. Useful as an audible
  // reference point against the song.
  const playScale = () => {
    const pcs: PitchClass[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    pcs.forEach((pc, i) => {
      setTimeout(() => synth.playNote(midiFromPitchOctave(pc, octave)), i * 220);
    });
  };

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Play along
        </span>
        <div
          className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] p-0.5 text-xs"
          role="radiogroup"
          aria-label="Octave"
        >
          {[3, 4, 5].map((o) => (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={octave === o}
              onClick={() => setOctave(o)}
              className={`rounded-full px-3 py-1 font-medium transition ${
                octave === o
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-soft)] hover:bg-[var(--card)] hover:text-[var(--ink)]'
              }`}
            >
              C{o}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={playScale}
          className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-soft)] hover:border-[var(--accent)] hover:text-[var(--ink)]"
          title="Play the C major scale ascending in the current octave"
        >
          ▶ Scale
        </button>
        {focused && (
          <span className="ml-auto text-xs text-[var(--ink-muted)]">
            Last: <strong className="text-[var(--ink)]">{focused}</strong>
          </span>
        )}
      </div>
      {/* The CSS variables (--white-key, --black-key, etc.) that
          PianoView reads are scoped to `.theory-companion` in
          theory-companion.css. Wrap so the keys render their proper
          colors when used outside TheoryCompanion. */}
      <div className="theory-companion">
        <PianoView
          highlighted={focused ? PITCH_CLASSES.map((pc) => ({ pitchClass: pc, octave })).filter((n) => n.pitchClass === focused) : []}
          rootPitchClass={null}
          matchByPitchClass={true}
          focusedPitchClass={focused}
          onPickPitchClass={handlePick}
          onPlayNote={handlePlay}
        />
      </div>
      <p className="mt-3 text-xs text-[var(--ink-muted)]">
        Click any key to play it. Switch octaves with C3 / C4 / C5. Use
        this to audition notes against the looped section above —
        especially handy when you're trying to find the root by ear.
      </p>
    </div>
  );
}
// Make sure midiFromNote is reachable for the click handler typing — re-export
// noop so the import isn't tree-shaken when unused.
void midiFromNote;
