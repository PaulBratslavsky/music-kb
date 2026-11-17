// The one tool the library chat defines itself: `load_passages`.
//
// The synthesizer starts each turn with only the #1-ranked candidate's
// passages loaded; the other 4 candidates appear as metadata-only.
// `load_passages(youtubeVideoId)` pulls the pre-retrieved passages for one
// candidate on demand, so the model only grows its context when it genuinely
// needs to.
//
// It lives in the app, not in Strapi, because it is not a library tool: it
// closes over the passages THIS request retrieved, so the passages it returns
// carry the same [N] citation indices that were sent to the browser in the
// `library-ask:citations` event.
//
// Every other tool the library chat can call (search across transcripts, find
// videos, fetch one video) is defined once, in Strapi, and loaded over MCP —
// see strapi-mcp-tools.ts. This file used to carry app-side copies of those
// three (`search_library`, `get_video_details`, `list_videos_by_topic`).

import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import { groupPassagesByVideo, type RetrievedPassage } from './ask-library';

// ---------------------------------------------------------------------------
// Tool: load_passages (per-request factory)
//
// The progressive-retrieval workhorse. The seed prompt only shows
// metadata for candidates 2..5; the model calls load_passages to pull
// the actual transcript passages for one of them. Returns passages with
// their pre-assigned [N] citation indices so the model can cite them
// the same way it cites the seed passages.
// ---------------------------------------------------------------------------

const LoadPassagesInput = z.object({
  youtubeVideoId: z
    .string()
    .min(1)
    .max(64)
    .describe(
      'The youtubeVideoId of a candidate video shown in the CANDIDATES block. Must match one of the candidates exactly — do not invent or guess IDs.',
    ),
});

const LoadPassagesOutput = z.object({
  matched: z.boolean(),
  videoTitle: z.string().nullable(),
  videoAuthor: z.string().nullable(),
  passages: z.array(
    z.object({
      index: z.number(),
      startSec: z.number(),
      endSec: z.number(),
      text: z.string(),
    }),
  ),
});

export function buildLoadPassagesTool(pool: RetrievedPassage[]) {
  const groups = groupPassagesByVideo(pool);
  const byYoutubeId = new Map(groups.map((g) => [g.video.youtubeVideoId, g]));
  return toolDefinition({
    name: 'load_passages',
    description: [
      'Load the additional transcript passages for ONE candidate video beyond the single anchor passage already shown in its card.',
      'Input is the youtubeVideoId of a candidate in the CANDIDATE VIDEOS block — never invent or guess IDs.',
      'Returns all passages for that video with their pre-assigned [N] citation indices (including the anchor, re-exposed). Cite them the same way you cite the anchor.',
      'Use this ONLY when a claim needs a specific quote, number, or timestamp beyond what the anchor passage or the summary already shows. If the summary already answers the question, SKIP this tool.',
    ].join(' '),
    inputSchema: LoadPassagesInput,
    outputSchema: LoadPassagesOutput,
  }).server(async ({ youtubeVideoId }) => {
    const group = byYoutubeId.get(youtubeVideoId);
    const ts = new Date().toISOString().slice(11, 23);
    if (!group) {
      console.log(
        `[${ts}] [tool load_passages] "${youtubeVideoId}" → not in candidate pool`,
      );
      return {
        matched: false,
        videoTitle: null,
        videoAuthor: null,
        passages: [],
      };
    }
    console.log(
      `[${ts}] [tool load_passages] "${youtubeVideoId}" (rank ${group.rank}) → ${group.passages.length} passages`,
    );
    return {
      matched: true,
      videoTitle: group.video.videoTitle,
      videoAuthor: group.video.videoAuthor,
      passages: group.passages.map((p) => ({
        index: p.index,
        startSec: p.startSec,
        endSec: p.endSec,
        text: p.text,
      })),
    };
  });
}
