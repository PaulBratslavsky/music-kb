// The right-hand column of a lesson: the videos the lesson was built
// from, and — once a citation is clicked — that video playing at the
// second the claim was grounded to.
//
// This is the whole point of the two-column view. Every citation in a
// generated lesson carries a timestamp that BM25 matched against the real
// transcript rather than one the model asserted (ADR 0004). Until now the
// UI spent that: a citation opened a new tab, and checking a claim meant
// leaving the lesson. Here the check happens beside the paragraph making
// the claim.
//
// Scope note: the lesson chat panel is a separate, larger task. This
// column is deliberately a plain vertical stack so chat can be appended
// below the source list without restructuring anything.

import { useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import {
  PlayerProvider,
  YouTubePlayer,
  usePlayerControl,
} from '#/components/player';
import {
  citationStartSec,
  formatCitationTime,
  youtubeWatchUrl,
  type LessonVideoSelection,
} from '#/lib/lesson/citation';
import type { LessonBlock, LessonSourceVideo } from '#/lib/services/lessons';

/**
 * Whether this lesson has anything the panel could ever show — i.e.
 * whether a clickable citation can render anywhere in the body.
 *
 * The two ways one can:
 *  - a `source.videoId` citation, which only renders when the video is in
 *    the lesson's resolved `videos` set (see SourceNote in LessonBody),
 *  - a `lesson.video-ref` block, which renders off its own `videoId` and
 *    does NOT consult that set — an older lesson can carry one with an
 *    empty relation.
 *
 * Missing the second case would leave a video-ref button wired to a panel
 * that was never rendered: a click that does nothing, with no error.
 */
export function lessonHasVideoPanel(
  blocks: LessonBlock[],
  videos: LessonSourceVideo[],
): boolean {
  if (videos.length > 0) return true;
  return blocks.some(
    (b) =>
      b.__component === 'lesson.video-ref' &&
      typeof b.videoId === 'string' &&
      b.videoId.length > 0,
  );
}

export function LessonVideoPanel({
  videos,
  selection,
  onSelect,
  onClear,
  onReturnToCitation,
}: Readonly<{
  videos: LessonSourceVideo[];
  /** Null until the reader clicks a citation — which is also the state
   *  the server renders, so the panel's SSR output and its first client
   *  render are identical (docs/ssr-client-fallback.md). No player exists
   *  on the server at all. */
  selection: LessonVideoSelection | null;
  onSelect: (videoId: string) => void;
  onClear: () => void;
  /** Scrolls back to the citation that opened this video. Only offered
   *  below `lg`, where the panel sits at the end of the document and
   *  reaching it meant leaving the paragraph behind — see the comment on
   *  the return button below. */
  onReturnToCitation: () => void;
}>) {
  const activeVideo =
    selection === null
      ? null
      : (videos.find((v) => v.youtubeVideoId === selection.videoId) ?? null);

  return (
    <div className="flex flex-col gap-5">
      {selection === null ? (
        <IdleHint />
      ) : (
        <SelectedVideo
          // Remounting on a video change is deliberate: it gives the
          // embed a fresh <PlayerProvider> whose `startSec` lands through
          // the player's own loadedmetadata path, the same way /learn
          // handles `?t=`. A time change WITHIN one video does not
          // remount — SeekOnSelectionChange handles that, so switching
          // moments in the same video doesn't reload the video.
          key={selection.videoId}
          selection={selection}
          video={activeVideo}
          onClear={onClear}
          onReturnToCitation={onReturnToCitation}
        />
      )}

      {videos.length > 0 ? (
        <section aria-labelledby="lesson-panel-sources">
          <h2
            id="lesson-panel-sources"
            className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]"
          >
            Sources
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {videos.map((v) => {
              const isActive = selection?.videoId === v.youtubeVideoId;
              return (
                <li key={v.documentId}>
                  <button
                    type="button"
                    onClick={() => onSelect(v.youtubeVideoId)}
                    aria-current={isActive ? 'true' : undefined}
                    className={`flex w-full min-w-0 gap-3 rounded-xl border p-2 text-left transition ${
                      isActive
                        ? 'border-[var(--accent)] bg-[var(--bg-subtle)]'
                        : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--line-strong)]'
                    }`}
                  >
                    {v.videoThumbnailUrl ? (
                      <img
                        src={v.videoThumbnailUrl}
                        alt=""
                        className="h-12 w-20 shrink-0 rounded-md object-cover"
                      />
                    ) : null}
                    <span className="min-w-0 self-center text-xs font-medium text-[var(--ink)]">
                      <span className="line-clamp-2">
                        {v.videoTitle ?? v.youtubeVideoId}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// Shown before anything is picked. An empty panel would be a hole the
// reader has to guess the purpose of; this says what the SOURCE links in
// the lesson will do, which is the only place that behaviour is
// discoverable before the first click.
function IdleHint() {
  return (
    <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-5 text-xs leading-relaxed text-[var(--ink-muted)]">
      Click any{' '}
      <span className="font-medium uppercase tracking-wide text-[var(--ink-soft)]">
        Source
      </span>{' '}
      line in the lesson to play that video here, at the moment the claim was
      matched to the transcript.
    </p>
  );
}

function SelectedVideo({
  selection,
  video,
  onClear,
  onReturnToCitation,
}: Readonly<{
  selection: LessonVideoSelection;
  /** Null when the citation names a video outside the lesson's resolved
   *  source set — possible for a `lesson.video-ref` block on a lesson
   *  with an empty `videos` relation. The player still works; only the
   *  title is unknown, so the id stands in rather than a blank line. */
  video: LessonSourceVideo | null;
  onClear: () => void;
  onReturnToCitation: () => void;
}>) {
  const startSec = citationStartSec(selection);
  const grounded = startSec > 0;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
      <PlayerProvider>
        <div className="relative aspect-video w-full bg-black">
          <YouTubePlayer
            videoId={selection.videoId}
            startSec={startSec}
            className="absolute inset-0 h-full w-full"
          />
        </div>
        <SeekOnSelectionChange startSec={startSec} seq={selection.seq} />
      </PlayerProvider>

      <div className="flex flex-col gap-2 px-3 py-3">
        <p className="text-sm font-medium leading-snug text-[var(--ink)]">
          {video?.videoTitle ?? selection.videoId}
        </p>
        <p className="text-[11px] text-[var(--ink-muted)]">
          {grounded
            ? `Playing from ${formatCitationTime(startSec)}`
            : 'No grounded timestamp for this citation — playing from the start'}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          {/* The deliberate "I do want to leave" affordances. The panel
              supersedes the old target="_blank" citation link, so the way
              out has to live somewhere explicit rather than disappear. */}
          <a
            href={youtubeWatchUrl(selection)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--ink-soft)] underline hover:text-[var(--accent)]"
          >
            Open on YouTube
          </a>
          <Link
            to="/learn/$videoId"
            params={{ videoId: selection.videoId }}
            search={grounded ? { t: startSec } : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--ink-soft)] underline hover:text-[var(--accent)]"
          >
            Open in library
          </Link>
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-[var(--ink-muted)] underline hover:text-[var(--ink)]"
          >
            Close
          </button>
        </div>
        {/* Below `lg` the panel sits at the END of the document, so
            opening a video means the page scrolled here from wherever
            the reader was — a one-way trip with nothing pointing back.
            This is the way back. Hidden on `lg`, where the panel is
            beside the paragraph and the reader never moved. */}
        <button
          type="button"
          onClick={onReturnToCitation}
          className="self-start text-[11px] text-[var(--ink-soft)] underline hover:text-[var(--accent)] lg:hidden"
        >
          Back to the lesson
        </button>
      </div>
    </div>
  );
}

// Seeks the already-loaded player when the reader clicks a DIFFERENT
// moment in the SAME video. Renders nothing; it exists only to be a
// descendant of <PlayerProvider>, which is where seekTo lives.
//
// The first run is skipped on purpose: on mount the position is already
// being applied by YouTubePlayer's `startSec`, and seeking an embed that
// has not loaded its metadata yet lands at 0.
function SeekOnSelectionChange({
  startSec,
  seq,
}: Readonly<{ startSec: number; seq: number }>) {
  const { seekTo } = usePlayerControl();
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    seekTo(startSec);
    // `seq` is in the dependency list without being read: it is what makes
    // clicking the same citation twice re-seek instead of doing nothing.
  }, [startSec, seq, seekTo]);
  return null;
}
