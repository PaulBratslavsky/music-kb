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

const findLessonForVideoMock = vi.fn();
vi.mock('#/data/server-functions/lessons', () => ({
  findLessonForVideo: (...args: unknown[]) => findLessonForVideoMock(...args),
}));

import { LessonTab } from './LessonTab';

afterEach(() => {
  cleanup();
  findLessonForVideoMock.mockReset();
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

describe('LessonTab — existing lesson vs. generate form', () => {
  it('shows the existing lesson (title, summary, link) instead of the generate form when one already exists', async () => {
    findLessonForVideoMock.mockResolvedValue({
      documentId: 'lesson-1',
      title: 'The Blues Turnaround',
      slug: 'the-blues-turnaround',
      summary: 'Everything this video teaches about the turnaround shape.',
    });

    render(<LessonTab video={makeVideo()} />);

    await waitFor(() => expect(screen.getByText('The Blues Turnaround')).toBeTruthy());
    expect(
      screen.getByText('Everything this video teaches about the turnaround shape.'),
    ).toBeTruthy();
    const link = screen.getByText('Open lesson →').closest('a');
    expect(link?.getAttribute('href')).toBe('/lessons/the-blues-turnaround');

    // The generate form must NOT render alongside an existing lesson.
    expect(screen.queryByText('Generate a lesson')).toBeNull();
    expect(screen.queryByText('Turn this video into a lesson')).toBeNull();

    expect(findLessonForVideoMock).toHaveBeenCalledWith({
      data: { documentId: 'doc-1', youtubeVideoId: 'yt-1' },
    });
  });

  it('shows the generate form when no lesson exists for this video yet', async () => {
    findLessonForVideoMock.mockResolvedValue(null);

    render(<LessonTab video={makeVideo()} />);

    await waitFor(() => expect(screen.getByText('Generate a lesson')).toBeTruthy());
    expect(screen.getByText('Turn this video into a lesson')).toBeTruthy();
  });

  it('falls back to the generate form if the existing-lesson lookup itself fails', async () => {
    findLessonForVideoMock.mockRejectedValue(new Error('backend down'));

    render(<LessonTab video={makeVideo()} />);

    await waitFor(() => expect(screen.getByText('Generate a lesson')).toBeTruthy());
  });
});
