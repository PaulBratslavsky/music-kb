// Fetch one lesson with its full block body, by slug. Dynamic zones are
// NOT populated by default in Strapi 5 — without an explicit populate,
// `body` comes back empty, which looks exactly like an unauthored lesson.
// Mirrors client/src/lib/services/lessons.ts's getLessonBySlugWithStatus.
//
// The body and parameter are returned in WRITE shape, not Strapi's read
// shape, so this tool's output is valid updateLesson input — see
// toWritableLessonBody in lesson-blocks.ts (issue #9).

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { toWritableLessonBody, toWritableLessonParameter } from './lesson-blocks';

const schema = z
  .object({
    slug: z.string().min(1).describe('The lesson\'s slug (from listLessons or createLesson\'s result).'),
  })
  .strict();

export const getLessonTool: ToolDef<z.infer<typeof schema>> = {
  // camelCase, not `get_lesson` — see the naming comment in
  // create-lesson.ts: content-manager's built-in `get_lesson` tool would
  // collide and crash Strapi's boot.
  name: 'getLesson',
  description:
    'Fetch a full lesson record by slug, including its ordered block `body`, the lesson `parameter` (if any), and ' +
    'referenced `videos`. Use listLessons first if you don\'t know the slug. `body` and `parameter` come back in the ' +
    'shape updateLesson accepts, so an edit is: getLesson, change the blocks, pass `body` straight to updateLesson. ' +
    '`videos` are records for reading — to keep or change them, pass their `youtubeVideoId`s as updateLesson\'s `videos`.',
  schema,
  execute: async ({ slug }, { strapi }) => {
    const lesson = (await strapi.documents('api::lesson.lesson').findFirst({
      filters: { slug: { $eq: slug } },
      populate: {
        parameter: true,
        videos: { fields: ['youtubeVideoId', 'videoTitle'] },
        body: { populate: '*' },
      },
    })) as Record<string, unknown> | null;

    if (!lesson) {
      return { error: `No lesson found for slug "${slug}".` };
    }

    // Strapi's read shape (component ids, nulls) is rejected by updateLesson's
    // strict schema; hand back the write shape so the output round-trips.
    return {
      ...lesson,
      parameter: toWritableLessonParameter(lesson.parameter),
      body: toWritableLessonBody(lesson.body as unknown[] | null | undefined),
    };
  },
};
