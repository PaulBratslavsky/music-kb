// Ported tool definitions for the official MCP server.
//
// Each entry reuses a legacy tool's execute body (imported from the
// hand-rolled server) and pairs it with a zod-3 input schema + access tier.
// Input schemas are re-declared here (zod 3, @strapi/utils) because the
// legacy schemas are zod 4 — see adapter.ts / the migration plan.
//
// This is the FIRST verified slice: read-only tools. Write tools
// (addVideo, saveSummary, tag/untag, saveNote, fetchTranscript,
// reindexEmbeddings, generateDigest) follow once this slice is proven
// end-to-end against a real admin token.
import { z } from '@strapi/utils';
import type { PortedTool } from './adapter';

import { libraryStatsTool } from '../mcp/tools/library-stats';
import { listVideosTool } from '../mcp/tools/list-videos';
import { searchVideosTool } from '../mcp/tools/search-videos';
import { getMusicDataTool } from '../mcp/tools/get-music-data';

export const portedTools: PortedTool[] = [
  {
    legacy: libraryStatsTool,
    title: 'Library stats overview',
    access: 'read',
    input: z.object({
      topTags: z.number().int().min(1).max(50).default(15),
      topAuthors: z.number().int().min(1).max(50).default(10),
      recentMonths: z.number().int().min(1).max(24).default(12),
    }),
  },
  {
    legacy: listVideosTool,
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
    legacy: searchVideosTool,
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
    legacy: getMusicDataTool,
    title: 'Get extracted music data',
    access: 'read',
    input: z.object({
      videoId: z
        .string()
        .min(1)
        .describe('Either the youtubeVideoId or the Strapi documentId.'),
    }),
  },
];
