// Substring search across video titles + summary fields. Complementary to
// findTranscripts (which searches the transcript body). Use this when the
// question is about AI-generated summary content rather than raw captions.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { buildTokenAndFilter, tokenizeQuery } from './query-helpers';

const FIELDS = [
  'videoTitle',
  'url',
  'youtubeVideoId',
  'summaryTitle',
  'summaryDescription',
  'summaryOverview',
  'verdictSummary',
  'verdictReason',
];

const schema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe('Search string — tokenized and matched against videoTitle, url, youtubeVideoId, summaryTitle, summaryDescription, and summaryOverview. Every non-stopword token must appear in at least one of those fields (case-insensitive), so "Rethinking AI Agents" matches a title like "Rethinking AI Agents: The Rise of X". You can also paste a full YouTube URL or 11-char video id and it will find the row.'),
  limit: z.number().int().min(1).max(50).default(10),
  tag: z
    .string()
    .optional()
    .describe('Optional tag filter (exact match, lowercase).'),
});

async function runQuery(strapi: any, filters: Record<string, unknown>, limit: number) {
  const rows = (await strapi.documents('api::video.video').findMany({
    filters,
    pagination: { start: 0, limit },
    sort: 'createdAt:desc',
    fields: [
      'youtubeVideoId',
      'videoTitle',
      'videoAuthor',
      'summaryTitle',
      'summaryDescription',
      'summaryStatus',
      'watchVerdict',
      'verdictSummary',
      'createdAt',
    ],
    populate: { tags: { fields: ['name'] } },
  })) as Array<{ tags?: Array<{ name: string }> } & Record<string, unknown>>;
  return rows.map((row) => ({ ...row, tags: (row.tags ?? []).map((t) => t.name) }));
}

export const searchVideosTool: ToolDef<z.infer<typeof schema>> = {
  name: 'searchVideos',
  description:
    'Tokenized search across video titles, URL, youtubeVideoId, and AI-generated summary fields (title/description/overview). Every non-stopword token in the query must appear in at least one field (case-insensitive substring per token). Works with natural-language queries, full YouTube URLs, or bare 11-char video ids. Falls back to any-token-matches if the strict search returns nothing. Use findTranscripts to search inside raw captions instead.',
  schema,
  execute: async ({ query, limit, tag }, { strapi }) => {
    const tokens = tokenizeQuery(query);
    const tagFilter = tag ? { tags: { name: { $eq: tag.trim().toLowerCase() } } } : {};

    // Strict-only: every token must match. We deliberately do NOT fall back
    // to any-token (OR) matching — it turns out that generic tokens like
    // "video" / "title" match almost every row in the KB, so the OR
    // fallback returns ~20 false positives instead of an honest empty +
    // hint. An empty result + a hint steering to listVideos/addVideo is
    // more useful to the agent than a huge pile of loosely-related rows.
    const strictFilters = { ...buildTokenAndFilter(query, FIELDS), ...tagFilter };
    let videos = await runQuery(strapi, strictFilters, limit);
    let mode: 'strict' | 'tag-only' = 'strict';

    // Tag-only fallback: query tokenized to nothing (all stopwords / too
    // short) but a tag was supplied — filter by tag alone.
    if (videos.length === 0 && tokens.length === 0 && tag) {
      videos = await runQuery(strapi, tagFilter, limit);
      mode = 'tag-only';
    }

    return {
      query,
      tokens,
      matchMode: mode,
      matchCount: videos.length,
      videos,
      ...(videos.length === 0
        ? {
            hint: 'No videos matched. Ask the user whether to ingest it — only call `addVideo({ url })` if they confirm. Otherwise call `listVideos` to show what\'s actually in the KB.',
          }
        : {}),
    };
  },
};
