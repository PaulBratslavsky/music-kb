// Fetch a transcript from YouTube via youtubei.js and upsert the
// Transcript row. Idempotent — calling a second time with the same videoId
// refreshes the stored transcript (i.e. this tool doubles as
// "regenerateTranscript").
//
// Does NOT run any LLM. Claude Desktop / Claude Code can call this when it
// wants up-to-date caption data, then reason over it with its own model.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { fetchYouTubeTranscript, fetchYouTubeMeta } from '../../services/youtube-transcript';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('YouTube video id (the 11-char string after ?v= or youtu.be/).'),
  force: z
    .boolean()
    .default(false)
    .describe('If a transcript already exists, re-fetch from YouTube and overwrite. Default false.'),
  proxyUrl: z
    .string()
    .url()
    .optional()
    .describe('Optional residential proxy (http://user:pass@host:port) for YouTube bot-wall bypass. Falls back to TRANSCRIPT_PROXY_URL env var if unset.'),
});

type Segment = { text: string; startMs: number; endMs: number };

export const fetchTranscriptTool: ToolDef<z.infer<typeof schema>> = {
  name: 'fetchTranscript',
  description:
    'WRITE OPERATION — fetch a YouTube transcript via youtubei.js and upsert the stored Transcript row. Acts as "regenerate" when force=true. DO NOT call this to "read" or "get" a transcript the user already has in the KB — use `getTranscript` instead. Only call `fetchTranscript` when the user explicitly asks to "fetch", "refresh", "re-fetch", or "regenerate" the transcript for a known videoId, OR when `getTranscript` reports no transcript stored. Idempotent only when force=false; force=true overwrites.',
  schema,
  execute: async ({ videoId, force, proxyUrl }, { strapi }) => {
    const existing = (await strapi
      .documents('api::transcript.transcript')
      .findFirst({
        filters: { youtubeVideoId: { $eq: videoId } },
      })) as { documentId: string } | null;

    if (existing && !force) {
      return {
        videoId,
        action: 'skipped',
        message: 'Transcript already exists. Set force=true to re-fetch from YouTube.',
        transcriptDocumentId: existing.documentId,
      };
    }

    const resolvedProxy = proxyUrl ?? process.env.TRANSCRIPT_PROXY_URL;
    const [result, meta] = await Promise.all([
      fetchYouTubeTranscript(videoId, { proxyUrl: resolvedProxy }),
      fetchYouTubeMeta(videoId),
    ]);

    const segments: Segment[] = result.segments.map((s) => ({
      text: s.text,
      startMs: s.start,
      endMs: s.end,
    }));

    const data = {
      youtubeVideoId: videoId,
      title: result.title ?? meta.title ?? null,
      author: meta.author ?? null,
      thumbnailUrl: meta.thumbnailUrl ?? null,
      language: 'en',
      durationSec: result.durationSec,
      rawSegments: segments,
      rawText: result.fullTranscript,
      fetchedAt: new Date().toISOString(),
    };

    if (existing) {
      const updated = await strapi.documents('api::transcript.transcript').update({
        documentId: existing.documentId,
        data,
      });
      return {
        videoId,
        action: 'updated',
        transcriptDocumentId: (updated as { documentId: string }).documentId,
        segmentCount: segments.length,
        durationSec: result.durationSec,
        characters: result.fullTranscript.length,
      };
    }

    const created = await strapi.documents('api::transcript.transcript').create({ data });
    return {
      videoId,
      action: 'created',
      transcriptDocumentId: (created as { documentId: string }).documentId,
      segmentCount: segments.length,
      durationSec: result.durationSec,
      characters: result.fullTranscript.length,
    };
  },
};
