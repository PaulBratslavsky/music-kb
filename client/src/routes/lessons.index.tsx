// /lessons — index of the guitar lessons. Each card links to a
// self-contained lesson page. Lesson data is Strapi-backed; hand-written
// lessons are added through the CMS. AI-generated ones can now also be
// produced right here, via generateAndSaveLesson (see the form below).

import { useState } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { BackendErrorPanel } from '#/components/BackendErrorPanel';
import { Button } from '#/components/ui/button';
import { listLessons } from '#/data/server-functions/lessons';
import { generateAndSaveLesson } from '#/data/server-functions/generate-lesson';
import type { LessonListResult, LessonSummary } from '#/lib/services/lessons';
import type { SourceVideo } from '#/lib/services/lesson-generation';

export const Route = createFileRoute('/lessons/')({
  component: LessonsIndexPage,
  loader: async (): Promise<LessonListResult> => listLessons(),
  head: () => ({ meta: [{ title: 'Lessons · Music KB' }] }),
});

function LessonsIndexPage() {
  const data = Route.useLoaderData();
  const router = useRouter();

  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-8 max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          Lessons
        </p>
        <h1 className="display-title mt-1 text-3xl text-[var(--ink)] sm:text-4xl">
          Guitar lessons
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">
          Self-contained walk-throughs that pair theory with practice.
          Click any card to start; each lesson cross-links to the
          fretboard explorer and the rest of the visualizer so you can
          dig as deep as you want.
        </p>
      </header>

      <GenerateLessonForm onGenerated={() => void router.invalidate()} />

      {!data.ok ? (
        <BackendErrorPanel message={data.error} />
      ) : data.lessons.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)]">
          No lessons yet. Add one through the CMS to see it here.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {data.lessons.map((l) => (
            <Link
              key={l.documentId}
              to="/lessons/$slug"
              params={{ slug: l.slug }}
              className="group block rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 no-underline transition hover:border-[var(--accent)]"
            >
              <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
                <span className="rounded-full border border-[var(--line)] px-2 py-0.5 font-medium">
                  {l.level}
                </span>
                {l.duration ? <span>{l.duration}</span> : null}
                <StatusBadge status={l.status} />
              </div>
              <h2 className="mt-3 text-base font-semibold text-[var(--ink)] group-hover:text-[var(--accent)]">
                {l.title}
              </h2>
              {l.summary ? (
                <p className="mt-2 text-sm text-[var(--ink-soft)]">{l.summary}</p>
              ) : null}
              <span className="mt-4 inline-block text-xs font-semibold text-[var(--accent)]">
                Start lesson →
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

// Small label chip using the palette that's already on the page (see the
// `level` chip just above it) — no new colors invented. `published` (and
// any other status the CMS might add) renders no badge at all, matching
// the "reviewed, nothing to flag" default. Exported for direct testing —
// rendering the full route through Route.useLoaderData() needs a live
// router context this suite doesn't set up.
export function StatusBadge({ status }: { status: LessonSummary['status'] }) {
  if (status === 'ai-generated') {
    return (
      <span className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2 py-0.5 font-medium text-[var(--accent)]">
        AI-generated
      </span>
    );
  }
  if (status === 'draft') {
    return (
      <span className="rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-0.5 font-medium text-[var(--ink-muted)]">
        Draft
      </span>
    );
  }
  return null;
}

// The backstop for anything the coverage check (lesson-generation.ts) might
// still miss: a user who can see exactly which videos a lesson was built
// from can judge it for themselves. Shown next to the success message,
// never hidden behind a click — this is the whole point of surfacing it.
// Exported for direct testing, same reasoning as StatusBadge above.
export function SourcesList({ sources }: { sources: SourceVideo[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 text-xs text-[var(--ink-muted)]">
      <span className="font-medium">Built from:</span>{' '}
      {sources.map((s, i) => (
        <span key={s.documentId}>
          {i > 0 ? ', ' : ''}
          {s.title ?? s.youtubeVideoId}
        </span>
      ))}
    </div>
  );
}

type GenerateState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | {
      kind: 'success';
      slug: string;
      title: string;
      tier: 'frontier' | 'local';
      model: string;
      sources: SourceVideo[];
    }
  // The relevance floor legitimately returning `{ ok: false }` isn't a
  // crash — it's information ("nothing in the library is close enough to
  // this topic"). Same shape as `error` so it renders identically; kept as
  // a separate variant only so the copy above the box can be honest about
  // which situation this is if that's ever needed.
  | { kind: 'error'; message: string };

// Generates a lesson from the video library (client/src/lib/services/
// lesson-generation.ts via the generateAndSaveLesson server function) and
// persists it. Runs entirely server-side — the ANTHROPIC_API_KEY that may
// back the frontier tier never reaches this component; only the tier NAME
// ('frontier' | 'local') and model id come back, which is exactly what the
// UI needs to show which kind of artifact this is.
function GenerateLessonForm({ onGenerated }: { onGenerated: () => void }) {
  const [topic, setTopic] = useState('');
  const [state, setState] = useState<GenerateState>({ kind: 'idle' });

  const running = state.kind === 'running';

  const handleGenerate = async () => {
    const trimmed = topic.trim();
    if (!trimmed || running) return;
    setState({ kind: 'running' });
    try {
      const result = await generateAndSaveLesson({ data: { topic: trimmed } });
      if (!result.ok) {
        setState({ kind: 'error', message: result.error });
        return;
      }
      setState({
        kind: 'success',
        slug: result.slug,
        title: result.title,
        tier: result.tier,
        model: result.model,
        sources: result.sources,
      });
      onGenerated();
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Lesson generation failed.',
      });
    }
  };

  return (
    <section className="mb-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
      <h2 className="text-base font-semibold text-[var(--ink)]">
        Generate a lesson
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Pick a topic and the AI builds a lesson from videos already in the
        library — retrieval, cross-video synthesis, and citations, all
        grounded in what you&apos;ve actually watched.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleGenerate();
          }}
          disabled={running}
          placeholder="e.g. drop-D tuning basics"
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-5 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={running || !topic.trim()}
        >
          {running ? 'Generating…' : 'Generate'}
        </Button>
      </div>

      {running && (
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          Retrieving related videos, synthesizing a digest, and writing the
          lesson section by section. This takes 1–3 minutes — the page will
          update here when it&apos;s done.
        </p>
      )}

      {state.kind === 'success' && (
        <p className="mt-3 text-xs text-[var(--ink)]">
          Generated{' '}
          <Link
            to="/lessons/$slug"
            params={{ slug: state.slug }}
            className="font-semibold text-[var(--accent)]"
          >
            {state.title}
          </Link>{' '}
          — built by the{' '}
          <strong>{state.tier === 'frontier' ? 'frontier' : 'local'}</strong>{' '}
          tier (<code>{state.model}</code>).
        </p>
      )}

      {state.kind === 'success' && <SourcesList sources={state.sources} />}

      {state.kind === 'error' && (
        <p className="mt-3 text-xs text-[var(--ink-soft)]">{state.message}</p>
      )}
    </section>
  );
}
