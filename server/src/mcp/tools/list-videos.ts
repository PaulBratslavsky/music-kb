// Paged list of videos in the knowledge base. Returns the catalog view —
// no summary body, no transcript — so the agent can pick one to drill into.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  status: z
    .enum(['any', 'pending', 'generated', 'failed'])
    .default('any')
    .describe('Filter by summaryStatus.'),
  verdict: z
    .enum(['any', 'worth_it', 'skim', 'skip'])
    .default('any')
    .describe(
      'Filter by the AI-generated watch verdict. worth_it = dense/actionable, skim = mixed, skip = generic. Use "worth_it" to find videos the summary alone cannot replace.',
    ),
  tag: z
    .string()
    .optional()
    .describe('Filter by tag name (exact match, case-sensitive after server normalization).'),
});

export const listVideosTool: ToolDef<z.infer<typeof schema>> = {
  name: 'listVideos',
  description:
    'List videos in the knowledge base. Returns header fields (title, youtubeVideoId, author, tags, summaryStatus, watchVerdict, verdictSummary) — use getVideo for the full record including summary.',
  schema,
  execute: async ({ page, pageSize, status, verdict, tag }, { strapi }) => {
    const filters: Record<string, unknown> = {};
    if (status !== 'any') filters.summaryStatus = { $eq: status };
    if (verdict !== 'any') filters.watchVerdict = { $eq: verdict };
    if (tag) filters.tags = { name: { $eq: tag.trim().toLowerCase() } };

    const start = (page - 1) * pageSize;
    const rows = (await strapi.documents('api::video.video').findMany({
      filters,
      sort: 'createdAt:desc',
      pagination: { start, limit: pageSize },
      fields: [
        'youtubeVideoId',
        'url',
        'videoTitle',
        'videoAuthor',
        'summaryStatus',
        'summaryTitle',
        'summaryDescription',
        'watchVerdict',
        'verdictSummary',
        'createdAt',
      ],
      populate: { tags: { fields: ['name'] } },
    })) as Array<{ tags?: Array<{ name: string }> } & Record<string, unknown>>;

    const total = await strapi.db.query('api::video.video').count({ where: filters });

    return {
      page,
      pageSize,
      total,
      hasMore: start + rows.length < total,
      videos: rows.map((row) => ({
        ...row,
        tags: (row.tags ?? []).map((t) => t.name),
      })),
    };
  },
};
