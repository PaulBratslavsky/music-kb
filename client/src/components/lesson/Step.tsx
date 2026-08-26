// Lesson chrome — shared between /lessons/* pages so a step looks the
// same whether the user is on "find any chord" or any of the
// theory-fundamentals tracks. Small enough that one file holds all
// three exports.

import type { ReactNode } from 'react';

export function Step({
  number,
  title,
  lede,
  headingLevel = 'h3',
  children,
}: {
  number: number;
  title: string;
  lede: string;
  /** A step is a subsection of whatever section heading (h2 or h3) it sits
   *  under, never a sibling of it (lesson-ux brief #1): a bare `<h2>` here
   *  put every step at the same outline level as the section containing
   *  it, wrong for the document outline and for screen readers. LessonBody
   *  derives this from the nearest preceding `lesson.heading` block —
   *  'h3' under a top-level (or absent) section heading, 'h4' under an
   *  `h3` subsection — so it always nests one level deeper than its
   *  section. The visual size is unchanged; only the tag changes. */
  headingLevel?: 'h3' | 'h4';
  children: ReactNode;
}) {
  const TitleTag = headingLevel;
  return (
    <section className="mb-12 max-w-5xl">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-base font-bold text-white">
          {number}
        </span>
        <div>
          <TitleTag className="text-lg font-semibold text-[var(--ink)] sm:text-xl">
            {title}
          </TitleTag>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-soft)]">{lede}</p>
        </div>
      </div>
      <div className="ml-14">{children}</div>
    </section>
  );
}

export function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-4 text-xs text-[var(--ink-soft)]">
      {children}
    </div>
  );
}

export function Principle({
  n,
  children,
}: {
  n: number;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-xs font-bold text-[var(--ink-muted)]">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}
