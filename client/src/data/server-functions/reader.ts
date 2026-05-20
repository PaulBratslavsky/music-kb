import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  generateReadableArticleForVideo,
  type ReadableArticleResult,
} from '#/lib/services/reader';

// =============================================================================
// Reading mode — generate or fetch the cached markdown article for a video.
// =============================================================================

const GenerateSchema = z.object({
  videoId: z.string().min(1).max(32).regex(/^[\w-]+$/),
  forceRegenerate: z.boolean().optional(),
});

export type GenerateReadableArticleResponse =
  | { status: 'ok'; article: ReadableArticleResult }
  | { status: 'already_running' }
  | { status: 'error'; error: string };

// In-memory dedupe — second click on "Generate" while the first is still
// running returns `already_running` instead of kicking off a duplicate
// LLM pass. Fine for a single-node local app; move to a DB flag or Redis
// if the app ever goes multi-node.
const inflight = new Set<string>();

export const generateReadableArticle = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof GenerateSchema>) =>
    GenerateSchema.parse(data),
  )
  .handler(async ({ data }): Promise<GenerateReadableArticleResponse> => {
    if (inflight.has(data.videoId)) {
      return { status: 'already_running' };
    }
    inflight.add(data.videoId);
    try {
      const result = await generateReadableArticleForVideo(data.videoId, {
        forceRegenerate: data.forceRegenerate,
      });
      if (!result.success) {
        return { status: 'error', error: result.error };
      }
      return { status: 'ok', article: result.data };
    } finally {
      inflight.delete(data.videoId);
    }
  });
