// Fetch one lesson with its full block body, by slug. Dynamic zones are
// NOT populated by default in Strapi 5 — without an explicit populate,
// `body` comes back empty, which looks exactly like an unauthored lesson.
// Mirrors client/src/lib/services/lessons.ts's getLessonBySlugWithStatus.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z
  .object({
    slug: z.string().min(1).describe('The lesson\'s slug (from list_lessons or create_lesson\'s result).'),
  })
  .strict();

export const getLessonTool: ToolDef<z.infer<typeof schema>> = {
  // camelCase, not `get_lesson` — see the naming comment in
  // create-lesson.ts: content-manager's built-in `get_lesson` tool would
  // collide and crash Strapi's boot.
  name: 'getLesson',
  description:
    'Fetch a full lesson record by slug, including its ordered block `body`, the lesson `parameter` (if any), and ' +
    'referenced `videos`. Use list_lessons first if you don\'t know the slug.',
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

    return lesson;
  },
};
