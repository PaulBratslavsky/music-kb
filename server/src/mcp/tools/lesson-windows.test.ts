// A fret window that hides its own dots is widened on the MCP write path, as
// the app parser widens it (issue #10).
//
// `fromFret`/`toFret` crop the neck. Set them so the crop misses the dots and
// the diagram renders as a blank fretboard — not an error, just nothing where
// the lesson promised a shape. The app parser (applyWindowRepair in
// client/src/lib/lesson/markdown-blocks.ts) widens the author's window to fit;
// the MCP tools used to store it as sent. The repair is reported back, the
// same way correctPitchLabels reports its corrections.
import { describe, expect, it } from 'vitest';
import { lessonBlockSchema } from './lesson-blocks';
import { repairHiddenWindows, widenNeckWindow } from './lesson-windows';

const explicitDiagram = (fromFret: number | undefined, toFret: number | undefined, frets: number[]) => ({
  __component: 'lesson.diagram',
  mode: 'explicit',
  instrument: 'guitar',
  dots: frets.map((fret, i) => ({ string: i % 6, fret })),
  ...(fromFret !== undefined ? { fromFret } : {}),
  ...(toFret !== undefined ? { toFret } : {}),
});

describe('explicit diagrams', () => {
  it('a window that hides every dot is widened to fit them — the blank-fretboard case', () => {
    const body: any[] = [explicitDiagram(10, 14, [3, 5])];
    const repairs = repairHiddenWindows(body);
    const widened = widenNeckWindow([{ fret: 3 }, { fret: 5 }], 'guitar', 10, 14);
    expect({ fromFret: body[0].fromFret, toFret: body[0].toFret }).toEqual(widened);
    expect(repairs).toEqual([
      { block: 0, component: 'lesson.diagram', hidden: 2, of: 2, from: { fromFret: 10, toFret: 14 }, to: widened },
    ]);
  });

  it('a window that hides some of them is widened too — an incomplete shape misleads', () => {
    const body: any[] = [explicitDiagram(0, 4, [2, 7])];
    const [repair] = repairHiddenWindows(body);
    expect(repair).toMatchObject({ hidden: 1, of: 2 });
    expect(body[0].toFret).toBeGreaterThanOrEqual(7);
  });

  it('a window that already shows every dot is left exactly as authored', () => {
    const body: any[] = [explicitDiagram(2, 9, [3, 5, 7])];
    expect(repairHiddenWindows(body)).toEqual([]);
    expect([body[0].fromFret, body[0].toFret]).toEqual([2, 9]);
  });

  it('no window means auto-fit — nothing to repair', () => {
    const body: any[] = [explicitDiagram(undefined, undefined, [3, 15])];
    expect(repairHiddenWindows(body)).toEqual([]);
    expect(body[0]).not.toHaveProperty('fromFret');
  });

  it('a theory-mode diagram is left alone: its dots are computed by the theory layer, which the server cannot run', () => {
    const body: any[] = [
      { __component: 'lesson.diagram', mode: 'theory', intent: 'chord', root: 'C', quality: 'major', stringSet: 'e–B–G', fromFret: 15, toFret: 19 },
    ];
    expect(repairHiddenWindows(body)).toEqual([]);
    expect([body[0].fromFret, body[0].toFret]).toEqual([15, 19]);
  });
});

describe('neck-pattern', () => {
  it('its one shared window is widened to hold every pattern', () => {
    const body: any[] = [
      {
        __component: 'lesson.neck-pattern',
        instrument: 'guitar',
        fromFret: 3,
        toFret: 7,
        patterns: [
          { label: 'Position 1', dots: [{ string: 0, fret: 5 }] },
          { label: 'Position 2', dots: [{ string: 0, fret: 12 }] },
        ],
      },
    ];
    const [repair] = repairHiddenWindows(body);
    expect(repair).toMatchObject({ component: 'lesson.neck-pattern', hidden: 1, of: 2 });
    expect(body[0].fromFret).toBeLessThanOrEqual(5);
    expect(body[0].toFret).toBeGreaterThanOrEqual(12);
  });
});

describe('a half-set window on a diagram', () => {
  it('is rejected, as neck-pattern already rejects it — the renderer ignores half a window', () => {
    const result = lessonBlockSchema.safeParse(explicitDiagram(4, undefined, [5]));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join('\n')).toMatch(/set together/);
  });

  it('a full window and no window both still parse', () => {
    expect(lessonBlockSchema.safeParse(explicitDiagram(4, 8, [5])).success).toBe(true);
    expect(lessonBlockSchema.safeParse(explicitDiagram(undefined, undefined, [5])).success).toBe(true);
  });
});
