// Update an existing lesson, addressed by documentId (never by slug or
// title — see create_lesson for why slugs are treated as free-form and
// collision-resolved rather than stable identifiers). All fields besides
// `documentId` are optional partial updates; omit a field to leave it
// unchanged. Passing `body` REPLACES the whole dynamic zone (Strapi has no
// partial dynamic-zone update), so pass the full block array, not a diff.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { LESSON_BLOCK_COMPONENTS, correctPitchLabels, lessonBodySchema, lessonParameterSchema } from './lesson-blocks';
import { resolveFreeLessonSlug, resolveLessonVideoDocumentIds, slugifyLessonTitle } from './lesson-utils';

const schema = z
  .object({
    documentId: z.string().min(1).describe('Strapi documentId of the lesson to update (from create_lesson, list_lessons, or get_lesson).'),
    title: z.string().min(1).max(160).optional(),
    slug: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Optional explicit new slug. If it collides with a DIFFERENT lesson, a numeric suffix is appended (this ' +
          'lesson\'s own current slug does not count as a collision). Read `slug` back from the result.',
      ),
    summary: z.string().max(400).optional(),
    level: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    instrument: z.enum(['guitar', 'piano', 'push', 'any']).optional().describe('"any" means the lesson applies to every instrument.'),
    order: z.number().int().optional(),
    duration: z.string().max(40).optional(),
    status: z
      .enum(['draft', 'published', 'ai-generated'])
      .optional()
      .describe('Set to "published" only once a human has reviewed the content — this is a review signal, not a default.'),
    parameter: lessonParameterSchema,
    videos: z
      .array(z.string().min(1))
      .optional()
      .describe('youtubeVideoId or documentId of videos this lesson references. REPLACES the existing `videos` relation entirely.'),
    body: lessonBodySchema
      .optional()
      .describe(
        'REPLACES the entire lesson body — pass the full, updated block array, not just the blocks that changed. ' +
          `Legal __component values: ${LESSON_BLOCK_COMPONENTS.join(', ')}.`,
      ),
  })
  .strict()
  .superRefine((args, ctx) => {
    const { documentId, ...rest } = args;
    void documentId;
    if (Object.values(rest).every((v) => v === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Nothing to update — provide at least one field besides documentId.',
      });
    }
  });

export const updateLessonTool: ToolDef<z.infer<typeof schema>> = {
  // camelCase, not `update_lesson` — see the naming comment in
  // create-lesson.ts: Strapi's content-manager plugin registers a built-in
  // `update_lesson` tool at boot and a name collision there crashes the
  // whole Strapi boot, not just this tool's registration.
  name: 'updateLesson',
  description:
    'Update an existing lesson by documentId. Every provided field replaces the stored value; omitted fields are ' +
    'left unchanged. `body`, if provided, replaces the whole block array (see create_lesson for the block vocabulary ' +
    'and validation, including the pitch-label correction pass reported back as `pitchLabelCorrections` — the same ' +
    'rules apply here). `videos`, if provided, replaces the whole relation.',
  schema,
  execute: async (args, { strapi }) => {
    const existing = (await strapi.documents('api::lesson.lesson').findOne({
      documentId: args.documentId,
      fields: ['documentId', 'slug'],
    })) as { documentId: string; slug: string } | null;
    if (!existing) {
      return { error: `No lesson found for documentId "${args.documentId}".` };
    }

    const data: Record<string, unknown> = {};

    if (args.title !== undefined) data.title = args.title;
    if (args.summary !== undefined) data.summary = args.summary;
    if (args.level !== undefined) data.level = args.level;
    if (args.instrument !== undefined) data.instrument = args.instrument;
    if (args.order !== undefined) data.order = args.order;
    if (args.duration !== undefined) data.duration = args.duration;
    if (args.status !== undefined) data.status = args.status;
    if (args.parameter !== undefined) data.parameter = args.parameter;
    const pitchLabelCorrections = args.body !== undefined ? correctPitchLabels(args.body) : [];
    if (args.body !== undefined) data.body = args.body;

    let resolvedSlug = existing.slug;
    if (args.slug !== undefined) {
      const baseSlug = slugifyLessonTitle(args.slug);
      const slugResolution = await resolveFreeLessonSlug(strapi, baseSlug, existing.documentId);
      if (slugResolution.status === 'error') return { error: slugResolution.error };
      resolvedSlug = slugResolution.slug;
      data.slug = resolvedSlug;
    }

    if (args.videos !== undefined) {
      if (args.videos.length === 0) {
        data.videos = [];
      } else {
        const videoResolution = await resolveLessonVideoDocumentIds(strapi, args.videos);
        if (videoResolution.status === 'error') return { error: videoResolution.error };
        data.videos = videoResolution.documentIds;
      }
    }

    try {
      const updated = (await strapi.documents('api::lesson.lesson').update({
        documentId: args.documentId,
        data,
      })) as { documentId: string; slug: string };

      return {
        lessonDocumentId: updated.documentId,
        slug: updated.slug ?? resolvedSlug,
        updatedFields: Object.keys(data),
        pitchLabelCorrections,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `Failed to update lesson "${args.documentId}": ${message}` };
    }
  },
};
