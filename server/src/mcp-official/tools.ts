// The music-kb domain tools registered on the official MCP server.
//
// Each entry pairs a tool's execute body (from ../mcp/tools/) with a zod-3
// input schema + an access tier (read | write | maintenance). Input schemas
// are re-declared here (zod 3, @strapi/utils) because the tools' own schemas
// are zod 4 and the two aren't interchangeable across the SDK — see ADR 0008
// and adapter.ts.
import { z } from '@strapi/utils';
import type { DomainTool } from './adapter';

import { libraryStatsTool } from '../mcp/tools/library-stats';
import { listVideosTool } from '../mcp/tools/list-videos';
import { searchVideosTool } from '../mcp/tools/search-videos';
import { getMusicDataTool } from '../mcp/tools/get-music-data';
import { getVideoTool } from '../mcp/tools/get-video';
import { getTranscriptTool } from '../mcp/tools/get-transcript';
import { searchTranscriptTool } from '../mcp/tools/search-transcript';
import { findTranscriptsTool } from '../mcp/tools/find-transcripts';
import { crossSearchTranscriptsTool } from '../mcp/tools/cross-search-transcripts';
import { listTranscriptsTool } from '../mcp/tools/list-transcripts';
import { aggregateByTagTool } from '../mcp/tools/aggregate-by-tag';
import { listUntaggedTool } from '../mcp/tools/list-untagged';
import { listTagsTool, tagVideoTool, untagVideoTool } from '../mcp/tools/tags';
import { relatedVideosTool } from '../mcp/tools/related-videos';
import { getReadableArticleTool } from '../mcp/tools/get-readable-article';
import { verifyCitationsTool } from '../mcp/tools/verify-citations';
import { addVideoTool } from '../mcp/tools/add-video';
import { saveSummaryTool } from '../mcp/tools/save-summary';
import { saveNoteTool } from '../mcp/tools/save-note';
import { fetchTranscriptTool } from '../mcp/tools/fetch-transcript';
import { reindexEmbeddingsTool } from '../mcp/tools/reindex-embeddings';
import { generateDigestTool } from '../mcp/tools/generate-digest';

const tagNames = z.array(z.string().min(1).max(40));

const videoIdInput = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('Either the youtubeVideoId or the Strapi documentId.'),
});

export const domainTools: DomainTool[] = [
  {
    tool: libraryStatsTool,
    title: 'Library stats overview',
    access: 'read',
    input: z.object({
      topTags: z.number().int().min(1).max(50).default(15),
      topAuthors: z.number().int().min(1).max(50).default(10),
      recentMonths: z.number().int().min(1).max(24).default(12),
    }),
  },
  {
    tool: listVideosTool,
    title: 'List videos',
    access: 'read',
    input: z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      status: z
        .enum(['any', 'pending', 'generated', 'failed'])
        .default('any')
        .describe('Filter by summaryStatus.'),
      verdict: z
        .enum(['any', 'worth_it', 'skim', 'skip'])
        .default('any')
        .describe('Filter by the AI watch verdict.'),
      tag: z
        .string()
        .optional()
        .describe('Filter by tag name (lowercase, exact).'),
    }),
  },
  {
    tool: searchVideosTool,
    title: 'Search videos',
    access: 'read',
    input: z.object({
      query: z
        .string()
        .min(1)
        .max(200)
        .describe(
          'Tokenized match against title/url/id/summary fields; a full YouTube URL or 11-char id also works.',
        ),
      limit: z.number().int().min(1).max(50).default(10),
      tag: z.string().optional().describe('Optional tag filter (lowercase).'),
    }),
  },
  {
    tool: getMusicDataTool,
    title: 'Get extracted music data',
    access: 'read',
    input: videoIdInput,
  },
  {
    tool: getVideoTool,
    title: 'Get a video',
    access: 'read',
    input: videoIdInput,
  },
  {
    tool: getTranscriptTool,
    title: 'Get a transcript',
    access: 'read',
    input: z.object({
      videoId: z.string().min(1).describe('YouTube video id.'),
      mode: z
        .enum(['full', 'chunked', 'timeRange'])
        .default('full')
        .describe('full: rawText slice (offset/maxChars). chunked: segment page (page/pageSize). timeRange: segments in [startSec,endSec].'),
      startSec: z.number().int().min(0).optional(),
      endSec: z.number().int().min(0).optional(),
      offset: z.number().int().min(0).default(0).describe('full mode: char offset; follow nextOffset to continue.'),
      maxChars: z.number().int().min(500).max(400_000).default(120_000).describe('full mode: max chars (default 120000).'),
      page: z.number().int().min(1).default(1).describe('chunked mode: 1-based page.'),
      pageSize: z.number().int().min(1).max(500).default(200).describe('chunked mode: segments per page (default 200).'),
    }),
  },
  {
    tool: searchTranscriptTool,
    title: 'Search within a transcript',
    access: 'read',
    input: z.object({
      videoId: z.string().min(1).describe('YouTube video id to search within.'),
      query: z.string().min(2).max(300).describe('Natural-language query; stopwords ignored.'),
      k: z.number().int().min(1).max(25).default(8).describe('Top-k chunks. Default 8.'),
    }),
  },
  {
    tool: findTranscriptsTool,
    title: 'Find transcripts',
    access: 'read',
    input: z.object({
      query: z.string().min(1).max(200).describe('Free-text query over title/id/rawText (all tokens must appear).'),
      limit: z.number().int().min(1).max(50).default(10),
      includeFullContent: z.boolean().default(false).describe('Include full transcript text per match.'),
    }),
  },
  {
    tool: crossSearchTranscriptsTool,
    title: 'Search across transcripts',
    access: 'read',
    input: z.object({
      query: z.string().min(2).max(300),
      tags: z.array(z.string().min(1).max(40)).max(10).optional().describe('Optional tag filter (any-of).'),
      perVideo: z.number().int().min(1).max(10).default(3).describe('Max chunks per video.'),
      maxVideos: z.number().int().min(1).max(100).default(25).describe('Max videos to scan.'),
    }),
  },
  {
    tool: listTranscriptsTool,
    title: 'List transcripts',
    access: 'read',
    input: z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      sort: z.enum(['newest', 'oldest', 'title']).default('newest'),
    }),
  },
  {
    tool: aggregateByTagTool,
    title: 'Aggregate videos by tag',
    access: 'read',
    input: z.object({
      tags: z.array(z.string().min(1).max(40)).min(1).max(10).describe('One or more tag names (lowercased).'),
      match: z.enum(['any', 'all']).default('any'),
      limit: z.number().int().min(1).max(200).default(50),
      fields: z.enum(['header', 'summary', 'full']).default('summary'),
    }),
  },
  {
    tool: listUntaggedTool,
    title: 'List untagged videos',
    access: 'read',
    input: z.object({
      limit: z.number().int().min(1).max(200).default(25),
      onlyGenerated: z.boolean().default(true).describe('Only videos whose summary finished generating.'),
    }),
  },
  {
    tool: listTagsTool,
    title: 'List tags',
    access: 'read',
    input: z.object({
      limit: z.number().int().min(1).max(500).default(100),
    }),
  },
  {
    tool: relatedVideosTool,
    title: 'Related videos',
    access: 'read',
    input: z.object({
      videoId: z.string().min(1).describe('youtubeVideoId or documentId.'),
      limit: z.number().int().min(1).max(20).optional().describe('Max neighbors. Default 6.'),
      minScore: z.number().min(-1).max(1).optional().describe('Cosine floor. Default 0.5.'),
    }),
  },
  {
    tool: getReadableArticleTool,
    title: 'Get the readable article',
    access: 'read',
    input: z.object({
      videoId: z.string().min(1).max(64).describe('youtubeVideoId or documentId.'),
    }),
  },
  {
    tool: verifyCitationsTool,
    title: 'Verify transcript citations',
    access: 'read',
    input: z.object({
      videoId: z.string().min(1).describe('YouTube video id whose transcript the citations target.'),
      text: z.string().min(1).describe('Draft text containing [mm:ss] / (mm:ss) / bare mm:ss citations.'),
      toleranceSec: z.number().int().min(0).default(30).describe('Drift threshold in seconds. Default 30.'),
      minScore: z.number().min(0).default(1.5).describe('Min BM25 confidence to act on. Default 1.5.'),
    }),
  },

  // ---- Write tools (gated by the music-kb-mcp.write admin action) ----
  {
    tool: addVideoTool,
    title: 'Add a video',
    access: 'maintenance',
    input: z.object({
      url: z.string().url().describe('Full YouTube URL (watch, youtu.be, or shorts).'),
      caption: z.string().max(500).optional(),
      tags: tagNames.max(20).optional().describe('Optional tags (lowercased on save).'),
    }),
  },
  {
    tool: saveSummaryTool,
    title: 'Save a video summary',
    access: 'write',
    input: z.object({
      videoId: z.string().min(1).describe('youtubeVideoId or documentId of an existing Video.'),
      summaryTitle: z.string().min(1).max(200),
      summaryDescription: z.string().min(1).max(500),
      summaryOverview: z.string().min(1).describe('Markdown TL;DR — 1–2 paragraphs.'),
      watchVerdict: z.enum(['skip', 'skim', 'worth_it']),
      verdictSummary: z.string().min(1).max(280),
      verdictReason: z.string().min(1).max(1000),
      keyTakeaways: z.array(z.object({ text: z.string().min(1).max(280) })).min(1).max(10),
      sections: z
        .array(
          z.object({
            heading: z.string().min(1).max(200),
            body: z.string().min(1).max(2000),
            timeSec: z.number().int().min(0).optional(),
          }),
        )
        .min(1)
        .max(20),
      actionSteps: z
        .array(z.object({ title: z.string().min(1).max(120), body: z.string().min(1).max(600) }))
        .min(1)
        .max(10),
      aiModel: z.string().max(100).optional(),
    }),
  },
  {
    tool: tagVideoTool,
    title: 'Tag a video',
    access: 'write',
    input: z.object({
      videoId: z.string().min(1).describe('youtubeVideoId or documentId.'),
      tags: tagNames.min(1).max(20).describe('Tag names to apply (created on the fly).'),
    }),
  },
  {
    tool: untagVideoTool,
    title: 'Untag a video',
    access: 'write',
    input: z.object({
      videoId: z.string().min(1),
      tags: tagNames.min(1).max(20),
    }),
  },
  {
    tool: saveNoteTool,
    title: 'Save a note',
    access: 'write',
    input: z.object({
      videoId: z.string().min(1).describe('youtubeVideoId or documentId.'),
      body: z.string().min(1).describe('Note body (markdown).'),
      title: z.string().max(200).optional(),
      author: z.string().max(120).optional().describe('Defaults to "mcp".'),
    }),
  },
  {
    tool: fetchTranscriptTool,
    title: 'Fetch a transcript from YouTube',
    access: 'maintenance',
    input: z.object({
      videoId: z.string().min(1).describe('11-char YouTube video id.'),
      force: z.boolean().default(false).describe('Re-fetch and overwrite if one exists.'),
      proxyUrl: z.string().url().optional().describe('Optional residential proxy; falls back to TRANSCRIPT_PROXY_URL.'),
    }),
  },
  {
    tool: reindexEmbeddingsTool,
    title: 'Reindex topical embeddings',
    access: 'maintenance',
    input: z.object({
      scope: z.enum(['missing', 'stale', 'all']).default('missing').describe('Which videos to (re)embed.'),
    }),
  },
  {
    tool: generateDigestTool,
    title: 'Generate a digest',
    access: 'maintenance',
    input: z.object({
      videoIds: z
        .array(z.string().min(1).max(64))
        .min(2)
        .max(5)
        .describe('2–5 generated videos (youtubeVideoId or documentId).'),
    }),
  },
];
