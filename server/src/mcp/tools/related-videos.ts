// Semantic neighbors for a video by cosine similarity over the stored
// summary embeddings. Mirrors the /learn-page "Related videos" card but
// callable from an MCP client so a frontier model can pull topical
// context when reasoning about a single video.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import {
  cosineSimilarity,
  embeddingStatus,
  type VideoWithEmbedding,
} from '../utils/embeddings';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('Either the youtubeVideoId or the Strapi documentId.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Max neighbors to return. Default 6.'),
  minScore: z
    .number()
    .min(-1)
    .max(1)
    .optional()
    .describe(
      'Cosine floor — neighbors below this are filtered. Default 0.5.',
    ),
});

type VideoRow = VideoWithEmbedding & {
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  summaryStatus?: string;
};

export const relatedVideosTool: ToolDef<z.infer<typeof schema>> = {
  name: 'relatedVideos',
  description:
    'Find semantically similar videos in the library by cosine similarity over the per-video topical embedding. Returns youtubeVideoId + documentId + title + author + score for each neighbor. Target must have a current embedding — run reindexEmbeddings first if it doesn\'t.',
  schema,
  execute: async (
    { videoId, limit = 6, minScore = 0.5 },
    { strapi },
  ) => {
    // Resolve the target by either id form — matches the pattern used in
    // other tools (getVideo, saveNote).
    let target = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
    } as never)) as unknown as VideoRow | null;
    if (!target) {
      target = (await strapi.documents('api::video.video').findOne({
        documentId: videoId,
      } as never)) as unknown as VideoRow | null;
    }
    if (!target) return { error: `No video found for "${videoId}".` };

    if (embeddingStatus(target) !== 'current') {
      return {
        error:
          'Target video has no current embedding. Call reindexEmbeddings { scope: "missing" } first.',
      };
    }
    const targetVec = target.summaryEmbedding as number[];

    const all = (await strapi.documents('api::video.video').findMany({
      filters: { summaryStatus: { $eq: 'generated' } },
      pagination: { pageSize: 1000 },
    } as never)) as unknown as VideoRow[];

    const scored = all
      .filter(
        (v) =>
          v.documentId !== target!.documentId &&
          embeddingStatus(v) === 'current' &&
          Array.isArray(v.summaryEmbedding),
      )
      .map((v) => ({
        v,
        score: cosineSimilarity(targetVec, v.summaryEmbedding as number[]),
      }))
      .filter((x) => x.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      target: {
        youtubeVideoId: target.youtubeVideoId,
        videoTitle: target.videoTitle,
      },
      count: scored.length,
      results: scored.map(({ v, score }) => ({
        youtubeVideoId: v.youtubeVideoId,
        documentId: v.documentId,
        videoTitle: v.videoTitle,
        videoAuthor: v.videoAuthor,
        score,
      })),
    };
  },
};
