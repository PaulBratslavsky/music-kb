// @vitest-environment jsdom
//
// Covers the two bugs reported against the shared progress panel:
//  - an event whose renderer produces null content used to still get
//    wrapped in a bordered `<li>`, showing as an empty grey box (the
//    `/api/lesson-plan(-video)` `plan` frame, before both callers stopped
//    pushing it into `events` — this test guards the panel itself, in case
//    a future event type does the same thing)
//  - "Writing each section…" looked frozen through the illustrate/ground/
//    save tail because the derivation only looked at the LAST event, which
//    can lag behind (or, worse, sit on 'section' for the whole gap before
//    the first 'illustrate' event lands)

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { deriveWriteStage, ProgressStepList } from './LessonProgressPanel';
import type { LessonProgressEvent } from '#/lib/services/lesson-generation';

afterEach(cleanup);

describe('ProgressStepList — an event with nothing to render draws no box', () => {
  it('skips the <li> entirely for an event type its renderer returns null for', () => {
    const events = [
      { type: 'tier', tier: 'frontier', model: 'claude-sonnet-5' },
      // No case in renderProgressEvent's switch handles this — same shape
      // as the `plan` terminal frame that used to leak into `events`.
      { type: 'plan', outline: {}, sources: [], digest: {}, tier: 'frontier', model: 'x' },
      { type: 'outline', title: 'A lesson', level: 'beginner', sections: ['Intro'] },
    ] as unknown as LessonProgressEvent[];

    const { container } = render(<ProgressStepList events={events} />);

    // Exactly two TOP-LEVEL <li> (the outline event's own nested <ol> of
    // section headings adds more <li>s below that don't count here) — the
    // unrenderable middle event produced none at all, not an empty
    // bordered box between the other two.
    const topLevelSteps = container.querySelectorAll(':scope > ol > li');
    expect(topLevelSteps).toHaveLength(2);
    expect(screen.getByText(/claude-sonnet-5/)).toBeTruthy();
    expect(screen.getByText(/Outline ready/)).toBeTruthy();
  });
});

describe('deriveWriteStage — structural stage, not "last event seen"', () => {
  it('starts on the sections stage', () => {
    expect(deriveWriteStage([])).toBe('Writing each section…');
  });

  it('advances to "sections finished" the instant the last section reports index+1===total — before any illustrate event arrives', () => {
    const events: LessonProgressEvent[] = [
      { type: 'section', index: 0, total: 2, heading: 'A', blocks: 3 },
      { type: 'section', index: 1, total: 2, heading: 'B', blocks: 2 },
    ];
    expect(deriveWriteStage(events)).toBe('Sections finished — choosing diagrams next…');
  });

  it('does not advance past "writing" for a non-final section', () => {
    const events: LessonProgressEvent[] = [
      { type: 'section', index: 0, total: 2, heading: 'A', blocks: 3 },
    ];
    expect(deriveWriteStage(events)).toBe('Writing each section…');
  });

  it('advances to illustrating once an illustrate event lands', () => {
    const events: LessonProgressEvent[] = [
      { type: 'section', index: 0, total: 1, heading: 'A', blocks: 3 },
      { type: 'illustrate', index: 0, total: 1, heading: 'A', diagrams: 2 },
    ];
    expect(deriveWriteStage(events)).toBe('Choosing diagrams for each section…');
  });

  it('advances to the saving stage once grounding is reported', () => {
    const events: LessonProgressEvent[] = [
      { type: 'section', index: 0, total: 1, heading: 'A', blocks: 3 },
      { type: 'illustrate', index: 0, total: 1, heading: 'A', diagrams: 0 },
      { type: 'grounding', grounded: 3, total: 3 },
    ];
    expect(deriveWriteStage(events)).toBe('Grounding citations and saving the lesson…');
  });

  it('never regresses — a retry on an earlier section after illustration has started does not undo the stage', () => {
    const events: LessonProgressEvent[] = [
      { type: 'section', index: 0, total: 2, heading: 'A', blocks: 3 },
      { type: 'section', index: 1, total: 2, heading: 'B', blocks: 2 },
      { type: 'illustrate', index: 0, total: 2, heading: 'A', diagrams: 1 },
      // A stray retry event carries no stage information at all — it must
      // not reset the derivation to the default "sections" case.
      { type: 'retry', step: 'illustrate', attempt: 2, reason: 'network blip', label: 'B' },
    ];
    expect(deriveWriteStage(events)).toBe('Choosing diagrams for each section…');
  });

  it('ignores notice events when deriving the stage', () => {
    const events: LessonProgressEvent[] = [
      { type: 'section', index: 0, total: 1, heading: 'A', blocks: 3 },
      { type: 'notice', step: 'citation', message: 'one paragraph auto-grounded' },
    ];
    expect(deriveWriteStage(events)).toBe('Sections finished — choosing diagrams next…');
  });
});
