// Music-layer view of a video: the AI-extracted music data blob
// (key, chords, techniques, referenced songs) plus the user's saved
// practice Loops. Use getVideo for the summary/sections view — this
// tool stays focused on the musical content.

import { z } from '@strapi/utils';
import type { ToolDef } from '../registry';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('Either the youtubeVideoId or the Strapi documentId.'),
});

export const getMusicDataTool: ToolDef<z.infer<typeof schema>> = {
  name: 'getMusicData',
  description:
    "Fetch the AI-extracted music data for a Video by youtubeVideoId or documentId: detected key (root/type/confidence), chords, playing techniques, and referenced songs — timeSec values are transcript-grounded, never model-emitted. Also returns the user's saved practice Loops for the video; each loop carries its own key/progression JSON plus label, startSec/endSec, optional bpm, and notes. Use this when you need musical content (what key, which chords, what songs are referenced) or the user's practice regions. Use getVideo for the summary/sections view and getTranscript or searchTranscript for the transcript body.",
  schema,
  execute: async ({ videoId }, { strapi }) => {
    // Try youtubeVideoId first, then fall back to documentId. Select only
    // the music-relevant fields — keeps transcriptSegments and the
    // embedding blobs out of the response entirely.
    const fields = ['youtubeVideoId', 'videoTitle', 'musicExtraction'] as const;

    let video = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
      fields: [...fields],
    })) as
      | (Record<string, unknown> & {
          documentId: string;
          youtubeVideoId?: string;
          videoTitle?: string | null;
          musicExtraction?: unknown;
        })
      | null;

    if (!video) {
      video = (await strapi.documents('api::video.video').findOne({
        documentId: videoId,
        fields: [...fields],
      })) as
        | (Record<string, unknown> & {
            documentId: string;
            youtubeVideoId?: string;
            videoTitle?: string | null;
            musicExtraction?: unknown;
          })
        | null;
    }

    if (!video) {
      return { error: `No video found for "${videoId}".` };
    }

    const loops = (await strapi.documents('api::loop.loop').findMany({
      filters: { video: { documentId: { $eq: video.documentId } } },
      sort: 'startSec:asc',
    })) as Array<
      Record<string, unknown> & {
        documentId: string;
        label?: string;
        startSec?: number;
        endSec?: number;
        key?: unknown;
        progression?: unknown;
        bpm?: number | null;
        notes?: string | null;
      }
    >;

    return {
      videoDocumentId: video.documentId,
      youtubeVideoId: video.youtubeVideoId,
      videoTitle: video.videoTitle ?? null,
      musicExtraction: video.musicExtraction ?? null,
      ...(video.musicExtraction == null
        ? {
            hint: 'No music extraction stored yet. The client app populates it via the "Analyze music" trigger on the learn page, or as part of a summary regeneration.',
          }
        : {}),
      loops: loops.map((loop) => ({
        documentId: loop.documentId,
        label: loop.label,
        startSec: loop.startSec,
        endSec: loop.endSec,
        key: loop.key ?? null,
        progression: loop.progression ?? null,
        bpm: loop.bpm ?? null,
        notes: loop.notes ?? null,
      })),
    };
  },
};
