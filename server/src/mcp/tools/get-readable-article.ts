// Reading mode over MCP — fetches the cached readable article for a
// video, or reports that one hasn't been generated yet.
//
// Why fetch-only (not generate-via-MCP):
//   Reader generation runs on the in-app Ollama pipeline (server/.env
//   config). Triggering that through MCP would spin up local compute
//   from inside a frontier-model session, which is confusing — the
//   user's Claude Desktop request would end up waiting on a local LLM
//   pass. Instead, the tool returns what's cached and points the caller
//   at the in-app UI for generation. Matches the "MCP reads, in-app
//   writes" split we use for digests too.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .max(64)
    .describe('youtubeVideoId or Strapi documentId of an existing Video row.'),
});

type VideoRecord = {
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  readableArticle: string | null;
  readableArticleGeneratedAt: string | null;
  readableArticleModel: string | null;
};

export const getReadableArticleTool: ToolDef<z.infer<typeof schema>> = {
  name: 'getReadableArticle',
  description:
    'Fetch the cached long-form readable article for a video (a cleaned-up markdown article version of the transcript, with filler/sponsor reads/tangents stripped). Returns null if the article has not been generated yet — the user must click "Read" in the in-app UI to generate it. Ideal when you want to reason over the full content of a video beyond the bullet-point summary.',
  schema,
  execute: async ({ videoId }, { strapi }) => {
    let video = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
    })) as VideoRecord | null;

    if (!video) {
      video = (await strapi.documents('api::video.video').findOne({
        documentId: videoId,
      })) as VideoRecord | null;
    }

    if (!video) {
      return { error: `No video found for "${videoId}".` };
    }

    if (!video.readableArticle) {
      return {
        videoTitle: video.videoTitle,
        youtubeVideoId: video.youtubeVideoId,
        readableArticle: null,
        hint:
          'No readable article cached yet. The user needs to open /read/' +
          video.youtubeVideoId +
          ' in the app and click "Generate article" to produce one. Generation runs on the local Ollama pipeline, so it must be triggered from the in-app UI.',
      };
    }

    return {
      videoTitle: video.videoTitle,
      videoAuthor: video.videoAuthor,
      youtubeVideoId: video.youtubeVideoId,
      readableArticle: video.readableArticle,
      generatedAt: video.readableArticleGeneratedAt,
      model: video.readableArticleModel,
    };
  },
};
