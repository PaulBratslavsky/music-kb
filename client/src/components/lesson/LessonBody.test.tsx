// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LessonBody } from './LessonBody';
import type { LessonBlock } from '#/lib/services/lessons';

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
});
