// Full video record including summary, sections, key takeaways, action
// steps, and tags. Use searchTranscript or getTranscript for the transcript
// body itself — this tool stays focused on the AI-generated view.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('Either the youtubeVideoId or the Strapi documentId.'),
});

export const getVideoTool: ToolDef<z.infer<typeof schema>> = {
  name: 'getVideo',
  description:
    'Fetch a full Video record by youtubeVideoId or documentId, including summary title/description/overview, sections (with timecodes), key takeaways, action steps, and tags. Does NOT include the transcript — call getTranscript or searchTranscript for that.',
  schema,
  execute: async ({ videoId }, { strapi }) => {
    // Try youtubeVideoId first, then fall back to documentId.
    let video = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
      populate: {
        tags: { fields: ['name'] },
        keyTakeaways: true,
        sections: true,
        actionSteps: true,
      },
    })) as (Record<string, unknown> & { tags?: Array<{ name: string }> }) | null;

    if (!video) {
      video = (await strapi.documents('api::video.video').findOne({
        documentId: videoId,
        populate: {
          tags: { fields: ['name'] },
          keyTakeaways: true,
          sections: true,
          actionSteps: true,
        },
      })) as (Record<string, unknown> & { tags?: Array<{ name: string }> }) | null;
    }

    if (!video) {
      return { error: `No video found for "${videoId}".` };
    }

    // Strip the BM25 index blob from the response — it's huge and not
    // useful to a human-readable tool call. Agents that need the index
    // should use searchTranscript which already consumes it.
    const { transcriptSegments, tags, ...rest } = video as Record<string, unknown> & {
      transcriptSegments?: unknown;
      tags?: Array<{ name: string }>;
    };
    void transcriptSegments;

    return {
      ...rest,
      tags: (tags ?? []).map((t) => t.name),
    };
  },
};
