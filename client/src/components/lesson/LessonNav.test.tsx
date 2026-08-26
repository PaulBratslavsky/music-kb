// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LessonNav, deriveNavEntries } from './LessonNav';
import { headingAnchorId } from './LessonBody';
import type { LessonBlock } from '#/lib/services/lessons';

// See LessonBody.test.tsx's own comment: RTL auto-cleanup needs
// `globals: true`, which this vitest config does not set.
afterEach(cleanup);

const heading = (id: number, text: string, level: 'h2' | 'h3' = 'h2'): LessonBlock =>
  ({ __component: 'lesson.heading', id, text, level }) as unknown as LessonBlock;

const prose = (id: number): LessonBlock =>
  ({ __component: 'lesson.prose', id, body: 'some text' }) as unknown as LessonBlock;

describe('deriveNavEntries', () => {
  it('derives entries only from lesson.heading blocks, in order', () => {
    const entries = deriveNavEntries([
      heading(1, 'Intro'),
      prose(2),
      heading(3, 'Subsection', 'h3'),
      heading(4, 'Next section'),
    ]);
    expect(entries).toEqual([
      { id: headingAnchorId(1), text: 'Intro', level: 'h2' },
      { id: headingAnchorId(3), text: 'Subsection', level: 'h3' },
      { id: headingAnchorId(4), text: 'Next section', level: 'h2' },
    ]);
  });

  it('drops a heading with empty text rather than rendering a blank link', () => {
    const entries = deriveNavEntries([heading(1, ''), heading(2, 'Real heading')]);
    expect(entries).toEqual([{ id: headingAnchorId(2), text: 'Real heading', level: 'h2' }]);
  });
});

describe('LessonNav', () => {
  it('renders nothing for a lesson with fewer than two top-level sections', () => {
    const { container } = render(<LessonNav blocks={[heading(1, 'Only section')]} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing for a lesson with no headings at all', () => {
    const { container } = render(<LessonNav blocks={[prose(1)]} />);
    expect(container.textContent).toBe('');
  });

  it('renders a jump link per heading, pointing at the same anchor LessonBody assigns', () => {
    render(
      <LessonNav
        blocks={[heading(1, 'First section'), prose(2), heading(3, 'Second section')]}
      />,
    );
    const first = screen.getByRole('link', { name: 'First section' });
    const second = screen.getByRole('link', { name: 'Second section' });
    expect(first.getAttribute('href')).toBe(`#${headingAnchorId(1)}`);
    expect(second.getAttribute('href')).toBe(`#${headingAnchorId(3)}`);
  });

  it('is collapsible via a native <details> element', () => {
    const { container } = render(
      <LessonNav blocks={[heading(1, 'A'), heading(2, 'B')]} />,
    );
    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(screen.getByText('On this page')).toBeTruthy();
  });
});
