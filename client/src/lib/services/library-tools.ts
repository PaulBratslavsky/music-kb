// Agentic tools for the library-chat synthesizer (progressive retrieval).
//
// The synthesizer starts each turn with only the #1-ranked candidate's
// passages loaded; the other 4 candidates appear as metadata-only. The
// primary tool is `load_passages(youtubeVideoId)` — it pulls the
// pre-retrieved passages for one candidate on demand, so the model only
// grows its context when it genuinely needs to.
//
// `buildLibraryTools(opts)` closes over the per-request pool so
// load_passages returns passages with their correct [N] citation
// indices (the same ones emitted in the upfront CITATIONS frame).
//
// The other tools (`search_library`, `get_video_details`,
// `list_videos_by_topic`) are escape hatches for off-candidate work —
// the model is instructed to prefer load_passages first.

import { toolDefinition } from '@tanstack/ai';
import { z } from 'zod';
import {
  retrievePassagesForQuery,
  groupPassagesByVideo,
  type RetrievedPassage,
} from './ask-library';
import {
  fetchVideoByVideoIdService,
  listAllVideosForEmbeddingService,
} from './videos';

// ---------------------------------------------------------------------------
// Tool: search_library
//
// Run a fresh hybrid retrieval with a new query. Use when the initial
// sources don't cover a subtopic, or when the user's question has a
// second axis that needs its own retrieval pass.
// ---------------------------------------------------------------------------

const SearchLibraryInput = z.object({
  query: z
    .string()
    .min(2)
    .max(200)
    .describe(
      'Search query for passages across the library. Natural language, not keyword fragments. Example: "Strapi authentication with Better Auth".',
    ),
});

const SearchLibraryOutput = z.object({
  results: z.array(
    z.object({
      videoTitle: z.string().nullable(),
      videoAuthor: z.string().nullable(),
      youtubeVideoId: z.string(),
      startSec: z.number(),
      endSec: z.number(),
      passageText: z.string(),
    }),
  ),
});

export const searchLibraryTool = toolDefinition({
  name: 'search_library',
  description: [
    'Run a fresh hybrid retrieval across every video in the library for a new query.',
    'Use when the pre-injected SOURCES/PASSAGES don\'t cover a subtopic, or when comparing two things you need to retrieve each side separately.',
    'Returns up to 5 passages. Each has the parent video\'s title, youtubeVideoId, the passage start/end in seconds, and the passage text.',
    'Do NOT call this for questions already answered by the initial context. Skip the tool if you can answer from what you already have.',
  ].join(' '),
  inputSchema: SearchLibraryInput,
  outputSchema: SearchLibraryOutput,
}).server(async ({ query }) => {
  const passages = await retrievePassagesForQuery(query, {
    maxVideos: 3,
    passagesPerVideo: 2,
    minScore: 0.35,
  });
  console.log(
    `[${new Date().toISOString().slice(11, 23)}] [tool search_library] "${query}" → ${passages.length} passages`,
  );
  return {
    results: passages.map((p) => ({
      videoTitle: p.video.videoTitle,
      videoAuthor: p.video.videoAuthor,
      youtubeVideoId: p.video.youtubeVideoId,
      startSec: p.startSec,
      endSec: p.endSec,
      passageText: p.text,
    })),
  };
});

// ---------------------------------------------------------------------------
// Tool: get_video_details
//
// Pull the full structured summary of one video — description, overview,
// key takeaways, sections with timestamps, tags. Use when the user
// asks "tell me more about that video" or when you need deeper
// context on a video already cited in the initial sources.
// ---------------------------------------------------------------------------

const GetVideoDetailsInput = z.object({
  youtubeVideoId: z
    .string()
    .min(1)
    .max(64)
    .describe(
      'The YouTube video ID (e.g. "v3Fr2JR47KA"). Get this from a passage\'s metadata or a prior tool result — do not invent.',
    ),
});

const GetVideoDetailsOutput = z.object({
  videoTitle: z.string().nullable(),
  videoAuthor: z.string().nullable(),
  summaryDescription: z.string().nullable(),
  summaryOverview: z.string().nullable(),
  keyTakeaways: z.array(z.object({ text: z.string() })),
  sections: z.array(
    z.object({
      heading: z.string(),
      body: z.string(),
      timeSec: z.number().nullable(),
    }),
  ),
  tags: z.array(z.string()),
  watchVerdict: z.string().nullable(),
  verdictSummary: z.string().nullable(),
});

export const getVideoDetailsTool = toolDefinition({
  name: 'get_video_details',
  description: [
    'Fetch the full structured summary of a single video — description, overview paragraph, key takeaways, timestamped sections, and tags.',
    'Use when: the user asks to go deeper on one video; you need structure/sections that aren\'t in the passages; or you need a canonical definition that\'s in the summary but not the retrieved chunks.',
    'Input is the youtubeVideoId — get it from a passage or prior tool result.',
  ].join(' '),
  inputSchema: GetVideoDetailsInput,
  outputSchema: GetVideoDetailsOutput,
}).server(async ({ youtubeVideoId }) => {
  const video = await fetchVideoByVideoIdService(youtubeVideoId);
  if (!video) {
    console.log(
      `[${new Date().toISOString().slice(11, 23)}] [tool get_video_details] "${youtubeVideoId}" → not found`,
    );
    return {
      videoTitle: null,
      videoAuthor: null,
      summaryDescription: null,
      summaryOverview: null,
      keyTakeaways: [],
      sections: [],
      tags: [],
      watchVerdict: null,
      verdictSummary: null,
    };
  }
  console.log(
    `[${new Date().toISOString().slice(11, 23)}] [tool get_video_details] "${youtubeVideoId}" → "${video.videoTitle}"`,
  );
  return {
    videoTitle: video.videoTitle,
    videoAuthor: video.videoAuthor,
    summaryDescription: video.summaryDescription,
    summaryOverview: video.summaryOverview,
    keyTakeaways: (video.keyTakeaways ?? []).map((t) => ({ text: t.text })),
    sections: (video.sections ?? []).map((s) => ({
      heading: s.heading,
      body: s.body,
      timeSec: s.timeSec,
    })),
    tags: (video.tags ?? []).map((t) => t.name),
    watchVerdict: video.watchVerdict,
    verdictSummary: video.verdictSummary,
  };
});

// ---------------------------------------------------------------------------
// Tool: list_videos_by_topic
//
// Find videos by tag or title keyword. Use when the user asks "what
// videos do I have about X" — cheaper and more focused than
// search_library which returns passages, not whole videos.
// ---------------------------------------------------------------------------

const ListVideosByTopicInput = z.object({
  topic: z
    .string()
    .min(1)
    .max(60)
    .describe(
      'A single topic keyword — a product name, framework, or concept. Matched against video titles, authors, and tags.',
    ),
});

const ListVideosByTopicOutput = z.object({
  videos: z.array(
    z.object({
      videoTitle: z.string().nullable(),
      videoAuthor: z.string().nullable(),
      youtubeVideoId: z.string(),
      summaryDescription: z.string().nullable(),
      tags: z.array(z.string()),
    }),
  ),
});

export const listVideosByTopicTool = toolDefinition({
  name: 'list_videos_by_topic',
  description: [
    'List videos in the library that match a single topic keyword (title, channel, or tag).',
    'Use when the user asks "what videos do I have about X" or "which videos talk about Y".',
    'Returns up to 10 videos with title, author, description, and tags.',
  ].join(' '),
  inputSchema: ListVideosByTopicInput,
  outputSchema: ListVideosByTopicOutput,
}).server(async ({ topic }) => {
  const needle = topic.toLowerCase().trim();
  const all = await listAllVideosForEmbeddingService();
  const matched = all.filter((v) => {
    if (v.videoTitle?.toLowerCase().includes(needle)) return true;
    if (v.videoAuthor?.toLowerCase().includes(needle)) return true;
    if (v.summaryDescription?.toLowerCase().includes(needle)) return true;
    if (v.tags?.some((t) => t.name.toLowerCase() === needle)) return true;
    return false;
  });
  console.log(
    `[${new Date().toISOString().slice(11, 23)}] [tool list_videos_by_topic] "${topic}" → ${matched.length}`,
  );
  return {
    videos: matched.slice(0, 10).map((v) => ({
      videoTitle: v.videoTitle,
      videoAuthor: v.videoAuthor,
      youtubeVideoId: v.youtubeVideoId,
      summaryDescription: v.summaryDescription,
      tags: (v.tags ?? []).map((t) => t.name),
    })),
  };
});

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

function buildLoadPassagesTool(pool: RetrievedPassage[]) {
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

// ---------------------------------------------------------------------------

export function buildLibraryTools(opts: { pool: RetrievedPassage[] }) {
  return [
    buildLoadPassagesTool(opts.pool),
    searchLibraryTool,
    getVideoDetailsTool,
    listVideosByTopicTool,
  ];
}
