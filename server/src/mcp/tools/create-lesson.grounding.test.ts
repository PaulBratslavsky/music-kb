// createLesson and updateLesson ground timecodes before they write — through
// the tools' real interfaces, with Strapi faked at its `documents(uid)` seam.
//
// lesson-grounding.test.ts pins the grounding policy itself. This pins that
// both write tools actually apply it: that what reaches Strapi carries the
// transcript's timecode, not the model's, and that a citation to a video that
// isn't in the library stops the write before anything is stored (issue #10).
import { describe, expect, it } from 'vitest';
import { buildBM25Index } from '../../../../client/src/lib/services/transcript';
import { createLessonTool } from './create-lesson';
import { updateLessonTool } from './update-lesson';

const VIDEO = 'dQw4w9WgXcQ';
const STORED_INDEX = {
  version: 1,
  bm25: buildBM25Index([
    { id: 0, startWord: 0, timeSec: 0, text: 'welcome to the channel today we talk about practice routines' },
    { id: 1, startWord: 10, timeSec: 95, text: 'a major triad stacks a major third and a minor third on top of the root' },
  ]),
};

/** A Strapi with one lesson collection, one library video, and a write log. */
function fakeStrapi() {
  const writes: Array<{ op: string; data: Record<string, any> }> = [];
  const strapi = {
    documents: (uid: string) => {
      if (uid === 'api::lesson.lesson') {
        return {
          findFirst: async () => null, // every slug is free
          findOne: async () => ({ documentId: 'lesson-1', slug: 'triads' }),
          create: async ({ data }: { data: Record<string, any> }) => {
            writes.push({ op: 'create', data });
            return { documentId: 'lesson-1', slug: data.slug };
          },
          update: async ({ data }: { data: Record<string, any> }) => {
            writes.push({ op: 'update', data });
            return { documentId: 'lesson-1', slug: 'triads' };
          },
        };
      }
      if (uid === 'api::video.video') {
        return {
          findFirst: async ({ filters }: any) =>
            filters?.youtubeVideoId?.$eq === VIDEO ? { youtubeVideoId: VIDEO, transcriptSegments: STORED_INDEX } : null,
          findOne: async () => null,
        };
      }
      throw new Error(`unexpected uid ${uid}`);
    },
  };
  return { strapi: strapi as never, writes };
}

const proseCiting = (videoId: string, timeSec: number) => ({
  __component: 'lesson.prose',
  body: 'A major triad stacks a major third and a minor third on the root.',
  source: { videoId, timeSec },
});

async function create(body: unknown[]) {
  const { strapi, writes } = fakeStrapi();
  const args = createLessonTool.schema.parse({ title: 'Triads', body });
  const result = (await createLessonTool.execute(args as never, { strapi })) as Record<string, any>;
  return { result, writes };
}

describe('createLesson', () => {
  it('stores the transcript timecode, not the model\'s', async () => {
    const { result, writes } = await create([proseCiting(VIDEO, 12)]);
    expect(writes[0].data.body[0].source).toEqual({ videoId: VIDEO, timeSec: 95 });
    expect(result.timecodes.grounded).toEqual([{ block: 0, videoId: VIDEO, from: 12, to: 95 }]);
  });

  it('rejects a citation to a video outside the library, writing nothing', async () => {
    const { result, writes } = await create([proseCiting('notARealVid', 12)]);
    expect(result.error).toMatch(/not in the library: notARealVid/);
    expect(writes).toEqual([]);
  });
});

describe('updateLesson', () => {
  it('grounds a replaced body the same way', async () => {
    const { strapi, writes } = fakeStrapi();
    const args = updateLessonTool.schema.parse({ documentId: 'lesson-1', body: [proseCiting(VIDEO, 999)] });
    const result = (await updateLessonTool.execute(args as never, { strapi })) as Record<string, any>;
    expect(writes[0].data.body[0].source.timeSec).toBe(95);
    expect(result.timecodes.grounded[0]).toMatchObject({ from: 999, to: 95 });
  });

  it('leaves the body alone when only metadata changes', async () => {
    const { strapi, writes } = fakeStrapi();
    const args = updateLessonTool.schema.parse({ documentId: 'lesson-1', title: 'Triads, again' });
    const result = (await updateLessonTool.execute(args as never, { strapi })) as Record<string, any>;
    expect(writes[0].data).not.toHaveProperty('body');
    expect(result.timecodes).toEqual({ grounded: [], removed: [] });
  });
});

describe('fret windows that hide their dots', () => {
  const hiddenWindowDiagram = {
    __component: 'lesson.diagram',
    mode: 'explicit',
    instrument: 'guitar',
    dots: [{ string: 0, fret: 3 }, { string: 1, fret: 5 }],
    fromFret: 10,
    toFret: 14, // hides both dots: a blank fretboard
  };

  it('createLesson widens the window before it writes, and says so', async () => {
    const { result, writes } = await create([hiddenWindowDiagram]);
    const stored = writes[0].data.body[0];
    expect(stored.fromFret).toBeLessThanOrEqual(3);
    expect(stored.toFret).toBeGreaterThanOrEqual(5);
    expect(result.windowRepairs).toHaveLength(1);
  });

  it('updateLesson does the same for a replaced body', async () => {
    const { strapi, writes } = fakeStrapi();
    const args = updateLessonTool.schema.parse({ documentId: 'lesson-1', body: [hiddenWindowDiagram] });
    const result = (await updateLessonTool.execute(args as never, { strapi })) as Record<string, any>;
    expect(writes[0].data.body[0].fromFret).toBeLessThanOrEqual(3);
    expect(result.windowRepairs).toHaveLength(1);
  });
});
