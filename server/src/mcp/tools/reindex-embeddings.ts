// Backfill / refresh topical embeddings across the Video collection.
// Mirrors the `/settings` UI button but driven from an MCP client — useful
// for automating maintenance after a model or embedding-version change.
//
// Serial execution: Ollama's /api/embeddings serializes anyway and MCP
// tool calls are one-shot, so concurrency would only add surprise without
// speedup here.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import {
  CURRENT_EMBEDDING_MODEL,
  CURRENT_EMBEDDING_VERSION,
  buildEmbeddingText,
  embedText,
  embeddingStatus,
  type VideoForEmbed,
  type VideoWithEmbedding,
} from '../utils/embeddings';

const schema = z.object({
  scope: z
    .enum(['missing', 'stale', 'all'])
    .default('missing')
    .describe(
      'Which videos to process: "missing" (no vector), "stale" (wrong model/version), or "all" (missing ∪ stale). Defaults to "missing".',
    ),
});

type VideoRow = VideoForEmbed &
  VideoWithEmbedding & {
    documentId: string;
    youtubeVideoId: string;
    summaryStatus?: string;
  };

export const reindexEmbeddingsTool: ToolDef<z.infer<typeof schema>> = {
  name: 'reindexEmbeddings',
  description:
    'Backfill or refresh topical embeddings on the Video collection. Use "missing" (default) to fill in videos that lack a vector, "stale" after an embedding model/version bump, or "all" for both. Serial against Ollama; safe to run anytime. Returns the counts and the first few errors if any.',
  schema,
  execute: async ({ scope }, { strapi }) => {
    const videos = (await strapi.documents('api::video.video').findMany({
      filters: { summaryStatus: { $eq: 'generated' } },
      populate: {
        tags: { fields: ['name'] },
        keyTakeaways: true,
        sections: { fields: ['heading'] },
      },
      pagination: { pageSize: 1000 },
    } as never)) as unknown as VideoRow[];

    const candidates = videos.filter((v) => {
      const s = embeddingStatus(v);
      if (scope === 'missing') return s === 'missing';
      if (scope === 'stale') return s === 'stale';
      return s !== 'current';
    });

    const errors: Array<{ youtubeVideoId: string; error: string }> = [];
    let succeeded = 0;

    for (const video of candidates) {
      try {
        const text = buildEmbeddingText(video);
        if (!text.trim()) {
          errors.push({
            youtubeVideoId: video.youtubeVideoId,
            error: 'no summary content to embed',
          });
          continue;
        }
        const embedding = await embedText(text);
        await strapi.documents('api::video.video').update({
          documentId: video.documentId,
          data: {
            summaryEmbedding: embedding,
            embeddingModel: CURRENT_EMBEDDING_MODEL,
            embeddingVersion: CURRENT_EMBEDDING_VERSION,
            embeddingGeneratedAt: new Date().toISOString(),
          },
        } as never);
        succeeded += 1;
      } catch (err) {
        errors.push({
          youtubeVideoId: video.youtubeVideoId,
          error: err instanceof Error ? err.message : 'embed failed',
        });
      }
    }

    return {
      scope,
      model: CURRENT_EMBEDDING_MODEL,
      version: CURRENT_EMBEDDING_VERSION,
      total: videos.length,
      targeted: candidates.length,
      succeeded,
      failed: errors.length,
      errors: errors.slice(0, 10),
    };
  },
};
