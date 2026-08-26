// The shape a lesson citation travels in between the content column and
// the video panel, plus the two derivations both sides must agree on:
// which second to start at, and whether two citations point at the same
// moment. Kept out of LessonBody.tsx so the panel can import it without
// pulling in react-markdown and the whole diagram renderer set.

export type LessonCitation = {
  videoId: string;
  /** The BM25-grounded second inside that video. Optional on purpose:
   *  the grounding pass omits it when no transcript chunk matched
   *  confidently (ADR 0004), and a fabricated timestamp is worse than
   *  none. Absent means "start of the video", never a guess. */
  timeSec?: number;
};

/** What the lesson page holds as its panel state: a citation plus a
 *  monotonically increasing `seq`.
 *
 *  `seq` exists because clicking the SAME citation twice must still
 *  re-seek the player. Without it the second click changes nothing in
 *  the props, the seek effect never re-runs, and the click is silently a
 *  no-op — exactly the "looks wired, does nothing" failure this feature
 *  is supposed to remove. */
export type LessonVideoSelection = LessonCitation & { seq: number };

/** The second a citation should start playing at. Anything that is not a
 *  finite positive number — absent, null, NaN, negative — is the start of
 *  the video. This is the single guard that keeps `t=undefined` (and
 *  `t=NaN`) out of every URL and player call downstream. */
export function citationStartSec(citation: {
  timeSec?: number | null;
}): number {
  const t = citation.timeSec;
  return typeof t === 'number' && Number.isFinite(t) && t > 0 ? Math.floor(t) : 0;
}

/** True when two citations name the same video at the same grounded
 *  moment — what "this citation is the one currently loaded" means. */
export function sameCitation(
  a: LessonCitation | null | undefined,
  b: LessonCitation | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.videoId === b.videoId && citationStartSec(a) === citationStartSec(b);
}

/** `m:ss`, or `h:mm:ss` past an hour. Same formatting the extraction
 *  panel and /api/ask anchors use; duplicated rather than shared because
 *  those live behind heavier modules and this one has to stay importable
 *  from a leaf component. */
export function formatCitationTime(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** The "I do want to leave" escape hatch the panel offers. Built through
 *  citationStartSec so a citation with no grounded time links to the
 *  video's start rather than `&t=undefineds`. */
export function youtubeWatchUrl(citation: LessonCitation): string {
  const start = citationStartSec(citation);
  const base = `https://www.youtube.com/watch?v=${encodeURIComponent(citation.videoId)}`;
  return start > 0 ? `${base}&t=${start}s` : base;
}
