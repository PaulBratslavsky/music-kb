// Tool registration entry point. Imported from server/src/index.ts
// register() so the registry is populated before the MCP route starts
// accepting requests. Adding a new tool = import here + call registerTool.

import { registerTool } from '../registry';

import { listTranscriptsTool } from './list-transcripts';
import { getTranscriptTool } from './get-transcript';
import { searchTranscriptTool } from './search-transcript';
import { findTranscriptsTool } from './find-transcripts';
import { fetchTranscriptTool } from './fetch-transcript';

import { listVideosTool } from './list-videos';
import { getVideoTool } from './get-video';
import { searchVideosTool } from './search-videos';
import { addVideoTool } from './add-video';
import { saveSummaryTool } from './save-summary';

import { listTagsTool, tagVideoTool, untagVideoTool } from './tags';
import { saveNoteTool } from './save-note';

import { aggregateByTagTool } from './aggregate-by-tag';
import { listUntaggedTool } from './list-untagged';
import { crossSearchTranscriptsTool } from './cross-search-transcripts';
import { libraryStatsTool } from './library-stats';
import { generateDigestTool } from './generate-digest';
import { getReadableArticleTool } from './get-readable-article';

import { reindexEmbeddingsTool } from './reindex-embeddings';
import { relatedVideosTool } from './related-videos';

let registered = false;

export function registerAllTools(): void {
  if (registered) return;
  registered = true;

  // Transcript tools — data access for stored captions.
  registerTool(listTranscriptsTool);
  registerTool(getTranscriptTool);
  registerTool(searchTranscriptTool);
  registerTool(findTranscriptsTool);
  registerTool(fetchTranscriptTool);

  // Video / KB tools — catalog-level.
  registerTool(listVideosTool);
  registerTool(getVideoTool);
  registerTool(searchVideosTool);
  registerTool(addVideoTool);
  registerTool(saveSummaryTool);

  // Organization tools — tags + notes.
  registerTool(listTagsTool);
  registerTool(tagVideoTool);
  registerTool(untagVideoTool);
  registerTool(saveNoteTool);

  // Aggregators — cross-video workflows (reason over many rows in one call).
  registerTool(aggregateByTagTool);
  registerTool(listUntaggedTool);
  registerTool(crossSearchTranscriptsTool);
  registerTool(libraryStatsTool);
  registerTool(generateDigestTool);
  registerTool(getReadableArticleTool);

  // Semantic discovery — per-video topical embeddings. Same (model, version)
  // contract as the client; `reindexEmbeddings` is the maintenance lever
  // when either changes.
  registerTool(reindexEmbeddingsTool);
  registerTool(relatedVideosTool);
}
