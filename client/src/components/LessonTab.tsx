// The Lesson tab on /learn/$videoId — turn THIS ONE video into a lesson,
// and once one exists, READ it right here rather than only link to it.
//
// Different pipeline than the library's /lessons generator, not a filtered
// version of it: for a single video, retrieval/coverage/digest are all
// answered before generation starts (see planSingleVideoLesson's header
// comment in lesson-generation.ts). This component only drives the PLAN
// phase against a video-specific endpoint (/api/lesson-plan-video); the
// WRITE phase posts to the EXISTING /api/lesson-write route, unchanged —
// same section/illustrate/ground/assemble/save code the library path runs.
//
// Progress rendering is the shared <ProgressStepList/> and <deriveWriteStage>
// — see LessonProgressPanel's header for why a second, differently-behaved
// progress UI (or a second stage-label derivation) would be wrong here.
//
// Reading a finished lesson reuses <LessonBody> unchanged — no second
// renderer. Unlike /lessons/$slug it does NOT mount <LessonVideoPanel>: the
// video is already playing in /learn's own right column, so a citation
// here seeks THAT player (usePlayerControl, the same mechanism the
// Transcript tab's timestamps already use) instead of opening a panel.

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import { LessonBody } from '#/components/lesson/LessonBody';
import { ProgressStepList, deriveWriteStage } from '#/components/LessonProgressPanel';
import { findLessonForVideo, getLessonBySlug } from '#/data/server-functions/lessons';
import { streamLessonPlanSSE, streamLessonWriteSSE } from '#/lib/services/lesson-stream';
import { citationStartSec, type LessonCitation } from '#/lib/lesson/citation';
import { usePlayerControl } from '#/components/player';
import type { LessonPlanFrame } from '#/routes/api.lesson-plan';
import type { LessonOutline, LessonProgressEvent } from '#/lib/services/lesson-generation';
import type { Lesson } from '#/lib/services/lessons';
import type { StrapiVideo } from '#/lib/services/videos';

type PlanPayload = Extract<LessonPlanFrame, { type: 'plan' }>;
type SavedPayload = Extract<LessonProgressEvent, { type: 'saved' }>;

type Phase =
  | 'checking'
  | 'showing'
  | 'idle'
  | 'planning'
  | 'review'
  | 'writing'
  | 'success'
  | 'error';

export function LessonTab({ video }: Readonly<{ video: StrapiVideo }>) {
  const [phase, setPhase] = useState<Phase>('checking');
  // The full lesson, once we have one to render inline — either an
  // existing one found on mount, or the one just generated. Both paths
  // converge on the same "showing" render below, which is the point:
  // revisiting a video with a lesson and just having generated one look
  // identical, because they render through the same code.
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [events, setEvents] = useState<LessonProgressEvent[]>([]);
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editHeadings, setEditHeadings] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedPayload | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ step: string; message: string } | null>(null);
  // Which citation was last clicked, purely for the "you are here" mark
  // LessonBody draws next to it — there is no companion panel in this tab
  // to otherwise show that state.
  const [activeCitation, setActiveCitation] = useState<LessonCitation | null>(null);

  const { seekTo } = usePlayerControl();

  const writingStage = deriveWriteStage(events);

  // On mount (and whenever the video changes — navigating between two
  // learn pages without a full reload), check whether a single-video
  // lesson already exists for THIS video, and if so load it in full for
  // inline rendering. See findLessonForVideoService for why this only
  // matches a lesson whose whole source set is this one video.
  useEffect(() => {
    let cancelled = false;
    setPhase('checking');
    setLesson(null);
    findLessonForVideo({
      data: { documentId: video.documentId, youtubeVideoId: video.youtubeVideoId },
    })
      .then(async (found) => {
        if (cancelled || !found) {
          if (!cancelled) setPhase('idle');
          return;
        }
        const full = await getLessonBySlug({ data: { slug: found.slug } });
        if (cancelled) return;
        if (full.ok) {
          setLesson(full.lesson);
          setPhase('showing');
        } else {
          // The lookup found it but the full fetch failed (a backend
          // hiccup between the two calls) — fall back to the generate
          // form rather than getting stuck; regenerating never overwrites.
          setPhase('idle');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPhase('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [video.documentId, video.youtubeVideoId]);

  const busy = phase === 'planning' || phase === 'writing';

  function resetToIdle() {
    setPhase('idle');
    setLesson(null);
    setEvents([]);
    setPlan(null);
    setSaved(null);
    setErrorInfo(null);
    setActiveCitation(null);
  }

  async function handlePlan() {
    if (busy) return;
    setPhase('planning');
    setEvents([]);
    setPlan(null);
    setSaved(null);
    setErrorInfo(null);

    try {
      const res = await fetch('/api/lesson-plan-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: video.youtubeVideoId }),
      });
      let finalPlan: PlanPayload | null = null;
      let lastError: { step: string; message: string } | null = null;
      for await (const frame of streamLessonPlanSSE(res)) {
        // The terminal `plan` frame is NOT a LessonProgressEvent (it
        // carries the round-trippable outline/sources/digest, not a
        // progress step) — kept out of `events` so ProgressStepList never
        // has to render it. Every other frame IS a LessonProgressEvent.
        if (frame.type === 'plan') finalPlan = frame;
        else {
          setEvents((prev) => [...prev, frame]);
          if (frame.type === 'error') lastError = { step: frame.step, message: frame.message };
        }
      }
      if (finalPlan) {
        setPlan(finalPlan);
        setEditTitle(finalPlan.outline.title);
        setEditHeadings(finalPlan.outline.sections.map((s) => s.heading));
        setPhase('review');
        return;
      }
      setErrorInfo(lastError ?? { step: 'plan', message: 'Lesson planning failed unexpectedly.' });
      setPhase('error');
    } catch (err) {
      setErrorInfo({
        step: 'plan',
        message: err instanceof Error ? err.message : 'Lesson planning failed.',
      });
      setPhase('error');
    }
  }

  async function handleWrite() {
    if (!plan) return;
    setPhase('writing');
    setSaved(null);
    setErrorInfo(null);

    const editedOutline: LessonOutline = {
      ...plan.outline,
      title: editTitle.trim() || plan.outline.title,
      sections: plan.outline.sections.map((section, i) => ({
        ...section,
        heading: (editHeadings[i] ?? section.heading).trim() || section.heading,
      })),
    };

    try {
      // The EXISTING /api/lesson-write route, unchanged — it only sees a
      // one-source plan with an empty digest, which it already knows how
      // to write (writeLesson never forked for this path).
      const res = await fetch('/api/lesson-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: video.summaryTitle ?? video.videoTitle ?? video.youtubeVideoId,
          outline: editedOutline,
          sources: plan.sources,
          digest: plan.digest,
        }),
      });
      let finalSaved: SavedPayload | null = null;
      let lastError: { step: string; message: string } | null = null;
      for await (const frame of streamLessonWriteSSE(res)) {
        setEvents((prev) => [...prev, frame]);
        if (frame.type === 'saved') finalSaved = frame;
        else if (frame.type === 'error') lastError = { step: frame.step, message: frame.message };
      }
      if (finalSaved) {
        setSaved(finalSaved);
        setPhase('success');
        // Load the just-saved lesson in full so this converges on the same
        // inline render as "an existing lesson was found" — the reader
        // sees the finished lesson, not a link to go read it elsewhere.
        const full = await getLessonBySlug({ data: { slug: finalSaved.slug } });
        if (full.ok) {
          setLesson(full.lesson);
          setPhase('showing');
        }
        // If the re-fetch fails, phase stays 'success' — the save itself
        // worked (that's what `saved` means), so the fallback below still
        // offers a working link rather than reporting an error for a
        // generation that actually succeeded.
        return;
      }
      setErrorInfo(lastError ?? { step: 'write', message: 'Lesson writing failed unexpectedly.' });
      setPhase('error');
    } catch (err) {
      setErrorInfo({
        step: 'write',
        message: err instanceof Error ? err.message : 'Lesson writing failed.',
      });
      setPhase('error');
    }
  }

  function handleCancel() {
    resetToIdle();
  }

  if (phase === 'checking') {
    return <p className="text-sm text-[var(--ink-muted)]">Checking for an existing lesson…</p>;
  }

  // The finished lesson, read right here — whether it already existed or
  // was just generated. A citation seeks the video already playing in
  // /learn's right column; it does not open a second player or link away.
  if (phase === 'showing' && lesson) {
    return (
      <div>
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Lesson
            </p>
            <h2 className="mt-1 text-2xl font-semibold leading-tight text-[var(--ink)]">
              {lesson.title}
            </h2>
            {lesson.summary ? (
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{lesson.summary}</p>
            ) : null}
          </div>
          <Link
            to="/lessons/$slug"
            params={{ slug: lesson.slug }}
            className="mt-1 shrink-0 whitespace-nowrap text-xs font-medium text-[var(--accent)] no-underline hover:underline"
          >
            Open full lesson →
          </Link>
        </div>

        <LessonBody
          blocks={lesson.body}
          parameter={lesson.parameter}
          sourceVideos={lesson.videos}
          onCitationSelect={(citation) => {
            setActiveCitation(citation);
            seekTo(citationStartSec(citation));
          }}
          activeCitation={activeCitation}
        />

        {/* Regenerating is reachable but deliberately not the default —
            it sits below the whole lesson, and a second generation never
            overwrites the first (saveLessonService appends -2, -3, …). */}
        <div className="mt-10 border-t border-[var(--line)] pt-4">
          <Button type="button" size="sm" variant="outline" onClick={resetToIdle}>
            Generate another version
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <h2 className="text-base font-semibold text-[var(--ink)]">Turn this video into a lesson</h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Built from THIS video&apos;s own transcript, not a library-wide search — every section is
        grounded in real passages from what this video actually says, and you&apos;ll review the
        proposed outline before it writes the full lesson.
      </p>

      {phase === 'idle' && (
        <div className="mt-4">
          <Button type="button" size="sm" onClick={() => void handlePlan()}>
            Generate a lesson
          </Button>
        </div>
      )}

      {phase === 'planning' && (
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          Checking the transcript and drafting an outline…
        </p>
      )}

      {(phase === 'planning' || phase === 'writing' || phase === 'success') && (
        <ProgressStepList events={events} />
      )}

      {phase === 'review' && plan && (
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4">
          <p className="text-xs font-medium text-[var(--ink-muted)]">
            Proposed outline — built by the{' '}
            <strong>{plan.tier === 'frontier' ? 'frontier' : 'local'}</strong> tier (
            <code>{plan.model}</code>). Edit the title or section headings, then generate the
            full lesson, or cancel — cancelling costs nothing further.
          </p>

          <label
            className="mt-3 block text-xs font-medium text-[var(--ink-muted)]"
            htmlFor="video-lesson-title-edit"
          >
            Title
          </label>
          <input
            id="video-lesson-title-edit"
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 text-sm text-[var(--ink)] focus:border-[var(--line-strong)] focus:outline-none"
          />

          <p className="mt-3 text-xs font-medium text-[var(--ink-muted)]">Sections</p>
          <ol className="mt-1 space-y-2">
            {plan.outline.sections.map((section, i) => (
              <li key={i}>
                <input
                  type="text"
                  value={editHeadings[i] ?? section.heading}
                  onChange={(e) =>
                    setEditHeadings((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                  className="h-9 w-full rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 text-sm text-[var(--ink)] focus:border-[var(--line-strong)] focus:outline-none"
                />
                {section.goal ? (
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">{section.goal}</p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="mt-4 flex gap-2">
            <Button type="button" size="sm" onClick={() => void handleWrite()}>
              Generate sections
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {phase === 'writing' && (
        <p className="mt-3 text-xs text-[var(--ink-muted)]">{writingStage}</p>
      )}

      {/* Fallback only: reached when the write succeeded but re-fetching
          the full lesson for inline rendering failed (see handleWrite).
          The save itself is real — this still links to it. */}
      {phase === 'success' && saved && (
        <p className="mt-3 text-xs text-[var(--ink)]">
          Generated{' '}
          <Link
            to="/lessons/$slug"
            params={{ slug: saved.slug }}
            className="font-semibold text-[var(--accent)]"
          >
            {saved.title}
          </Link>{' '}
          — built by the <strong>{saved.tier === 'frontier' ? 'frontier' : 'local'}</strong> tier
          (<code>{saved.model}</code>).
        </p>
      )}

      {phase === 'error' && errorInfo && (
        <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4 text-xs text-[var(--ink-soft)]">
          <p>
            Failed at <strong>{errorInfo.step}</strong>: {errorInfo.message}
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={resetToIdle}>
            Try again
          </Button>
        </div>
      )}
    </section>
  );
}
