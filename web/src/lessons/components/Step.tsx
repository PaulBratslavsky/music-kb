// Lesson chrome — shared between /lessons/* pages so a step looks the
// same whether the user is on "find any chord" or any of the
// theory-fundamentals tracks. Small enough that one file holds all
// three exports.

import type { ReactNode } from 'react';

export function Step({
  number,
  title,
  lede,
  children,
}: {
  number: number;
  title: string;
  lede: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-12 max-w-5xl">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-base font-bold text-white">
          {number}
        </span>
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)] sm:text-xl">
            {title}
          </h2>
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
