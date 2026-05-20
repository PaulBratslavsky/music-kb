// Find videos with no tags attached — the starting point for the "go
// through all videos and add tags" workflow. Claude iterates over the
// returned list, calls `getVideo` + reasoning, then `tagVideo` per row.
//
// Also surfaces `summaryTitle` + `summaryDescription` so the agent has
// enough signal to reason about tags without a separate getVideo call
// per row (keeps the workflow to ~1 tagVideo call per untagged video).

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  limit: z.number().int().min(1).max(200).default(25),
  onlyGenerated: z
    .boolean()
    .default(true)
    .describe('Only include videos whose summary has finished generating. True by default — untagged videos without summaries give the agent nothing to reason about.'),
});

export const listUntaggedTool: ToolDef<z.infer<typeof schema>> = {
  name: 'listUntagged',
  description:
    'List videos with zero tags. Returns header + summary title/description so the agent has enough context to suggest tags without a follow-up getVideo. Typical workflow: listUntagged → reason about each → tagVideo per row. Pair with listTags to see which tags already exist (prefer reusing over creating).',
  schema,
  execute: async ({ limit, onlyGenerated }, { strapi }) => {
    const filters: Record<string, unknown> = {
      tags: { id: { $null: true } },
    };
    if (onlyGenerated) filters.summaryStatus = { $eq: 'generated' };

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
        'createdAt',
      ],
    })) as Array<Record<string, unknown>>;

    return {
      limit,
      onlyGenerated,
      untaggedCount: rows.length,
      videos: rows,
      ...(rows.length === 0
        ? { hint: 'No untagged videos found. Everything in the KB has at least one tag.' }
        : {
            next: 'For each video, decide which of the existing tags (via `listTags`) fit, then call `tagVideo({ videoId, tags })`. Prefer reusing tags over creating new ones.',
          }),
    };
  },
};
