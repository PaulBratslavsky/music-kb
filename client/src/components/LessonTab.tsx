// The Lesson tab on /learn/$videoId — turn THIS ONE video into a lesson.
//
// Different pipeline than the library's /lessons generator, not a filtered
// version of it: for a single video, retrieval/coverage/digest are all
// answered before generation starts (see planSingleVideoLesson's header
// comment in lesson-generation.ts). This component only drives the PLAN
// phase against a video-specific endpoint (/api/lesson-plan-video); the
// WRITE phase posts to the EXISTING /api/lesson-write route, unchanged —
// same section/illustrate/ground/assemble/save code the library path runs.
//
// Progress rendering is the shared <ProgressStepList/> — see that module's
// header for why a second, differently-behaved progress UI would be wrong
// here.

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import { ProgressStepList } from '#/components/LessonProgressPanel';
import { findLessonForVideo } from '#/data/server-functions/lessons';
import { streamLessonPlanSSE, streamLessonWriteSSE } from '#/lib/services/lesson-stream';
import type { LessonPlanFrame } from '#/routes/api.lesson-plan';
import type { LessonOutline, LessonProgressEvent } from '#/lib/services/lesson-generation';
import type { LessonForVideo } from '#/lib/services/lessons';
import type { StrapiVideo } from '#/lib/services/videos';

type PlanPayload = Extract<LessonPlanFrame, { type: 'plan' }>;
type SavedPayload = Extract<LessonProgressEvent, { type: 'saved' }>;

type Phase =
  | 'checking'
  | 'existing'
  | 'idle'
  | 'planning'
  | 'review'
  | 'writing'
  | 'success'
  | 'error';

export function LessonTab({ video }: Readonly<{ video: StrapiVideo }>) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [existing, setExisting] = useState<LessonForVideo | null>(null);
  const [events, setEvents] = useState<LessonProgressEvent[]>([]);
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editHeadings, setEditHeadings] = useState<string[]>([]);
  const [saved, setSaved] = useState<SavedPayload | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ step: string; message: string } | null>(null);

  const writingStage = (() => {
    const last = [...events].reverse().find((e) => e.type !== 'notice');
    switch (last?.type) {
      case 'section':
        return 'Writing each section…';
      case 'illustrate':
        return 'Choosing diagrams for each section…';
      case 'grounding':
        return 'Grounding citations against the transcript…';
      default:
        return 'Assembling and saving the lesson…';
    }
  })();

  // On mount (and whenever the video changes — navigating between two
  // learn pages without a full reload), check whether a single-video
  // lesson already exists for THIS video. If one does, the generate form
  // never renders — see findLessonForVideoService for why this only
  // matches a lesson whose whole source set is this one video.
  useEffect(() => {
    let cancelled = false;
    setPhase('checking');
    setExisting(null);
    findLessonForVideo({
      data: { documentId: video.documentId, youtubeVideoId: video.youtubeVideoId },
    })
      .then((found) => {
        if (cancelled) return;
        if (found) {
          setExisting(found);
          setPhase('existing');
        } else {
          setPhase('idle');
        }
      })
      .catch(() => {
        if (cancelled) return;
        // A failed lookup falls back to the generate form rather than
        // getting stuck on "checking" forever — worst case the reader sees
        // the form when a lesson already exists, discovers as much from
        // this tab still being reachable, and generation is idempotent
        // enough (never overwrites) that trying again costs nothing but a
        // few minutes.
        setPhase('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [video.documentId, video.youtubeVideoId]);

  const busy = phase === 'planning' || phase === 'writing';

  function resetToIdle() {
    setPhase('idle');
    setEvents([]);
    setPlan(null);
    setSaved(null);
    setErrorInfo(null);
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
        setEvents((prev) => [...prev, frame as LessonProgressEvent]);
        if (frame.type === 'plan') finalPlan = frame;
        else if (frame.type === 'error') lastError = { step: frame.step, message: frame.message };
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

  if (phase === 'existing' && existing) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lesson
        </p>
        <h2 className="mt-1 text-xl font-semibold text-[var(--ink)]">{existing.title}</h2>
        {existing.summary ? (
          <p className="mt-2 text-sm text-[var(--ink-soft)]">{existing.summary}</p>
        ) : null}
        <Link
          to="/lessons/$slug"
          params={{ slug: existing.slug }}
          className="mt-4 inline-block text-sm font-semibold text-[var(--accent)] no-underline hover:underline"
        >
          Open lesson →
        </Link>
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
