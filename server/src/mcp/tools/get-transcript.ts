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
    .describe('full: rawText slice (offset/maxChars). chunked: rawSegments page (page/pageSize). timeRange: segments inside [startSec, endSec].'),
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
  // Pagination — a long transcript exceeds the 1 MB MCP result limit, so
  // both bulk modes return a bounded slice plus a cursor (nextOffset /
  // page+hasMore) the agent follows to pull more as needed.
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('full mode: character offset to start from. Follow the returned nextOffset to continue.'),
  maxChars: z
    .number()
    .int()
    .min(500)
    .max(400_000)
    .default(120_000)
    .describe('full mode: max characters to return (default 120000, well under the 1 MB limit).'),
  page: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('chunked mode: 1-based page of segments.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(500)
    .default(200)
    .describe('chunked mode: segments per page (default 200).'),
});

type Segment = { text: string; startMs: number; endMs: number };

export const getTranscriptTool: ToolDef<z.infer<typeof schema>> = {
  name: 'getTranscript',
  description:
    'Retrieve a saved transcript by youtubeVideoId. Prefer `searchTranscript` to answer a question from the relevant passages first; reach for this when you need the verbatim text. Modes: "full" returns a character slice (offset/maxChars) with a nextOffset cursor; "chunked" returns a page of caption segments (page/pageSize) with hasMore; "timeRange" returns only segments inside [startSec, endSec). Bulk modes are paginated because a long transcript exceeds the 1 MB MCP limit — follow nextOffset / increment page to pull more as needed. Use "timeRange" to expand context around a searchTranscript hit.',
  schema,
  execute: async ({ videoId, mode, startSec, endSec, offset, maxChars, page, pageSize }, { strapi }) => {
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
      const fullText = row.rawText ?? (row.rawSegments ?? []).map((s) => s.text).join(' ');
      const totalChars = fullText.length;
      const slice = fullText.slice(offset, offset + maxChars);
      const nextOffset = offset + slice.length;
      const hasMore = nextOffset < totalChars;
      return {
        ...header,
        mode,
        offset,
        returnedChars: slice.length,
        totalChars,
        hasMore,
        // Cursor to continue from; null when the transcript is fully read.
        nextOffset: hasMore ? nextOffset : null,
        transcript: slice,
      };
    }

    if (mode === 'chunked') {
      const all = row.rawSegments ?? [];
      const totalSegments = all.length;
      const start = (page - 1) * pageSize;
      const segments = all.slice(start, start + pageSize);
      return {
        ...header,
        mode,
        page,
        pageSize,
        totalSegments,
        returnedSegments: segments.length,
        hasMore: start + segments.length < totalSegments,
        segments,
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
