// Bundle summaries for every video that matches a set of tags into a
// single response so a frontier model can reason across the whole
// sub-library in one context. Much cheaper than calling getVideo N times.
//
// Inspired by the plugin's `aggregateContent`, but domain-specific: we
// only surface fields a YouTube-KB user cares about (title, author,
// summary overview, sections, takeaways) so the payload stays small
// enough for 40+ videos to fit inside one tool-call response.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  tags: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(10)
    .describe('One or more tag names. Normalized to lowercase-trim before matching.'),
  match: z
    .enum(['any', 'all'])
    .default('any')
    .describe('any: video matches if it has ANY of the tags. all: video must have ALL tags.'),
  limit: z.number().int().min(1).max(200).default(50).describe('Max videos to include.'),
  fields: z
    .enum(['header', 'summary', 'full'])
    .default('summary')
    .describe('header: title/author/id only. summary: + description + overview + takeaways. full: + sections + action steps.'),
});

const BASE_FIELDS = [
  'youtubeVideoId',
  'videoTitle',
  'videoAuthor',
  'summaryStatus',
  'summaryTitle',
  'summaryDescription',
  'createdAt',
];

const SUMMARY_FIELDS = [...BASE_FIELDS, 'summaryOverview'];

export const aggregateByTagTool: ToolDef<z.infer<typeof schema>> = {
  name: 'aggregateByTag',
  description:
    'Gather summary data for every video matching a set of tags. Returns an array of video records with their summaries (and optionally sections + takeaways). Use this for "what do my `rag` videos say about chunking?" or "compare every `ai-agents` video" — it avoids N round-trips of `getVideo`. For transcript content, pair with `crossSearchTranscripts`.',
  schema,
  execute: async ({ tags, match, limit, fields }, { strapi }) => {
    const normalized = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const tagFilter =
      match === 'all'
        ? { $and: normalized.map((n) => ({ tags: { name: { $eq: n } } })) }
        : { tags: { name: { $in: normalized } } };

    const selectFields = fields === 'header' ? BASE_FIELDS : SUMMARY_FIELDS;
    const populate: Record<string, unknown> = { tags: { fields: ['name'] } };
    if (fields === 'full') {
      populate.keyTakeaways = true;
      populate.sections = true;
      populate.actionSteps = true;
    } else if (fields === 'summary') {
      populate.keyTakeaways = true;
    }

    const rows = (await strapi.documents('api::video.video').findMany({
      filters: tagFilter,
      pagination: { start: 0, limit },
      sort: 'createdAt:desc',
      fields: selectFields as never,
      populate,
    })) as Array<Record<string, unknown> & { tags?: Array<{ name: string }> }>;

    return {
      tags: normalized,
      match,
      fields,
      videoCount: rows.length,
      videos: rows.map((r) => ({
        ...r,
        tags: (r.tags ?? []).map((t) => t.name),
      })),
      ...(rows.length === 0
        ? {
            hint: 'No videos matched those tags. Call `listTags` to see what tags exist.',
          }
        : {}),
    };
  },
};
