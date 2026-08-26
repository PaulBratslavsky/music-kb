// Create a music lesson from typed blocks — the MCP-path equivalent of the
// client's in-app lesson generator (client/src/lib/services/lesson-
// generation.ts). On this path Claude itself is the generator: it reads
// the library with the existing read tools, composes the blocks, and calls
// this tool. See lesson-blocks.ts for the block vocabulary and why its
// schema descriptions carry the validation weight.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { LESSON_BLOCK_COMPONENTS, correctPitchLabels, lessonBodySchema, lessonParameterSchema } from './lesson-blocks';
import { resolveFreeLessonSlug, resolveLessonVideoDocumentIds, slugifyLessonTitle } from './lesson-utils';

const schema = z
  .object({
    title: z.string().min(1).max(160),
    slug: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Optional explicit slug. If omitted, derived from `title`. Either way, if the resulting slug is already ' +
          'taken by another lesson, a numeric suffix ("-2", "-3", …) is appended automatically — the existing ' +
          'lesson is NEVER overwritten. Always read `slug` back from the result rather than assuming your input was used.',
      ),
    summary: z.string().max(400).optional(),
    level: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
    instrument: z.enum(['guitar', 'piano', 'push', 'any']).default('any').describe('"any" means the lesson applies to every instrument.'),
    order: z.number().int().default(0).describe('Sort position among lessons — lower shows first.'),
    duration: z.string().max(40).optional().describe('Free-text estimate shown to the reader, e.g. "~6 min read".'),
    status: z
      .enum(['draft', 'published', 'ai-generated'])
      .default('ai-generated')
      .describe(
        'Defaults to "ai-generated" — the app UI uses this to flag content a human has not yet reviewed. Do not ' +
          'set "published" unless you have a specific reason to; that is a human-review signal, not a default.',
      ),
    parameter: lessonParameterSchema,
    videos: z
      .array(z.string().min(1))
      .optional()
      .describe('youtubeVideoId or documentId of videos this lesson references. Each is resolved and linked via the `videos` relation.'),
    body: lessonBodySchema,
  })
  .strict();

export const createLessonTool: ToolDef<z.infer<typeof schema>> = {
  // camelCase, not `create_lesson`: Strapi's content-manager plugin derives
  // its own built-in per-content-type MCP tools as `{verb}_${slug}` (e.g.
  // `create_lesson`, `get_lesson`, `update_lesson` for api::lesson.lesson —
  // see @strapi/content-manager's derive-content-type-mcp-tools.js) and
  // registers them unconditionally at boot for every displayed content
  // type, regardless of token permissions. A name collision there throws
  // OUTSIDE this adapter's per-tool try/catch (registerDomainTool only
  // guards our own registration calls) and takes down the whole Strapi
  // boot — confirmed by actually booting with `create_lesson` and watching
  // it crash with "tool with name ... is already registered". Every
  // existing domain tool in this catalog is camelCase for the same
  // collision-proofing reason; this one follows suit rather than the
  // snake_case originally sketched for it.
  name: 'createLesson',
  description:
    'Create a music lesson from an ordered array of typed blocks (see the `body` field for the full block vocabulary — ' +
    `legal __component values: ${LESSON_BLOCK_COMPONENTS.join(', ')}). ` +
    'Every block is schema-validated before anything is written — a bad enum value, an over-length caption, or a block ' +
    'missing a field its render mode needs is rejected with a message naming the offending block\'s array index and field. ' +
    'This validates SHAPE, not quality — call `getLessonAuthoringGuide` first for the field reference plus the traps a ' +
    'schema can\'t express (e.g. `diagram.stringSet`\'s en-dash separators) and for what makes a lesson worth reading ' +
    'rather than generic filler. ' +
    'NEVER overwrites an existing lesson: if the slug collides, a numeric suffix is appended and the actual slug used is ' +
    'returned — read it from the result. Defaults `status` to "ai-generated", never "published". ' +
    'A pitch name at a fret position is computed, not trusted from the block: any `dots[].label` (in `lesson.diagram` or ' +
    '`lesson.neck-pattern`) that parses as a pitch name and disagrees with what that string/fret actually sounds is ' +
    'corrected in place before saving — the dot is kept, only the wrong name changes. See `pitchLabelCorrections` in the result.',
  schema,
  execute: async (args, { strapi }) => {
    const pitchLabelCorrections = correctPitchLabels(args.body);
    const baseSlug = slugifyLessonTitle(args.slug ?? args.title);
    const slugResolution = await resolveFreeLessonSlug(strapi, baseSlug);
    if (slugResolution.status === 'error') return { error: slugResolution.error };

    let videoDocumentIds: string[] = [];
    if (args.videos && args.videos.length > 0) {
      const videoResolution = await resolveLessonVideoDocumentIds(strapi, args.videos);
      if (videoResolution.status === 'error') return { error: videoResolution.error };
      videoDocumentIds = videoResolution.documentIds;
    }

    try {
      const created = (await strapi.documents('api::lesson.lesson').create({
        data: {
          title: args.title,
          slug: slugResolution.slug,
          summary: args.summary ?? null,
          level: args.level,
          instrument: args.instrument,
          order: args.order,
          duration: args.duration ?? null,
          status: args.status,
          parameter: args.parameter ?? null,
          videos: videoDocumentIds,
          body: args.body,
        } as never,
      })) as { documentId: string; slug: string };

      return {
        lessonDocumentId: created.documentId,
        slug: created.slug ?? slugResolution.slug,
        status: args.status,
        blockCount: args.body.length,
        videoCount: videoDocumentIds.length,
        pitchLabelCorrections,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        error: `Failed to create lesson "${args.title}" (resolved slug "${slugResolution.slug}"): ${message}`,
      };
    }
  },
};
