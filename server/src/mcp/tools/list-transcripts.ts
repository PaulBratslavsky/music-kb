// List all stored transcripts with pagination. Lightweight — returns the
// header fields so the agent can decide which ones to pull full content
// for via getTranscript.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('1-indexed page number.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Number of transcripts per page. Max 100.'),
  sort: z
    .enum(['newest', 'oldest', 'title'])
    .default('newest')
    .describe('Sort order.'),
});

const SORT_MAP: Record<z.infer<typeof schema>['sort'], string> = {
  newest: 'createdAt:desc',
  oldest: 'createdAt:asc',
  title: 'title:asc',
};

export const listTranscriptsTool: ToolDef<z.infer<typeof schema>> = {
  name: 'listTranscripts',
  description:
    'List all saved transcripts in the knowledge base with pagination. Returns header fields (youtubeVideoId, title, author, durationSec, language, createdAt) — use getTranscript to fetch full content for a specific video.',
  schema,
  execute: async ({ page, pageSize, sort }, { strapi }) => {
    const start = (page - 1) * pageSize;
    const rows = (await strapi.documents('api::transcript.transcript').findMany({
      sort: SORT_MAP[sort] as never,
      pagination: { start, limit: pageSize },
      fields: [
        'youtubeVideoId',
        'title',
        'author',
        'durationSec',
        'language',
        'createdAt',
        'fetchedAt',
      ],
    })) as unknown as Array<Record<string, unknown>>;

    const total = await strapi.db
      .query('api::transcript.transcript')
      .count({});

    return {
      page,
      pageSize,
      total,
      hasMore: start + rows.length < total,
      transcripts: rows,
    };
  },
};
