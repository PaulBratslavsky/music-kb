// The music-kb domain tools registered on the official MCP server.
//
// Each entry pairs a tool's execute body (from ./tools/) with an access tier
// (read | write | maintenance) and a human title. The INPUT SCHEMA IS NOT
// HERE — it lives on the tool itself (`ToolDef.schema`, built with the
// app's own top-level `zod` dependency) and the adapter reads it from there.
//
// This file used to carry a second, hand-maintained copy of every input
// schema, on the belief that @strapi/utils shipped zod 3 while the app used
// zod 4. That reasoning was itself wrong (@strapi/utils re-exports zod v4,
// not zod 3 — see ADR 0008), and on top of that the tools were building
// their schemas with @strapi/utils's re-exported `z`, whose `.describe()`
// calls silently never reached MCP clients (see ADR 0008): Zod 4 keeps
// description text in a per-module-instance registry, and the MCP SDK
// converts with its own bundled zod, which can't see a description
// recorded by a different zod copy. Tool schemas are now built with the
// app's own `zod` import instead, so descriptions survive. The
// hand-maintained copies had already drifted — listVideos' `verdict`
// guidance rotted to a one-liner in the copy clients actually saw — so
// there is exactly one declaration per tool. Do not reintroduce a second
// one.
import type { DomainTool } from './adapter';

import { libraryStatsTool } from './tools/library-stats';
import { listVideosTool } from './tools/list-videos';
import { searchVideosTool } from './tools/search-videos';
import { getMusicDataTool } from './tools/get-music-data';
import { getVideoTool } from './tools/get-video';
import { getTranscriptTool } from './tools/get-transcript';
import { searchTranscriptTool } from './tools/search-transcript';
import { findTranscriptsTool } from './tools/find-transcripts';
import { crossSearchTranscriptsTool } from './tools/cross-search-transcripts';
import { listTranscriptsTool } from './tools/list-transcripts';
import { aggregateByTagTool } from './tools/aggregate-by-tag';
import { listUntaggedTool } from './tools/list-untagged';
import { listTagsTool, tagVideoTool, untagVideoTool } from './tools/tags';
import { relatedVideosTool } from './tools/related-videos';
import { getReadableArticleTool } from './tools/get-readable-article';
import { verifyCitationsTool } from './tools/verify-citations';
import { addVideoTool } from './tools/add-video';
import { saveSummaryTool } from './tools/save-summary';
import { saveNoteTool } from './tools/save-note';
import { fetchTranscriptTool } from './tools/fetch-transcript';
import { reindexEmbeddingsTool } from './tools/reindex-embeddings';
import { generateDigestTool } from './tools/generate-digest';

export const domainTools: DomainTool[] = [
  // ---- Read tools (gated by the music-kb-mcp.read admin action) ----
  { tool: libraryStatsTool, title: 'Library stats overview', access: 'read' },
  { tool: listVideosTool, title: 'List videos', access: 'read' },
  { tool: searchVideosTool, title: 'Search videos', access: 'read' },
  { tool: getMusicDataTool, title: 'Get extracted music data', access: 'read' },
  { tool: getVideoTool, title: 'Get a video', access: 'read' },
  { tool: getTranscriptTool, title: 'Get a transcript', access: 'read' },
  { tool: searchTranscriptTool, title: 'Search within a transcript', access: 'read' },
  { tool: findTranscriptsTool, title: 'Find transcripts', access: 'read' },
  { tool: crossSearchTranscriptsTool, title: 'Search across transcripts', access: 'read' },
  { tool: listTranscriptsTool, title: 'List transcripts', access: 'read' },
  { tool: aggregateByTagTool, title: 'Aggregate videos by tag', access: 'read' },
  { tool: listUntaggedTool, title: 'List untagged videos', access: 'read' },
  { tool: listTagsTool, title: 'List tags', access: 'read' },
  { tool: relatedVideosTool, title: 'Related videos', access: 'read' },
  { tool: getReadableArticleTool, title: 'Get the readable article', access: 'read' },
  { tool: verifyCitationsTool, title: 'Verify transcript citations', access: 'read' },

  // ---- Write tools (gated by the music-kb-mcp.write admin action) ----
  { tool: saveSummaryTool, title: 'Save a video summary', access: 'write' },
  { tool: tagVideoTool, title: 'Tag a video', access: 'write' },
  { tool: untagVideoTool, title: 'Untag a video', access: 'write' },
  { tool: saveNoteTool, title: 'Save a note', access: 'write' },

  // ---- Maintenance tools (expensive / external side effects / hard to undo)
  //      gated by the music-kb-mcp.maintenance admin action ----
  { tool: addVideoTool, title: 'Add a video', access: 'maintenance' },
  { tool: fetchTranscriptTool, title: 'Fetch a transcript from YouTube', access: 'maintenance' },
  { tool: reindexEmbeddingsTool, title: 'Reindex topical embeddings', access: 'maintenance' },
  { tool: generateDigestTool, title: 'Generate a digest', access: 'maintenance' },
];
