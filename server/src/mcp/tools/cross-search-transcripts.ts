// BM25 search across many transcripts in a single call. Reuses the
// already-stored per-video index on `Video.transcriptSegments`, iterates
// over the matching video set, and returns the top-k chunks per video.
//
// Optional tag filter so the search scope matches the user's framing
// ("what do my rag videos say about chunking?" → tags: ['rag'], query:
// 'chunking'). Falls back to a full KB scan when no tag is given.
//
// Capped per-video to keep the response size manageable — the agent can
// always call `searchTranscript` on a specific video for deeper detail.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import {
  formatTimecode,
  isStoredIndex,
  searchBM25,
} from '../../services/bm25-search';

const schema = z.object({
  query: z.string().min(2).max(300),
  tags: z
    .array(z.string().min(1).max(40))
    .max(10)
    .optional()
    .describe('Optional tag filter — limit the search to videos with any of these tags.'),
  perVideo: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(3)
    .describe('Max chunks to return per video.'),
  maxVideos: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Max videos to scan. Videos without a BM25 index (missing summary) are skipped silently.'),
});

export const crossSearchTranscriptsTool: ToolDef<z.infer<typeof schema>> = {
  name: 'crossSearchTranscripts',
  description:
    'BM25 search across multiple transcripts in a single call. Returns top-k passages per matching video with timecodes — ideal for "what do my `rag` videos say about chunking?" style questions. Optional tag filter scopes the search. Use `searchTranscript` instead when you already know the specific videoId.',
  schema,
  execute: async ({ query, tags, perVideo, maxVideos }, { strapi }) => {
    const filters: Record<string, unknown> = { summaryStatus: { $eq: 'generated' } };
    if (tags && tags.length > 0) {
      filters.tags = { name: { $in: tags.map((t) => t.trim().toLowerCase()) } };
    }

    const videos = (await strapi.documents('api::video.video').findMany({
      filters,
      pagination: { start: 0, limit: maxVideos },
      sort: 'createdAt:desc',
      fields: ['youtubeVideoId', 'videoTitle', 'summaryTitle', 'transcriptSegments'],
      populate: { tags: { fields: ['name'] } },
    })) as Array<{
      youtubeVideoId: string;
      videoTitle?: string | null;
      summaryTitle?: string | null;
      transcriptSegments?: unknown;
      tags?: Array<{ name: string }>;
    }>;

    const perVideoResults = videos
      .map((v) => {
        if (!isStoredIndex(v.transcriptSegments)) return null;
        const ranked = searchBM25(v.transcriptSegments.bm25, query, perVideo);
        if (ranked.length === 0) return null;
        return {
          youtubeVideoId: v.youtubeVideoId,
          videoTitle: v.videoTitle ?? v.summaryTitle ?? null,
          tags: (v.tags ?? []).map((t) => t.name),
          topScore: ranked[0].score,
          passages: ranked.map((r) => ({
            timecode: formatTimecode(r.chunk.timeSec),
            timeSec: r.chunk.timeSec,
            text: r.chunk.text,
            score: Number(r.score.toFixed(4)),
          })),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      // Order videos by best-hit score so the strongest matches come first.
      .sort((a, b) => b.topScore - a.topScore);

    return {
      query,
      tags: tags ?? null,
      videosScanned: videos.length,
      videosWithHits: perVideoResults.length,
      results: perVideoResults,
      ...(perVideoResults.length === 0
        ? {
            hint: 'No transcripts had passages matching that query. Try different terms, drop the tag filter, or call `listVideos` to see what\'s actually in the KB.',
          }
        : {}),
    };
  },
};
