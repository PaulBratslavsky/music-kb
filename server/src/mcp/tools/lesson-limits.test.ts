// The MCP lesson write tools enforce the same runaway limits and neck bounds
// as the app's markdown parser (issue #10).
//
// Before this, the two paths disagreed: the client parser capped tables,
// degree chips, labels and dot lists, and dropped any dot drawn off the neck —
// but the MCP schema capped none of those and let a bass diagram put dots on
// strings 4 and 5, or at fret 30. Such a block saved, then rendered outside the
// board where nobody could see it.
//
// The client DROPS or TRUNCATES; the server REJECTS, with a message naming the
// limit. A model calling a tool can fix its input, and a rejection it can read
// is strictly more useful than content silently cut short.
//
// Each limit is checked AT the limit (accepted) and one PAST it (rejected), so
// the boundary itself is pinned, not just "large is bad". The numbers are
// hand-copied from the client and kept equal by
// client/src/lib/lesson/lesson-limits-parity.test.ts.
import { describe, expect, it } from 'vitest';
import { LESSON_LIMITS, NECK_MAX_FRET, NECK_STRING_COUNT, lessonBlockSchema } from './lesson-blocks';

const parse = (block: unknown) => lessonBlockSchema.safeParse(block);
const messages = (r: { success: boolean; error?: any }) =>
  r.success ? '' : r.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('\n');

/** `n` distinct on-neck guitar positions, strings 0–5 then frets upward. */
const guitarDots = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ string: i % 6, fret: Math.floor(i / 6) }));

describe('neck bounds, instrument-aware', () => {
  const diagram = (instrument: 'guitar' | 'bass', dot: { string: number; fret: number }) =>
    parse({ __component: 'lesson.diagram', mode: 'explicit', instrument, dots: [dot] });

  it('guitar: the top fret is on the board, one past it is not', () => {
    expect(diagram('guitar', { string: 0, fret: NECK_MAX_FRET.guitar }).success).toBe(true);
    const off = diagram('guitar', { string: 0, fret: NECK_MAX_FRET.guitar + 1 });
    expect(off.success).toBe(false);
    expect(messages(off)).toMatch(/off a guitar neck/);
  });

  it('bass: four strings and a shorter board', () => {
    expect(diagram('bass', { string: NECK_STRING_COUNT.bass - 1, fret: 0 }).success).toBe(true);
    expect(diagram('bass', { string: NECK_STRING_COUNT.bass, fret: 0 }).success).toBe(false);
    expect(diagram('bass', { string: 0, fret: NECK_MAX_FRET.bass }).success).toBe(true);
    const off = diagram('bass', { string: 0, fret: NECK_MAX_FRET.bass + 1 });
    expect(off.success).toBe(false);
    expect(messages(off)).toMatch(/off a bass neck/);
  });

  it('a string index that is fine on guitar is off a bass', () => {
    // The exact failure: string 5 is low E on a guitar and nothing on a bass.
    expect(diagram('guitar', { string: 5, fret: 3 }).success).toBe(true);
    expect(diagram('bass', { string: 5, fret: 3 }).success).toBe(false);
  });

  it('neck-pattern dots are held to the same bounds', () => {
    const pattern = (dot: { string: number; fret: number }) =>
      parse({
        __component: 'lesson.neck-pattern',
        instrument: 'bass',
        patterns: [
          { label: 'Position 1', dots: [{ string: 0, fret: 1 }] },
          { label: 'Position 2', dots: [dot] },
        ],
      });
    expect(pattern({ string: 3, fret: 5 }).success).toBe(true);
    const off = pattern({ string: 4, fret: 5 });
    expect(off.success).toBe(false);
    expect(messages(off)).toMatch(/off a bass neck/);
  });
});

describe('runaway limits match the client parser', () => {
  it('table: headers and rows', () => {
    const headers = (n: number) => Array.from({ length: n }, (_, i) => `h${i}`);
    const table = (cols: number, rows: number) =>
      parse({
        __component: 'lesson.table',
        headers: headers(cols),
        rows: Array.from({ length: rows }, () => headers(cols)),
      });
    expect(table(LESSON_LIMITS.tableHeaders, 1).success).toBe(true);
    expect(table(LESSON_LIMITS.tableHeaders + 1, 1).success).toBe(false);
    expect(table(1, LESSON_LIMITS.tableRows).success).toBe(true);
    expect(table(1, LESSON_LIMITS.tableRows + 1).success).toBe(false);
  });

  it('degree chips', () => {
    const chips = (n: number) =>
      parse({ __component: 'lesson.degree-chips', degrees: Array.from({ length: n }, (_, i) => String(i + 1)) });
    expect(chips(LESSON_LIMITS.degreeChips).success).toBe(true);
    expect(chips(LESSON_LIMITS.degreeChips + 1).success).toBe(false);
  });

  it('diagram dots: every position on a guitar neck, and no more', () => {
    const dots = (n: number) =>
      parse({ __component: 'lesson.diagram', mode: 'explicit', dots: [...guitarDots(Math.min(n, LESSON_LIMITS.diagramDots)), ...guitarDots(n - LESSON_LIMITS.diagramDots)] });
    expect(dots(LESSON_LIMITS.diagramDots).success).toBe(true);
    expect(dots(LESSON_LIMITS.diagramDots + 1).success).toBe(false);
  });

  it('keyboard marks: one per pitch class', () => {
    const pcs = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const marks = (n: number) =>
      parse({
        __component: 'lesson.keyboard-diagram',
        mode: 'explicit',
        marks: Array.from({ length: n }, (_, i) => ({ pc: pcs[i % 12] })),
      });
    expect(marks(LESSON_LIMITS.keyboardMarks).success).toBe(true);
    expect(marks(LESSON_LIMITS.keyboardMarks + 1).success).toBe(false);
  });

  it('video-ref label', () => {
    const ref = (n: number) =>
      parse({ __component: 'lesson.video-ref', videoId: 'dQw4w9WgXcQ', label: 'x'.repeat(n) });
    expect(ref(LESSON_LIMITS.videoRefLabel).success).toBe(true);
    expect(ref(LESSON_LIMITS.videoRefLabel + 1).success).toBe(false);
  });

  it('param-picker label', () => {
    const picker = (n: number) => parse({ __component: 'lesson.param-picker', label: 'x'.repeat(n) });
    expect(picker(LESSON_LIMITS.paramPickerLabel).success).toBe(true);
    expect(picker(LESSON_LIMITS.paramPickerLabel + 1).success).toBe(false);
  });

  it('diagramDots is exactly every position on the largest board', () => {
    // Derived, not arbitrary: a guitar neck has 6 strings x frets 0-22.
    expect(LESSON_LIMITS.diagramDots).toBe(NECK_STRING_COUNT.guitar * (NECK_MAX_FRET.guitar + 1));
  });
});
