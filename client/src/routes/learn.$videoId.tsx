import { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { BackendErrorPanel } from '#/components/BackendErrorPanel';
import { Button } from '#/components/ui/button';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';
import {
  TimecodeMarkdown,
  stripInlineTimecodes,
} from '#/components/TimecodeMarkdown';
import { z } from 'zod';
import { SectionTimecodeEditor } from '#/components/SectionTimecodeEditor';
import { VideoChat } from '#/components/VideoChat';
import { ViewTabs } from '#/components/ViewTabs';
import { ReadablePane } from '#/components/ReadablePane';
import { NotesPane } from '#/components/NotesPane';
import { TranscriptPane } from '#/components/TranscriptPane';
import TheoryCompanion from '#/lib/music/TheoryCompanion';
import { parseTheoryParam } from '#/lib/music/deep-link';
import { PlayerProvider, YouTubePlayer } from '#/components/player';
import { LoopControls } from '#/components/LoopControls';
import {
  LoopBuilderProvider,
  useLoopBuilder,
} from '#/components/LoopBuilderProvider';
import { LoopBuilder } from '#/components/LoopBuilder';
import { SavedLoopsList } from '#/components/SavedLoopsList';
import { usePlayerControl } from '#/components/player';
import type { AppState } from '#/lib/music/types';
import type { KeySig } from '#/lib/services/loops';
import {
  saveLoop as saveLoopServerFn,
  getLoop as getLoopServerFn,
} from '#/data/server-functions/loops';
import { RelatedVideos } from '#/components/RelatedVideos';
import { GenerationModeSelect } from '#/components/GenerationModeSelect';
import {
  clearSummaryFailure,
  getGenerationProgress,
  getVideoByVideoId,
  regenerateSummary,
  regenerateVideoEmbedding,
  regenerateVideoVerdict,
  triggerSummaryGeneration,
  type GenerationProgress,
} from '#/data/server-functions/videos';
import type { VideoEmbeddingStatus } from '#/lib/services/embeddings';
import type { StrapiVideo, WatchVerdict } from '#/lib/services/videos';
import type { GenerationMode } from '#/lib/validations/post';

const VERDICT_LABEL: Record<WatchVerdict, string> = {
  worth_it: 'Worth watching',
  skim: 'Skim it',
  skip: 'Skip',
};

const VERDICT_BADGE: Record<WatchVerdict, string> = {
  worth_it:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  skim: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  skip: 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]',
};

const VERDICT_PANEL: Record<WatchVerdict, string> = {
  worth_it: 'border-emerald-500/20 bg-emerald-500/5',
  skim: 'border-amber-500/20 bg-amber-500/5',
  skip: 'border-[var(--line)] bg-[var(--card)]',
};

// The learn page loads by videoId (the YouTube id in the URL). There are
// four possible states:
//   1. Video row doesn't exist yet → user hasn't shared this video. Prompt
//      to share.
//   2. Row exists, summaryStatus === 'generated' → render everything.
//   3. Row exists, summaryStatus === 'pending' → show the pending UI and
//      poll every 3s. Auto-trigger a fallback generation if it's been
//      pending too long (handled by triggerSummaryGeneration's dedupe).
//   4. Row exists, summaryStatus === 'failed' → show the error state with
//      retry.
type LoaderData =
  | { status: 'ready'; video: StrapiVideo }
  | { status: 'pending'; video: StrapiVideo; progress: GenerationProgress }
  | { status: 'failed'; video: StrapiVideo; error?: string }
  | { status: 'unshared' }
  // Distinct from `unshared`: row lookup itself failed because Strapi
  // is unreachable. Without this, a dead backend looked identical to
  // "you haven't shared this video yet" — confusing the user.
  | { status: 'backend-error'; error: string };

// View the left pane is showing.
//   `summary` = structured summary (sections, takeaways, verdict).
//   `read`    = long-form article version.
//   `notes`   = saved notes for this video (chat summaries, MCP entries, manual).
// `t` = optional start-at-second deep link. Populated by moment-search
// results and the future "jump to this moment" chips. Baked into the
// iframe `start` param so YouTube seeks + autoplays without us needing
// to wait for the player's postMessage channel to come up.
const LearnSearchSchema = z.object({
  view: z.enum(['summary', 'read', 'notes', 'theory', 'transcript']).optional(),
  t: z.number().int().min(0).max(86400).optional(),
  // Deep-link shorthand for the Theory tab: chord:C:maj:0:0 / scale:C:major /
  // note:C. Parsed by parseTheoryParam; invalid input falls back to defaults
  // silently rather than 404-ing. Length-capped to keep this from being abused
  // as an arbitrary query buffer.
  theory: z.string().max(64).optional(),
  // Documents the saved Loop being reopened. When present, the page
  // fetches the row and hydrates: player loop region, LoopBuilder draft,
  // and TheoryCompanion initialState. Bookmarkable.
  loopId: z.string().max(64).optional(),
});

export const Route = createFileRoute('/learn/$videoId')({
  validateSearch: LearnSearchSchema,
  loader: async ({ params }): Promise<LoaderData> => {
    const lookup = await getVideoByVideoId({ data: { videoId: params.videoId } });
    if (lookup.error) return { status: 'backend-error', error: lookup.error };
    const video = lookup.video;
    if (!video) return { status: 'unshared' };
    if (video.summaryStatus === 'generated') return { status: 'ready', video };
    if (video.summaryStatus === 'failed') return { status: 'failed', video };

    // Still pending — nudge the background job (no-op if already running).
    // If the trigger reports a recent in-memory failure, the DB row is stale
    // (bg job threw before it could mark the row failed). Surface the error
    // so the UI doesn't poll forever.
    const trigger = await triggerSummaryGeneration({ data: { videoId: params.videoId } });
    if (trigger.status === 'error') {
      return { status: 'failed', video, error: trigger.error };
    }
    const progress = await getGenerationProgress({ data: { videoId: params.videoId } });
    return { status: 'pending', video, progress };
  },
  component: LearnPage,
  head: ({ loaderData }) => {
    if (loaderData?.status === 'ready') {
      const v = loaderData.video;
      return {
        meta: [
          { title: `${v.summaryTitle ?? v.videoTitle ?? 'Summary'} · Music KB` },
          ...(v.summaryDescription
            ? [{ name: 'description', content: v.summaryDescription }]
            : []),
        ],
      };
    }
    return { meta: [{ title: 'Summary · Music KB' }] };
  },
});

// Poll the loader while generation is pending. Long videos doing
// map-reduce summaries can run 5–10 min, so the cap has to exceed that or
// the UI freezes mid-run as polling dies. Also invalidates when the tab
// regains focus — tabbing back triggers an immediate refresh instead of
// waiting for the next interval tick.
function usePollingInvalidation(active: boolean) {
  const router = useRouter();
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!active) {
      attemptsRef.current = 0;
      return;
    }

    // 200 attempts × 3s = 10 min. Beyond that something is genuinely
    // wrong and the user should use "Force retry" rather than wait.
    const MAX_ATTEMPTS = 200;

    const id = window.setInterval(() => {
      attemptsRef.current += 1;
      if (attemptsRef.current > MAX_ATTEMPTS) {
        window.clearInterval(id);
        return;
      }
      void router.invalidate();
    }, 3000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void router.invalidate();
      }
    };
    const onFocus = () => {
      void router.invalidate();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [active, router]);
}

function LearnPage() {
  const data = Route.useLoaderData();
  const { videoId } = Route.useParams();

  usePollingInvalidation(data.status === 'pending');

  if (data.status === 'backend-error') {
    return (
      <main className="flex min-h-[60vh] items-center justify-center px-6 py-14 sm:px-10">
        <BackendErrorPanel message={data.error} />
      </main>
    );
  }
  if (data.status === 'unshared') return <UnsharedState videoId={videoId} />;
  if (data.status === 'pending')
    return <PendingState videoId={videoId} progress={data.progress} />;
  if (data.status === 'failed') return <FailedState video={data.video} error={data.error} />;
  return <SummaryView video={data.video} videoId={videoId} />;
}

function SummaryView({
  video,
  videoId,
}: Readonly<{ video: StrapiVideo; videoId: string }>) {
  // Both providers wrap the same subtree — PlayerProvider owns the iframe
  // ref + loop region, LoopBuilderProvider owns the in-flight musical
  // discovery (candidate key + ordered progression). The Theory tab's
  // LoopBuilder reads from the latter; "Set A / Set B" reads from the
  // former. The actual layout lives in <LearnLayout> so it can use both
  // hooks without nesting provider→consumer awkwardly in this component.
  return (
    <PlayerProvider>
      <LoopBuilderProvider>
        <LearnLayout video={video} videoId={videoId} />
      </LoopBuilderProvider>
    </PlayerProvider>
  );
}

function LearnLayout({
  video,
  videoId,
}: Readonly<{ video: StrapiVideo; videoId: string }>) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.view ?? 'summary';
  const setView = (next: 'summary' | 'read' | 'notes' | 'theory' | 'transcript') => {
    // Preserve `t` across view changes — stripping it would mutate the
    // player's start offset and force a reload. User changes tabs after
    // landing at a moment; the video should keep playing uninterrupted.
    // Drop `theory` when leaving the Theory tab; it's specific to that view
    // and lingering would clutter the URL on Summary/Notes/Transcript.
    void navigate({
      search: {
        view: next === 'summary' ? undefined : next,
        t: search.t,
        theory: next === 'theory' ? search.theory : undefined,
        loopId: next === 'theory' ? search.loopId : undefined,
      },
    });
  };
  // Bumped when VideoChat saves a note, so NotesPane refetches without
  // needing its own event wiring or a page reload.
  const [notesRefreshKey, setNotesRefreshKey] = useState(0);
  // Bumped when a loop saves, so SavedLoopsList refetches.
  const [loopsRefreshKey, setLoopsRefreshKey] = useState(0);

  // LoopBuilder integration ------------------------------------------------
  const {
    recordMode,
    appendChord,
    setCandidateKey,
    candidateKey,
    progression,
    hydrateFromSaved,
  } = useLoopBuilder();
  const {
    loopStartSec,
    loopEndSec,
    setLoopStart,
    setLoopEnd,
    toggleLoopActive,
    loopActive,
    seekTo,
  } = usePlayerControl();
  // Local mirror of the visualizer's focused pitch class — drives the
  // LoopBuilder's "Use as <PC> major / minor" buttons.
  const [lastFocusedPC, setLastFocusedPC] = useState<string | null>(null);
  // When the user picks a key via "Use as X" we remount TheoryCompanion
  // with a new initialState so the visualizer flips into scale mode at
  // the chosen root. The `key` on the component remounts it; the nonce
  // is monotonically bumped so identical consecutive picks still remount.
  const [theoryNonce, setTheoryNonce] = useState(0);
  const [theoryOverrideState, setTheoryOverrideState] =
    useState<AppState | null>(null);

  const handleUseAsKey = (key: KeySig) => {
    setCandidateKey(key);
    setTheoryOverrideState({
      mode: 'scale',
      chord: { root: 'C', quality: 'maj', inversion: 0, voicingIndex: 0 },
      scale: { root: key.root as any, type: key.type as any },
      singleNote: 'C',
      scalePosition: 'all',
      preferFlats: false,
    });
    setTheoryNonce((n) => n + 1);
  };

  // When the user changes the visualizer scale via SelectionBar (instead of
  // through the "Use as X" two-button flow), mirror that into the
  // LoopBuilder's candidateKey. Same outcome as clicking "Use as X" without
  // the explicit commitment step — feels natural once a key is being
  // explored. The callback is wrapped in useCallback so TheoryCompanion's
  // effect doesn't refire on every parent render.
  const handleScaleChange = useCallback(
    (scale: { root: string; type: string } | null) => {
      if (!scale) return; // don't clear when user leaves scale mode
      // Skip if it already matches — prevents an idempotent setState→render
      // loop driven by new object references.
      if (
        candidateKey &&
        candidateKey.root === scale.root &&
        candidateKey.type === scale.type
      ) {
        return;
      }
      setCandidateKey({ root: scale.root, type: scale.type });
    },
    [candidateKey, setCandidateKey],
  );

  // Compose the TheoryCompanion's initial state: override > URL deep-link > default.
  const theoryInitialState =
    theoryOverrideState ?? parseTheoryParam(search.theory) ?? undefined;

  // ---- Save flow --------------------------------------------------------
  // Compute a human-readable reason why the Save button might be disabled.
  // Falls through to null when ready to save.
  const saveBlockedReason = (() => {
    const effectiveStart = loopStartSec ?? 0;
    const effectiveEnd = loopEndSec;
    if (effectiveEnd == null || effectiveEnd <= effectiveStart) {
      return 'Set an A/B loop on the player first';
    }
    if (!candidateKey) return 'Pick a key first';
    if (progression.length === 0) return 'Add at least one chord to the progression';
    return null;
  })();

  const handleSaveLoop = async (payload: {
    label: string;
    bpm: number | null;
    notes: string | null;
  }) => {
    const effectiveStart = loopStartSec ?? 0;
    if (loopEndSec == null) return { ok: false, error: 'Loop end not set' };
    const res = await saveLoopServerFn({
      data: {
        videoDocumentId: video.documentId,
        label: payload.label,
        startSec: effectiveStart,
        endSec: loopEndSec,
        key: candidateKey,
        progression,
        bpm: payload.bpm,
        notes: payload.notes,
      },
    });
    if (res.status === 'error') {
      return { ok: false as const, error: res.error };
    }
    setLoopsRefreshKey((k) => k + 1);
    return { ok: true as const };
  };

  // ---- Reload flow (?loopId=) -------------------------------------------
  // When the URL carries a loopId, fetch the saved Loop and hydrate:
  //   • player: loopStart/End, seek to start, activate
  //   • LoopBuilder: key + progression
  //   • TheoryCompanion: scale mode at the saved root
  // Effect keyed on loopId so revisiting the same URL doesn't refire.
  const loopId = search.loopId;
  useEffect(() => {
    if (!loopId) return;
    let cancelled = false;
    void getLoopServerFn({ data: { documentId: loopId } }).then((res) => {
      if (cancelled) return;
      if (res.status === 'error' || !res.loop) return;
      const loop = res.loop;
      setLoopStart(loop.startSec);
      setLoopEnd(loop.endSec);
      seekTo(loop.startSec);
      if (!loopActive) toggleLoopActive();
      hydrateFromSaved({
        candidateKey: loop.key,
        progression: Array.isArray(loop.progression) ? loop.progression : [],
      });
      if (loop.key) {
        setTheoryOverrideState({
          mode: 'scale',
          chord: { root: 'C', quality: 'maj', inversion: 0, voicingIndex: 0 },
          scale: { root: loop.key.root as any, type: loop.key.type as any },
          singleNote: 'C',
          scalePosition: 'all',
          preferFlats: false,
        });
        setTheoryNonce((n) => n + 1);
      }
    });
    return () => {
      cancelled = true;
    };
    // Intentionally only depends on loopId — the player/loopBuilder
    // setters are stable references from their providers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopId]);

  return (
      <main className="min-h-[calc(100dvh-4rem)] lg:fixed lg:inset-x-0 lg:bottom-0 lg:top-16 lg:min-h-0 lg:overflow-hidden">
        <div className="grid min-h-[calc(100dvh-4rem)] lg:h-full lg:min-h-0 lg:grid-cols-[6fr_4fr]">
          <div className="min-w-0 bg-[var(--bg-subtle)] px-6 py-10 sm:px-10 sm:py-14 lg:overflow-y-auto lg:overscroll-contain lg:px-14">
            <div className="mb-6">
              <ViewTabs
                active={view}
                tabs={[
                  { id: 'summary', label: 'Summary' },
                  { id: 'read', label: 'Read' },
                  { id: 'notes', label: 'Notes' },
                  { id: 'theory', label: 'Theory' },
                  { id: 'transcript', label: 'Transcript' },
                ]}
                onChange={setView}
              />
            </div>

            {view === 'read' ? (
              <ReadablePane video={video} />
            ) : view === 'notes' ? (
              <NotesPane
                videoDocumentId={video.documentId}
                videoYoutubeId={video.youtubeVideoId}
                refreshKey={notesRefreshKey}
              />
            ) : view === 'theory' ? (
              <>
                <LoopBuilder
                  lastFocusedPC={lastFocusedPC}
                  onUseAsKey={handleUseAsKey}
                  onSave={handleSaveLoop}
                  saveBlockedReason={saveBlockedReason}
                />
                <TheoryCompanion
                  key={theoryNonce}
                  initialState={theoryInitialState}
                  onFocusedPitchClassChange={(pc) =>
                    setLastFocusedPC(pc as string | null)
                  }
                  onDiatonicChordClick={(chord) => {
                    if (recordMode) appendChord(chord);
                  }}
                  onScaleChange={handleScaleChange}
                />
              </>
            ) : view === 'transcript' ? (
              <TranscriptPane video={video} />
            ) : (
              <SummaryContent video={video} />
            )}
          </div>

          {/* Right column — video pinned at top, chat scrolls internally
              below it. The aside fills the grid cell (no `sticky` needed
              since the page itself is height-locked on lg+). */}
          <aside className="flex min-h-0 min-w-0 flex-col bg-[var(--card)] lg:overscroll-contain lg:border-l lg:border-[var(--line)]">
            <div className="bg-black">
              <div className="relative aspect-video w-full">
                <YouTubePlayer
                  videoId={videoId}
                  startSec={search.t}
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            </div>
            <LoopControls />
            <SavedLoopsList
              videoDocumentId={video.documentId}
              refreshKey={loopsRefreshKey}
            />
            <VideoChat
              videoId={videoId}
              onNoteCreated={() => setNotesRefreshKey((k) => k + 1)}
              className="min-h-[360px] flex-1 px-6 py-6 sm:px-8"
            />
          </aside>
        </div>
      </main>
  );
}

const STEPS: Array<{
  key: 'transcript' | 'ai' | 'saving';
  label: string;
  detail: string;
}> = [
  {
    key: 'transcript',
    label: 'Fetch transcript',
    detail: 'Pulling captions from the transcript service.',
  },
  {
    key: 'ai',
    label: 'Run local model',
    detail: 'Your Ollama model is reading the transcript and writing structured notes.',
  },
  {
    key: 'saving',
    label: 'Save to library',
    detail: 'Persisting the summary, sections, takeaways, and action steps.',
  },
];

function formatElapsed(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

// The structured-notes view of a video: title/description, verdict block,
// overview, takeaways, walkthrough sections (with timecode chips), action
// steps, and the generation-mode footer with regenerate. Rendered as the
// `summary` tab in the learn page's left pane.
function SummaryContent({
  video,
}: Readonly<{ video: StrapiVideo }>) {
  return (
    <>
      <header className="mb-10">
        <h1 className="display-title text-3xl leading-[1.1] text-[var(--ink)] sm:text-5xl">
          {video.summaryTitle ?? video.videoTitle ?? 'Video summary'}
        </h1>
        {video.summaryDescription && (
          <p className="mt-4 text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
            {video.summaryDescription}
          </p>
        )}
        {(video.videoTitle ?? video.videoAuthor) && (
          <p className="mt-3 text-xs leading-relaxed text-[var(--ink-muted)]">
            Based on{' '}
            {video.videoTitle && (
              <span className="font-medium text-[var(--ink)]">{video.videoTitle}</span>
            )}
            {video.videoAuthor && (
              <>
                {video.videoTitle ? ' by ' : ''}
                <span className="font-medium text-[var(--ink)]">{video.videoAuthor}</span>
              </>
            )}
          </p>
        )}
      </header>
      {video.watchVerdict && video.verdictSummary && (
        <VerdictBlock video={video} />
      )}
      {video.summaryOverview && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Overview
          </h2>
          <TimecodeMarkdown
            className="chat-md mt-4 text-base leading-relaxed text-[var(--ink-soft)]"
          >
            {video.summaryOverview}
          </TimecodeMarkdown>
        </section>
      )}
      {video.keyTakeaways && video.keyTakeaways.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Key takeaways
          </h2>
          <ul className="mt-4 grid gap-2.5">
            {video.keyTakeaways.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 py-3 text-sm leading-relaxed text-[var(--ink-soft)]"
              >
                <span className="mt-[0.4rem] h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent)]" />
                <TimecodeMarkdown className="chat-md min-w-0 flex-1">
                  {t.text}
                </TimecodeMarkdown>
              </li>
            ))}
          </ul>
        </section>
      )}
      {video.sections && video.sections.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Walkthrough
          </h2>
          <div className="mt-4 grid gap-3">
            {[...video.sections]
              .sort((a, b) => {
                const aT = typeof a.timeSec === 'number' ? a.timeSec : Number.MAX_SAFE_INTEGER;
                const bT = typeof b.timeSec === 'number' ? b.timeSec : Number.MAX_SAFE_INTEGER;
                return aT - bT;
              })
              .map((s) => {
                const hasTime = typeof s.timeSec === 'number';
                return (
                  <article
                    key={s.id}
                    className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 sm:p-6"
                  >
                    <header className="flex items-start justify-between gap-3">
                      <h3 className="flex-1 text-base font-semibold leading-snug text-[var(--ink)]">
                        {s.heading}
                      </h3>
                      {hasTime && (
                        <SectionTimecodeEditor
                          documentId={video.documentId}
                          sectionId={s.id}
                          timeSec={s.timeSec as number}
                        />
                      )}
                    </header>
                    <TimecodeMarkdown className="chat-md mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
                      {stripInlineTimecodes(s.body)}
                    </TimecodeMarkdown>
                  </article>
                );
              })}
          </div>
        </section>
      )}
      {video.actionSteps && video.actionSteps.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Your plan
          </h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Concrete things to try this week, based on the video.
          </p>
          <ol className="mt-5 grid gap-3">
            {video.actionSteps.map((step, i) => (
              <li
                key={step.id}
                className="flex gap-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 sm:p-6"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[var(--ink)] text-sm font-bold text-[var(--cream)]">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold leading-snug text-[var(--ink)]">
                    {step.title}
                  </h3>
                  <TimecodeMarkdown className="chat-md mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
                    {step.body}
                  </TimecodeMarkdown>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      <footer className="mt-12 border-t border-[var(--line)] pt-5 text-xs text-[var(--ink-muted)]">
        <h3 className="mb-3 text-sm font-medium text-[var(--ink)]">
          Generation mode
        </h3>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl">
            Auto-generated{video.aiModel ? ` by ${video.aiModel}` : ''}. Summaries are AI-
            produced and may miss nuance — treat them as reading notes, not a replacement
            for the video itself.
          </p>
          <RegenerateButton videoId={video.youtubeVideoId} />
        </div>
        <EmbeddingPanel video={video} />
      </footer>
      <RelatedVideos videoId={video.youtubeVideoId} />
    </>
  );
}

// Verdict + content-score panel with a per-video "Regenerate verdict" action.
// Rendered above the summary overview when the video has a watchVerdict
// + verdictSummary. The regenerate button re-rates ONLY the verdict
// (watchVerdict, valueScore, verdictSummary, verdictReason) without
// touching sections / takeaways / action steps — much faster than a full
// summary regen. Use the existing summary "Regenerate" pill at the bottom
// of the page for a complete redo.
function VerdictBlock({ video }: Readonly<{ video: StrapiVideo }>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!video.watchVerdict || !video.verdictSummary) return null;

  const handleRegenerate = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await regenerateVideoVerdict({
        data: { videoId: video.youtubeVideoId },
      });
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Regenerate failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section
      className={`mb-10 rounded-2xl border p-5 sm:p-6 ${VERDICT_PANEL[video.watchVerdict]}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${VERDICT_BADGE[video.watchVerdict]}`}
        >
          {VERDICT_LABEL[video.watchVerdict]}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
          Should I watch this?
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {typeof video.finalScore === 'number' && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
              title="Content score (0–100). Hybrid blend: 60% programmatic signals + 40% LLM judgement. Sub-scores below."
              aria-label={`Content score: ${video.finalScore} out of 100`}
            >
              <span>Content score</span>
              <span className="text-[var(--ink)]">{video.finalScore}</span>
            </span>
          )}
          {typeof video.signalScore === 'number' && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider text-[var(--ink-muted)]"
              title="Programmatic signal score: filler density, lexical density, compression ratio, speaking pace, sponsor presence."
            >
              <span>Signals</span>
              <span className="text-[var(--ink-soft)]">{video.signalScore}</span>
            </span>
          )}
          {typeof video.valueScore === 'number' && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-0.5 text-[0.6rem] font-medium uppercase tracking-wider text-[var(--ink-muted)]"
              title="LLM verdict score: model's contextual 'is this worth your time' judgement."
            >
              <span>LLM</span>
              <span className="text-[var(--ink-soft)]">{video.valueScore}</span>
            </span>
          )}
        </div>
      </div>
      <p className="mt-3 text-base font-medium leading-relaxed text-[var(--ink)]">
        {video.verdictSummary}
      </p>
      {video.verdictReason && (
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">
          {video.verdictReason}
        </p>
      )}
      <div className="mt-4 flex items-center justify-between gap-3">
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : (
          <span className="text-[0.7rem] text-[var(--ink-muted)]">
            Re-rates only the verdict, not the full summary.
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleRegenerate}
          disabled={running}
        >
          {running ? 'Regenerating…' : 'Regenerate verdict'}
        </Button>
      </div>
    </section>
  );
}

function PendingState({
  videoId,
  progress,
}: Readonly<{ videoId: string; progress: GenerationProgress }>) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [retryMode, setRetryMode] = useState<GenerationMode>('auto');

  const handleForceRetry = async () => {
    setRetrying(true);
    await clearSummaryFailure({ data: { videoId } });
    await triggerSummaryGeneration({ data: { videoId, mode: retryMode } });
    await router.invalidate();
    setRetrying(false);
  };

  const currentIndex = progress.step
    ? STEPS.findIndex((s) => s.key === progress.step)
    : -1;
  const elapsed = formatElapsed(progress.elapsedMs);

  return (
    <main className="flex min-h-[60vh] items-center justify-center px-6 py-14 sm:px-10">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--card)] p-8 sm:p-10">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="h-8 w-8 flex-none animate-spin rounded-full border-[3px] border-[var(--line)] border-t-[var(--ink)]"
          />
          <div className="min-w-0">
            <h1 className="display-title text-xl text-[var(--ink)] sm:text-2xl">
              Generating your summary…
            </h1>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              You can leave this page — the job keeps running.
            </p>
          </div>
        </div>

        <ol className="mt-7 grid gap-3">
          {STEPS.map((step, i) => {
            const status =
              currentIndex === -1
                ? i === 0
                  ? 'active'
                  : 'pending'
                : i < currentIndex
                  ? 'done'
                  : i === currentIndex
                    ? 'active'
                    : 'pending';

            // For the active step, override the generic detail line with
            // the live sub-progress from the server (e.g. "map chunk 10/16")
            // so long map-reduce runs show forward motion instead of sitting
            // on a static label.
            const detailText =
              status === 'active' && progress.detail
                ? progress.detail
                : step.detail;
            const detailElapsed =
              status === 'active' && progress.detailElapsedMs != null
                ? formatElapsed(progress.detailElapsedMs)
                : null;

            return (
              <li
                key={step.key}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition ${
                  status === 'active'
                    ? 'border-[var(--line-strong)] bg-[var(--bg-subtle)]'
                    : 'border-[var(--line)] bg-transparent'
                }`}
              >
                <StepIcon status={status} index={i} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-medium ${
                        status === 'pending'
                          ? 'text-[var(--ink-muted)]'
                          : 'text-[var(--ink)]'
                      }`}
                    >
                      {step.label}
                    </span>
                    {status === 'active' && elapsed && (
                      <span className="rounded-full bg-[var(--card)] px-2 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)]">
                        {elapsed}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <p className="text-xs leading-relaxed text-[var(--ink-muted)]">
                      {detailText}
                    </p>
                    {detailElapsed && status === 'active' && progress.detail && (
                      <span className="rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[0.6rem] font-medium text-[var(--ink-muted)]">
                        {detailElapsed}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 border-t border-[var(--line)] pt-4">
          <p className="text-xs text-[var(--ink-muted)]">
            Stuck? The background job may have crashed.
          </p>
          <GenerationModeSelect
            value={retryMode}
            onChange={setRetryMode}
            disabled={retrying}
            id="force-retry-mode"
            className="mt-3 sm:max-w-sm"
            trailing={
              <Button
                type="button"
                size="pill"
                variant="outline"
                onClick={handleForceRetry}
                disabled={retrying}
                className="shrink-0"
              >
                {retrying ? 'Retrying…' : 'Force retry'}
              </Button>
            }
          />
        </div>
      </div>
    </main>
  );
}

function StepIcon({
  status,
  index,
}: Readonly<{ status: 'done' | 'active' | 'pending'; index: number }>) {
  if (status === 'done') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--ink)] text-[var(--cream)]"
      >
        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8l3.5 3.5L13 5" />
        </svg>
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 border-[var(--ink)] text-[var(--ink)]"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--ink)]" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border border-[var(--line)] text-[0.65rem] font-semibold text-[var(--ink-muted)]"
    >
      {index + 1}
    </span>
  );
}

function FailedState({
  video,
  error,
}: Readonly<{ video: StrapiVideo; error?: string }>) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    // Use `regenerateSummary` (not `triggerSummaryGeneration`) here — the
    // latter doesn't flip the DB row from `failed` → `pending`, so the
    // loader keeps seeing `failed` on `router.invalidate()` and re-renders
    // this same FailedState screen indefinitely (background job runs but
    // the UI never sees it because FailedState doesn't poll). Regenerate
    // does the flip in its `beforeStart` hook + clears the recent-failure
    // marker, so the next loader run sees `pending` and the polling UI
    // takes over correctly.
    await regenerateSummary({ data: { videoId: video.youtubeVideoId } });
    await router.invalidate();
    setRetrying(false);
  };

  return (
    <main className="page-wrap flex min-h-[60vh] items-center justify-center px-4 py-14">
      <div className="mx-auto max-w-md rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <h1 className="display-title text-2xl text-[var(--ink)]">Generation failed</h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          The AI model couldn't produce a summary for this video. Retry now, or check your
          Ollama daemon and model.
        </p>
        {error && (
          <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-left text-xs text-destructive">
            {friendlyOllamaError(error)}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-2">
          <Button type="button" size="pill" onClick={handleRetry} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </Button>
        </div>
      </div>
    </main>
  );
}

function UnsharedState({ videoId }: Readonly<{ videoId: string }>) {
  return (
    <main className="page-wrap flex min-h-[60vh] items-center justify-center px-4 py-14">
      <div className="mx-auto max-w-md rounded-2xl border border-[var(--line)] bg-[var(--card)] p-10 text-center">
        <h1 className="display-title text-3xl text-[var(--ink)]">
          This video isn't in the knowledge base yet.
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Share it from the new-post page to add it and generate the summary.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild size="pill" variant="outline">
            <a
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noreferrer"
            >
              Watch on YouTube
            </a>
          </Button>
        </div>
      </div>
    </main>
  );
}

// Topical embedding status + regenerate affordance. Uses `summaryEmbedding`/
// `embeddingModel`/`embeddingVersion` from the already-loaded Video row — no
// separate fetch needed to decide which label to show.
function EmbeddingPanel({ video }: Readonly<{ video: StrapiVideo }>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: VideoEmbeddingStatus = (() => {
    if (!video.summaryEmbedding || video.summaryEmbedding.length === 0) {
      return 'missing';
    }
    // The env constants can't be imported client-side via a secret; trust
    // what's stored: the server-side `getEmbeddingStatus` is authoritative
    // when we need it. Render as 'current' unless explicitly missing.
    // Regenerating is always safe — the server handles staleness detection.
    return 'current';
  })();

  const handleRegenerate = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await regenerateVideoEmbedding({
        data: { videoId: video.youtubeVideoId },
      });
      if (res.status === 'error') {
        setError(res.error);
        return;
      }
      await router.invalidate();
    } finally {
      setRunning(false);
    }
  };

  const label =
    status === 'missing' ? 'Generate embedding' : 'Regenerate embedding';

  return (
    <div className="mt-8 border-t border-[var(--line)] pt-5">
      <h3 className="mb-2 text-sm font-medium text-[var(--ink)]">
        Semantic embedding
      </h3>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-xs text-[var(--ink-muted)]">
          {status === 'missing' ? (
            <>
              No topical embedding yet. Generate one to enable related-video
              suggestions and library-wide semantic search for this video.
            </>
          ) : (
            <>
              Embedded{' '}
              {video.embeddingGeneratedAt
                ? new Date(video.embeddingGeneratedAt).toLocaleDateString()
                : '—'}
              {video.embeddingModel ? ` · ${video.embeddingModel}` : null}
              {typeof video.embeddingVersion === 'number'
                ? ` · v${video.embeddingVersion}`
                : null}
              . Regenerate after a summary regenerate or an embedding-model
              upgrade.
            </>
          )}
        </p>
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            size="pill"
            variant="outline"
            onClick={handleRegenerate}
            disabled={running}
          >
            {running ? 'Generating…' : label}
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}

function RegenerateButton({ videoId }: Readonly<{ videoId: string }>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<GenerationMode>('auto');

  const handleClick = async () => {
    if (running) return;
    if (
      !window.confirm(
        'Regenerate the summary? The old content stays if regeneration fails, and is replaced on success.',
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const result = await regenerateSummary({ data: { videoId, mode } });
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      await router.invalidate();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <GenerationModeSelect
        value={mode}
        onChange={setMode}
        disabled={running}
        id="regenerate-mode"
        className="w-full sm:w-80"
        trailing={
          <Button
            type="button"
            size="pill"
            variant="outline"
            onClick={handleClick}
            disabled={running}
            className="shrink-0"
          >
            {running ? 'Starting…' : 'Regenerate'}
          </Button>
        }
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

