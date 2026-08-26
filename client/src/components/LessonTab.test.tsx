// @vitest-environment jsdom
//
// Covers the brief's explicit test: "the tab shows an existing lesson
// instead of the form when one exists." The generate-flow itself (planning
// → review → writing → success) reuses the exact same fetch/SSE shape
// GenerateLessonPanel already has test coverage for in
// lessons.index.test.tsx, so this file focuses on the piece unique to
// LessonTab: the existing-lesson lookup gate.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { StrapiVideo } from '#/lib/services/videos';

vi.mock('@tanstack/react-router', () => ({
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

// Same stub LessonVideoPanel.test.tsx uses — LessonTab seeks the ALREADY
// mounted /learn player via this hook, no second player of its own.
const seekToMock = vi.fn();
vi.mock('#/components/player', () => ({
  usePlayerControl: () => ({ seekTo: seekToMock }),
}));

const findLessonForVideoMock = vi.fn();
const getLessonBySlugMock = vi.fn();
vi.mock('#/data/server-functions/lessons', () => ({
  findLessonForVideo: (...args: unknown[]) => findLessonForVideoMock(...args),
  getLessonBySlug: (...args: unknown[]) => getLessonBySlugMock(...args),
}));

import { LessonTab } from './LessonTab';

afterEach(() => {
  cleanup();
  findLessonForVideoMock.mockReset();
  getLessonBySlugMock.mockReset();
  seekToMock.mockReset();
});

function makeVideo(overrides: Partial<StrapiVideo> = {}): StrapiVideo {
  return {
    documentId: 'doc-1',
    youtubeVideoId: 'yt-1',
    videoTitle: 'How to play the blues turnaround',
    summaryTitle: 'The blues turnaround, start to finish',
    ...overrides,
  } as StrapiVideo;
}

function makeLesson(overrides: Partial<import('#/lib/services/lessons').Lesson> = {}) {
  return {
    documentId: 'lesson-1',
    title: 'The Blues Turnaround',
    slug: 'the-blues-turnaround',
    summary: 'Everything this video teaches about the turnaround shape.',
    level: 'beginner',
    instrument: 'guitar',
    order: 0,
    duration: '5 min',
    status: 'ai-generated',
    parameter: null,
    body: [{ __component: 'lesson.prose', id: 1, body: 'Fret 3 on the low E string is G.' }],
    videos: [],
    ...overrides,
  } as import('#/lib/services/lessons').Lesson;
}

describe('LessonTab — existing lesson vs. generate form', () => {
  it('renders the existing lesson inline (title, summary, body, link) instead of the generate form', async () => {
    findLessonForVideoMock.mockResolvedValue({
      documentId: 'lesson-1',
      title: 'The Blues Turnaround',
      slug: 'the-blues-turnaround',
      summary: 'Everything this video teaches about the turnaround shape.',
    });
    getLessonBySlugMock.mockResolvedValue({ ok: true, lesson: makeLesson() });

    render(<LessonTab video={makeVideo()} />);

    await waitFor(() => expect(screen.getByText('The Blues Turnaround')).toBeTruthy());
    expect(
      screen.getByText('Everything this video teaches about the turnaround shape.'),
    ).toBeTruthy();
    // The lesson body itself renders inline (LessonBody), not a link-only card.
    expect(screen.getByText('Fret 3 on the low E string is G.')).toBeTruthy();
    const link = screen.getByText('Open full lesson →').closest('a');
    expect(link?.getAttribute('href')).toBe('/lessons/the-blues-turnaround');

    // The generate form must NOT render alongside an existing lesson.
    expect(screen.queryByText('Generate a lesson')).toBeNull();
    expect(screen.queryByText('Turn this video into a lesson')).toBeNull();
    // Regenerating is reachable but not the default state.
    expect(screen.getByText('Generate another version')).toBeTruthy();

    expect(findLessonForVideoMock).toHaveBeenCalledWith({
      data: { documentId: 'doc-1', youtubeVideoId: 'yt-1' },
    });
    expect(getLessonBySlugMock).toHaveBeenCalledWith({
      data: { slug: 'the-blues-turnaround' },
    });
  });

  it('clicking a citation seeks the ALREADY-mounted /learn player, not a second one', async () => {
    findLessonForVideoMock.mockResolvedValue({
      documentId: 'lesson-1',
      title: 'The Blues Turnaround',
      slug: 'the-blues-turnaround',
      summary: null,
    });
    getLessonBySlugMock.mockResolvedValue({
      ok: true,
      lesson: makeLesson({
        body: [
          {
            __component: 'lesson.prose',
            id: 1,
            body: 'Fret 3 on the low E string is G.',
            source: { videoId: 'yt-1', timeSec: 142 },
          },
        ],
        videos: [
          { documentId: 'doc-1', youtubeVideoId: 'yt-1', videoTitle: 'How to play the turnaround', videoThumbnailUrl: null },
        ],
      }),
    });

    render(<LessonTab video={makeVideo()} />);
    await waitFor(() => expect(screen.getByText('Fret 3 on the low E string is G.')).toBeTruthy());

    // No second player mounted by this tab — usePlayerControl is the only
    // wiring, and no <iframe>/player component is rendered here.
    expect(document.querySelector('iframe')).toBeNull();

    const citationButton = screen.getByText('How to play the turnaround').closest('button');
    expect(citationButton).toBeTruthy();
    citationButton?.click();

    expect(seekToMock).toHaveBeenCalledWith(142);
  });

  it('shows the generate form when no lesson exists for this video yet', async () => {
    findLessonForVideoMock.mockResolvedValue(null);

    render(<LessonTab video={makeVideo()} />);

    await waitFor(() => expect(screen.getByText('Generate a lesson')).toBeTruthy());
    expect(screen.getByText('Turn this video into a lesson')).toBeTruthy();
    expect(getLessonBySlugMock).not.toHaveBeenCalled();
  });

  it('falls back to the generate form if the existing-lesson lookup itself fails', async () => {
    findLessonForVideoMock.mockRejectedValue(new Error('backend down'));

    render(<LessonTab video={makeVideo()} />);

    await waitFor(() => expect(screen.getByText('Generate a lesson')).toBeTruthy());
  });

  it('falls back to the generate form if the found lesson cannot be re-fetched in full', async () => {
    findLessonForVideoMock.mockResolvedValue({
      documentId: 'lesson-1',
      title: 'The Blues Turnaround',
      slug: 'the-blues-turnaround',
      summary: null,
    });
    getLessonBySlugMock.mockResolvedValue({ ok: false, status: 0, error: 'down' });

    render(<LessonTab video={makeVideo()} />);

    await waitFor(() => expect(screen.getByText('Generate a lesson')).toBeTruthy());
  });
});
