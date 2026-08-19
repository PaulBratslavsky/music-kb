// BM25 search within a single transcript. Reuses the index already built
// by the in-app summary pipeline and stored on `Video.transcriptSegments`
// — no re-indexing per query.
//
// If the video has no stored BM25 index (e.g. summary hasn't been
// generated yet), falls back to naive substring scoring over the raw
// transcript so the tool still returns something useful.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import {
  formatTimecode,
  isStoredIndex,
  searchBM25,
  type TranscriptChunk,
} from '../../services/bm25-search';

const schema = z.object({
  videoId: z.string().min(1).describe('YouTube video id to search within.'),
  query: z
    .string()
    .min(2)
    .max(300)
    .describe('Natural-language search query. Multi-word phrases work; stopwords are ignored.'),
  k: z
    .number()
    .int()
    .min(1)
    .max(25)
    .default(8)
    .describe('Top-k chunks to return. Default 8.'),
});

type FallbackSegment = { text: string; startMs: number; endMs: number };

export const searchTranscriptTool: ToolDef<z.infer<typeof schema>> = {
  name: 'searchTranscript',
  description:
    'BM25 full-text search INSIDE a single already-known transcript. REQUIRES a videoId — do not call this when the user only gave you a title or description; use `searchVideos` first to find the videoId. Returns top-k passages with timecodes, ideal for answering fine-grained questions grounded in that video. Use `findTranscripts` for cross-video discovery, `searchVideos` for catalog-level title lookup.',
  schema,
  execute: async ({ videoId, query, k }, { strapi }) => {
    const video = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
      populate: ['transcript'],
    })) as unknown as {
      documentId: string;
      youtubeVideoId: string;
      videoTitle?: string | null;
      transcriptSegments?: unknown;
      transcript?: { documentId: string; rawSegments?: FallbackSegment[] | null; rawText?: string | null } | null;
    } | null;

    if (!video) {
      return { error: `No video found for videoId "${videoId}".` };
    }

    // Fast path: BM25 index stored on Video.transcriptSegments.
    if (isStoredIndex(video.transcriptSegments)) {
      const ranked = searchBM25(video.transcriptSegments.bm25, query, k);
      return {
        videoId,
        title: video.videoTitle ?? null,
        source: 'bm25',
        query,
        results: ranked.map((r) => formatResult(r.chunk, r.score)),
      };
    }

    // Fallback: naive substring search against the Transcript row.
    if (!video.transcript || !video.transcript.rawSegments) {
      return {
        error: `No searchable transcript for videoId "${videoId}". Call fetchTranscript and generate a summary to build the BM25 index, or query getTranscript directly.`,
      };
    }

    const q = query.toLowerCase();
    const hits = video.transcript.rawSegments
      .map((seg, idx) => ({
        seg,
        idx,
        score: (seg.text.toLowerCase().match(new RegExp(escapeRegex(q), 'g')) ?? []).length,
      }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return {
      videoId,
      title: video.videoTitle ?? null,
      source: 'substring',
      query,
      results: hits.map((h) => ({
        timecode: formatTimecode(Math.floor(h.seg.startMs / 1000)),
        timeSec: Math.floor(h.seg.startMs / 1000),
        text: h.seg.text,
        score: h.score,
      })),
    };
  },
};

function formatResult(chunk: TranscriptChunk, score: number) {
  return {
    timecode: formatTimecode(chunk.timeSec),
    timeSec: chunk.timeSec,
    text: chunk.text,
    score: Number(score.toFixed(4)),
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
