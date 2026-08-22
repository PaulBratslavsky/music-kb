// @vitest-environment jsdom
//
// Only StatusBadge is exercised directly here — rendering the full
// LessonsIndexPage needs a live TanStack Router context for
// Route.useLoaderData(), which is more machinery than this one badge is
// worth setting up (see LessonBody.test.tsx for the same reasoning on the
// Link mock, not needed here since StatusBadge renders no links).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StatusBadge } from './lessons.index';

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
