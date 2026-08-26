// Paged list of lessons — the catalog view (no body). Use get_lesson for
// the full block content of a specific lesson.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
    status: z.enum(['any', 'draft', 'published', 'ai-generated']).default('any'),
    level: z.enum(['any', 'beginner', 'intermediate', 'advanced']).default('any'),
    instrument: z
      .enum(['all', 'guitar', 'piano', 'push', 'any'])
      .default('all')
      .describe(
        '"all" = no filter (the default). "any" filters to lessons whose OWN instrument field is literally "any" ' +
          '(i.e. instrument-agnostic lessons) — these are different things, do not confuse them.',
      ),
  })
  .strict();

export const listLessonsTool: ToolDef<z.infer<typeof schema>> = {
  // camelCase, not `list_lessons` — see the naming comment in
  // create-lesson.ts. This one doesn't collide today (content-manager's
  // built-in is singular `list_lesson`), but every domain tool in this
  // catalog is camelCase on purpose so a future content-manager naming
  // tweak can't silently collide with it.
  name: 'listLessons',
  description:
    'List lessons in the knowledge base: documentId, slug, title, status, level, instrument, order. Use get_lesson ' +
    'for the full block body of one lesson, or update_lesson (with the documentId from here) to edit one.',
  schema,
  execute: async ({ page, pageSize, status, level, instrument }, { strapi }) => {
    const filters: Record<string, unknown> = {};
    if (status !== 'any') filters.status = { $eq: status };
    if (level !== 'any') filters.level = { $eq: level };
    if (instrument !== 'all') filters.instrument = { $eq: instrument };

    const start = (page - 1) * pageSize;
    const rows = await strapi.documents('api::lesson.lesson').findMany({
      filters,
      sort: 'order:asc',
      pagination: { start, limit: pageSize },
      fields: ['documentId', 'slug', 'title', 'status', 'level', 'instrument', 'order', 'duration'],
    });

    const total = await strapi.db.query('api::lesson.lesson').count({ where: filters });

    return {
      page,
      pageSize,
      total,
      hasMore: start + rows.length < total,
      lessons: rows,
    };
  },
};
