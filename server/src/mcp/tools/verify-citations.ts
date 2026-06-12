// Verify and rewrite drifted `[mm:ss]` citations in a draft text against a
// video's transcript. The model sometimes emits timecodes that are close to
// where a topic lives but off by 30s+; this tool BM25-grounds each citation
// and rewrites the drifted ones in place, preserving wrapper style.
//
// Soft-fail by design (docs/mcp-citation-rewrite-plan.md, decision #5): the
// tool is safe to chain on every save. No stored BM25 index → text returned
// unchanged with `reason: 'no-index'`; no citations in the text → no-op.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { isStoredIndex, verifyTimecodesInText } from '../../services/bm25-search';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('YouTube video id whose transcript the citations target.'),
  text: z
    .string()
    .min(1)
    .describe('The draft text containing `[mm:ss]` / `(mm:ss)` / bare mm:ss citations.'),
  toleranceSec: z
    .number()
    .int()
    .min(0)
    .default(30)
    .describe('Drift threshold in seconds — citations within this of the grounded location are left untouched. Default 30.'),
  minScore: z
    .number()
    .min(0)
    .default(1.5)
    .describe('Minimum BM25 match confidence to act on a citation. Weak matches are left untouched. Default 1.5.'),
});

export const verifyCitationsTool: ToolDef<z.infer<typeof schema>> = {
  name: 'verifyCitations',
  description:
    'Run before saving any text that contains `[mm:ss]` citations into a video-scoped note, summary, or draft. BM25-matches each citation against the video\'s transcript and rewrites drifted ones in place (wrapper style preserved — `[12:34]` stays bracketed, `(12:34)` stays parenthesized, bare stays bare). Returns the corrected text, an `overrides` audit trail of every rewrite, and an `ungrounded` list of citations with no confident transcript anchor (left untouched — decide whether to re-cite or strip them). Safe to call on every save: no citations or no stored index is a no-op, never an error.',
  schema,
  execute: async ({ videoId, text, toleranceSec, minScore }, { strapi }) => {
    const video = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
    })) as unknown as {
      documentId: string;
      youtubeVideoId: string;
      transcriptSegments?: unknown;
    } | null;

    if (!video) {
      return { error: `No video found for videoId "${videoId}".` };
    }

    // Soft-fail: no stored BM25 index (summary not generated yet) — the
    // caller should still be able to save the draft, just without correction.
    if (!isStoredIndex(video.transcriptSegments)) {
      return {
        text,
        overrides: [],
        ungrounded: [],
        reason: 'no-index',
        hint: `No stored BM25 index for videoId "${videoId}" — generate a summary first (it builds the index). Text returned unchanged.`,
      };
    }

    const result = verifyTimecodesInText(text, video.transcriptSegments.bm25, {
      toleranceSec,
      minScore,
    });

    return {
      text: result.text,
      overrides: result.overrides,
      ungrounded: result.ungrounded,
    };
  },
};
