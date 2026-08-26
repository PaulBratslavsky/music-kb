// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LessonVideoPanel, lessonHasVideoPanel } from './LessonVideoPanel';
import type { LessonBlock, LessonSourceVideo } from '#/lib/services/lessons';

// The real player module pulls in react-player, which mounts a YouTube
// iframe — nothing jsdom can meaningfully run. Stubbed down to a marker
// that records the two props that carry the whole point of this feature:
// WHICH video and WHICH second. There is no second, non-stubbed rendering
// path in the panel — the app renders exactly this component with exactly
// these props.
vi.mock('#/components/player', () => ({
  PlayerProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  YouTubePlayer: ({ videoId, startSec }: { videoId: string; startSec?: number }) => (
    <div data-testid="player" data-video-id={videoId} data-start-sec={String(startSec)} />
  ),
  usePlayerControl: () => ({ seekTo: () => {} }),
}));

// Same Link stub as the other lesson component tests — avoids needing a
// live router just to assert an href.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string | number>;
    children?: ReactNode;
  }) => {
    const path = to.replace(/\$([a-zA-Z0-9_]+)/g, (_, key) => String(params?.[key] ?? ''));
    const qs = search
      ? `?${Object.entries(search)
          .map(([k, v]) => `${k}=${v}`)
          .join('&')}`
      : '';
    return (
      <a href={`${path}${qs}`} {...rest}>
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

const block = (b: Partial<LessonBlock> & { __component: string }): LessonBlock =>
  ({ id: 1, ...b }) as LessonBlock;

const noop = () => {};

describe('lessonHasVideoPanel', () => {
  it('is true when the lesson resolved any source video', () => {
    expect(lessonHasVideoPanel([], [video()])).toBe(true);
  });

  it('is false for a lesson with no sources and nothing citable', () => {
    expect(
      lessonHasVideoPanel([block({ __component: 'lesson.prose', body: 'hi' })], []),
    ).toBe(false);
  });

  it('is true for a video-ref block even with an empty videos relation', () => {
    // A video-ref renders off its own videoId and never consults the
    // lesson's source set — miss this and the block renders a button
    // wired to a panel that was never mounted: a click that does nothing,
    // silently.
    expect(
      lessonHasVideoPanel(
        [block({ __component: 'lesson.video-ref', videoId: 'abc123' })],
        [],
      ),
    ).toBe(true);
  });

  it('ignores a video-ref with no usable videoId', () => {
    expect(
      lessonHasVideoPanel([block({ __component: 'lesson.video-ref', videoId: '' })], []),
    ).toBe(false);
  });
});

describe('LessonVideoPanel', () => {
  it('defaults to the lesson source list, with no player, when nothing is selected', () => {
    render(
      <LessonVideoPanel
        videos={[
          video({ documentId: 'doc-1', youtubeVideoId: 'vid1', videoTitle: 'Video One' }),
          video({ documentId: 'doc-2', youtubeVideoId: 'vid2', videoTitle: 'Video Two' }),
        ]}
        selection={null}
        onSelect={noop}
        onClear={noop}
        onReturnToCitation={noop}
      />,
    );
    expect(screen.queryByTestId('player')).toBeNull();
    expect(screen.getByText('Sources')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Video One/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Video Two/ })).toBeTruthy();
  });

  it('loads the selected video at the selected second', () => {
    render(
      <LessonVideoPanel
        videos={[video({ youtubeVideoId: 'vid1' })]}
        selection={{ videoId: 'vid1', timeSec: 42, seq: 1 }}
        onSelect={noop}
        onClear={noop}
        onReturnToCitation={noop}
      />,
    );
    const player = screen.getByTestId('player');
    expect(player.getAttribute('data-video-id')).toBe('vid1');
    expect(player.getAttribute('data-start-sec')).toBe('42');
    expect(screen.getByText('Playing from 0:42')).toBeTruthy();
  });

  it('loads at 0 — and never at undefined — for a citation with no grounded time', () => {
    render(
      <LessonVideoPanel
        videos={[video({ youtubeVideoId: 'vid1' })]}
        selection={{ videoId: 'vid1', seq: 1 }}
        onSelect={noop}
        onClear={noop}
        onReturnToCitation={noop}
      />,
    );
    expect(screen.getByTestId('player').getAttribute('data-start-sec')).toBe('0');
    // Says so out loud rather than implying a timestamp it does not have.
    expect(screen.getByText(/No grounded timestamp/)).toBeTruthy();
  });

  it('keeps an explicit way out to YouTube at the grounded second', () => {
    render(
      <LessonVideoPanel
        videos={[video({ youtubeVideoId: 'vid1' })]}
        selection={{ videoId: 'vid1', timeSec: 42, seq: 1 }}
        onSelect={noop}
        onClear={noop}
        onReturnToCitation={noop}
      />,
    );
    const out = screen.getByRole('link', { name: 'Open on YouTube' });
    expect(out.getAttribute('href')).toBe('https://www.youtube.com/watch?v=vid1&t=42s');
    expect(out.getAttribute('target')).toBe('_blank');
    expect(out.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not link out to t=undefined when the citation had no timestamp', () => {
    render(
      <LessonVideoPanel
        videos={[video({ youtubeVideoId: 'vid1' })]}
        selection={{ videoId: 'vid1', seq: 1 }}
        onSelect={noop}
        onClear={noop}
        onReturnToCitation={noop}
      />,
    );
    for (const name of ['Open on YouTube', 'Open in library']) {
      const href = screen.getByRole('link', { name }).getAttribute('href') ?? '';
      expect(href).not.toContain('undefined');
    }
  });

  it('marks the source that is playing', () => {
    render(
      <LessonVideoPanel
        videos={[
          video({ documentId: 'doc-1', youtubeVideoId: 'vid1', videoTitle: 'Video One' }),
          video({ documentId: 'doc-2', youtubeVideoId: 'vid2', videoTitle: 'Video Two' }),
        ]}
        selection={{ videoId: 'vid2', timeSec: 10, seq: 1 }}
        onSelect={noop}
        onClear={noop}
        onReturnToCitation={noop}
      />,
    );
    expect(
      screen.getByRole('button', { name: /Video One/ }).getAttribute('aria-current'),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: /Video Two/ }).getAttribute('aria-current'),
    ).toBe('true');
  });

  it('selects a video from the source list', () => {
    const onSelect = vi.fn();
    render(
      <LessonVideoPanel
        videos={[video({ youtubeVideoId: 'vid1', videoTitle: 'Video One' })]}
        selection={null}
        onSelect={onSelect}
        onClear={noop}
        onReturnToCitation={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Video One/ }));
    expect(onSelect).toHaveBeenCalledWith('vid1');
  });

  it('still plays a citation for a video outside the resolved source set', () => {
    // A lesson.video-ref on an older lesson with an empty `videos`
    // relation. The title is unknown; the video must still play rather
    // than the panel rendering a blank card.
    render(
      <LessonVideoPanel
        videos={[]}
        selection={{ videoId: 'orphan1', timeSec: 5, seq: 1 }}
        onSelect={noop}
        onClear={noop}
        onReturnToCitation={noop}
      />,
    );
    expect(screen.getByTestId('player').getAttribute('data-video-id')).toBe('orphan1');
    expect(screen.getByText('orphan1')).toBeTruthy();
  });

  it('clears back to the source list', () => {
    const onClear = vi.fn();
    render(
      <LessonVideoPanel
        videos={[video({ youtubeVideoId: 'vid1' })]}
        selection={{ videoId: 'vid1', timeSec: 42, seq: 1 }}
        onSelect={noop}
        onClear={onClear}
        onReturnToCitation={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClear).toHaveBeenCalled();
  });
});
