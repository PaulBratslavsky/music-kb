// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LessonBody } from './LessonBody';
import type { LessonBlock } from '#/lib/services/lessons';

// LessonBody's video-ref block renders a TanStack `Link`, which needs a
// live RouterProvider to resolve `useRouter()` — overkill for a unit test
// of block rendering. Stub it down to the plain <a> it produces, matching
// how strapi-client is mocked elsewhere in this suite.
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
    search?: Record<string, string | number> | undefined;
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

const block = (b: Partial<LessonBlock> & { __component: string }): LessonBlock =>
  ({ id: 1, ...b }) as LessonBlock;

describe('LessonBody', () => {
  it('renders a prose block', () => {
    render(
      <LessonBody
        blocks={[block({ __component: 'lesson.prose', body: 'hello world' })]}
        parameter={null}
      />,
    );
    expect(screen.getByText(/hello world/)).toBeTruthy();
  });

  it('renders a heading block at the requested level', () => {
    render(
      <LessonBody
        blocks={[block({ __component: 'lesson.heading', text: 'Part one', level: 'h2' })]}
        parameter={null}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Part one' })).toBeTruthy();
  });

  it('renders a video-ref block as a link into the player', () => {
    render(
      <LessonBody
        blocks={[
          block({
            __component: 'lesson.video-ref',
            videoId: 'abc123',
            timeSec: 90,
            label: 'See it played',
          }),
        ]}
        parameter={null}
      />,
    );
    const link = screen.getByRole('link', { name: 'See it played' });
    expect(link.getAttribute('href')).toBe('/learn/abc123?t=90');
  });

  it('renders nothing for an unknown block instead of throwing', () => {
    const { container } = render(
      <LessonBody
        blocks={[block({ __component: 'lesson.does-not-exist' })]}
        parameter={null}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders a lesson.keyboard-diagram block', () => {
    const { container } = render(
      <LessonBody
        blocks={[
          block({
            __component: 'lesson.keyboard-diagram',
            mode: 'theory',
            root: 'C',
            quality: 'major',
          }),
        ]}
        parameter={null}
      />,
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders the blocks it knows even when an unknown one is present', () => {
    render(
      <LessonBody
        blocks={[
          block({ __component: 'lesson.does-not-exist' }),
          block({ __component: 'lesson.prose', body: 'still here' }),
        ]}
        parameter={null}
      />,
    );
    expect(screen.getByText(/still here/)).toBeTruthy();
  });

  it('renders the caption for a fretboard diagram block', () => {
    render(
      <LessonBody
        blocks={[
          block({
            __component: 'lesson.diagram',
            instrument: 'guitar',
            mode: 'explicit',
            caption: 'The low E string, nut to 12th fret.',
            dots: [{ string: 5, fret: 0, root: true }],
          }),
        ]}
        parameter={null}
      />,
    );
    expect(screen.getByText('The low E string, nut to 12th fret.')).toBeTruthy();
  });

  it('renders the caption for a keyboard-diagram block', () => {
    render(
      <LessonBody
        blocks={[
          block({
            __component: 'lesson.keyboard-diagram',
            mode: 'theory',
            root: 'C',
            quality: 'major',
            caption: 'C major triad on the keyboard',
          }),
        ]}
        parameter={null}
      />,
    );
    expect(screen.getByText('C major triad on the keyboard')).toBeTruthy();
  });

  it('renders the caption for a table block', () => {
    render(
      <LessonBody
        blocks={[
          block({
            __component: 'lesson.table',
            headers: ['A'],
            rows: [['1']],
            caption: 'Counting up from an open low E.',
          }),
        ]}
        parameter={null}
      />,
    );
    expect(screen.getByText('Counting up from an open low E.')).toBeTruthy();
  });

  it('gives note/tip/warning callouts distinct, labelled treatment', () => {
    render(
      <LessonBody
        blocks={[
          { ...block({ __component: 'lesson.callout', tone: 'note', body: 'a note' }), id: 1 },
          { ...block({ __component: 'lesson.callout', tone: 'tip', body: 'a tip' }), id: 2 },
          { ...block({ __component: 'lesson.callout', tone: 'warning', body: 'a warning' }), id: 3 },
        ]}
        parameter={null}
      />,
    );
    expect(screen.getByText('Note')).toBeTruthy();
    expect(screen.getByText('Tip')).toBeTruthy();
    expect(screen.getByText('Warning')).toBeTruthy();
  });

  it('degrades degree-chips to an empty render instead of throwing on a malformed json field', () => {
    // Reproduced by review: `degrees: [1, 2, 3]` (numbers, not strings) is
    // legal for a Strapi `json` column and crashes DegreeChips.includes().
    const { container } = render(
      <LessonBody
        blocks={[
          block({ __component: 'lesson.degree-chips', degrees: [1, 2, 3] as unknown as string[] }),
        ]}
        parameter={null}
      />,
    );
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('degrades a table to an empty render instead of throwing on malformed headers/rows', () => {
    // Reproduced by review: `rows: [{ a: 'x' }]` crashes row.map(); a
    // non-array `headers` crashes headers.map().
    const { container } = render(
      <LessonBody
        blocks={[
          block({
            __component: 'lesson.table',
            headers: 'not-an-array' as unknown as string[],
            rows: [{ a: 'x' }] as unknown as string[][],
          }),
        ]}
        parameter={null}
      />,
    );
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelectorAll('th')).toHaveLength(0);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  });
});
