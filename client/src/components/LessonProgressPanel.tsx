// The live step list for streamed lesson generation — shared by the
// library panel (/lessons, GenerateLessonPanel) and the single-video Lesson
// tab (learn.$videoId.tsx, LessonTab). Extracted from lessons.index.tsx
// rather than duplicated: both entry points stream the exact same
// LessonProgressEvent vocabulary (lesson-generation.ts emits it from the
// same call sites regardless of which PLAN function produced the outline),
// so a second, differently-behaved progress UI would just be two renderings
// of the same events drifting apart. Completed steps stay visible with
// their result (videos found, outline proposed, per-section block counts,
// grounding stats) — nothing here collapses or disappears once it lands.

import type { LessonProgressEvent } from '#/lib/services/lesson-generation';

// The model authors in markdown now, so a block the parser rejected — a bad
// enum, an unknown directive, a diagram that would draw nothing — would
// otherwise show up as nothing but a slightly shorter lesson. The count is
// already on the wire (`dropped`); this puts it on the page.
function RejectedBlocks({
  count,
  repaired,
}: Readonly<{ count?: number; repaired?: number }>) {
  if (!count && !repaired) return null;
  return (
    <span className="text-[var(--ink-muted)]">
      {count ? ` ${count} block${count === 1 ? '' : 's'} rejected by the parser.` : ''}
      {/* A repair is not a loss — the block is still in the lesson — but it
          IS evidence the model produced something that would have failed
          invisibly. The case that motivated this: a diagram whose own fret
          window hid its own dots, which renders as a blank fretboard rather
          than an error. Four of those were already sitting in published
          lessons before anything reported them. */}
      {repaired
        ? ` ${repaired} repaired (e.g. a diagram whose fret window hid its own notes).`
        : ''}
    </span>
  );
}

// Prose the model wrote with no citation, that the pipeline then grounded
// itself by BM25-matching the paragraph against the source transcripts (see
// `chooseProseSource`). Shown apart from the block counts because it answers
// a question about the PROMPT rather than about this lesson: if auto-grounding
// is citing most of the prose, the write pass is the thing to fix. It is also
// the only place the difference is visible at all — the finished page cannot
// tell a model-supplied citation from a recovered one.
function AutoGrounded({ count }: Readonly<{ count?: number }>) {
  if (!count) return null;
  return (
    <span className="text-[var(--ink-muted)]">
      {` ${count} uncited paragraph${count === 1 ? '' : 's'} grounded to a source by transcript match.`}
    </span>
  );
}

function renderProgressEvent(event: LessonProgressEvent) {
  switch (event.type) {
    case 'tier':
      return (
        <span>
          Using the <strong>{event.tier === 'frontier' ? 'frontier' : 'local'}</strong> tier
          (<code>{event.model}</code>).
        </span>
      );
    case 'retrieve':
      return (
        <div>
          <p>
            Found {event.videos.length} of {event.considered} candidate video
            {event.considered === 1 ? '' : 's'} above the relevance floor ({event.floor}).
          </p>
          {event.videos.length > 0 && (
            <ul className="mt-1 ml-4 list-disc">
              {event.videos.map((v) => (
                <li key={v.documentId}>
                  {v.title ?? v.youtubeVideoId} — {v.score.toFixed(2)}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    case 'coverage':
      return event.covered ? (
        <span>Coverage check passed — the library actually teaches this topic.</span>
      ) : (
        <span>
          Coverage check failed — the library doesn&apos;t cover this topic.
          {event.actualTopic ? ` Closest match: ${event.actualTopic}.` : ''}
          {event.reason ? ` (${event.reason})` : ''}
        </span>
      );
    case 'digest':
      return (
        <span>
          {event.cacheHit ? 'Reused a cached cross-video digest' : 'Synthesized a new cross-video digest'}{' '}
          ({event.ms}ms).
        </span>
      );
    case 'outline':
      return (
        <div>
          <p>
            Outline ready: <strong>{event.title}</strong> ({event.level}).
          </p>
          <ol className="mt-1 ml-4 list-decimal">
            {event.sections.map((heading, i) => (
              <li key={i}>{heading}</li>
            ))}
          </ol>
        </div>
      );
    case 'section':
      return (
        <span>
          Section {event.index + 1}/{event.total} &ldquo;{event.heading}&rdquo; — {event.blocks} block
          {event.blocks === 1 ? '' : 's'}
          {/* Written from real transcript passages, or (0) from the source
              summaries alone — worth showing, since a section that fell
              back to summaries is the one most likely to read vaguely. */}
          {typeof event.passages === 'number'
            ? event.passages === 0
              ? ', from the source summaries (no transcript passages matched).'
              : ` from ${event.passages} transcript passage${event.passages === 1 ? '' : 's'}.`
            : '.'}
          <RejectedBlocks count={event.dropped} repaired={event.repaired} />
          <AutoGrounded count={event.autoSourced} />
        </span>
      );
    case 'illustrate':
      return (
        <span>
          Illustrating {event.index + 1}/{event.total} &ldquo;{event.heading}&rdquo; —{' '}
          {event.diagrams === 0
            ? 'nothing needed a diagram.'
            : `${event.diagrams} diagram${event.diagrams === 1 ? '' : 's'} added.`}
          <RejectedBlocks count={event.dropped} repaired={event.repaired} />
        </span>
      );
    case 'grounding':
      return (
        <span>
          Grounded {event.grounded}/{event.total} citation{event.total === 1 ? '' : 's'} to a real
          transcript timecode.
        </span>
      );
    case 'retry':
      return (
        <span className="text-[var(--ink-muted)]">
          Retrying {event.step}
          {event.label ? ` "${event.label}"` : ''} (attempt {event.attempt}) — {event.reason}
        </span>
      );
    case 'saved':
      return (
        <span>
          Saved as <strong>{event.title}</strong> ({event.blockCount} block
          {event.blockCount === 1 ? '' : 's'}).
        </span>
      );
    case 'notice':
      // Not a failure — the run continued. Red "Failed at" on a successful
      // generation is worse than saying nothing, because it teaches the
      // reader to distrust a pipeline that is working.
      return <span className="text-[var(--ink-soft)]">{event.message}</span>;
    case 'error':
      return (
        <span className="text-red-600 dark:text-red-400">
          Failed at {event.step}: {event.message}
        </span>
      );
    default:
      return null;
  }
}

// Exported for direct testing (see lessons.index.test.tsx, which imports it
// via lessons.index.tsx's re-export) — rendering the full panel needs the
// fetch/SSE machinery mocked, so this piece is tested in isolation against
// a plain event array.
//
// `events` is typed as `LessonProgressEvent[]`, but both callers actually
// push whatever their SSE stream yields — including /api/lesson-plan(-video)'s
// terminal `plan` frame, which is a `LessonPlanFrame` member, NOT a
// `LessonProgressEvent` one (it carries the round-trippable outline/sources/
// digest, not a progress step). `renderProgressEvent` has no case for it, so
// it fell to `default: return null` — and this component used to wrap that
// null in an `<li>` anyway, rendering an empty bordered box between the
// outline step and the write phase's own `tier` line. Skipping the `<li>`
// entirely when there is nothing to show fixes that FOR ANY event type that
// ever renders null, not just this one case.
export function ProgressStepList({ events }: { events: LessonProgressEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="mt-4 space-y-1.5 text-xs text-[var(--ink-soft)]">
      {events.map((event, i) => {
        const content = renderProgressEvent(event);
        if (content === null) return null;
        return (
          <li
            key={i}
            className="rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2"
          >
            {content}
          </li>
        );
      })}
    </ol>
  );
}

// -----------------------------------------------------------------------------
// Write-phase stage label — shared so LessonTab and GenerateLessonPanel show
// the identical text instead of two hand-maintained copies drifting apart.
// -----------------------------------------------------------------------------
//
// The naive version of this ("switch on the last non-notice event's type")
// looks frozen on "Writing each section…" for the whole illustrate/ground/
// save tail whenever there is a real gap before the NEXT event of a
// different type arrives — reported twice against two different panels.
// The fix here is structural, not another string: it scans every event seen
// so far (not just the last one) and tracks the FURTHEST stage reached,
// including a `sections-done` stage entered the instant a `section` event
// reports `index + 1 === total` — before the first `illustrate` event has
// even arrived. A stage, once reached, never regresses (STAGE_ORDER is a
// strict ordering scanned forward), so a stray `retry` on an earlier step
// can't un-advance a later one.
const WRITE_STAGE_ORDER = ['sections', 'sections-done', 'illustrating', 'saving'] as const;
type WriteStage = (typeof WRITE_STAGE_ORDER)[number];

const WRITE_STAGE_LABEL: Record<WriteStage, string> = {
  sections: 'Writing each section…',
  'sections-done': 'Sections finished — choosing diagrams next…',
  illustrating: 'Choosing diagrams for each section…',
  // A `grounding` event fires once, right as writeLesson finishes — by the
  // time the client sees it, grounding and assembly are already done and
  // the only thing left is the route's own Strapi write. So `grounding`
  // folds into this label rather than getting a fourth, momentary one of
  // its own that would just flash by.
  saving: 'Grounding citations and saving the lesson…',
};

/** The write phase's current stage, as a ready-to-render label. Exported
 * (rather than kept as a private helper in each panel) so LessonTab and
 * GenerateLessonPanel derive the exact same text from the exact same
 * events — see this section's header comment. */
export function deriveWriteStage(events: LessonProgressEvent[]): string {
  let stage: WriteStage = 'sections';
  const advance = (next: WriteStage) => {
    if (WRITE_STAGE_ORDER.indexOf(next) > WRITE_STAGE_ORDER.indexOf(stage)) stage = next;
  };
  for (const event of events) {
    if (event.type === 'section') {
      advance(event.index + 1 >= event.total ? 'sections-done' : 'sections');
    } else if (event.type === 'illustrate') {
      advance('illustrating');
    } else if (event.type === 'grounding') {
      advance('saving');
    }
  }
  return WRITE_STAGE_LABEL[stage];
}
