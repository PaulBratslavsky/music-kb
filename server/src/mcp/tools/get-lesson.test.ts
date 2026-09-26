// getLesson → updateLesson, through both tools' real interfaces.
//
// The demo beat this protects: an MCP client fetches a lesson, edits a block,
// and saves it. That used to fail on Strapi's read shape — component `id`s and
// `null` fields that updateLesson's strict schema rejects (issue #9). Strapi is
// faked at the one seam the tool uses (`documents(uid).findFirst`); everything
// else is the production code.
import { describe, expect, it } from 'vitest';
import { getLessonTool } from './get-lesson';
import { updateLessonTool } from './update-lesson';

/** What Strapi 5 returns for a populated lesson. */
const storedLesson = {
  id: 7,
  documentId: 'lesson-doc-1',
  slug: 'c-major-triads',
  title: 'C major triads',
  parameter: { id: 3, name: 'key', label: null, default: 'C' },
  videos: [{ id: 21, documentId: 'vid-doc-1', youtubeVideoId: 'dQw4w9WgXcQ', videoTitle: 'Triads 101' }],
  body: [
    { id: 11, body: 'A triad is three notes.', source: null, __component: 'lesson.prose' },
    {
      id: 12,
      mode: 'theory',
      intent: 'chord',
      root: 'C',
      quality: 'major',
      stringSet: 'e–B–G',
      dots: null,
      caption: null,
      source: { id: 40, videoId: 'dQw4w9WgXcQ', timeSec: 12 },
      __component: 'lesson.diagram',
    },
  ],
};

function strapiReturning(lesson: unknown) {
  return { documents: () => ({ findFirst: async () => lesson }) };
}

async function getLesson(slug = 'c-major-triads') {
  return (await getLessonTool.execute({ slug }, { strapi: strapiReturning(storedLesson) } as never)) as Record<
    string,
    any
  >;
}

describe('getLesson output is valid updateLesson input', () => {
  it('an unedited lesson round-trips', async () => {
    const lesson = await getLesson();
    const input = { documentId: lesson.documentId, body: lesson.body, parameter: lesson.parameter };
    const parsed = updateLessonTool.schema.safeParse(input);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('an edited lesson round-trips — the actual demo beat', async () => {
    const lesson = await getLesson();
    const [prose, ...rest] = lesson.body;
    const edited = [{ ...prose, body: 'A triad stacks two thirds.' }, ...rest];
    const parsed = updateLessonTool.schema.safeParse({ documentId: lesson.documentId, body: edited });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('keeps the fields a reader needs', async () => {
    const lesson = await getLesson();
    expect(lesson.title).toBe('C major triads');
    expect(lesson.videos[0].youtubeVideoId).toBe('dQw4w9WgXcQ');
    expect(lesson.body).toHaveLength(2);
  });

  it('still reports a missing lesson as an error, not an empty record', async () => {
    const out = (await getLessonTool.execute(
      { slug: 'nope' },
      { strapi: strapiReturning(null) } as never,
    )) as Record<string, unknown>;
    expect(out.error).toMatch(/No lesson found for slug "nope"/);
  });
});
