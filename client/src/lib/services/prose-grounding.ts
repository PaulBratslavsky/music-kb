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
// An independent review of the shipped picker replaying it over the live KB
// (519 citeable blocks, real `loadStoredIndex`) found a defect in exactly
// that confidence judgement — see "Distinctiveness has two scopes" below —
// and one shipped attachment that names a video whose transcript states the
// OPPOSITE mechanic from the prose. Both are fixed by the library-rarity
// gate; the review's numbers are folded into (b) below rather than kept as a
// separate log, so the threshold's history reads in one place.
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
//   * Question 2 is decided on the count of shared terms that are
//     DISTINCTIVE — rare inside the winning video AND rare across the rest
//     of the library (`distinctiveTerms` filtered by `isLibraryDistinctive`)
//     — which is what separates "both texts are about guitar" from "this
//     paragraph came from this passage". See "Distinctiveness has two
//     scopes" below for why within-video rarity alone is not enough.
//
// ## Distinctiveness has two scopes
//
// The first cut of this module measured "rare" only INSIDE the winning
// video (df ≤ `DISTINCTIVE_DF_RATIO` of its own chunks). That is necessary
// but not sufficient: a term can be rare inside a 20-chunk video that
// happens to say it once while being ordinary vocabulary the rest of the
// library uses constantly — a within-video count has no way to tell "the
// fifth position" (fretboard furniture, said everywhere) apart from
// "committing scale shapes to memory" (said by one video). Six of the
// twelve attachments the first cut shipped sat at exactly the floor,
// carried by terms whose document frequency across the library (75 indexed
// transcripts, the winning video included) was 40–64 — `will`, `change`,
// `scale`, `any` for one of them, plain modal verbs and topic words, not
// evidence. One of the twelve was worse than ordinary: prose about the
// open-position E chord being one CAGED shape, auto-cited to a passage
// where the source video is naming the C shape by a DIFFERENT finger — the
// opposite mechanic from the sentence it was attached to. A second bad case
// turned up in the library that the first cut's own test fixture had
// predicted and not actually re-checked against real data: "the note the
// fifth position hands off to is the same letter, twelve frets and one full
// cycle later" — the exact synthesis-not-sourced case documented in this
// module's test file — reattached once the within-video floor was lowered
// far enough to compensate for the new filter below, because its three
// "distinctive" terms (`fifth`, `frets`, `later`) merely happened not to
// occur in this one lesson's four OTHER source videos, while sitting at
// 55%, 24%, and 49% document frequency across the library.
//
// The fix, per `isLibraryDistinctive` in `transcript.ts`: a shared term only
// counts toward `MIN_DISTINCTIVE_SHARED` if it ALSO appears in at most
// `LIBRARY_DF_RATIO` of the OTHER indexed transcripts in the library, not
// just the lesson's own source set — the corpus is the more reliable
// population precisely because a lesson's own 1–5 sources are too small a
// sample to tell "nobody else says this" from "nobody else in this
// particular lesson happened to".
//
// ## Where the numbers come from
//
// Tuned twice. The first pass (below, (a) and the within-video half of (b))
// used the 103 uncited prose blocks in the library at the time. The second
// pass — adding `isLibraryDistinctive` — replayed the shipped picker over
// the FULL current library (591 citeable blocks: prose, callout, and step;
// 75 indexed transcripts) via real `loadStoredIndex`, using the twelve
// previously-shipped attachments as the reading set plus the wider pool as
// a check against introducing anything new.
//
// (a) Agreement. On the prose blocks the model DID cite, does this picker
//     independently choose the same video? At `SHARED_TERM_MARGIN` 1.4 it
//     agrees on 33/33 — 100%. Below 1.34 agreement falls off fast (1.25 →
//     91%, 1.2 → 89%), and at 1.5 the yield halves while agreement does not
//     improve. So 1.4. (Unaffected by the library-rarity pass — it governs
//     question 1, not question 2 — and reconfirmed per block type; see the
//     module's test file and the generation-wiring tests for current
//     agreement counts.)
//
// (b) Reading, against the corpus-aware measure. `LIBRARY_DF_RATIO` and
//     `MIN_DISTINCTIVE_SHARED` were swept together (ratios 0.2–0.6, floors
//     2–4) and every resulting attachment set read against its matched
//     passage. The result is a genuine plateau, not a single lucky number:
//     for every ratio from 0.365 through 0.45, floor 3 selects the exact
//     same ten attachments, and reading all ten confirms every one names
//     its real source — including two (a verbatim-quoted "main lanes where
//     patterns repeat cleanly" and a named "Nandi method" citation) that
//     the original within-video-only floor of 4 would have dropped as
//     collateral damage. `LIBRARY_DF_RATIO: 0.4` sits mid-plateau. Outside
//     it in either direction the set changes for a reason: below 0.365 it
//     loses those same two correct, verified citations; at 0.45 the CAGED
//     opposite-mechanic attachment reappears, and at 0.55 so does the
//     fifth-position fretboard-furniture one. `MIN_DISTINCTIVE_SHARED: 3`
//     is the floor those ten need — 2 is not safe at ANY tested ratio (the
//     CAGED attachment still clears it), and 4 is provably too strict once
//     terms are filtered against the library (it costs the same two correct
//     citations the plateau reading flagged).
//
//     Of the twelve the first cut shipped, three do not survive: the CAGED
//     opposite-mechanic attachment, the self-referential-widget one (see
//     both above), and a third whose prose carries no attribution language
//     at all ("one video puts it…", a named source) and whose overlap with
//     its matched passage is topical, not verbatim — declined rather than
//     risk a fourth repeat of the CAGED shape. One new attachment appears
//     that the first cut never reached (its within-video count sat below
//     4): a paragraph about ending a phrase on a root note "on purpose",
//     matched to a passage that says the same thing in different words —
//     recall the corpus-aware filter gives back by no longer over-punishing
//     a real citation for using ordinary connecting words.
//
// `MIN_SCORE` never fires on the current library (the weakest accepted
// match now scores 8.5, still comfortably above 8). It remains a backstop
// for the shape this corpus does not contain: a very short transcript,
// where "rare in this video" can mean "in one chunk out of five" and three
// such terms can co-occur by chance at a low score.
// -----------------------------------------------------------------------------

import { findEvidenceForQuote, isLibraryDistinctive, type BM25Index } from '#/lib/services/transcript';

/**
 * The bar a paragraph must clear before this pipeline will attach a source it
 * did not ask for. Exported so the tests assert on the same numbers the
 * pipeline runs, and so a future retune is a single edit with a visible diff.
 */
export const PROSE_AUTO_CITE = {
  /**
   * Shared terms that clear BOTH distinctiveness bars: rare inside the
   * winning video (df ≤ 20% of its chunks) AND rare across the rest of the
   * library (`LIBRARY_DF_RATIO`, below). The evidence floor — see (b) above.
   */
  MIN_DISTINCTIVE_SHARED: 3,
  /**
   * How far ahead of the runner-up video the winner's shared-term count must
   * be. "If two sources match equally well, the prose is probably synthesis
   * rather than sourced, and gets nothing."
   */
  SHARED_TERM_MARGIN: 1.4,
  /** Absolute BM25 backstop — see the note on `MIN_SCORE` above. */
  MIN_SCORE: 8,
  /**
   * Document-frequency ceiling — as a fraction of the OTHER indexed
   * transcripts in the library, not the lesson's own source set — for a
   * within-video-distinctive term to still count as evidence. See
   * "Distinctiveness has two scopes" above; passed straight through to
   * `isLibraryDistinctive`.
   */
  LIBRARY_DF_RATIO: 0.4,
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
 * `libraryIndexes` is a SEPARATE, wider population: every indexed transcript
 * in the whole KB, not just this lesson's sources — the population
 * `isLibraryDistinctive` measures rarity against (see "Distinctiveness has
 * two scopes" in this module's header). It answers a different question
 * than `bm25ByVideoId` (which video could this paragraph have come from)
 * — whether a term that looks rare in the winning video is actually rare,
 * or just rare among the handful of videos this one lesson happens to draw
 * on. A video missing from it (no stored index, or the caller passed an
 * empty map) simply contributes nothing to the comparison — same
 * empty-population stance `isLibraryDistinctive` documents.
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
  libraryIndexes: ReadonlyMap<string, BM25Index>,
): ProseSourceDecision {
  const query = text.trim();
  if (!query) return { attach: false, reason: 'no-candidate' };

  const candidates: Array<{
    videoId: string;
    score: number;
    shared: number;
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

  // Question 2's evidence floor, extended: a within-video-rare term only
  // counts if it is ALSO rare across the rest of the library — otherwise
  // "will", "change", "any" clear the within-video bar on any short quote
  // and say nothing about provenance. See "Distinctiveness has two scopes".
  const otherLibraryIndexes: BM25Index[] = [];
  for (const [videoId, index] of libraryIndexes) {
    if (videoId !== best.videoId) otherLibraryIndexes.push(index);
  }
  const distinctiveTerms = best.distinctiveTerms.filter((term) =>
    isLibraryDistinctive(term, otherLibraryIndexes, PROSE_AUTO_CITE.LIBRARY_DF_RATIO),
  );

  const base = {
    videoId: best.videoId,
    score: best.score,
    shared: best.shared,
    distinctive: distinctiveTerms.length,
    runnerUpShared,
  };

  if (distinctiveTerms.length < PROSE_AUTO_CITE.MIN_DISTINCTIVE_SHARED) {
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
  return { attach: true, ...base, distinctiveTerms };
}
