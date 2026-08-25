// Table of contents for a lesson (lesson-ux brief #3) — a 60-80 block
// lesson had no way to see its own shape or jump between sections. Derived
// from the lesson's own `lesson.heading` blocks, never asked of the model:
// the headings already exist and are the one thing in the body that
// legitimately describes the lesson's shape.
//
// Deliberately INLINE, not sticky. A two-column layout is queued next
// (.superpowers/sdd/lesson-two-col/brief.md) with a sticky video panel on
// the right; a second sticky element in the content column competing for
// scroll-anchored space would just have to be torn out the moment that
// lands. This renders once, at the top of the content column, and scrolls
// away with the rest of the lesson like any other block.
//
// The collapse is a native <details>/<summary> — no client state, so no
// SSR/hydration mismatch (docs/ssr-client-fallback.md) and no viewport
// media-query guesswork: it is the same collapsible affordance at any
// width, open by default so the shape is visible immediately, and a tap
// away from getting out of a reader's way on a phone.

import type { LessonBlock } from '#/lib/services/lessons';
import { headingAnchorId } from './LessonBody';

type NavEntry = { id: string; text: string; level: 'h2' | 'h3' };

/** Exported for direct testing, same reasoning as the other small pure
 *  helpers in LessonBody.tsx (deriveSectionLevels, headingAnchorId). */
export function deriveNavEntries(blocks: LessonBlock[]): NavEntry[] {
  const entries: NavEntry[] = [];
  for (const b of blocks) {
    if (b.__component !== 'lesson.heading') continue;
    const text = typeof b.text === 'string' ? b.text.trim() : '';
    if (!text) continue;
    entries.push({
      id: headingAnchorId(b.id),
      text,
      level: b.level === 'h3' ? 'h3' : 'h2',
    });
  }
  return entries;
}

export function LessonNav({ blocks }: Readonly<{ blocks: LessonBlock[] }>) {
  const entries = deriveNavEntries(blocks);
  // A single top-level section isn't a "shape" worth mapping — one link
  // back to the top of the page the reader is already on is noise, not
  // orientation. Two h2 sections and up is where "where am I in this"
  // starts to matter.
  const sectionCount = entries.filter((e) => e.level === 'h2').length;
  if (sectionCount < 2) return null;

  return (
    <nav
      aria-label="Lesson sections"
      className="mb-10 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3"
    >
      <details open>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          On this page
        </summary>
        <ol className="mt-3 flex flex-col gap-1.5 text-sm">
          {entries.map((e) => (
            <li key={e.id} className={e.level === 'h3' ? 'ml-4' : undefined}>
              <a
                href={`#${e.id}`}
                className="text-[var(--ink-soft)] hover:text-[var(--accent)] hover:underline"
              >
                {e.text}
              </a>
            </li>
          ))}
        </ol>
      </details>
    </nav>
  );
}
