// Ingest a YouTube URL into the knowledge base. Creates a Video row +
// fetches and stores the transcript (via the same fetchYouTubeTranscript
// helper the in-app pipeline uses).
//
// The Strapi middleware at server/src/index.ts already enforces dedupe on
// youtubeVideoId — this tool surfaces the resulting error cleanly instead
// of crashing the MCP call.
//
// Summary generation is NOT triggered here — that's an Ollama-bound task
// and belongs in the in-app pipeline. After adding, the user can generate
// the summary from the app UI, or (from Claude Desktop) call saveSummary
// with a summary the frontier model produced itself.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { fetchYouTubeTranscript, fetchYouTubeMeta } from '../../services/youtube-transcript';
import { slugifyTagName } from './tag-utils';

const schema = z.object({
  url: z
    .string()
    .url()
    .describe('Full YouTube URL (youtube.com/watch?v=..., youtu.be/..., or shorts URL).'),
  caption: z
    .string()
    .max(500)
    .optional()
    .describe('Optional user-facing caption for this video.'),
  tags: z
    .array(z.string().min(1).max(40))
    .max(20)
    .optional()
    .describe('Optional tags to apply. Normalized lowercase-trimmed on save.'),
});

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1).split('/')[0] || null;
    }
    if (/youtube\.com$/.test(u.hostname) || /youtube\.com$/.test(u.hostname.replace(/^www\./, ''))) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const shorts = u.pathname.match(/\/shorts\/([^/?#]+)/);
      if (shorts) return shorts[1];
    }
    return null;
  } catch {
    return null;
  }
}

type Segment = { text: string; startMs: number; endMs: number };

export const addVideoTool: ToolDef<z.infer<typeof schema>> = {
  name: 'addVideo',
  description:
    'WRITE OPERATION — ingest a NEW YouTube URL into the knowledge base. DO NOT call this for "find", "summarize", "look up", "tell me about", or "get info on" a video — those are READ requests and must go through `searchVideos`/`findTranscripts` FIRST. Only call `addVideo` when (a) the user used an explicit write verb like "add", "ingest", "import", "save", or "ingest this video", AND (b) `searchVideos` has already returned zero matches for that URL/title/videoId. If both conditions aren\'t met, call `searchVideos` instead. Ingesting a video that already exists throws a duplicate-key error; ingesting when the user didn\'t ask to ingest wastes a YouTube fetch and surprises the user.',
  schema,
  execute: async ({ url, caption, tags }, { strapi }) => {
    const videoId = extractVideoId(url);
    if (!videoId) {
      return { error: `Could not extract a YouTube video id from url "${url}".` };
    }

    const existingVideo = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
    })) as { documentId: string } | null;
    if (existingVideo) {
      return {
        videoId,
        action: 'exists',
        videoDocumentId: existingVideo.documentId,
        message: 'Video already in knowledge base.',
      };
    }

    const [transcript, meta] = await Promise.all([
      fetchYouTubeTranscript(videoId, { proxyUrl: process.env.TRANSCRIPT_PROXY_URL }),
      fetchYouTubeMeta(videoId),
    ]);

    const segments: Segment[] = transcript.segments.map((s) => ({
      text: s.text,
      startMs: s.start,
      endMs: s.end,
    }));

    // Create transcript row first so a later failure doesn't orphan a
    // Video without its cached captions — matches the ordering in
    // client/src/lib/services/learning.ts.
    const existingTranscript = (await strapi.documents('api::transcript.transcript').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
    })) as { documentId: string } | null;

    const transcriptRow = existingTranscript
      ? existingTranscript
      : ((await strapi.documents('api::transcript.transcript').create({
          data: {
            youtubeVideoId: videoId,
            title: transcript.title ?? meta.title ?? null,
            author: meta.author ?? null,
            thumbnailUrl: meta.thumbnailUrl ?? null,
            language: 'en',
            durationSec: transcript.durationSec,
            rawSegments: segments,
            rawText: transcript.fullTranscript,
            fetchedAt: new Date().toISOString(),
          },
        })) as { documentId: string });

    // Resolve tags: create any that don't exist yet (server/src/index.ts
    // normalizes names lower-case on create).
    const tagDocumentIds: string[] = [];
    for (const raw of tags ?? []) {
      const name = raw.trim().toLowerCase();
      if (!name) continue;
      let existing = (await strapi.documents('api::tag.tag').findFirst({
        filters: { name: { $eq: name } },
      })) as { documentId: string } | null;
      if (!existing) {
        // `documents().create()` does NOT auto-generate uid fields, so we
        // pass the slug explicitly (matches what the admin UI produces).
        existing = (await strapi.documents('api::tag.tag').create({
          data: { name, slug: slugifyTagName(name) } as never,
        })) as { documentId: string };
      }
      tagDocumentIds.push(existing.documentId);
    }

    const video = (await strapi.documents('api::video.video').create({
      data: {
        youtubeVideoId: videoId,
        url,
        videoTitle: transcript.title ?? meta.title ?? null,
        videoAuthor: meta.author ?? null,
        videoThumbnailUrl: meta.thumbnailUrl ?? null,
        caption: caption ?? null,
        summaryStatus: 'pending',
        transcript: transcriptRow.documentId,
        tags: tagDocumentIds,
      } as never,
    })) as { documentId: string };

    return {
      videoId,
      action: 'created',
      videoDocumentId: video.documentId,
      transcriptDocumentId: transcriptRow.documentId,
      segmentCount: segments.length,
      durationSec: transcript.durationSec,
      tags: tags ?? [],
    };
  },
};
