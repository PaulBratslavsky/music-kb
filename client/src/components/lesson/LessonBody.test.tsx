// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LessonBody } from './LessonBody';
import type { LessonBlock, LessonSourceVideo } from '#/lib/services/lessons';

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

// RTL auto-cleanup only registers itself when vitest runs with `globals: true`;
// this config does not, so without an explicit afterEach every render in this
// file accumulates in document.body and `screen` queries match leftovers from
// earlier tests. That silently weakens every assertion here — a test can pass
// on markup a different test rendered.
afterEach(cleanup);

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
    // Lessons are self-contained — a citation must open alongside the
    // lesson, never navigate away from it in the same tab.
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
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

  it('coerces numeric degree-chips rather than throwing', () => {
    // Reproduced by review: `degrees: [1, 2, 3]` (numbers, not strings) is
    // legal for a Strapi `json` column and crashed DegreeChips.includes().
    // Numbers are the common case and stringify to exactly what the author
    // meant, so the right outcome is real chips, not an empty render.
    render(
      <LessonBody
        blocks={[
          block({ __component: 'lesson.degree-chips', degrees: [1, 2, 3] as unknown as string[] }),
        ]}
        parameter={null}
      />,
    );
    for (const d of ['1', '2', '3']) {
      expect(screen.getByText(d)).toBeTruthy();
    }
  });

  it('renders object-shaped degrees as visible garbage rather than crashing', () => {
    // The honest limit of the coercion: `.map(String)` on an object yields
    // "[object Object]". That is deliberate — a visibly wrong chip is a
    // better failure than an SSR 500 that takes the whole lesson down, and
    // it is legible to whoever has to debug the generated lesson. Pinned so
    // nobody "fixes" it into a silent drop, which would hide the bad data.
    render(
      <LessonBody
        blocks={[
          block({
            __component: 'lesson.degree-chips',
            degrees: [{ a: 'x' }] as unknown as string[],
          }),
        ]}
        parameter={null}
      />,
    );
    expect(screen.getByText('[object Object]')).toBeTruthy();
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

  // The four NeckDot style flags are what let one diagram carry two layers
  // of meaning (scale tones under chord tones). They were declared on
  // MiniNeck from the start but absent from lesson.neck-dot's schema, so no
  // authored lesson could reach them — the mirror image of this branch's
  // declared-but-unrendered fields. These assert the whole path: block JSON
  // → resolveDiagramDots → MiniNeck → distinct SVG treatment.
  describe('explicit-diagram dot styles', () => {
    const renderDots = (dots: Record<string, unknown>[]) =>
      render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.diagram',
              instrument: 'guitar',
              mode: 'explicit',
              fromFret: 5,
              toFret: 9,
              dots: dots as never,
            }),
          ]}
          parameter={null}
        />,
      ).container;

    it('draws a hollow dot as an outlined ring, not a filled disc', () => {
      const container = renderDots([{ string: 0, fret: 7, hollow: true }]);
      const circles = [...container.querySelectorAll('circle')];
      const hollow = circles.find((c) => c.getAttribute('stroke') === 'var(--ink-muted)');
      expect(hollow, 'no hollow dot rendered').toBeTruthy();
      expect(hollow?.getAttribute('fill')).toBe('var(--card)');
    });

    it('draws a ringed dot with an accent halo in addition to the dot itself', () => {
      const plain = renderDots([{ string: 0, fret: 7 }]);
      const plainCount = plain.querySelectorAll('circle').length;
      cleanup();
      const ringed = renderDots([{ string: 0, fret: 7, ringed: true }]);
      const circles = [...ringed.querySelectorAll('circle')];
      expect(circles.length).toBe(plainCount + 1);
      expect(circles.some((c) => c.getAttribute('stroke') === 'var(--accent)')).toBe(true);
    });

    it('draws a light dot as a cut-out — light fill, dark outline', () => {
      const container = renderDots([{ string: 0, fret: 7, light: true, label: '3' }]);
      const cutout = [...container.querySelectorAll('circle')].find(
        (c) => c.getAttribute('stroke') === 'var(--ink)',
      );
      expect(cutout, 'no cut-out dot rendered').toBeTruthy();
      expect(cutout?.getAttribute('fill')).toBe('var(--card)');
    });

    it('fades a dimmed dot', () => {
      const container = renderDots([{ string: 0, fret: 7, dim: true }]);
      expect(container.querySelector('g[opacity="0.22"]')).toBeTruthy();
    });
  });

  describe('lesson.chord-diagram', () => {
    // Strings are addressed by their own index, so order in the array is
    // not load-bearing — this fixture is deliberately shuffled.
    const cMajor = [
      { string: 5, state: 'muted' },
      { string: 2, state: 'open' },
      { string: 0, state: 'open' },
      { string: 4, state: 'fretted', fret: 3, root: true },
      { string: 3, state: 'fretted', fret: 2 },
      { string: 1, state: 'fretted', fret: 1 },
    ];

    it('renders a chord box with a dot per fretted string', () => {
      const { container } = render(
        <LessonBody
          blocks={[block({ __component: 'lesson.chord-diagram', strings: cMajor as never })]}
          parameter={null}
        />,
      );
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      // Three fretted strings → three dots (r=6.5 is the fingered-dot radius).
      expect(container.querySelectorAll('circle[r="6.5"]')).toHaveLength(3);
      // The root dot gets the accent fill.
      expect(
        [...container.querySelectorAll('circle[r="6.5"]')].filter(
          (c) => c.getAttribute('fill') === 'var(--accent)',
        ),
      ).toHaveLength(1);
    });

    it('marks open strings O and muted strings ×', () => {
      render(
        <LessonBody
          blocks={[block({ __component: 'lesson.chord-diagram', strings: cMajor as never })]}
          parameter={null}
        />,
      );
      expect(screen.getAllByText('O')).toHaveLength(2);
      expect(screen.getAllByText('×')).toHaveLength(1);
    });

    it('draws a barre when all three barre fields are present', () => {
      const { container } = render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.chord-diagram',
              strings: [
                { string: 0, state: 'fretted', fret: 5 },
                { string: 1, state: 'fretted', fret: 5 },
                { string: 2, state: 'fretted', fret: 6 },
                { string: 3, state: 'fretted', fret: 7 },
                { string: 4, state: 'fretted', fret: 7 },
                { string: 5, state: 'fretted', fret: 5, root: true },
              ] as never,
              barreFret: 5,
              barreFromString: 0,
              barreToString: 5,
              caption: 'A minor barre at the 5th',
            }),
          ]}
          parameter={null}
        />,
      );
      expect(container.querySelector('rect[rx="5"]')).toBeTruthy();
      expect(screen.getByText('A minor barre at the 5th')).toBeTruthy();
      // Up the neck → a position label instead of a nut.
      expect(screen.getByText('5fr')).toBeTruthy();
    });

    it('renders nothing when no string is played rather than an empty box', () => {
      const { container } = render(
        <LessonBody
          blocks={[block({ __component: 'lesson.chord-diagram', strings: [] as never })]}
          parameter={null}
        />,
      );
      expect(container.querySelector('svg')).toBeNull();
    });
  });

  describe('lesson.natural-notes', () => {
    it('renders the fixed reference strip and its caption', () => {
      const { container } = render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.natural-notes',
              caption: 'Learn these 14 and every root is one fret away.',
            }),
          ]}
          parameter={null}
        />,
      );
      expect(
        container.querySelector('svg[aria-label="Natural notes on the low E and A strings"]'),
      ).toBeTruthy();
      expect(screen.getByText('Learn these 14 and every root is one fret away.')).toBeTruthy();
    });
  });

  describe('lesson.neck-pattern', () => {
    const patterns = [
      { label: 'Box 1', sub: 'frets 5–8', dots: [{ string: 5, fret: 5, root: true }] },
      { label: 'Box 2', sub: 'frets 7–10', dots: [{ string: 5, fret: 8 }] },
    ];

    it('renders one pill per pattern over a single shared neck', () => {
      const { container } = render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.neck-pattern',
              instrument: 'guitar',
              patterns: patterns as never,
              fromFret: 3,
              toFret: 12,
            }),
          ]}
          parameter={null}
        />,
      );
      expect(screen.getByRole('button', { name: 'Box 1' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Box 2' })).toBeTruthy();
      // One diagram, not one per pattern — that is the whole point.
      expect(container.querySelectorAll('svg')).toHaveLength(1);
      expect(screen.getByText('frets 5–8')).toBeTruthy();
    });

    it('swaps the diagram when another pattern is picked', () => {
      render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.neck-pattern',
              patterns: patterns as never,
              fromFret: 3,
              toFret: 12,
            }),
          ]}
          parameter={null}
        />,
      );
      expect(screen.getByRole('button', { name: 'Box 1' }).getAttribute('aria-pressed')).toBe(
        'true',
      );
      fireEvent.click(screen.getByRole('button', { name: 'Box 2' }));
      expect(screen.getByRole('button', { name: 'Box 2' }).getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(screen.getByText('frets 7–10')).toBeTruthy();
    });

    it('renders nothing for a single pattern — that is a lesson.diagram', () => {
      const { container } = render(
        <LessonBody
          blocks={[
            block({ __component: 'lesson.neck-pattern', patterns: [patterns[0]] as never }),
          ]}
          parameter={null}
        />,
      );
      expect(container.querySelector('svg')).toBeNull();
    });
  });

  describe('source citations', () => {
    const knownVideo: LessonSourceVideo = {
      documentId: 'doc-1',
      youtubeVideoId: 'vid123',
      videoTitle: 'Drop D Basics',
      videoThumbnailUrl: null,
    };

    it('renders a link to the right video at the right time', () => {
      render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.prose',
              body: 'some claim',
              source: { videoId: 'vid123', timeSec: 42 },
            }),
          ]}
          parameter={null}
          sourceVideos={[knownVideo]}
        />,
      );
      const link = screen.getByRole('link', { name: 'Drop D Basics' });
      expect(link.getAttribute('href')).toBe('/learn/vid123?t=42');
      // Citations open alongside the lesson, never in place of it.
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it('renders without a timestamp and does not link to t=undefined when timeSec is absent', () => {
      render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.callout',
              tone: 'note',
              body: 'some claim',
              source: { videoId: 'vid123' },
            }),
          ]}
          parameter={null}
          sourceVideos={[knownVideo]}
        />,
      );
      const link = screen.getByRole('link', { name: 'Drop D Basics' });
      expect(link.getAttribute('href')).toBe('/learn/vid123');
      expect(link.getAttribute('href')).not.toContain('undefined');
    });

    it('does not render a broken link for a video outside the lesson source set', () => {
      const { container } = render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.step',
              number: 1,
              title: 'Step one',
              lede: 'lede',
              body: 'body text',
              source: { videoId: 'not-in-lesson', timeSec: 10 },
            }),
          ]}
          parameter={null}
          sourceVideos={[knownVideo]}
        />,
      );
      expect(container.querySelectorAll('a')).toHaveLength(0);
    });

    it('renders nothing when no sourceVideos are supplied at all', () => {
      const { container } = render(
        <LessonBody
          blocks={[
            block({
              __component: 'lesson.prose',
              body: 'some claim',
              source: { videoId: 'vid123', timeSec: 42 },
            }),
          ]}
          parameter={null}
        />,
      );
      expect(container.querySelectorAll('a')).toHaveLength(0);
    });
  });
});
