// MCP lesson writes never keep a timecode the model produced (issue #10).
//
// A lesson reaches Strapi two ways. The app's generator tells the model NOT
// to emit timecodes and derives each one itself, by BM25 against the cited
// video's real transcript — CLAUDE.md: "Do not add a code path that trusts a
// timecode the model produced." The MCP createLesson / updateLesson tools used
// to store `source.timeSec` exactly as the model sent it: a code path that
// trusted it. This module puts the app's policy on the MCP path.
//
// The policy is the app's, not a new one — see `resolveBlockSource` and
// `groundingTextOf` in client/src/lib/services/lesson-generation.ts:
//
//   - A confident transcript match decides the timecode, whatever was sent,
//     and adds one where none was.
//   - No confident match, no stored index, or no text to match against means
//     NO timecode. "A wrong timecode is worse than no timecode." The citation
//     to the video stays; only the moment goes.
//   - A citation to a video that is not in the library is reported, not
//     corrected: that is a hallucinated source, and the caller rejects the
//     write so the model can fix it.
//
// Server code only READS a stored index — the client builds it and persists
// it on `Video.transcriptSegments` (ADR 0010).

import type { Core } from '@strapi/strapi';
import { findEvidenceForQuote, isStoredIndex, type BM25Index } from '../../services/bm25-search';

/** What the library knows about one cited video. */
export type CitedVideo = { exists: false } | { exists: true; index: BM25Index | null };

export type TimecodeGrounding = {
  /** Timecodes set from the transcript: a changed value (`from` = what was sent) or an added one (`from` = null). */
  grounded: Array<{ block: number; videoId: string; from: number | null; to: number }>;
  /** Timecodes removed because none could be grounded. */
  removed: Array<{ block: number; videoId: string; from: number; reason: 'no-match' | 'no-index' | 'no-text' }>;
  /** Cited videos that are not in the library. The caller should reject the write. */
  unknownVideos: string[];
};

type Block = Record<string, any>;

/**
 * The text a block's citation is grounded against. Mirrors the app's
 * `groundingTextOf`, plus the video-ref case: on the app path a video-ref is
 * grounded on the "moment" text the markdown carries, and on this path the
 * closest equivalent is its link `label`.
 */
export function groundingTextOf(block: Block): string {
  switch (block.__component) {
    case 'lesson.step':
      return [block.title, block.lede, block.body]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join('. ');
    case 'lesson.prose':
    case 'lesson.callout':
      return typeof block.body === 'string' ? block.body : '';
    case 'lesson.video-ref':
      return typeof block.label === 'string' ? block.label : '';
    default:
      return typeof block.caption === 'string' ? block.caption : '';
  }
}

/** Where a block keeps its citation, or null when it has none to ground. */
function citationOf(block: Block): { videoId: string | undefined; holder: Block } | null {
  if (block.__component === 'lesson.video-ref') return { videoId: block.videoId, holder: block };
  if (block.source && typeof block.source === 'object') return { videoId: block.source.videoId, holder: block.source };
  return null;
}

/** Every distinct video the body cites. */
export function citedVideoIds(body: readonly Block[]): string[] {
  const ids = new Set<string>();
  for (const block of body) {
    const videoId = citationOf(block)?.videoId;
    if (typeof videoId === 'string' && videoId) ids.add(videoId);
  }
  return [...ids];
}

/**
 * Ground every citation's timecode in `body`, IN PLACE, and report what
 * changed. Pure: the caller supplies what the library knows about each cited
 * video (see `loadCitedVideos`).
 */
export function groundLessonTimecodes(
  body: Block[],
  videos: ReadonlyMap<string, CitedVideo>,
): TimecodeGrounding {
  const report: TimecodeGrounding = { grounded: [], removed: [], unknownVideos: [] };
  const unknown = new Set<string>();

  body.forEach((block, i) => {
    const citation = citationOf(block);
    if (!citation) return;
    const { videoId, holder } = citation;
    const sent = typeof holder.timeSec === 'number' ? (holder.timeSec as number) : null;

    // A moment with no video to belong to means nothing.
    if (typeof videoId !== 'string' || !videoId) {
      delete holder.timeSec;
      return;
    }

    const video = videos.get(videoId);
    if (!video || !video.exists) {
      unknown.add(videoId);
      return;
    }

    const drop = (reason: TimecodeGrounding['removed'][number]['reason']) => {
      if (sent === null) return;
      delete holder.timeSec;
      report.removed.push({ block: i, videoId, from: sent, reason });
    };

    if (!video.index) return drop('no-index');
    const text = groundingTextOf(block).trim();
    if (!text) return drop('no-text');

    // Default minScore, as the app uses: a weak match is not a moment.
    const evidence = findEvidenceForQuote(text, video.index);
    if (!evidence) return drop('no-match');

    holder.timeSec = evidence.timeSec;
    if (sent !== evidence.timeSec) {
      report.grounded.push({ block: i, videoId, from: sent, to: evidence.timeSec });
    }
  });

  report.unknownVideos = [...unknown];
  return report;
}

/** Look up each cited video and its stored BM25 index. */
export async function loadCitedVideos(
  strapi: Core.Strapi,
  videoIds: readonly string[],
): Promise<Map<string, CitedVideo>> {
  const out = new Map<string, CitedVideo>();
  await Promise.all(
    videoIds.map(async (videoId) => {
      const video = (await strapi.documents('api::video.video').findFirst({
        filters: { youtubeVideoId: { $eq: videoId } },
        fields: ['youtubeVideoId', 'transcriptSegments'],
      } as never)) as { transcriptSegments?: unknown } | null;
      out.set(
        videoId,
        video
          ? { exists: true, index: isStoredIndex(video.transcriptSegments) ? video.transcriptSegments.bm25 : null }
          : { exists: false },
      );
    }),
  );
  return out;
}

/** The tool-call error for citations to videos outside the library. */
export function unknownVideosError(ids: readonly string[]): string {
  return (
    `These cited video IDs are not in the library: ${ids.join(', ')}. A citation (a block's \`source.videoId\` or a ` +
    'lesson.video-ref `videoId`) must be the youtubeVideoId of a video that exists — find one with searchVideos or ' +
    'listVideos. Nothing was written.'
  );
}
