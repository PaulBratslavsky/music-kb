// Cross-video digest — ephemeral synthesis across 2-5 selected videos.
// Mirrors the in-app /digest route: reads the already-compiled summary
// fields for each video, runs a single LLM synthesis, returns structured
// output. Nothing persists.
//
// Frontier-model specific detail: unlike the in-app pipeline (which runs
// local Ollama), the MCP caller brings its own model. This tool does NOT
// call an LLM — it assembles the summary bundle and hands it back as
// structured data for the caller to synthesize itself. That keeps the
// server off the inference path (the whole point of MCP) and avoids
// burning local Ollama cycles from a Claude Desktop session.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  videoIds: z
    .array(z.string().min(1).max(64))
    .min(2)
    .max(5)
    .describe(
      'Exactly 2-5 videos to digest. Each id may be a youtubeVideoId (11 chars) or a Strapi documentId. Every video must have summaryStatus === "generated".',
    ),
});

type VideoRecord = {
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  summaryStatus: string | null;
  summaryTitle: string | null;
  summaryDescription: string | null;
  summaryOverview: string | null;
  watchVerdict: string | null;
  verdictSummary: string | null;
  verdictReason: string | null;
  keyTakeaways: Array<{ text: string }> | null;
  sections: Array<{ heading: string; body: string; timeSec: number | null }> | null;
  actionSteps: Array<{ title: string; body: string }> | null;
};

export const generateDigestTool: ToolDef<z.infer<typeof schema>> = {
  name: 'generateDigest',
  description:
    'Bundle the compiled summary fields for 2-5 videos into a single payload for cross-video synthesis. Returns structured summary data per video (title, description, overview, verdict, takeaways, sections, action steps); the caller does the synthesis using its own model. Use this when the user asks about themes, contradictions, or shared ideas across multiple videos. Every video must already be summarized (summaryStatus === "generated").',
  schema,
  execute: async ({ videoIds }, { strapi }) => {
    const unique = Array.from(new Set(videoIds.map((s) => s.trim()).filter(Boolean)));
    if (unique.length < 2) {
      return { error: 'Need at least 2 distinct videos.' };
    }

    const videos: VideoRecord[] = [];
    const missing: string[] = [];

    for (const id of unique) {
      let row = (await strapi.documents('api::video.video').findFirst({
        filters: { youtubeVideoId: { $eq: id } },
        populate: {
          keyTakeaways: true,
          sections: true,
          actionSteps: true,
        },
      })) as VideoRecord | null;

      if (!row) {
        row = (await strapi.documents('api::video.video').findOne({
          documentId: id,
          populate: {
            keyTakeaways: true,
            sections: true,
            actionSteps: true,
          },
        })) as VideoRecord | null;
      }

      if (!row) {
        missing.push(id);
      } else {
        videos.push(row);
      }
    }

    if (missing.length > 0) {
      return { error: `No video found for: ${missing.join(', ')}` };
    }

    const ineligible = videos.filter((v) => v.summaryStatus !== 'generated');
    if (ineligible.length > 0) {
      const titles = ineligible
        .map((v) => v.videoTitle ?? v.youtubeVideoId)
        .join(', ');
      return {
        error: `These videos need summaries first: ${titles}. Use the in-app pipeline or saveSummary (after generating) to get them ready.`,
      };
    }

    return {
      videos: videos.map((v) => ({
        youtubeVideoId: v.youtubeVideoId,
        documentId: v.documentId,
        videoTitle: v.videoTitle,
        videoAuthor: v.videoAuthor,
        summaryTitle: v.summaryTitle,
        summaryDescription: v.summaryDescription,
        summaryOverview: v.summaryOverview,
        watchVerdict: v.watchVerdict,
        verdictSummary: v.verdictSummary,
        verdictReason: v.verdictReason,
        keyTakeaways: (v.keyTakeaways ?? []).map((t) => t.text),
        sections: (v.sections ?? []).map((s) => ({
          heading: s.heading,
          body: s.body,
          timeSec: s.timeSec,
        })),
        actionSteps: (v.actionSteps ?? []).map((a) => ({
          title: a.title,
          body: a.body,
        })),
      })),
      synthesisGuidance: {
        instructions:
          'Produce a cross-video digest with: (1) overall theme, (2) shared themes with which videos cover each, (3) unique contributions per video, (4) any real contradictions between videos (leave empty if they mostly agree), (5) suggested viewing order when order matters (leave empty if not), (6) bottom-line TL;DR. Use videoTitle strings verbatim when referencing videos so links can be reconstructed.',
        maxVideos: 5,
        minVideos: 2,
      },
    };
  },
};
