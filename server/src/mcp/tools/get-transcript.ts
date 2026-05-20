// Retrieve a saved transcript. Three modes:
//   full      — whole transcript text (rawText) + metadata.
//   chunked   — segmented array (rawSegments) with ms timing.
//   timeRange — segments filtered to [startSec, endSec].
//
// Mirrors the getTranscript tool in strapi-plugin-ai-sdk-yt-transcripts so
// prompts targeting that plugin work here unchanged.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('YouTube video id (e.g. "dQw4w9WgXcQ"). Looked up against api::transcript.transcript.youtubeVideoId.'),
  mode: z
    .enum(['full', 'chunked', 'timeRange'])
    .default('full')
    .describe('full: rawText + metadata. chunked: rawSegments with ms timing. timeRange: segments inside [startSec, endSec].'),
  startSec: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Inclusive start second for timeRange mode.'),
  endSec: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Exclusive end second for timeRange mode.'),
});

type Segment = { text: string; startMs: number; endMs: number };

export const getTranscriptTool: ToolDef<z.infer<typeof schema>> = {
  name: 'getTranscript',
  description:
    'Retrieve a saved transcript by youtubeVideoId. Supports three modes: "full" returns the whole transcript, "chunked" returns caption segments with millisecond timing, "timeRange" returns only segments inside [startSec, endSec). Use "timeRange" when the user asks about a specific moment in the video.',
  schema,
  execute: async ({ videoId, mode, startSec, endSec }, { strapi }) => {
    const row = (await strapi
      .documents('api::transcript.transcript')
      .findFirst({
        filters: { youtubeVideoId: { $eq: videoId } },
      })) as unknown as {
      documentId: string;
      youtubeVideoId: string;
      title?: string | null;
      author?: string | null;
      durationSec?: number | null;
      language?: string | null;
      rawText?: string | null;
      rawSegments?: Segment[] | null;
      createdAt?: string;
    } | null;

    if (!row) {
      return { error: `No transcript stored for videoId "${videoId}". Call fetchTranscript first.` };
    }

    const header = {
      youtubeVideoId: row.youtubeVideoId,
      title: row.title ?? null,
      author: row.author ?? null,
      durationSec: row.durationSec ?? null,
      language: row.language ?? 'en',
    };

    if (mode === 'full') {
      return {
        ...header,
        transcript: row.rawText ?? (row.rawSegments ?? []).map((s) => s.text).join(' '),
      };
    }

    if (mode === 'chunked') {
      return {
        ...header,
        segments: row.rawSegments ?? [],
      };
    }

    // timeRange
    const start = typeof startSec === 'number' ? startSec * 1000 : 0;
    const end =
      typeof endSec === 'number'
        ? endSec * 1000
        : Number.POSITIVE_INFINITY;
    const segments = (row.rawSegments ?? []).filter(
      (s) => s.startMs >= start && s.startMs < end,
    );
    return {
      ...header,
      startSec: startSec ?? 0,
      endSec: endSec ?? null,
      segmentCount: segments.length,
      segments,
    };
  },
};
