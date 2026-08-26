// -----------------------------------------------------------------------------
// Grounding prose that arrived without a citation.
// -----------------------------------------------------------------------------
//
// The model authors lessons in markdown. A bare paragraph parses into a
// `lesson.prose` block with no `src`; only the explicit `::prose{src=…}`
// directive form carries one. So the more naturally the model writes, the
// less it cites — and prose citation coverage across the live library sat at
// 127/230 = 55% while every other block type was at or near 100%.
//
// The fix is the one this codebase already uses for timecodes: don't ask the
// model to remember, derive it. A model-produced timecode is never trusted —
// the model names the video and BM25 finds the moment (CLAUDE.md, ADR 0004).
// This is that operation with the video unknown too: BM25 the paragraph's own
// text against every source transcript and take the best match — but only
// when the match is confident enough to defend.
//
// ## Why confidence is the whole design
//
// A wrong citation is worse than a missing one. It is a false attribution in
// a system whose entire premise is grounded citation, and unlike a gap it is
// invisible: the reader sees a source chip, clicks it, and lands somewhere
// plausible in a video that never said the thing. Prose that is genuinely the
// model's own connective writing MUST stay uncited. Coverage is not the
// target; defensible attribution is.
//
// ## The two questions, kept separate
//
// 1. WHICH video — a comparison BETWEEN videos.
// 2. Is there enough evidence AT ALL — a judgement WITHIN the winner.
//
// They need different measures, because BM25 scores are not comparable across
// indexes. Each video's index has its own idf table over its own chunk count
// (this library holds videos with 5 chunks and videos with 48), so the same
// overlap scores differently depending on which transcript it lands in — the
// same reason `retrieveSectionPassages` ranks per video and interleaves by
// rank instead of sorting globally.
//
//   * Question 1 is decided on the COUNT of shared distinct terms
//     (`sharedTerms`), which has no per-index scale. Empirically it is also
//     just the better answer: ranking the five source videos by shared-term
//     count picks the video the model itself cited on 86/114 of the library's
//     already-cited prose blocks (75%), where ranking by raw BM25 score picks
//     it on 71/114 (62%).
//   * Question 2 is decided on the count of shared terms that are RARE inside
//     the winning video (`distinctiveTerms`), which is what separates "both
//     texts are about guitar" from "this paragraph came from this passage".
//
// ## Where the numbers come from
//
// Tuned on the 103 uncited prose blocks already in the library, with two
// independent checks:
//
// (a) Agreement. On the 114 prose blocks the model DID cite, does this
//     picker independently choose the same video? At `SHARED_TERM_MARGIN`
//     1.4 it agrees on 33/33 — 100%. Below 1.34 agreement falls off fast
//     (1.25 → 91%, 1.2 → 89%), and at 1.5 the yield halves while agreement
//     does not improve. So 1.4.
//
// (b) Reading. Agreement is measured on blocks the model chose to cite, which
//     are longer and better anchored than the uncited population, so it
//     flatters. Every attachment the rule would make on the uncited blocks
//     was read against its matched passage. `MIN_DISTINCTIVE_SHARED` is the
//     threshold that came out of that reading, and it is a sharp edge, not a
//     round number: at 4 all twelve attachments name a video that really is
//     the source. Dropping it to 3 adds exactly three more, and all three are
//     wrong — paragraphs whose overlap with the transcript is `fret`, `note`,
//     `position`, `first`, `same`, and nothing else. Raising it to 5 costs
//     six correct attachments, including verbatim quotations.
//
// `MIN_SCORE` never fires on the current library (the weakest accepted match
// scores 10.1). It is a backstop for the shape this corpus does not contain:
// a very short transcript, where "rare in this video" can mean "in one chunk
// out of five" and four such terms can co-occur by chance at a low score.
// -----------------------------------------------------------------------------

import { findEvidenceForQuote, type BM25Index } from '#/lib/services/transcript';

/**
 * The bar a paragraph must clear before this pipeline will attach a source it
 * did not ask for. Exported so the tests assert on the same numbers the
 * pipeline runs, and so a future retune is a single edit with a visible diff.
 */
export const PROSE_AUTO_CITE = {
  /**
   * Shared terms that are rare inside the winning video (df ≤ 20% of its
   * chunks). The evidence floor — see (b) above.
   */
  MIN_DISTINCTIVE_SHARED: 4,
  /**
   * How far ahead of the runner-up video the winner's shared-term count must
   * be. "If two sources match equally well, the prose is probably synthesis
   * rather than sourced, and gets nothing."
   */
  SHARED_TERM_MARGIN: 1.4,
  /** Absolute BM25 backstop — see the note on `MIN_SCORE` above. */
  MIN_SCORE: 8,
} as const;

/** Why a paragraph was left uncited, for the run log. */
export type ProseSourceDeclineReason =
  | 'no-candidate'
  | 'too-few-distinctive-terms'
  | 'no-margin-over-runner-up'
  | 'below-min-score';

export type ProseSourceDecision =
  | {
      attach: true;
      videoId: string;
      /** Diagnostics — logged on every attachment so a bad one is auditable. */
      score: number;
      shared: number;
      distinctive: number;
      /** The runner-up's shared-term count; 0 when there was no runner-up. */
      runnerUpShared: number;
      /** The rare terms that carried the match — the reason to believe it. */
      distinctiveTerms: string[];
    }
  | {
      attach: false;
      reason: ProseSourceDeclineReason;
      /** Present whenever there WAS a best candidate, just not a good enough one. */
      videoId?: string;
      score?: number;
      shared?: number;
      distinctive?: number;
      runnerUpShared?: number;
    };

/**
 * Picks the video a paragraph should be cited to, or declines.
 *
 * `videoIds` is the lesson's source set that actually has a stored transcript
 * index — a video with no index cannot be a candidate, and must not silently
 * count as a beaten runner-up either.
 *
 * The chosen video is only the ANSWER TO "which video". The moment inside it
 * is left to the existing grounding path (`resolveBlockSource` →
 * `findEvidenceForQuote`), so an auto-grounded citation gets its `timeSec`
 * from exactly the code every model-supplied citation goes through, and
 * inherits its "weak match means no timestamp" rule unchanged.
 */
export function chooseProseSource(
  text: string,
  videoIds: Iterable<string>,
  bm25ByVideoId: ReadonlyMap<string, BM25Index>,
): ProseSourceDecision {
  const query = text.trim();
  if (!query) return { attach: false, reason: 'no-candidate' };

  const candidates: Array<{
    videoId: string;
    score: number;
    shared: number;
    distinctive: number;
    distinctiveTerms: string[];
  }> = [];
  for (const videoId of videoIds) {
    const index = bm25ByVideoId.get(videoId);
    if (!index) continue;
    // minScore 0: rejecting here would hide a strong runner-up, and the
    // runner-up is half of the decision. The floors are applied below, once,
    // to the winner.
    const evidence = findEvidenceForQuote(query, index, 0);
    if (!evidence || evidence.score <= 0) continue;
    candidates.push({
      videoId,
      score: evidence.score,
      shared: evidence.sharedTerms.length,
      distinctive: evidence.distinctiveTerms.length,
      distinctiveTerms: evidence.distinctiveTerms,
    });
  }
  if (candidates.length === 0) return { attach: false, reason: 'no-candidate' };

  // Shared-term count decides, score breaks ties. Score is the tie-break and
  // not the ranking for the reason in this module's header: it is not
  // comparable across indexes, but within a tie it is still the more
  // informative of two equal counts.
  candidates.sort((a, b) => b.shared - a.shared || b.score - a.score);
  const best = candidates[0];
  const runnerUpShared = candidates[1]?.shared ?? 0;
  const base = {
    videoId: best.videoId,
    score: best.score,
    shared: best.shared,
    distinctive: best.distinctive,
    runnerUpShared,
  };

  if (best.distinctive < PROSE_AUTO_CITE.MIN_DISTINCTIVE_SHARED) {
    return { attach: false, reason: 'too-few-distinctive-terms', ...base };
  }
  // A single source is not a competition — there is no "which video" question
  // to get wrong, so the margin has nothing to say and the evidence floor
  // carries the decision alone.
  if (runnerUpShared > 0 && best.shared < runnerUpShared * PROSE_AUTO_CITE.SHARED_TERM_MARGIN) {
    return { attach: false, reason: 'no-margin-over-runner-up', ...base };
  }
  if (best.score < PROSE_AUTO_CITE.MIN_SCORE) {
    return { attach: false, reason: 'below-min-score', ...base };
  }
  return { attach: true, ...base, distinctiveTerms: best.distinctiveTerms };
}
