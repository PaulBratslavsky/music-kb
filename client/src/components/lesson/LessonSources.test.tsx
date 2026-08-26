// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LessonSources } from './LessonSources';
import type { LessonSourceVideo } from '#/lib/services/lessons';

// Same Link stub as LessonBody.test.tsx — avoids needing a live router
// just to assert an href.
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

// vitest here does not run `globals: true`, so RTL auto-cleanup never
// registers — match the explicit afterEach convention from LessonBody.test.tsx.
afterEach(cleanup);

const video = (overrides: Partial<LessonSourceVideo> = {}): LessonSourceVideo => ({
  documentId: 'doc-1',
  youtubeVideoId: 'vid1',
  videoTitle: 'Drop D Basics',
  videoThumbnailUrl: null,
  ...overrides,
});

describe('LessonSources', () => {
  it('renders no "Built from" section for an empty video list', () => {
    const { container } = render(<LessonSources videos={[]} />);
    expect(container.textContent).toBe('');
    expect(screen.queryByText('Built from')).toBeNull();
  });

  it('lists each distinct source video once', () => {
    render(
      <LessonSources
        videos={[
          video({ documentId: 'doc-1', youtubeVideoId: 'vid1', videoTitle: 'Video One' }),
          video({ documentId: 'doc-2', youtubeVideoId: 'vid2', videoTitle: 'Video Two' }),
        ]}
      />,
    );
    expect(screen.getByText('Built from')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(screen.getByText('Video One')).toBeTruthy();
    expect(screen.getByText('Video Two')).toBeTruthy();
  });

  it('links each source video to /learn/$videoId', () => {
    render(<LessonSources videos={[video({ youtubeVideoId: 'abc123' })]} />);
    expect(screen.getByRole('link', { name: 'Drop D Basics' }).getAttribute('href')).toBe(
      '/learn/abc123',
    );
  });

  it('opens source video links in a new tab rather than navigating away from the lesson', () => {
    render(<LessonSources videos={[video({ youtubeVideoId: 'abc123' })]} />);
    const link = screen.getByRole('link', { name: 'Drop D Basics' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
