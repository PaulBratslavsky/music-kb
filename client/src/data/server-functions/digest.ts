import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  generateDigestByIds,
  generateDigestArticleByIds,
  DIGEST_MAX_VIDEOS,
  DIGEST_MIN_VIDEOS,
  type Digest,
} from '#/lib/services/digest';
import { stripVideoForClient, type StrapiVideo } from '#/lib/services/videos';

// =============================================================================
// Generate digest (ephemeral — no DB row)
// =============================================================================

const GenerateDigestSchema = z.object({
  videoIds: z
    .array(z.string().min(1).max(64))
    .min(DIGEST_MIN_VIDEOS)
    .max(DIGEST_MAX_VIDEOS),
});

export type GenerateDigestResult =
  | { status: 'ok'; digest: Digest; videos: StrapiVideo[] }
  | { status: 'error'; error: string };

export const generateDigest = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof GenerateDigestSchema>) =>
    GenerateDigestSchema.parse(data),
  )
  .handler(async ({ data }): Promise<GenerateDigestResult> => {
    const result = await generateDigestByIds(data.videoIds);
    if (!result.success) return { status: 'error', error: result.error };
    return {
      status: 'ok',
      digest: result.digest,
      videos: result.videos.map((v) => stripVideoForClient(v)!),
    };
  });

// =============================================================================
// Generate digest article (flowing long-form markdown post — like reading
// mode but for the cross-video digest). Ephemeral, lazy.
// =============================================================================

export type GenerateDigestArticleResult =
  | { status: 'ok'; article: string; videos: StrapiVideo[] }
  | { status: 'error'; error: string };

export const generateDigestArticle = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof GenerateDigestSchema>) =>
    GenerateDigestSchema.parse(data),
  )
  .handler(async ({ data }): Promise<GenerateDigestArticleResult> => {
    const result = await generateDigestArticleByIds(data.videoIds);
    if (!result.success) return { status: 'error', error: result.error };
    return {
      status: 'ok',
      article: result.article,
      videos: result.videos.map((v) => stripVideoForClient(v)!),
    };
  });

