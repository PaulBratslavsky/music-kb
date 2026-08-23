// @vitest-environment jsdom
//
// StatusBadge/SourcesList/ProgressStepList are exercised directly, and
// GenerateLessonPanel is exercised with fetch + the SSE stream parser
// mocked out — rendering the full LessonsIndexPage needs a live TanStack
// Router context for Route.useLoaderData(), which is more machinery than
// this page's pieces are worth setting up (see LessonBody.test.tsx for the
// same reasoning on the Link mock).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { SourceVideo, LessonProgressEvent } from '#/lib/services/lesson-generation';

// Same stub as LessonBody.test.tsx — GenerateLessonPanel renders a `Link`
// on the review/success steps, which needs a live RouterProvider to
// resolve useRouter() otherwise.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ useLoaderData: () => undefined, options }),
  useRouter: () => ({ invalidate: () => undefined }),
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => {
    const path = to.replace(/\$([a-zA-Z0-9_]+)/g, (_, key) => String(params?.[key] ?? ''));
    return (
      <a href={path} {...rest}>
        {children}
      </a>
    );
  },
}));

const streamLessonPlanSSEMock = vi.fn();
const streamLessonWriteSSEMock = vi.fn();
vi.mock('#/lib/services/lesson-stream', () => ({
  streamLessonPlanSSE: (...args: unknown[]) => streamLessonPlanSSEMock(...args),
  streamLessonWriteSSE: (...args: unknown[]) => streamLessonWriteSSEMock(...args),
}));

import { StatusBadge, SourcesList, ProgressStepList, GenerateLessonPanel } from './lessons.index';

// RTL auto-cleanup only registers itself when vitest runs with `globals:
// true`; this config does not, so without an explicit afterEach every
// render in this file accumulates in document.body and `screen` queries
// match leftovers from earlier tests.
afterEach(cleanup);

describe('StatusBadge', () => {
  it('renders an AI-generated badge for status "ai-generated"', () => {
    render(<StatusBadge status="ai-generated" />);
    expect(screen.getByText('AI-generated')).toBeTruthy();
  });

  it('renders a Draft badge for status "draft"', () => {
    render(<StatusBadge status="draft" />);
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('renders nothing for status "published"', () => {
    const { container } = render(<StatusBadge status="published" />);
    expect(container.textContent).toBe('');
  });
});

describe('SourcesList', () => {
  const sources: SourceVideo[] = [
    { documentId: 'a', youtubeVideoId: 'yt-a', title: 'Blues Turnarounds 101', score: 0.71 },
    { documentId: 'b', youtubeVideoId: 'yt-b', title: 'Advanced Turnarounds', score: 0.63 },
  ];

  it('lists every source video title, so a user can judge the lesson for themselves', () => {
    render(<SourcesList sources={sources} />);
    expect(screen.getByText(/Blues Turnarounds 101/)).toBeTruthy();
    expect(screen.getByText(/Advanced Turnarounds/)).toBeTruthy();
  });

  it('falls back to the youtubeVideoId when a source has no title', () => {
    render(<SourcesList sources={[{ documentId: 'c', youtubeVideoId: 'yt-c', title: null, score: 0.5 }]} />);
    expect(screen.getByText(/yt-c/)).toBeTruthy();
  });

  it('renders nothing for an empty source list', () => {
    const { container } = render(<SourcesList sources={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('ProgressStepList', () => {
  it('renders nothing for an empty event list', () => {
    const { container } = render(<ProgressStepList events={[]} />);
    expect(container.textContent).toBe('');
  });

  it('renders a step for each event as it arrives, with the result visible', () => {
    const events: LessonProgressEvent[] = [
      { type: 'tier', tier: 'frontier', model: 'claude-sonnet-5' },
      {
        type: 'retrieve',
        considered: 5,
        floor: 0.5,
        videos: [{ documentId: 'a', youtubeVideoId: 'yt-a', title: 'Blues Turnarounds 101', score: 0.71 }],
      },
      { type: 'coverage', covered: true, actualTopic: null, reason: null },
      { type: 'digest', cacheHit: true, ms: 12 },
      { type: 'outline', title: 'Blues turnarounds', level: 'beginner', sections: ['Intro', 'The shape'] },
      { type: 'section', index: 0, total: 2, heading: 'Intro', blocks: 3 },
      { type: 'retry', step: 'section', attempt: 1, reason: 'zero usable blocks', label: 'Intro' },
      { type: 'grounding', grounded: 2, total: 3 },
      { type: 'saved', slug: 'blues-turnarounds', title: 'Blues turnarounds', blockCount: 5, tier: 'frontier', model: 'claude-sonnet-5' },
      { type: 'error', step: 'section', message: 'Every lesson section failed to generate.' },
    ];

    render(<ProgressStepList events={events} />);

    expect(screen.getByText(/claude-sonnet-5/)).toBeTruthy();
    expect(screen.getByText(/Blues Turnarounds 101/)).toBeTruthy();
    expect(screen.getByText(/Coverage check passed/)).toBeTruthy();
    expect(screen.getByText(/Reused a cached cross-video digest/)).toBeTruthy();
    expect(screen.getByText(/Outline ready/)).toBeTruthy();
    expect(screen.getAllByText(/Intro/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Retrying section/)).toBeTruthy();
    expect(screen.getByText(/Grounded 2\/3/)).toBeTruthy();
    expect(screen.getByText(/Saved as/)).toBeTruthy();
    expect(screen.getByText(/Failed at section/)).toBeTruthy();
  });
});

function asyncGenOf<T>(items: T[]): AsyncGenerator<T, void, void> {
  return (async function* () {
    for (const item of items) yield item;
  })();
}

describe('GenerateLessonPanel', () => {
  afterEach(() => {
    streamLessonPlanSSEMock.mockReset();
    streamLessonWriteSSEMock.mockReset();
    vi.unstubAllGlobals();
  });

  it('gates on approval: shows the proposed outline after phase 1 and requires an explicit click before writing sections', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));
    streamLessonPlanSSEMock.mockReturnValue(
      asyncGenOf([
        { type: 'tier', tier: 'local', model: 'gemma4-kb:latest' },
        {
          type: 'plan',
          outline: {
            title: 'Blues turnarounds',
            summary: 's',
            level: 'beginner',
            instrument: 'guitar',
            duration: null,
            sections: [{ heading: 'Intro', goal: 'g1' }, { heading: 'The shape', goal: 'g2' }],
          },
          sources: [{ documentId: 'a', youtubeVideoId: 'yt-a', title: 'Video A', score: 0.8 }],
          digest: { title: 't', description: 'd', overallTheme: 'o', sharedThemes: [], uniqueInsights: [], contradictions: [], viewingOrder: [], bottomLine: 'b' },
          tier: 'local',
          model: 'gemma4-kb:latest',
        },
      ]),
    );

    render(<GenerateLessonPanel onGenerated={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/drop-D tuning basics/), { target: { value: 'blues turnarounds' } });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => expect(screen.getByText('Generate sections')).toBeTruthy());
    // No write request has fired yet — the approval gate held it.
    expect(streamLessonWriteSSEMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Blues turnarounds')).toBeTruthy();
    expect(screen.getByDisplayValue('Intro')).toBeTruthy();
    expect(screen.getByDisplayValue('The shape')).toBeTruthy();
  });

  it('cancelling the outline approval costs nothing further — no write request fires', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));
    streamLessonPlanSSEMock.mockReturnValue(
      asyncGenOf([
        {
          type: 'plan',
          outline: {
            title: 'Blues turnarounds',
            summary: 's',
            level: 'beginner',
            instrument: 'guitar',
            duration: null,
            sections: [{ heading: 'Intro', goal: 'g1' }],
          },
          sources: [],
          digest: { title: 't', description: 'd', overallTheme: 'o', sharedThemes: [], uniqueInsights: [], contradictions: [], viewingOrder: [], bottomLine: 'b' },
          tier: 'local',
          model: 'gemma4-kb:latest',
        },
      ]),
    );

    render(<GenerateLessonPanel onGenerated={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/drop-D tuning basics/), { target: { value: 'blues turnarounds' } });
    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => expect(screen.getByText('Cancel')).toBeTruthy());

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText('Generate sections')).toBeNull();
    expect(screen.getByPlaceholderText(/drop-D tuning basics/)).toBeTruthy();
    expect(streamLessonWriteSSEMock).not.toHaveBeenCalled();
  });

  it('presents a coverage refusal as information, not a crash', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));
    streamLessonPlanSSEMock.mockReturnValue(
      asyncGenOf([
        { type: 'coverage', covered: false, actualTopic: 'triads and harmonic movement', reason: 'no mention of barre chords' },
      ]),
    );

    render(<GenerateLessonPanel onGenerated={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/drop-D tuning basics/), { target: { value: 'barre chords' } });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => expect(screen.getByText(/doesn't actually cover/)).toBeTruthy());
    expect(screen.getByText(/triads and harmonic movement/)).toBeTruthy();
    expect(screen.getByText('Try another topic')).toBeTruthy();
  });

  it('renders a friendly error naming the failed step', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));
    streamLessonPlanSSEMock.mockReturnValue(
      asyncGenOf([{ type: 'error', step: 'retrieve', message: 'Cannot reach Strapi — is the backend running?' }]),
    );

    render(<GenerateLessonPanel onGenerated={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/drop-D tuning basics/), { target: { value: 'blues turnarounds' } });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => expect(screen.getByText(/Failed at/)).toBeTruthy());
    expect(screen.getByText(/retrieve/)).toBeTruthy();
    expect(screen.getByText(/Cannot reach Strapi/)).toBeTruthy();
  });
});
