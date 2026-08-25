// AI lesson generation — builds a Strapi-shaped lesson body from the video
// library, staged as several SMALL model calls instead of one big one.
//
// Why staged, not one shot: a local model cannot reliably emit a 20-block
// lesson body as a single JSON object — it drifts, drops fields, or produces
// invalid enum values, and the failure is silent (the block just doesn't
// render, see LessonBody.tsx's `default: return null`). So the pipeline
// asks for a SMALL structured result at every step:
//
//   1. retrieve — embed the topic, cosine over stored video embeddings,
//                 apply a relevance floor, cap to the digest's video range
//   1.5. coverage — ONE chat() call: do the retrieved sources actually
//                 teach the topic, or just sit near it in embedding space?
//                 Runs before the (expensive) digest step and refuses on
//                 anything but a clear "yes" — see the step's own comment.
//   2. digest   — reuse a cached cross-video digest for this exact video
//                 set, or synthesize one via the existing digest service
//   3. context  — title + summary + musicExtraction per source video, plus
//                 the digest's cross-video synthesis
//   4. outline  — ONE chat() call → { title, summary, level, sections[] }
//   5. sections (WRITE) — ONE chat() call PER section → MARKDOWN, parsed
//                 into text blocks only (prose/callout/step/table/
//                 degree-chips/video-ref/param-picker, as many or as few as
//                 the content needs). No drawing directive is available to
//                 this pass at all; the section heading is injected
//                 deterministically, never trusted from the model
//   5.5. illustrate — a SEPARATE chat() call PER section, run CONCURRENTLY
//                 (each section's call is independent), given that
//                 section's own finished text: decides what would be
//                 clearer shown than described and answers in MARKDOWN with
//                 the five drawing directives plus where each belongs.
//                 Split from step 5 on purpose — see that step's comment.
//   6. assemble — flatten to LessonBlock[], renumber steps + ids, append
//                 contradiction callouts, drop anything invalid
//
// Steps 5 and 5.5 ask for MARKDOWN and parse it (see
// client/src/lib/lesson/markdown-blocks.ts); steps 1.5 and 4 still use
// structured output, because a coverage verdict and an outline are small
// fixed records with no vocabulary problem. That split is why the
// Anthropic schema-lint guard in lesson-generation.test.ts now covers two
// schemas instead of four, and asserts that no third one has crept back
// into a markdown pass.
//
// This mirrors the map-reduce shape in learning.ts (many small model calls,
// one deterministic assembly step) and the structured-extraction shape in
// music-extraction.ts (schema-validated but content-untrusted, sanitized
// after the fact). Persistence is NOT this module's job — the caller (the
// `/api/lesson-write` route) saves the result. That includes the digest: on
// a cache miss this module synthesizes one via `synthesizeDigest` but never
// calls `createDigestService` — persisting it is the /digest page's job (an
// explicit user Save), not an implicit side effect of generating a lesson.
//
// WHICH model runs steps 4/5 is decided exactly once, by
// `resolveLessonModel()` (lesson-model.ts) — a frontier Anthropic model
// when ANTHROPIC_API_KEY is set, the local Ollama model otherwise. This
// module never picks an adapter itself; it asks once and uses whatever it
// gets back for every chat() call, so a lesson never mixes tiers. Both
// tiers run this exact same staged pipeline — see lesson-model.ts for why
// (comparability between a local and a frontier lesson matters more than
// letting a frontier model collapse the staging into one call).
//
// -----------------------------------------------------------------------------
// Two phases, one pipeline (streamed progress + outline approval)
// -----------------------------------------------------------------------------
//
// The pipeline above is split into two entry points so the caller (the
// `/api/lesson-plan` and `/api/lesson-write` SSE routes) can pause for user
// approval of the outline between "plan" and "write" — a single SSE stream
// can't easily take input mid-flight, and this stateless two-call split is
// simpler than bidirectional streaming.
//
//   planLesson()  — steps 1 through 4 (resolve tier → retrieve → coverage →
//                   digest → outline). Returns the outline + everything
//                   phase 2 needs to resume: sources, digest, tier, model.
//   writeLesson() — steps 5 and 6 (per-section generation → grounding →
//                   assembly). Takes phase 1's output back — POSSIBLY
//                   user-edited (headings/title) — and re-validates it
//                   rather than trusting it, since it has been through the
//                   browser.
//
// No server-side job store sits between them: the digest is a few KB of
// JSON and round-trips fine as part of the phase-2 request body. Both
// functions accept an optional `onProgress` callback that fires the exact
// same moments `logPhase` already logs, as structured `LessonProgressEvent`s
// — the SSE routes forward those as frames; nothing here talks HTTP.

import { chat } from '@tanstack/ai';
import { z } from 'zod';
import { withRetry } from '#/lib/retry';
import {
  getOutlineGuideExcerpt,
  getSectionBlockGuideExcerpt,
  getIllustrationGuideExcerpt,
} from '#/lib/lesson/authoring-guide';
import {
  formatIssues,
  parseLessonMarkdown,
  type LessonDirectiveName,
  type ParsedBlock,
  type ParseIssue,
} from '#/lib/lesson/markdown-blocks';
import { PITCH_CLASSES, type PitchClass } from '@music-kb/music/types';
import {
  DIGEST_MAX_VIDEOS,
  DIGEST_MIN_VIDEOS,
  DigestSchema,
  synthesizeDigest,
  type Digest,
} from '#/lib/services/digest';
import {
  findDigestByVideoSetKeyService,
  makeVideoSetKey,
  strapiRowToDigest,
} from '#/lib/services/digests';
import { cosineSimilarity, embedText } from '#/lib/services/embeddings';
import { friendlyAnthropicError } from '#/lib/services/anthropic-errors';
import {
  redactAnthropicKey,
  resolveLessonModel,
  type ModelTier,
} from '#/lib/services/lesson-model';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';
import { samplingOptions } from '#/lib/services/ollama-model-options';
import {
  findEvidenceForQuote,
  loadStoredIndex,
  searchBM25,
  type BM25Index,
  type TranscriptChunk,
} from '#/lib/services/transcript';
import {
  buildMusicExtractionText,
  fetchVideoByDocumentIdService,
  fetchVideoByVideoIdService,
  listAllVideosForEmbeddingWithStatusService,
  type StrapiVideo,
} from '#/lib/services/videos';
import type { LessonBlock } from '#/lib/services/lessons';

// Translates a caught error's message through the tier-appropriate friendly
// mapper. Frontier errors get the non-echoing Anthropic mapper (never
// leaks provider payload / the key); local errors keep the existing Ollama
// mapper, which is safe to echo since Ollama runs on localhost.
function friendlyModelError(tier: ModelTier, message: string): string {
  return tier === 'frontier' ? friendlyAnthropicError(message) : friendlyOllamaError(message);
}

// The two adapters take differently-shaped `modelOptions`: Ollama nests
// sampling knobs under `.options` and requires a (structurally unused)
// top-level `model` field (see samplingOptions' own doc comment); Anthropic
// takes sampling knobs flat, with no `model` field in modelOptions at all
// (model is bound at adapter-construction time either way — this is purely
// about satisfying each adapter's declared provider-options shape).
function buildModelOptions(lessonModel: ReturnType<typeof resolveLessonModel>, temperature: number) {
  // Frontier: send NO sampling knobs. Newer Anthropic models reject
  // `temperature` outright — claude-sonnet-5 answers a request carrying it
  // with `400 invalid_request_error: \`temperature\` is deprecated for this
  // model.`, which fails the whole generation. The local path still needs it
  // (temperature 1.0 is what made gemma4-kb's tool calling unreliable), so
  // the knob stays tier-specific rather than being dropped everywhere.
  // `temperature` is accepted here and deliberately unused on this branch.
  void temperature;
  if (lessonModel.tier === 'frontier') return {};
  return samplingOptions(lessonModel.model, temperature);
}

function logPhase(topic: string, phase: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const body = extra ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [lesson-gen "${topic}"] ${phase}${body}`);
}

// -----------------------------------------------------------------------------
// Progress events — the observability layer over the pipeline above.
// -----------------------------------------------------------------------------
//
// Emitted from the exact same call sites `logPhase` already marks — this is
// not a second source of truth, it's the same moments given a structured
// shape a UI/SSE frame can carry instead of a log line. `onProgress` is
// optional everywhere (tests, and any future non-streaming caller, can omit
// it) and MUST NOT throw — a progress subscriber's bug should never take
// down generation; see `emit()` below.
//
// `retry` is the one event type not named 1:1 after a pipeline step: every
// retry this module performs — the coverage call's transient-network retry,
// the outline retry (on a thrown call, an unusable shape, OR a thin
// result), and the per-section retry (thrown call or zero usable blocks) —
// reports through this single shape so "a retry happened" is never only a
// log line. See the brief's "Silence" concern: a retry that happens
// invisibly is worse than a loud failure.
export type LessonProgressEvent =
  | { type: 'tier'; tier: ModelTier; model: string }
  | {
      type: 'retrieve';
      /** How many videos had a stored embedding at all (before the floor). */
      considered: number;
      /** RELEVANCE_FLOOR at the time of this run. */
      floor: number;
      /** The videos actually selected — titles + cosine scores. */
      videos: SourceVideo[];
    }
  | {
      type: 'coverage';
      covered: boolean;
      actualTopic: string | null;
      reason: string | null;
    }
  | { type: 'digest'; cacheHit: boolean; ms: number }
  | { type: 'outline'; title: string; level: LessonOutline['level']; sections: string[] }
  | {
      type: 'section';
      index: number;
      total: number;
      heading: string;
      blocks: number;
      /**
       * How many real transcript passages this section was written FROM
       * (see `retrieveSectionPassages`). Optional only so hand-built
       * fixtures and older callers still typecheck; the pipeline always
       * sets it. Reported because zero here means the section silently
       * fell back to summary cards — the change that put passages in this
       * prompt would then be inert with nothing to show for it.
       */
      passages?: number;
      /**
       * How many blocks the markdown parser REJECTED on this pass — a bad
       * enum, an unknown directive, a diagram that would draw nothing.
       * Reported rather than only logged: since the model now authors in
       * markdown, a parse rejection is the one failure mode that would
       * otherwise show up as nothing but a shorter lesson.
       */
      dropped?: number;
      /**
       * How many blocks in this section NAME a source in their own text —
       * an attribution, a verbatim quotation, a source video's title —
       * while carrying no `src` citation. Reported because an unlinked
       * sourcing claim is the one content defect this pipeline cannot
       * repair without guessing (see `findSourcingClaim`), and a lesson
       * whose premise is grounded citation must not hide it. A section
       * with any of these ALSO emits a non-fatal `error` event, since
       * that is the only frame today's UI renders in the run log.
       */
      unsourced?: number;
    }
  | {
      // The illustrate pass ticks off per section, same as 'section' above,
      // so the SSE-driven progress UI keeps advancing during this phase
      // instead of going quiet — see this module's header comment on why
      // the illustrate pass needs its own progress events. `diagrams: 0` is
      // a normal, successful outcome (nothing in that section earned a
      // diagram), not a failure — never conflate it with a dropped/errored
      // section.
      type: 'illustrate';
      index: number;
      total: number;
      heading: string;
      diagrams: number;
      /**
       * How many blocks the markdown parser REJECTED on this pass — a bad
       * enum, an unknown directive, a diagram that would draw nothing.
       * Reported rather than only logged: since the model now authors in
       * markdown, a parse rejection is the one failure mode that would
       * otherwise show up as nothing but a shorter lesson.
       */
      dropped?: number;
    }
  | { type: 'grounding'; grounded: number; total: number }
  | {
      type: 'retry';
      step: 'coverage' | 'outline' | 'section' | 'illustrate';
      attempt: number;
      reason: string;
      /** Section heading, when step === 'section' or 'illustrate'. */
      label?: string;
    }
  | {
      type: 'saved';
      slug: string;
      title: string;
      blockCount: number;
      tier: ModelTier;
      model: string;
    }
  /**
   * Something went wrong. NOT necessarily terminal: every path that fails
   * the whole run emits one of these last, but a run can also emit one and
   * keep going — a section that produced nothing after its retry, a
   * section carrying unlinked sourcing claims. Those defects have no other
   * frame that reaches the reader's screen, and the alternative (a step
   * that shows a retry and then simply vanishes) is the silence this
   * pipeline keeps being bitten by. Consumers should treat `error` as
   * "surface this", and decide success from whether a terminal frame
   * (`saved`, or an `ok: true` return) arrived — which is exactly what
   * `lessons.index.tsx` already does.
   */
  | { type: 'error'; step: string; message: string };

type ProgressFn = (event: LessonProgressEvent) => void;

// Never lets a bad onProgress subscriber (a UI bug, an SSE encoder throwing
// on a circular payload that can't actually occur here, etc.) abort
// generation — the pipeline's own correctness must not depend on the
// observability layer being bug-free.
function emit(onProgress: ProgressFn | undefined, event: LessonProgressEvent) {
  if (!onProgress) return;
  try {
    onProgress(event);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[lesson-gen] onProgress subscriber threw — ignoring', err);
  }
}

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export type PlanLessonInput = { topic: string; maxVideos?: number };

/**
 * The lesson-level `lesson.parameter` as this pipeline emits it — narrower
 * than `LessonParameter` in lessons.ts, which is the READ-side shape (what
 * Strapi hands back, where every enum arrives as a plain string). On the
 * write side both `name` and `default` are closed sets, and saying so is
 * what stops a `default` that `resolveDiagramDots` would refuse from ever
 * being constructed. Structurally assignable to `LessonParameter`, so
 * `saveLessonService` takes it unchanged.
 */
export type GeneratedLessonParameter = {
  name: 'key';
  label: string;
  default: PitchClass;
};

export type SourceVideo = {
  documentId: string;
  youtubeVideoId: string;
  title: string | null;
  /** Cosine similarity of the topic embedding against this video's stored
   * summary embedding. Not a percentage — see MatchTier commentary in
   * embeddings.ts for why raw cosine isn't shown to users directly. */
  score: number;
};

export type PlanLessonResult =
  | {
      ok: true;
      topic: string;
      outline: LessonOutline;
      sources: SourceVideo[];
      digest: Digest;
      tier: ModelTier;
      model: string;
    }
  | { ok: false; error: string };

/** Mirrors the Strapi `lesson` content type shape (schema.json) closely
 * enough that a caller can hand this straight to a create call, modulo
 * `slug` deduping (caller's job — this module has no DB access). */
export type GeneratedLesson = {
  title: string;
  slug: string;
  summary: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  instrument: 'guitar' | 'piano' | 'push' | 'any';
  duration: string | null;
  status: 'ai-generated';
  /** The lesson-level `lesson.parameter` component, or null. Persisted by
   * `saveLessonService` — without it a `lesson.param-picker` block in
   * `body` renders as nothing at all. */
  parameter: GeneratedLessonParameter | null;
  body: LessonBlock[];
};

export type GenerateLessonResult =
  | {
      ok: true;
      lesson: GeneratedLesson;
      sources: SourceVideo[];
      /** Which model tier actually generated this lesson — a frontier
       * lesson and a local one are not the same artifact; callers/UI
       * should surface this. */
      tier: ModelTier;
      /** The specific model id used within that tier. */
      model: string;
    }
  | { ok: false; error: string };

// -----------------------------------------------------------------------------
// Step 1: retrieve — cosine rank, then a relevance floor
// -----------------------------------------------------------------------------

const DEFAULT_MAX_VIDEOS = 5;

// Below this cosine score, a video is not "about" the topic — it's noise
// that happens to share vocabulary. Two pieces of evidence set this value
// (Strapi was intentionally not started for this task, so it isn't tuned
// against the live library — see the report):
//   1. `embeddings.ts`'s own calibration notes (`getMatchTier` comments)
//      document that raw cosine with nomic-embed-text "saturates around
//      0.65–0.72 for correct topical matches" and "good" matches run
//      0.45–0.72 — i.e. 0.45 is the documented floor for "good", not "off
//      topic".
//   2. The live diagnostic in `embeddings.ranking.test.ts` (real Ollama,
//      same embedText/prefix scheme) shows 0.45 is too permissive on its
//      own: for a query genuinely unrelated to its corpus ("fitness"
//      against AI/dev-tooling docs), several clearly-irrelevant docs still
//      scored 0.46–0.55 — well above 0.45. For a genuinely-relevant query
//      ("running AI models on my laptop"), the true topical matches scored
//      0.514–0.615, with the best false positive at 0.489.
// 0.50 sits just above that observed false-positive ceiling while staying
// below every observed true-positive score in both diagnostics — a better
// separator than the documented 0.45 floor alone, though still an
// approximation from a small, non-music, non-library corpus.
const RELEVANCE_FLOOR = 0.5;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Keeps every prompt in this pipeline small — a per-video context card, not
// the whole summary. Consistent with the "small structured calls" design:
// lean input, lean output.
const CONTEXT_SNIPPET_MAX_CHARS = 400;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

// Labeled with the youtubeVideoId so later steps (section citation) can ask
// the model to name a source by an id it has already seen here.
function buildVideoContextText(v: StrapiVideo): string {
  const title = v.summaryTitle ?? v.videoTitle ?? 'Untitled video';
  const desc = v.summaryDescription ?? v.summaryOverview ?? '';
  const music = buildMusicExtractionText(v.musicExtraction);
  const lines = [`- [${v.youtubeVideoId}] "${title}"`];
  if (desc.trim()) lines.push(`  ${truncate(desc.trim(), CONTEXT_SNIPPET_MAX_CHARS)}`);
  if (music) lines.push(`  ${music.split('\n').join(' | ')}`);
  return lines.join('\n');
}

type RankedVideo = { video: StrapiVideo; score: number };

// Ranks every video with a stored embedding against the topic. Does NOT
// apply the relevance floor or cap — callers do that, so the full ranked
// list is available for logging while tuning the floor.
/** Thrown when Strapi itself is unreachable, so the caller can say so. */
class BackendUnreachableError extends Error {}

async function rankVideosByTopic(topic: string): Promise<RankedVideo[]> {
  const queryVec = await embedText(topic, 'query');
  const listed = await listAllVideosForEmbeddingWithStatusService();
  if (!listed.ok) {
    throw new BackendUnreachableError(
      listed.status === 0
        ? 'Cannot reach Strapi — is the backend running?'
        : `Strapi returned ${listed.status} while listing videos: ${listed.error}`,
    );
  }
  const all = listed.videos;
  const withEmbeddings = all.filter(
    (v) => Array.isArray(v.summaryEmbedding) && v.summaryEmbedding.length > 0,
  );
  return withEmbeddings
    .map((video) => ({
      video,
      score: cosineSimilarity(queryVec, video.summaryEmbedding as number[]),
    }))
    .sort((a, b) => b.score - a.score);
}

// -----------------------------------------------------------------------------
// Step 1.5: coverage — does the retrieved set actually cover the topic?
// -----------------------------------------------------------------------------
//
// The relevance floor above measures embedding SIMILARITY, not topical
// COVERAGE, and the two come apart. A real run asked for "barre chords" and
// got 23 confident blocks about triads and harmonic movement that never once
// said "barre" — a failure worse than an error, because it looks like
// success. (That particular run turned out to be a generation fluke rather
// than missing source material; the library does cover barre chords. But the
// gap it exposed is real: similarity is not coverage, and a topic the library
// genuinely lacks can still sit close enough in embedding space to clear the
// floor.) Verified against the real model: "jazz reharmonization and tritone
// substitution" is correctly refused here in ~14s. This step is one small
// model call, run BEFORE the (expensive) digest step, asking whether the
// retrieved sources actually teach the topic — using only each candidate's
// title + summary, never full transcripts, consistent with every other
// call in this pipeline staying small.
//
// Refuses only when the library has essentially nothing on-topic to teach
// from — NOT merely when it doesn't cover the topic exhaustively. An
// earlier version of this prompt biased toward refusing on ANY doubt,
// reasoning that a false "covered" ships a confidently wrong lesson while a
// false "not covered" only costs a rephrase; in practice that asymmetry
// argument pushed the model to demand exhaustive coverage of every
// sub-topic a request could touch, and a real request ("what a beginner
// guitar student needs to know") was refused even with 5 sources scoring
// 0.70–0.77 that plainly had real beginner material, just not EVERY
// beginner sub-topic (posture, tuning, equipment). The recalibrated
// COVERAGE_SYSTEM asks a narrower question — can a genuinely USEFUL lesson
// be built from these sources — and still refuses the case this step was
// originally built for (barre chords against a triads/harmonic-movement
// library, jazz reharmonization against a library with neither concept in
// it): (a) the system prompt asks about usefulness, not exhaustiveness, (b)
// an unusable/failed verdict still refuses rather than proceeding (see the
// catch block and the `!coverage` check in planLesson — model failure is
// never treated as permission to continue), and (c) on refusal the message
// names both the requested topic and what the library actually has, so the
// user knows what to search for or add.
//
// A refusal here is NEVER retried — see `planLesson`'s coverage step below.
// Only the underlying chat() call transiently retries (network-level
// failure), same as before; a `covered: false` verdict is a correct answer,
// not an error, and re-asking the same question against the same sources
// won't change it.
// Exported (along with LessonOutlineSchema below) so
// lesson-generation.test.ts can walk every schema actually passed to
// `outputSchema` and assert none of them carries an array `.min(n)` with
// n > 1 — Anthropic's structured-output validator 400s on that (see
// LessonOutlineSchema's `sections` field comment for the exact error).
// This schema itself has no arrays today, but it's exported alongside the
// other one so the guard test enumerates "every outputSchema", not a
// hand-picked subset that can silently miss the next one added here. These
// two are now the ONLY structured-output calls in the pipeline — the write
// and illustrate passes answer in markdown — and the guard test reads this
// file's source to assert exactly that, so a third one cannot arrive
// unguarded.
export const CoverageVerdictSchema = z.object({
  covered: z
    .boolean()
    .describe(
      'true if a genuinely useful lesson on the topic can be built from these sources — they do not need to cover every sub-topic the request could touch, only have real, substantive on-topic material. false only when the sources have essentially nothing to say about the topic itself (merely adjacent/tangential, sharing vocabulary but not substance).',
    ),
  actualTopic: z
    .string()
    .nullable()
    .describe(
      'When covered is false: a short phrase naming what the sources DO actually cover, so the user knows what to search for instead. Null when covered is true.',
    ),
  reason: z
    .string()
    .nullable()
    .describe('One short sentence explaining the verdict, or null.'),
}).strict();

/** What the sources DO cover, when they don't cover the topic. */
export type CoverageVerdict = {
  covered: boolean;
  actualTopic?: string;
  reason?: string;
};

// Recalibrated after a real refusal the repo owner hit: "beginner guitar
// basics" was refused even though 5 sources scored 0.70–0.77 and were
// obviously usable (self-teaching guitar, first months playing, fretboard
// orientation, learning songs by ear) — the model refused because none of
// them individually covered posture/tuning/equipment, i.e. it was demanding
// EXHAUSTIVE coverage of every sub-topic a beginner-guitar lesson could
// touch, not USEFUL coverage of the topic as asked. The question this check
// asks is deliberately narrower than "do the sources cover the topic
// completely" — a lesson doesn't need to exhaust its topic, it needs real
// material to teach from. Still refuses the case this was originally built
// for: sources about triads/harmonic movement genuinely have nothing to say
// about "barre chords" specifically (a different technique on a different
// part of the instrument, not a missing sub-topic of a topic they DO
// address), same as "jazz reharmonization and tritone substitution" against
// a library with neither concept anywhere in it.
export const COVERAGE_SYSTEM = [
  'You judge whether a genuinely useful lesson on a requested topic can be built from a set of source videos — not whether they exhaustively cover every sub-topic the request could touch, and not merely whether they are topically adjacent or related.',
  'Ask: "do these sources have real, substantive material to teach this topic from?" NOT "do these sources cover every aspect of this topic?" A lesson does not need to exhaust its topic to be worth generating — answer covered: true whenever the sources give a learner genuine, on-topic material, even if some sub-topics the request could plausibly include are missing from them.',
  'Answer covered: false only when the sources have essentially nothing to say about the topic itself — they share vocabulary or a broad subject area, but a learner asking specifically for this topic would find nothing that actually teaches it.',
  'Example of a correct refusal: sources about triads and harmonic movement do NOT cover "barre chords" — barre chords are a distinct technique those sources never touch, not a missing detail of a topic they do address.',
  'Example of a correct acceptance: sources on self-teaching guitar, a beginner\'s first months of practice, and fretboard orientation DO cover "what a beginner guitar student needs to know" — even though none of them individually covers posture, tuning, or equipment, together they have real, substantive beginner material to build a useful lesson from. Refusing that case would be over-refusing: demanding exhaustive coverage of every sub-topic instead of asking whether the sources are useful for the topic as asked.',
  'When you are genuinely unsure whether the sources are USEFUL for the topic (not merely whether they are COMPLETE), lean toward covered: true — a false "covered" that turns out thin is caught later by the outline/section steps having little to say, which is recoverable; a false "not covered" silently blocks a lesson the library could actually have supported, with no such recovery path.',
  'When covered is false, set `actualTopic` to a short phrase naming what the sources DO actually cover, so the user knows what to search for instead.',
].join('\n');

function buildCoverageCandidateText(v: StrapiVideo): string {
  const title = v.summaryTitle ?? v.videoTitle ?? 'Untitled video';
  const desc = v.summaryDescription ?? v.summaryOverview ?? '';
  const lines = [`- "${title}"`];
  if (desc.trim()) lines.push(`  ${truncate(desc.trim(), CONTEXT_SNIPPET_MAX_CHARS)}`);
  return lines.join('\n');
}

function buildCoveragePrompt(topic: string, candidatesText: string): string {
  return [
    `Requested lesson topic: ${topic}`,
    '',
    'Candidate source videos (title + summary only):',
    candidatesText,
  ].join('\n');
}

// Defensive, same stance as sanitizeOutline: `raw` is untrusted content, not
// just an untrusted shape. `covered` missing/non-boolean is treated as an
// unusable verdict (caller refuses) rather than defaulted either way — a
// coin-flip default here would silently reintroduce the exact bug this step
// exists to close.
function sanitizeCoverageVerdict(raw: unknown): CoverageVerdict | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.covered !== 'boolean') return null;
  const actualTopic =
    typeof r.actualTopic === 'string' && r.actualTopic.trim() ? r.actualTopic.trim() : undefined;
  const reason = typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : undefined;
  return { covered: r.covered, actualTopic, reason };
}

// -----------------------------------------------------------------------------
// Step 2: digest — reuse a cached synthesis for this exact video set, or
// synthesize (never persist) one via the existing digest service.
// -----------------------------------------------------------------------------

async function resolveFullVideos(
  youtubeVideoIds: string[],
): Promise<{ videos: StrapiVideo[]; missing: string[] }> {
  const videos: StrapiVideo[] = [];
  const missing: string[] = [];
  await Promise.all(
    youtubeVideoIds.map(async (id) => {
      const byVid = await fetchVideoByVideoIdService(id).catch(() => null);
      if (byVid) {
        videos.push(byVid);
        return;
      }
      const byDoc = await fetchVideoByDocumentIdService(id).catch(() => null);
      if (byDoc) {
        videos.push(byDoc);
        return;
      }
      missing.push(id);
    }),
  );
  return { videos, missing };
}

type DigestResolution =
  | { ok: true; digest: Digest; fullVideos: StrapiVideo[]; cacheHit: boolean }
  | { ok: false; error: string };

// `listAllVideosForEmbeddingService` (used for retrieval) strips
// `transcriptSegments` before returning — it's the client-safe listing
// helper. Grounding needs the real BM25 index, and digest synthesis wants
// full StrapiVideo rows, so this step re-fetches the selected videos in
// full via the same fetchers `generateDigestByIds` uses internally.
async function getOrCreateDigest(
  topic: string,
  youtubeVideoIds: string[],
): Promise<DigestResolution> {
  const { videos: fullVideos, missing } = await resolveFullVideos(youtubeVideoIds);
  if (missing.length > 0 || fullVideos.length < DIGEST_MIN_VIDEOS) {
    logPhase(topic, 'digest ✗ could not load full source videos', { missing });
    return {
      ok: false,
      error: 'Could not load the selected source videos to synthesize a digest.',
    };
  }

  const videoSetKey = makeVideoSetKey(youtubeVideoIds);
  const cached = await findDigestByVideoSetKeyService(videoSetKey);
  if (cached.success && cached.data) {
    logPhase(topic, 'digest ✓ cache hit', { videoSetKey });
    return { ok: true, digest: strapiRowToDigest(cached.data), fullVideos, cacheHit: true };
  }

  logPhase(topic, 'digest ▶ cache miss, synthesizing', { videoSetKey });
  const synthesized = await synthesizeDigest(fullVideos);
  if (!synthesized.success) {
    logPhase(topic, 'digest ✗ synthesis failed', { error: synthesized.error });
    return { ok: false, error: synthesized.error };
  }
  return { ok: true, digest: synthesized.data, fullVideos, cacheHit: false };
}

// Compact prose rendering of the digest's cross-video synthesis, fed into
// the outline call so `viewingOrder` can inform section progression and
// `sharedThemes` / `uniqueInsights` can become section material.
// `contradictions` is deliberately NOT included here — those are handled
// deterministically (see `buildContradictionCallouts`), not left to the
// model to paraphrase.
function buildDigestContextText(digest: Digest): string {
  const lines: string[] = [];
  if (digest.overallTheme.trim()) {
    lines.push('Cross-video synthesis — overall theme:');
    lines.push(digest.overallTheme.trim());
  }
  if (digest.sharedThemes.length > 0) {
    lines.push('');
    lines.push('Themes shared across the sources:');
    for (const t of digest.sharedThemes) {
      lines.push(`- ${t.title}: ${truncate(t.body, 300)}`);
    }
  }
  if (digest.uniqueInsights.length > 0) {
    lines.push('');
    lines.push("What each source uniquely contributes:");
    for (const u of digest.uniqueInsights) {
      lines.push(`- ${u.videoTitle}: ${truncate(u.insight, 300)}`);
    }
  }
  if (digest.viewingOrder.length > 0) {
    lines.push('');
    lines.push('Recommended progression across the sources (use this to order sections):');
    digest.viewingOrder.forEach((v, i) => {
      lines.push(`${i + 1}. ${v.videoTitle} — ${v.why}`);
    });
  }
  if (digest.bottomLine.trim()) {
    lines.push('');
    lines.push(`Cross-video bottom line: ${digest.bottomLine.trim()}`);
  }
  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Step 4: outline — one small structured call
// -----------------------------------------------------------------------------

// Reused, not re-typed: the theory layer (`@music-kb/music`) is the single
// source of truth for the 12 sharps-only pitch classes — see
// docs/lesson-authoring.md's "The 12 pitch classes". Cast to a non-empty
// tuple only because zod's `.enum()` wants that shape at the type level;
// the runtime values come straight from the theory package, never
// hand-copied. Declared HERE rather than down with the section schema
// because module-scope consts evaluate top-to-bottom: LessonOutlineSchema
// below reads it, so it has to exist by then.
const PITCH_CLASS_ENUM = PITCH_CLASSES as [PitchClass, ...PitchClass[]];

export const LessonOutlineSchema = z.object({
  title: z.string().describe('Short lesson title. MAX 150 characters.'),
  summary: z
    .string()
    .describe('One or two sentence summary of what the lesson teaches. MAX 350 characters.'),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  instrument: z
    .enum(['guitar', 'piano', 'push', 'any'])
    .describe(
      'What the lesson is taught on, based on the source videos. Use "any" for instrument-agnostic theory.',
    ),
  duration: z
    .string()
    .nullable()
    .describe('Rough time estimate like "15 min", or null. MAX 30 characters.'),
  // The lesson-level reader-controlled parameter (`lesson.parameter`),
  // declared as TWO nullable scalars rather than one nullable object on
  // purpose: a nullable enum and a nullable string are both shapes this
  // pipeline has already exercised against the live frontier tier, where
  // a nullable OBJECT is not. Two `anyOf` nodes instead of one is a cheap
  // price on a schema that otherwise uses 1 of its 16-union budget (see
  // lesson-generation.test.ts's union-cap guard), and it buys zero new
  // structured-output risk — the class of bug this file's comments are
  // mostly about. `name` is not asked for at all: `key` is the only value
  // lesson.parameter's own enum supports, so it is filled in by code.
  parameterLabel: z
    .string()
    .nullable()
    .describe(
      'Set this ONLY if the whole lesson is about something a reader should be able to re-key (triad shapes, scale patterns, a chord grip that transposes) — then it is the picker\'s label, e.g. "Key". MAX 40 characters. Null (the common case) for a lesson whose content is tied to specific named keys/chords from the sources, which would become wrong if re-keyed.',
    ),
  parameterDefault: z
    .enum(PITCH_CLASS_ENUM)
    .nullable()
    .describe(
      'The key the lesson starts in, when parameterLabel is set — pick the one the sources actually demonstrate in. One of the 12 sharps-only pitch classes (no flats). Null whenever parameterLabel is null.',
    ),
  sections: z
    .array(
      z.object({
        heading: z.string().describe('Section heading. MAX 150 characters.'),
        goal: z
          .string()
          .describe(
            'ONE sentence: what this section should teach. Used to prompt the next generation step — never shown to the learner.',
          ),
      }).strict(),
    )
    // NOT .min(2) AND NOT .max(6) here — Anthropic's structured-output
    // schema support rejects BOTH: `minItems` values other than 0 or 1
    // (`output_config.format.schema: For 'array' type, 'minItems' values
    // other than 0 or 1 are not supported`) AND `maxItems` at all
    // (`output_config.format.schema: For 'array' type, property 'maxItems'
    // is not supported`) — the latter was caught by a real run against the
    // live frontier tier, not by any mocked/local test, exactly like the
    // minItems bug before it. The local Ollama tier accepts both fine,
    // which is exactly why array bounds keep shipping unnoticed here.
    // The "2 to 6 sections" intent still holds: the retry loop in
    // `planLesson` enforces the minimum (see MIN_OUTLINE_SECTIONS), and
    // `sanitizeOutline` below enforces the maximum by truncating.
    .describe('2 to 6 teaching beats, in the order the lesson should cover them.'),
}).strict();

// The target minimum section count — see LessonOutlineSchema's comment
// above for why it isn't a schema `.min()`. Below this, the outline retry
// loop in `planLesson` retries the call once; if the retry is STILL thin,
// it is accepted anyway (a single-beat topic can be real, and failing the
// whole generation over a quantity target would throw away real content) —
// but it's logged and reported as a `retry` progress event either way, so a
// thin outline is always visible, never silently accepted on the first try.
const MIN_OUTLINE_SECTIONS = 2;
// The target maximum — see the schema comment above for why this can't be
// a schema `.max()` for the frontier tier either. Enforced by truncation in
// `sanitizeOutline` below instead of a hard failure: a model that names 8
// sections when asked for "2 to 6" is still giving usable content, just
// more of it than intended.
const MAX_OUTLINE_SECTIONS = 6;

export type LessonOutline = {
  title: string;
  summary: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  instrument: 'guitar' | 'piano' | 'push' | 'any';
  duration: string | null;
  /**
   * The lesson-level `lesson.parameter`, or null when this lesson has no
   * re-keyable content. This is what makes a `lesson.param-picker` block
   * render at all — LessonBody returns null for a picker on a lesson with
   * no parameter — so the write pass is only allowed to emit a picker (or
   * a `useParam` diagram) when this is non-null. Enforced in
   * `groundParsedBlocks`, which drops both.
   */
  parameter: GeneratedLessonParameter | null;
  sections: Array<{ heading: string; goal: string }>;
};

const OUTLINE_SYSTEM = [
  'You design the OUTLINE for a short interactive music lesson, grounded in a set of source videos from a personal knowledge base.',
  'Output ONLY the outline shape (title, summary, level, instrument, duration, sections). Do NOT write the lesson body here — every section is generated separately, afterward, one at a time.',
  'Sections are short teaching beats: 2 to 6 of them, each with a heading and a one-sentence goal describing what it should cover, in the order a learner should encounter them.',
  'Ground the outline in what the source videos actually teach. Do not invent chords, keys, techniques, or songs the sources do not mention.',
  'If a recommended progression across the sources is given, use it to inform section order — a learner should hit prerequisite material before what depends on it.',
  'Shared themes and unique per-video contributions (if given) are good material for individual sections — the outline should give the learner the throughline AND the standout specifics, not just the throughline.',
  '`instrument` should reflect what the sources are teaching (guitar/piano/push), or "any" when the lesson is instrument-agnostic theory.',
  'A lesson MAY declare ONE reader-controlled parameter (a key picker) via `parameterLabel` + `parameterDefault`. Declare one only when the lesson\'s content genuinely transposes — movable triad shapes, scale patterns, a grip that works from any root. Leave BOTH null when the lesson is about specific named keys, chords, or songs from the sources, where re-keying would make the text wrong.',
].join('\n');

// Loaded once at module scope, not per call — see authoring-guide.ts's own
// comment for why this reads from disk instead of a Vite `?raw` import.
// Only the structural-judgment excerpt, not the block reference: the
// outline call never emits a block, so the block vocabulary would be dead
// weight in this prompt (see getOutlineGuideExcerpt's own comment).
// LAZY, not module scope. The guide is read from disk with node:fs, and
// this module ends up in the browser graph, so evaluating it at import time
// threw `Module "node:fs" has been externalized for browser compatibility`
// and broke the /lessons page outright. Deferring the read means importing
// this module is free and only a real generation call (which always runs
// server-side) ever touches the filesystem.
let outlineSystemWithGuide: string | null = null;
function getOutlineSystemWithGuide(): string {
  outlineSystemWithGuide ??= `${OUTLINE_SYSTEM}\n\n---\n\n${getOutlineGuideExcerpt()}`;
  return outlineSystemWithGuide;
}

function buildOutlinePrompt(topic: string, contextText: string, digestText: string): string {
  const parts = [
    `Topic: ${topic}`,
    '',
    'Source videos (ground the lesson in these — do not invent content beyond them):',
    contextText,
  ];
  if (digestText.trim()) {
    parts.push('', digestText);
  }
  return parts.join('\n');
}

// Defensive: treats the model's response as untrusted content, not just an
// untrusted shape — a local model can return well-typed JSON with the wrong
// values (empty strings, empty arrays) even under constrained decoding.
function sanitizeOutline(raw: unknown): LessonOutline | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const summary = typeof r.summary === 'string' ? r.summary.trim() : '';
  if (!title || !summary) return null;

  const level =
    r.level === 'intermediate' || r.level === 'advanced' ? r.level : 'beginner';
  const instrument =
    r.instrument === 'guitar' || r.instrument === 'piano' || r.instrument === 'push'
      ? r.instrument
      : 'any';
  const duration =
    typeof r.duration === 'string' && r.duration.trim() ? r.duration.trim() : null;

  // Both halves must be usable or the parameter is dropped entirely — a
  // half-declared parameter is the silent-failure shape this file keeps
  // guarding against: a picker that renders with no default, or a default
  // with no picker label. `name` is filled in rather than asked for
  // (lesson.parameter's enum has exactly one value today), and a default
  // outside the 12 pitch classes falls back to C rather than shipping a
  // value `resolveDiagramDots` would refuse.
  const parameterLabel =
    typeof r.parameterLabel === 'string' && r.parameterLabel.trim()
      ? truncate(r.parameterLabel.trim(), 40)
      : null;
  const rawDefault = typeof r.parameterDefault === 'string' ? r.parameterDefault.trim() : '';
  const parameter: GeneratedLessonParameter | null = parameterLabel
    ? {
        name: 'key',
        label: parameterLabel,
        default: (PITCH_CLASSES as readonly string[]).includes(rawDefault)
          ? (rawDefault as PitchClass)
          : 'C',
      }
    : null;

  const sectionsRaw = Array.isArray(r.sections) ? r.sections : [];
  const sections = sectionsRaw
    .map((s) => {
      if (!s || typeof s !== 'object') return null;
      const sr = s as Record<string, unknown>;
      const heading = typeof sr.heading === 'string' ? sr.heading.trim() : '';
      const goal = typeof sr.goal === 'string' ? sr.goal.trim() : '';
      if (!heading) return null;
      return { heading, goal };
    })
    .filter((s): s is { heading: string; goal: string } => s !== null)
    // Enforces MAX_OUTLINE_SECTIONS in code since the schema can't (see its
    // comment) — a model that names more than intended still gets used,
    // just capped rather than rejected.
    .slice(0, MAX_OUTLINE_SECTIONS);
  // Only the empty case is treated as unusable here — the caller's retry
  // loop is what enforces MIN_OUTLINE_SECTIONS as a *soft* target (retry
  // once, then accept). A personal-KB topic genuinely can be one teaching
  // beat, and failing the WHOLE generation over a thin-but-usable outline
  // would throw away real content for a quantity target, not a correctness
  // one.
  if (sections.length === 0) return null;

  return { title, summary, level, instrument, duration, parameter, sections };
}

// -----------------------------------------------------------------------------
// Step 5: sections — one small MARKDOWN call PER section
// -----------------------------------------------------------------------------
//
// This pass used to ask for structured JSON against a flattened block
// schema, and it is where every Anthropic structured-output restriction on
// this branch was paid for: `oneOf` rejected (so the discriminated union
// had to be flattened into one object of nullable fields), array
// `minItems`/`maxItems` rejected, integer bounds rejected, and — the
// expensive one — a hard cap of 16 union-typed parameters per request that
// pinned the reachable vocabulary at 5 of 13 block types while Claude
// authoring over MCP reached all 13.
//
// It now asks for MARKDOWN with inline component directives and parses the
// answer. See client/src/lib/lesson/markdown-blocks.ts for the syntax and
// for where the validation went — it MOVED to parse time, it did not
// disappear. Nothing downstream changed: storage, renderer, MCP tools, the
// videos relation and citations all still see the same typed blocks.
//
// `heading` is deliberately NOT in this pass's directive set. The section
// heading is injected from the outline and never trusted from the model —
// and the parser now says so out loud, with an error naming the line,
// where `buildSectionBlocks` used to drop a model heading in silence.

/**
 * The directives the WRITE pass may emit — text only. Diagrams belong to
 * the separate ILLUSTRATE pass (see its own header below); giving this
 * call the diagram vocabulary is what made a diagram an afterthought.
 */
const WRITE_DIRECTIVES = [
  'prose',
  'callout',
  'step',
  'table',
  'degree-chips',
  'param-picker',
  'video-ref',
] as const satisfies readonly LessonDirectiveName[];

// NOT a shaping cap — the brief this branch implements ("stop templating")
// deleted the old MAX_SECTION_BLOCKS=4 shaping behaviour deliberately: a
// section's real length should be decided by what it needs to teach, not a
// constant invented up front. This is only a runaway backstop, an order of
// magnitude above the old shaping cap.
const SECTION_BLOCKS_BACKSTOP = 40;

// The target a section should contain. A section with 0 usable blocks is
// retried once (see the section loop in `writeLesson`); a section with
// 1..MIN_SECTION_BLOCKS-1 stays accept-and-log — a thin-but-grounded
// section is real content, and failing it over a 1-vs-2 block count would
// cost an extra call for a quantity target, not a correctness one.
// Checked AFTER parsing + grounding, so a section that wrote three blocks
// and had two rejected is correctly flagged thin.
const MIN_SECTION_BLOCKS = 2;

// WRITE pass only — no diagram guidance here at all. Do not reintroduce
// diagram language; that reunites the two passes this branch split apart.
const SECTION_SYSTEM = [
  'You write ONE section of a music lesson as MARKDOWN.',
  'Ordinary prose is ordinary markdown: write paragraphs and they become the lesson\'s prose. Anything richer is an inline component directive.',
  'DEFAULT TO THE CITED FORM. Wrap each paragraph as ::prose{src=VIDEO_ID} — a bare markdown paragraph carries no citation at all, and an uncited paragraph is a claim the reader cannot check. Leave a paragraph bare only when it genuinely blends several sources evenly, which should be the minority.',
  'A directive opens with `::name{attributes}` on its own line and closes with a line containing only `::`. There is no self-closing form — every directive has a closing `::`, even one with an empty body. Quote any attribute value containing a space, e.g. title="Fret the root".',
  '',
  'Worked example of a section:',
  '',
  'The minor third sits three frets above the root, so on the low E string an open E puts it at fret 3.',
  '',
  '::callout{tone=tip src=VIDEO_ID}',
  'Count frets, not notes: every fret is one half step, no exceptions anywhere on the neck.',
  '::',
  '',
  '::step{title="Find the root"}',
  'Fret the low E at 5 — that is A.',
  '::',
  '',
  '::table{caption="Counting up from an open low E"}',
  '| Interval | Half steps | Fret |',
  '|---|---|---|',
  '| Minor 3rd | 3 | 3 |',
  '| Major 3rd | 4 | 4 |',
  '::',
  '',
  'Available directives in THIS pass, and nothing else: ::prose, ::callout, ::step, ::table, ::degree-chips, ::video-ref, ::param-picker. Diagrams are added separately, by a later pass, after this section\'s text is finished. Do not describe a diagram in prose either; if something would be clearer shown than described, say what it is and trust the illustration pass to show it.',
  'Do NOT write a heading — no `#` line and no ::heading. The section heading is added automatically from the outline; start straight in with content.',
  'Directive reference: ::callout{tone=note|tip|warning src=…} with the aside as its body. ::step{title="…" lede="…" src=…} with optional markdown as its body. ::table{caption="…"} with a markdown table as its body — every row must have exactly as many cells as the header. ::degree-chips{size=sm|md} with the chips on one line, e.g. `I ii IV V7`. ::prose{src=…} when a paragraph needs a citation. ::video-ref{videoId=… label="…"}. ::param-picker{label="…"}.',
  'Use `::step` for sequenced instructions, `::table` for comparisons, `::degree-chips` for scale-degree sequences, `::callout` for a short aside that carries one specific, checkable fact, and plain paragraphs for the reasoning that connects them — why, not just what.',
  'Use `::video-ref` when a source shows something a reader really should watch rather than read — a demonstration, a sound, a hand position. Set `videoId` to the video, `label` to the link text, and the BODY to a short description of that exact moment (in the video\'s own words as best you recall them) — the body is never shown to the reader, it is what locates the timecode. At most one or two per section; it is a pointer, not a substitute for teaching the material.',
  'Use `::param-picker` ONLY if the user prompt below says this lesson declares a reader-controlled parameter. At most ONE per lesson, placed early in the section it belongs to. On a lesson with no parameter it renders as nothing at all, so never emit one speculatively.',
  'Ground content in the PASSAGES quoted from the source transcripts below. They are the actual words of the videos — prefer their specifics (note names, fret numbers, chord names, the exact wording of a rule) over generalities. Do not invent chords, keys, techniques, or songs the passages and source list do not mention.',
  'Write what the passages actually say, concretely. "The minor third sits three frets up from the root" is a lesson; "focus on understanding the pattern" is filler. If a passage names a note, a fret, a string or a chord, name it too.',
  'Cite with `src=` — the exact id shown in [brackets] next to the source video that content is drawn from. It belongs on ::prose, ::callout, ::step and (as `videoId`) ::video-ref. Aim for nearly every content block to carry one: a section where most blocks are uncited is a section that drifted off its passages.',
  'NEVER write a bare video id into text a reader sees — that id is for `src` only. Refer to a source in text by its title or a natural phrase ("one video recommends…"), never by the [bracketed] id itself.',
  'If a block NAMES a source in its own words — quotes a video verbatim, says "one video recommends…", "according to…", or names a channel or instructor — that block MUST carry `src` pointing at exactly that video. An attribution the reader cannot follow is worse than no attribution: either cite it, or make the point in your own voice without naming a source. Quote verbatim only when the exact wording matters, and always with `src`.',
  'The `[id @ m:ss]` header on each passage is metadata for you, not content: never copy a timecode or an id into the lesson text. Timecodes are added automatically afterwards.',
  'Output the markdown for this section and nothing else — no preamble, no code fence around the whole answer, no explanation of what you wrote.',
].join('\n');

// Loaded once at module scope — see OUTLINE_GUIDE_EXCERPT's comment above.
// The directive-reference entries for exactly the block types this call is
// allowed to emit, plus the judgment on what makes those blocks good rather
// than generic (see getSectionBlockGuideExcerpt's own comment). Lazy for the
// same reason as getOutlineSystemWithGuide above.
let sectionSystemWithGuide: string | null = null;
function getSectionSystemWithGuide(): string {
  sectionSystemWithGuide ??= `${SECTION_SYSTEM}\n\n---\n\n${getSectionBlockGuideExcerpt()}`;
  return sectionSystemWithGuide;
}

// -----------------------------------------------------------------------------
// Section source material — real transcript passages, not digest themes.
// -----------------------------------------------------------------------------
//
// The write pass used to be prompted from the per-video CONTEXT CARDS
// (title + 400-char summary + music-extraction line) and nothing else. A
// summary exists to compress; a section needs exactly what compression
// throws away — the note names, the fret numbers, the exact wording of a
// rule. The symptom was prose that said "understand the pattern" where the
// source said "fret 5 on the low E is A".
//
// So each section call now retrieves its own passages, per section, from
// the SAME BM25 indexes citation grounding already uses (one per source
// video, loaded from `transcriptSegments`) — the pattern
// `retrieveChunksForDigest` in learning.ts uses for cross-video chat, with
// the section's heading + goal as the query instead of a user question.
//
// Two knock-on effects worth naming, because both are the point rather
// than a side effect:
//   * Citations should get better, not just prose. A block written FROM a
//     passage has text that BM25-matches that passage, so `resolveBlockSource`
//     finds a real timecode instead of falling back to a video-only citation.
//   * The digest stops being the section's source material and goes back to
//     being the lesson's THROUGHLINE — see `buildDigestContinuityText`.

// Budget. Deliberately small: this pipeline's whole shape is many small
// calls (see the module header), and it has to stay runnable on the local
// tier. A retrieval chunk is RETRIEVAL_CHUNK_WORDS (150) words ≈ 200
// tokens, so 8 passages ≈ 1,600 tokens of source material per section
// call — roughly the footprint of single-video chat's top-8 retrieval,
// which is the largest retrieval budget anything else in this codebase
// uses. 2 per video (rather than 3, as digest chat uses) keeps five
// sources from crowding out the one that actually covers this section,
// and the round-robin below spends the remaining slots on the
// highest-ranked videos.
const SECTION_PASSAGES_PER_VIDEO = 2;
const SECTION_PASSAGES_MAX = 8;
// Backstop only — a retrieval chunk is ~150 words ≈ 900 chars.
const PASSAGE_MAX_CHARS = 1000;

type SectionPassage = { videoId: string; timeSec: number; text: string };

function formatPassageTimecode(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(rest).padStart(2, '0')}`;
}

// `chunkForRetrieval` embeds `[mm:ss]` markers inside chunk text so chat
// can cite them. This pass must NOT cite them — a lesson block's timecode
// is decided by grounding, never by the model (CLAUDE.md: "Do not add a
// code path that trusts a timecode the model produced") — and a literal
// "[2:15]" copied into prose renders as raw text with no chip behind it.
// Stripped here rather than in transcript.ts: chat genuinely wants them.
function stripInlineTimecodes(text: string): string {
  return text.replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Retrieves the passages for ONE section across all source videos.
 *
 * Ranks per video (BM25 scores are not comparable ACROSS videos — each
 * index has its own idf table — so there is no honest global sort), then
 * interleaves by RANK: every video's best passage first, then every
 * video's second, until the budget runs out. `videos` arrives in
 * relevance order (phase 1 sorts by cosine), so when the budget cuts a
 * rank tier short it cuts the least-relevant videos, not an arbitrary one.
 */
function retrieveSectionPassages(
  section: { heading: string; goal: string },
  videoIds: string[],
  bm25ByVideoId: Map<string, BM25Index>,
): SectionPassage[] {
  const query = `${section.heading}. ${section.goal}`.trim();
  if (!query) return [];

  const perVideo: Array<{ videoId: string; chunks: TranscriptChunk[] }> = [];
  for (const videoId of videoIds) {
    const index = bm25ByVideoId.get(videoId);
    if (!index) continue;
    perVideo.push({ videoId, chunks: searchBM25(index, query, SECTION_PASSAGES_PER_VIDEO) });
  }

  const out: SectionPassage[] = [];
  for (let rank = 0; rank < SECTION_PASSAGES_PER_VIDEO; rank++) {
    for (const { videoId, chunks } of perVideo) {
      if (out.length >= SECTION_PASSAGES_MAX) return out;
      const chunk = chunks[rank];
      if (!chunk) continue;
      const text = truncate(stripInlineTimecodes(chunk.text), PASSAGE_MAX_CHARS);
      if (!text) continue;
      out.push({ videoId, timeSec: chunk.timeSec, text });
    }
  }
  return out;
}

function formatSectionPassages(passages: SectionPassage[]): string {
  return passages
    .map((p) => `[${p.videoId} @ ${formatPassageTimecode(p.timeSec)}]\n${p.text}`)
    .join('\n\n');
}

// The digest's job in the WRITE pass, now that passages carry the
// specifics: continuity, and only continuity. Two one-line fields — the
// throughline and the bottom line — so five independently-generated
// sections still read as one lesson. Deliberately NOT sharedThemes /
// uniqueInsights / viewingOrder: that is the compressed material this
// change exists to stop writing sections from. The outline call still gets
// all of it (`buildDigestContextText`), where structure IS the job.
function buildDigestContinuityText(digest: Digest): string {
  const lines: string[] = [];
  if (digest.overallTheme.trim()) {
    lines.push(`Throughline across the sources: ${truncate(digest.overallTheme.trim(), 400)}`);
  }
  if (digest.bottomLine.trim()) {
    lines.push(`Where the lesson lands: ${truncate(digest.bottomLine.trim(), 300)}`);
  }
  return lines.join('\n');
}

// The source ROSTER for the write pass: `- [id] "Title"` and nothing more,
// for videos whose passages are already in the prompt — the id is there so
// `sourceVideoId` can be filled in, and the passages carry the substance.
// A video that contributed NO passage to this section (no stored transcript
// index, or nothing matched) keeps its full context card, so it doesn't
// silently shrink to a bare title and drop out of the lesson.
function buildSectionRosterText(videos: StrapiVideo[], withPassages: Set<string>): string {
  return videos
    .map((v) =>
      withPassages.has(v.youtubeVideoId)
        ? `- [${v.youtubeVideoId}] "${v.summaryTitle ?? v.videoTitle ?? 'Untitled video'}"`
        : buildVideoContextText(v),
    )
    .join('\n');
}

function buildSectionPrompt(
  outline: { title: string; summary: string; parameter: GeneratedLessonParameter | null },
  section: { heading: string; goal: string },
  rosterText: string,
  passagesText: string,
  continuityText: string,
): string {
  const parts = [
    `Lesson: "${outline.title}" — ${outline.summary}`,
  ];
  if (continuityText) parts.push(continuityText);
  parts.push(
    outline.parameter
      ? `This lesson DOES declare a reader-controlled parameter: a ${outline.parameter.label.toLowerCase()} picker starting on ${outline.parameter.default}. A \`param-picker\` block is allowed (at most one in the whole lesson).`
      : 'This lesson declares NO reader-controlled parameter — do not emit a `param-picker` block; it would render as nothing.',
    '',
    `This section's heading (already added automatically — do not repeat it): "${section.heading}"`,
    `This section's goal: ${section.goal}`,
    '',
    'Source videos (cite by the [bracketed] id):',
    rosterText,
  );
  if (passagesText) {
    parts.push(
      '',
      'Passages retrieved from those transcripts for THIS section — the videos\' actual words, and the material to write from:',
      passagesText,
    );
  } else {
    parts.push(
      '',
      '(No transcript passages matched this section. Write from the source summaries above, and stay conservative — do not invent specifics they do not state.)',
    );
  }
  return parts.join('\n');
}

// The caption / label length caps that used to live here moved into
// markdown-blocks.ts, alongside every other limit the output schema used to
// carry — one place, applied to both authoring passes.

// -----------------------------------------------------------------------------
// Citation grounding — never trust a timecode the model produced. The model
// only ever names WHICH video a block draws from (`sourceVideoId`); WHEN in
// that video is decided here, by BM25-matching the block's own text against
// that video's real transcript chunks, exactly the pattern
// `groundSectionsToTranscript` uses in transcript.ts for summary sections.
// -----------------------------------------------------------------------------

type GroundingContext = {
  validVideoIds: Set<string>;
  bm25ByVideoId: Map<string, BM25Index>;
  /** youtubeVideoId -> display title, for stripLeakedVideoIds below. */
  titleByVideoId: Map<string, string>;
  /**
   * The lesson's `lesson.parameter`, or null. Gates BOTH the
   * `param-picker` block and a diagram's `useParam`: without a parameter
   * a picker renders as literally nothing (LessonBody returns null), and
   * `useParam: true` would make `resolveDiagramDots` take LessonBody's
   * fallback paramValue ('C') as the root — silently redrawing every
   * theory diagram in the wrong key. Both are dropped here rather than
   * shipped, since neither failure raises anything at render time.
   *
   * The `default` is load-bearing too, not just informational — see
   * `honoursLessonParameter` below.
   */
  parameter: GeneratedLessonParameter | null;
  /**
   * Called when a block is discarded. Dropping silently is the failure this
   * whole pipeline keeps guarding against, so every drop is announced with
   * the field values that caused it.
   */
  warn: (reason: string, meta?: Record<string, unknown>) => void;
};

// Reader-facing text must never contain a raw video id. The context text
// every section call sees lists each source as `[videoId] "Title"` so the
// model can copy the id into `sourceVideoId` — but the bracketed id is for
// the model, not the reader, and nothing stops it from typing the id into
// prose instead of the field. A real generation run did exactly this:
// "One fix from PS54GhZoojo is octave displacement." Only checked against
// ids ACTUALLY in this lesson's source set (never a general "11
// base64-ish characters" pattern), so an ordinary word is never mangled by
// coincidence. Replaces the id with the video's title when known (so the
// sentence still reads naturally), or a generic phrase otherwise.
function stripLeakedVideoIds(text: string, ground: GroundingContext): string {
  let result = text;
  for (const videoId of ground.validVideoIds) {
    if (!result.includes(videoId)) continue;
    const title = ground.titleByVideoId.get(videoId);
    const replacement = title ? `"${title}"` : 'one of the source videos';
    result = result.split(videoId).join(replacement);
  }
  return result;
}

// -----------------------------------------------------------------------------
// Prompt scaffolding must not reach the reader either.
// -----------------------------------------------------------------------------
//
// `stripLeakedVideoIds` above exists because a model copied an id out of its
// own prompt into reader-facing prose. The illustrate pass leaks a SECOND
// kind of prompt detail the same way: it is handed the section's finished
// text as a NUMBERED list so it can anchor `after=N`, and a live run shipped
// a caption that referred to that numbering — a sentence about the
// pipeline's own bookkeeping, published in a lesson. The numbering is not
// content, the reader never sees the list, and no caption that mentions it
// can be read into sense.
//
// Same treatment as a leaked id, then: remove it, tidy what's left, and SAY
// SO (see sanitizeReaderText, which now warns on BOTH kinds of repair
// instead of doing them in silence). The prompts were reworded too, so the
// numbering is presented as an address rather than as a thing worth
// describing — see ILLUSTRATION_SYSTEM — but a prompt is a request and this
// is the enforcement.
const PROMPT_SCAFFOLDING_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  // "block 2", "block [2]", "block index 2", "as shown in block 3", and the
  // plural forms. A music lesson has no other use for the word.
  {
    label: 'a block index reference',
    re: /\b(?:as\s+(?:shown|described|seen|listed)\s+in\s+)?blocks?\s*(?:index\s*)?[#[]?\s*-?\d+\s*\]?/gi,
  },
  // The framing itself: "the indexed list", "the list of blocks above".
  {
    label: 'the indexed-list framing',
    re: /\b(?:the\s+)?(?:indexed\s+list|list\s+of\s+blocks|block\s+list)(?:\s+above)?\b/gi,
  },
  // Attribute syntax quoted out of the prompt rather than used.
  { label: 'a placement attribute', re: /\bafter\s*=\s*-?\d+/gi },
  { label: 'raw attribute syntax', re: /\b(?:src|videoId)\s*=\s*[^\s,;.)]+/gi },
  { label: 'a placeholder id', re: /\bVIDEO_ID\b/g },
  { label: 'directive syntax', re: /::[a-z][a-z-]*(?:\{[^}]*\})?/gi },
  // A bare "[2]" left where the index used to be. Never a timecode — those
  // are `[m:ss]` and are stripped from passages before the model sees them.
  { label: 'a bare index reference', re: /(?<![\w:])\[\s*-?\d+\s*\]/g },
];

// Whitespace/punctuation left behind by a removal. Only ever runs when
// something WAS removed, so it can't quietly reshape untouched text.
function tidyAfterRemoval(text: string): string {
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])\s*(?=[,.;:])/g, '')
    .replace(/^[\s,.;:—–-]+/, '')
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
}

/** Returns the cleaned text plus what kind of scaffolding was taken out. */
function stripPromptScaffolding(text: string): { text: string; removed: string[] } {
  let result = text;
  const removed: string[] = [];
  for (const { label, re } of PROMPT_SCAFFOLDING_PATTERNS) {
    const next = result.replace(re, ' ');
    if (next !== result) removed.push(label);
    result = next;
  }
  if (removed.length === 0) return { text, removed };
  return { text: tidyAfterRemoval(result), removed };
}

// Every reader-facing free-text field (prose/callout/step body+lede+title,
// diagram/keyboard-diagram/table caption) is read through this, not a bare
// `.trim()` — see stripLeakedVideoIds above for why. BOTH repairs announce
// themselves: a silent repair is how a prompt-scaffolding caption reached a
// live lesson unnoticed in the first place.
function sanitizeReaderText(
  raw: unknown,
  ground: GroundingContext,
  where?: Record<string, unknown>,
): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const deIded = stripLeakedVideoIds(trimmed, ground);
  if (deIded !== trimmed) {
    ground.warn('a raw video id leaked into reader-facing text — replaced with the title', {
      ...where,
      text: truncate(trimmed, 160),
    });
  }
  const { text: deScaffolded, removed } = stripPromptScaffolding(deIded);
  if (removed.length > 0) {
    ground.warn('prompt scaffolding leaked into reader-facing text — removed', {
      ...where,
      removed,
      before: truncate(deIded, 160),
      after: truncate(deScaffolded, 160),
    });
  }
  return deScaffolded.trim();
}

// -----------------------------------------------------------------------------
// A transposable diagram must not carry a caption pinned to one key.
// -----------------------------------------------------------------------------
//
// `honoursLessonParameter` (below) checks the diagram's ROOT against the
// lesson key. Nothing checked the CAPTION, and a live lesson shipped the
// consequence: a `useParam` diagram rooted on the lesson key, captioned
// "C, E and G — scale degrees 1, 3 and 5". Turn the picker to G and the
// diagram redraws as G–B–D while the caption still names C, E and G. No
// error, no empty diagram — the lesson just contradicts itself on screen.
//
// So a caption that names a concrete note is treated as evidence that the
// diagram does NOT transpose, and `useParam` is switched off — the same
// remedy the root-mismatch case already uses, for the same reason: the
// caption is grounded, cited content and the transposition is the
// speculative part, so the diagram stays fixed on the root its caption
// describes. One rule, stated once: a diagram whose caption cannot survive
// being re-keyed does not get re-keyed.
//
// The detector deliberately errs toward finding a note name. A false
// positive costs one diagram its interactivity and prints a warning naming
// the caption; a false negative publishes a lesson that argues with itself.

/**
 * String names are note letters that do NOT move when the key does — "the
 * low E string" is the low E string in every key, and so is "the E/A pair"
 * and "the e–B–G set" — so they are removed before the scan rather than
 * counted as key pins. Checked against the captions of a real generated
 * lesson; see the fixture in lesson-generation.test.ts.
 */
const STRING_NAME_RE =
  /\b[A-Ga-g][#♯b♭]?(?:\s*[–—/-]\s*[A-Ga-g][#♯b♭]?)*\s*(?:strings?|set|pairs?)\b/g;

/**
 * A note letter that is not the first letter of an ordinary word: an
 * optional accidental, an optional chord-quality suffix (`Am`, `Cmaj7`),
 * and no letter directly either side.
 */
const NOTE_TOKEN_RE = /(?<![A-Za-z#♯♭])([A-G])([#♯b♭]?)(maj|min|dim|aug|sus|m|°|Δ)?(?![A-Za-z])/g;

/** "C major", "G 7", "E triad" — a quality word right after the letter. */
const QUALITY_FOLLOWS_RE =
  /^\s*(?:major|minor|maj|min|diminished|dim|augmented|aug|sus|triad|chord|scale|arpeggio|note|root|tonic|\d)/i;

/** "in the key of C", "the root note G", "rooted on D". */
const ANCHOR_PRECEDES_RE =
  /(?:\bkey(?:\s+of)?|\bnotes?|\broot|\btonic|\bchord|\bscale|\brooted\s+on|\bstarting\s+on|\bbased\s+on|\bin|\bon|\bto|\bfrom|\baround)\s+$/i;

/** The gap between two note letters in a run: "C, E and G", "G–B–D". */
const NOTE_RUN_GAP_RE = /^\s*(?:[,/–—+-]|and|or|to|then)?\s*$/i;

export type PinnedNote = { term: string; why: string };

/**
 * The first concrete note name a caption pins itself to, or null.
 *
 * Exported for its own unit tests — the qualification rules below are the
 * whole substance of this check and are much easier to pin down directly
 * than through a full generation run.
 */
export function findKeyPinnedNote(caption: string): PinnedNote | null {
  const text = stripStringNames(caption);
  if (!text.trim()) return null;
  const matches = [...text.matchAll(NOTE_TOKEN_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (m[2]) return { term: m[0], why: 'a note name carrying an accidental' };
    if (m[3]) return { term: m[0], why: 'a chord name built on a note letter' };
    const after = text.slice(end);
    if (QUALITY_FOLLOWS_RE.test(after)) {
      return { term: m[0], why: 'a note letter followed by a chord or scale quality' };
    }
    if (ANCHOR_PRECEDES_RE.test(text.slice(0, start))) {
      return { term: m[0], why: 'a note letter introduced as a key, root or chord' };
    }
    const next = matches[i + 1];
    if (next) {
      const gap = text.slice(end, next.index ?? end);
      if (gap.length <= 6 && NOTE_RUN_GAP_RE.test(gap)) {
        return { term: `${m[0]}${gap}${next[0]}`, why: 'a run of note names' };
      }
    }
  }
  return null;
}

function stripStringNames(text: string): string {
  return text.replace(STRING_NAME_RE, ' ');
}

// -----------------------------------------------------------------------------
// Prose that names a source but carries no citation.
// -----------------------------------------------------------------------------
//
// This whole pipeline's premise is that a claim in a lesson can be followed
// back to the transcript it came from. A block that NAMES a source in its
// own words — "one video recommends…", a channel or instructor by name, a
// verbatim quotation — and then carries no `src` is worse than an uncited
// generality: it advertises a provenance the reader cannot reach. A live
// lesson shipped both shapes, including a quotation in quote marks, while
// prose citation coverage sat around 41% against 100% for every other block
// type.
//
// Detected here rather than trusted to the prompt (SECTION_SYSTEM asks for
// it too, but a prompt is a request), and REPORTED rather than repaired:
// guessing which video a claim came from would replace an unlinked
// attribution with a possibly-wrong one, which is worse still. The count
// reaches the progress stream, so it is visible per section and not only in
// the server log.
const SOURCING_CLAIM_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'a verbatim quotation', re: /[“"][^”"]{12,}[”"]/ },
  {
    label: 'an attribution to a source video',
    re: /\b(?:one|another|the|this|that)\s+(?:video|tutorial|instructor|teacher|source|creator|channel)\b/i,
  },
  { label: 'an "according to" attribution', re: /\baccording to\b/i },
  {
    label: 'an attribution to a named speaker',
    re: /\bas\s+[\w'’]+\s+(?:puts it|explains|says|describes|calls)\b/i,
  },
];

/** What makes this text read as a sourcing claim, or null. */
function findSourcingClaim(text: string, ground: GroundingContext): string | null {
  for (const { label, re } of SOURCING_CLAIM_PATTERNS) {
    if (re.test(text)) return label;
  }
  for (const title of ground.titleByVideoId.values()) {
    // Short titles collide with ordinary phrases; only a substantial one is
    // evidence that the text is naming a specific source.
    if (title.length >= 12 && text.includes(title)) {
      return `a source video named in the text ("${truncate(title, 60)}")`;
    }
  }
  return null;
}

function resolveBlockSource(
  rawSourceVideoId: unknown,
  blockText: string,
  ground: GroundingContext,
): { videoId: string; timeSec?: number } | undefined {
  if (typeof rawSourceVideoId !== 'string') return undefined;
  const videoId = rawSourceVideoId.trim();
  if (!videoId || !ground.validVideoIds.has(videoId)) return undefined;

  const index = ground.bm25ByVideoId.get(videoId);
  const text = blockText.trim();
  if (!index || !text) return { videoId };

  // Default minScore (1.0) — a weak/no match means we cite the video
  // without a timestamp rather than guess. A wrong timecode is worse than
  // no timecode.
  const evidence = findEvidenceForQuote(text, index);
  return evidence ? { videoId, timeSec: evidence.timeSec } : { videoId };
}

// -----------------------------------------------------------------------------
// From parsed blocks to grounded blocks
// -----------------------------------------------------------------------------
//
// `parseLessonMarkdown` is pure: it validates shape, enforces every enum
// and length rule, and drops anything the renderer could not draw. What it
// cannot know is which videos THIS lesson may cite, whether the lesson
// declares a parameter, and what a real timecode is. That is this
// function's job — and it is shared by BOTH passes, which is why `src` is
// one attribute across the whole directive vocabulary rather than two
// spellings.
//
// Never reads a model-supplied `timeSec`: the parser refuses to carry one
// at all (its `trustTimeSec` option is false everywhere in generation), and
// WHEN in a video a block came from is decided here, by BM25 against that
// video's real transcript chunks.

/** The text blocks a `src` citation belongs on when they cite in prose. */
const CITEABLE_TEXT_COMPONENTS = new Set([
  'lesson.prose',
  'lesson.callout',
  'lesson.step',
]);

/** Every reader-facing free-text field, read through sanitizeReaderText. */
const READER_TEXT_FIELDS = ['body', 'title', 'lede', 'caption', 'label', 'text'] as const;

/** The text a block is grounded BY — what BM25 matches against the transcript. */
function groundingTextOf(block: LessonBlock): string {
  switch (block.__component) {
    case 'lesson.step':
      return [block.title, block.lede, block.body]
        .filter((v): v is string => typeof v === 'string' && v.length > 0)
        .join('. ');
    case 'lesson.prose':
    case 'lesson.callout':
      return typeof block.body === 'string' ? block.body : '';
    default:
      return typeof block.caption === 'string' ? block.caption : '';
  }
}

/**
 * What grounding did beyond producing blocks — the numbers a caller needs
 * to report instead of only logging.
 */
export type GroundingStats = {
  /** Blocks grounding discarded (unrenderable, or citing an unknown video). */
  dropped: number;
  /** Text blocks that name a source in their own words but carry no `src`. */
  unsourced: number;
  /** Diagrams whose `useParam` was switched off (root or caption mismatch). */
  fixedUseParam: number;
};

/**
 * Returns the SURVIVING parsed items, with their blocks grounded in place
 * — not a bare `LessonBlock[]`. Dropping is part of this function's job, so
 * a caller that needs a block's parse metadata (the illustrate pass needs
 * its `after` anchor) would silently mis-pair by array index otherwise.
 *
 * Also returns the counts above: every drop here used to be a log line and
 * nothing else, so a run that lost half a section to grounding still
 * reported `dropped: 0` to the progress stream.
 */
function groundParsedBlocks(
  parsed: ParsedBlock[],
  ground: GroundingContext,
): { items: ParsedBlock[]; stats: GroundingStats } {
  const out: ParsedBlock[] = [];
  const stats: GroundingStats = { dropped: 0, unsourced: 0, fixedUseParam: 0 };
  for (const item of parsed) {
    const block = item.block;

    // A param-picker on a lesson with no `parameter` renders as literally
    // nothing (LessonBody returns null), so it is dropped rather than
    // shipped as an invisible gap. The one-per-lesson rule is enforced at
    // assembly, which is the only point that sees the whole body.
    if (block.__component === 'lesson.param-picker' && !ground.parameter) {
      ground.warn('param-picker on a lesson that declares no parameter', { line: item.line });
      stats.dropped += 1;
      continue;
    }

    // Reader-facing text must never contain a raw video id: a real run
    // produced "One fix from PS54GhZoojo is octave displacement." Nor may
    // it carry this pipeline's own prompt scaffolding — see
    // stripPromptScaffolding. Runs BEFORE the useParam checks below, so
    // the caption those read is the caption the reader will actually see.
    for (const field of READER_TEXT_FIELDS) {
      const value = block[field];
      if (typeof value === 'string') {
        block[field] = sanitizeReaderText(value, ground, {
          component: block.__component,
          field,
          line: item.line,
        });
      }
    }
    if (
      (block.__component === 'lesson.prose' || block.__component === 'lesson.callout') &&
      !block.body
    ) {
      ground.warn('block dropped — its body was empty after sanitisation', {
        component: block.__component,
        line: item.line,
      });
      stats.dropped += 1;
      continue;
    }

    // `useParam` substitutes the reader's chosen key for the diagram's
    // root. That is only coherent when TWO things hold: the root IS the
    // lesson key (see honoursLessonParameter), and the caption does not
    // pin the diagram to one key in words (see findKeyPinnedNote). Either
    // failure silently desynchronises the picture from its own caption, so
    // both switch the picker off rather than shipping the contradiction.
    if (block.useParam === true) {
      if (!honoursLessonParameter(block.root, ground.parameter)) {
        ground.warn('useParam ignored — the diagram root does not match the lesson key', {
          root: block.root ?? null,
          parameterDefault: ground.parameter?.default ?? null,
          line: item.line,
        });
        block.useParam = false;
        stats.fixedUseParam += 1;
      } else {
        const caption = typeof block.caption === 'string' ? block.caption : '';
        const pinned = findKeyPinnedNote(caption);
        if (pinned) {
          ground.warn(
            'useParam ignored — the caption names a specific note, so the diagram cannot be re-keyed under it',
            {
              term: pinned.term,
              why: pinned.why,
              root: block.root ?? null,
              caption: truncate(caption, 160),
              line: item.line,
            },
          );
          block.useParam = false;
          stats.fixedUseParam += 1;
        }
      }
    }

    if (block.__component === 'lesson.video-ref') {
      // `videoId` is required by the component (LessonBody renders nothing
      // without it), so an unresolvable one drops the block rather than
      // shipping a dead link.
      const videoId = typeof block.videoId === 'string' ? block.videoId : '';
      if (!ground.validVideoIds.has(videoId)) {
        ground.warn("video-ref names a video outside this lesson's source set", {
          videoId,
          line: item.line,
        });
        stats.dropped += 1;
        continue;
      }
      const momentText =
        sanitizeReaderText(item.moment ?? '', ground, {
          component: block.__component,
          field: 'moment',
          line: item.line,
        }) || (typeof block.label === 'string' ? block.label : '');
      const resolved = resolveBlockSource(videoId, momentText, ground);
      if (resolved && typeof resolved.timeSec === 'number') {
        block.timeSec = resolved.timeSec;
      } else {
        ground.warn('video-ref grounded to a video but not to a timecode — linking to 0:00', {
          videoId,
        });
      }
      out.push(item);
      continue;
    }

    if (item.src) {
      const source = resolveBlockSource(item.src, groundingTextOf(block), ground);
      if (source) block.source = source;
      else
        ground.warn("citation dropped — src names a video outside this lesson's source set", {
          src: item.src,
          line: item.line,
        });
    } else if (CITEABLE_TEXT_COMPONENTS.has(block.__component)) {
      // No `src` at all. Fine for a general statement; NOT fine for a block
      // that names a source in its own text — see findSourcingClaim.
      const text = groundingTextOf(block);
      const claim = findSourcingClaim(text, ground);
      if (claim) {
        ground.warn('block names a source in its own text but carries no citation', {
          component: block.__component,
          claim,
          line: item.line,
          text: truncate(text, 200),
        });
        stats.unsourced += 1;
      }
    }
    out.push(item);
  }
  return { items: out, stats };
}


/**
 * Reports a runaway-backstop truncation as the drop it is, and returns how
 * many blocks it cost.
 *
 * Both authoring passes used to truncate their parsed block list with a
 * bare `.slice(0, BACKSTOP)` inline — no log, and nothing added to the
 * `dropped` count the progress stream carries. A backstop firing is rare
 * and always interesting (it means a pass produced an order of magnitude
 * more blocks than a section should have), so it is exactly the kind of
 * thing that must not be inferable only from a slightly shorter lesson.
 */
function countBackstopOverflow(
  topic: string,
  label: string,
  parsedCount: number,
  backstop: number,
): number {
  const overflow = Math.max(0, parsedCount - backstop);
  if (overflow > 0) {
    logPhase(topic, `${label} ⚠ truncated at the runaway backstop — ${overflow} block(s) dropped`, {
      parsed: parsedCount,
      backstop,
    });
  }
  return overflow;
}

/**
 * Announces what the parser rejected or repaired. Dropping in silence is
 * the failure this whole pipeline keeps guarding against — a parse error
 * that only ever showed up as a shorter lesson would be the same class of
 * bug as the four fields that reached production unrendered.
 */
function logParseIssues(topic: string, label: string, issues: ParseIssue[]) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (errors.length > 0) {
    logPhase(topic, `${label} ⚠ parser rejected ${errors.length} block(s)`, {
      detail: formatIssues(errors),
    });
  }
  if (warnings.length > 0) {
    logPhase(topic, `${label} · ${warnings.length} parser warning(s)`, {
      detail: formatIssues(warnings),
    });
  }
}

// -----------------------------------------------------------------------------
// Step 5.5: illustrate — one small MARKDOWN call PER SECTION, given that
// section's OWN finished text (from step 5), answering a different question
// than the write pass: "what here would be clearer shown than described?"
// Returns visual blocks plus where each belongs in the section. See
// docs/lesson-authoring.md's "Generation is two passes" note for the full
// rationale; the short version is that a combined write+illustrate call
// makes a diagram an afterthought.
//
// This pass reaches the WHOLE visual vocabulary — all five drawing blocks,
// explicit-mode dots and marks with the four style flags, inversions, fret
// windows, barres, pattern sets. None of that was reachable while the
// answer had to fit a structured-output schema: a request may carry at
// most 16 union-typed parameters and every optional field is a union, so
// the combined schema sat at the ceiling and the vocabulary was cut to
// fit. Markdown has no such ceiling, and taking that is the point of this
// change rather than a side effect of it.
//
// Run PER SECTION rather than once for the whole lesson — same "small,
// independent calls" shape as the write pass, and, unlike the write pass,
// every section's illustrate call is fully independent of every other
// section's (it only reads that one section's already-finished text), so
// `writeLesson` below fires them all with `Promise.all` instead of a
// sequential loop — otherwise this pass would roughly double total
// generation time for no reason.
// -----------------------------------------------------------------------------

/**
 * The directives the ILLUSTRATE pass may emit — the five that draw
 * something, and nothing else. The write pass owns the words; a prose
 * directive here would be this pass rewriting a section it was explicitly
 * told is finished, so the parser rejects it by name.
 */
const ILLUSTRATE_DIRECTIVES = [
  'diagram',
  'keyboard-diagram',
  'chord-diagram',
  'neck-pattern',
  'natural-notes',
] as const satisfies readonly LessonDirectiveName[];

// Runaway backstops, NOT shaping caps — see SECTION_BLOCKS_BACKSTOP's
// comment for why this branch treats the two differently from the old
// MAX_DIAGRAMS_PER_SECTION=1 / MAX_DIAGRAMS_PER_LESSON=4 it replaces. A
// section teaching five pentatonic positions should get five diagrams; an
// order-of-magnitude-higher ceiling only exists so a badly-behaved model
// can't emit an unbounded number of illustrations, not to shape how many a
// well-behaved one produces.
const ILLUSTRATIONS_PER_SECTION_BACKSTOP = 10;
const ILLUSTRATIONS_PER_LESSON_BACKSTOP = 40;

const ILLUSTRATION_SYSTEM = [
  'You are the ILLUSTRATE pass for one already-written section of a music lesson. The section\'s text is finished — you do not write or edit it. Your only job: decide what in it would be clearer SHOWN than described, and emit the diagram(s) for that.',
  'Answer in MARKDOWN, using ONLY component directives — no prose, no preamble, no explanation, no code fence around the answer. A directive opens with `::name{attributes}` on its own line and closes with a line containing only `::`. There is no self-closing form. Quote any attribute value containing a space.',
  // Deliberately phrased as an ADDRESS, not as "an indexed list of blocks"
  // — the old wording named a thing, and a live run shipped a caption that
  // described it to the reader. Anything the prompt hands the model that is
  // not lesson content has to arrive labelled as machinery, and be
  // explicitly out of bounds for a caption; stripPromptScaffolding enforces
  // the same rule after the fact.
  'Placement: each line of the section text below is preceded by a number in square brackets. That number is a placement address for the `after=` attribute and nothing else — it is not part of the lesson and the reader never sees it. `after=N` puts the illustration after the line addressed N; `after=-1` puts it before everything; omitting `after` puts it at the end of the section (the common case).',
  'A caption is read by a learner who can see only the finished lesson. NEVER mention a line number, an index, a block, a list, an attribute name, or anything else from these instructions in a caption — a caption that does is describing this prompt instead of the music, and it ships to the reader exactly as you wrote it.',
  'Not every section needs an illustration. If nothing in this section\'s text would be clearer shown than described, return an EMPTY response — zero characters. Do not write the word "none" or "nothing"; an empty answer is a correct, expected outcome, not a failure.',
  'There is no fixed count. A section naming five pentatonic positions wants five diagrams; a section explaining a relationship or a reason wants zero. Decide by fit, never by habit or to fill a quota — see the guide below for what each type is for.',
  'If the section\'s text names an ordered chord progression — a chord sequence like G–C–D, or a Roman-numeral pattern like ii–V–I — illustrate it: emit ONE diagram PER chord in the progression, in the order named, not a single diagram or none at all.',
  '',
  'The five directives available here, and nothing else:',
  '',
  '::diagram{after=2 instrument=guitar mode=theory root=C quality=major stringSet="e–B–G" inversion=0 fromFret=3 toFret=8 src=VIDEO_ID}',
  'The caption goes in the body — say why the shape sits where it does, not that it is a triad.',
  '::',
  '',
  '::diagram{mode=explicit fromFret=5 toFret=8}',
  'Chord tones (light) inside the scale shape (hollow); the notes your hand actually holds are ringed.',
  '- string=5 fret=5 label=A root ringed',
  '- string=4 fret=7 label=E light',
  '- string=3 fret=5 hollow',
  '::',
  '',
  '::chord-diagram{barreFret=1 barreFromString=0 barreToString=5}',
  'F major — the barre does the work of the nut.',
  '- string=0 state=fretted fret=1',
  '- string=1 state=fretted fret=1',
  '- string=2 state=fretted fret=2',
  '- string=3 state=fretted fret=3',
  '- string=4 state=fretted fret=3',
  '- string=5 state=fretted fret=1 root',
  '::',
  '',
  '::neck-pattern{fromFret=0 toFret=15}',
  'The five boxes, on one neck, climbing.',
  '- label="Box 1" sub="E minor pentatonic · frets 0–3"',
  '  - string=5 fret=0 label=E root',
  '  - string=5 fret=3 label=G',
  '- label="Box 2"',
  '  - string=5 fret=3 label=G',
  '  - string=5 fret=5 label=A',
  '::',
  '',
  '::keyboard-diagram{mode=explicit octaves=1}',
  'E–F and B–C are the two white pairs with no black key between them.',
  '- pc=E label=E flag',
  '- pc=F label=F flag',
  '::',
  '',
  '::natural-notes{}',
  'Every sharp and flat is one fret from one of these fourteen notes.',
  '::',
  '',
  'Which to reach for: ::diagram is a stretch of neck — "where do these notes live". ::chord-diagram is the songbook chord box — "how do I hold this chord", and ANY lesson naming a chord the reader is meant to play should show one. ::neck-pattern is several shapes over ONE neck, for a system that spans it (five pentatonic boxes, seven three-note-per-string shapes) — two or more patterns, never one. ::natural-notes is a fixed reference strip, used ONCE, where a lesson first asks the reader to locate a root by name. ::keyboard-diagram is pitch-class addressed, for a piano.',
  'PREFER mode="theory" (root+quality, and stringSet on ::diagram) over mode="explicit" — theory mode cannot be musically wrong the way hand-placed dots can. Use explicit mode when theory mode genuinely cannot express the shape: a scale box, a specific fret window, a voicing that is not a plain triad. In explicit mode the four dot styles are what turn one diagram into two layers — `hollow` for background scale tones (omit their label), `light` for the foreground chord tones, `ringed` for the notes the hand actually holds, `dim` to fade the rest of the scale right back. A diagram where every dot is plain is usually a diagram that could have taught more.',
  'quality is TRIADS ONLY: major, minor, augmented, or diminished — never a seventh-chord quality. stringSet MUST use an EN DASH (–) between letters, e.g. "e–B–G", never a hyphen — a hyphenated lookalike is rejected.',
  'String indices everywhere: 0 = the HIGHEST-pitched string (high e), increasing toward the lowest (5 = low E). This is the opposite of most tab numbering. fret 0 = open.',
  'Set `src` on EVERY illustration you can: the exact id shown in [brackets] next to the source video whose material the illustration shows. Nearly every diagram in a section written from one source belongs to that source — omit `src` only when the illustration genuinely draws on no single one. Never invent or guess an id.',
  '`useParam` goes on a theory-mode diagram ONLY when the user prompt below says this lesson declares a reader-controlled key picker AND this diagram\'s root IS that key. A diagram of a different scale degree — the vi chord, the vii° — keeps its own fixed root and omits useParam, because the picker replaces the root outright and would leave the caption describing a chord that is no longer on screen. Always set `root` alongside it as the fallback.',
  'A useParam diagram\'s CAPTION must survive being re-keyed too, so it may not name a note. "C, E and G — scale degrees 1, 3 and 5" stops being true the instant the reader picks G. Caption a useParam diagram in movable terms only — scale degrees, intervals, the shape, which finger goes where. If the point you want to make needs the actual note names, keep them and omit useParam: a fixed diagram that matches its caption beats a transposing one that does not.',
].join('\n');

// Loaded once at module scope, lazily — see getOutlineSystemWithGuide's
// comment for why (this module reaches the browser bundle; the guide read
// touches node:fs and must not run at import time).
let illustrationSystemWithGuide: string | null = null;
function getIllustrationSystemWithGuide(): string {
  illustrationSystemWithGuide ??= `${ILLUSTRATION_SYSTEM}\n\n---\n\n${getIllustrationGuideExcerpt()}`;
  return illustrationSystemWithGuide;
}

// Renders one already-built text block as a compact, indexed preview the
// illustration call can anchor `afterBlockIndex` against. Never the full
// block — just enough to judge "does this deserve a diagram", matching
// this pipeline's "small structured calls, lean input" shape throughout.
const ILLUSTRATION_PREVIEW_MAX = 200;

function previewBlockText(block: LessonBlock): string {
  if (typeof block.body === 'string') return block.body;
  if (Array.isArray(block.degrees)) return (block.degrees as string[]).join(' ');
  if (block.__component === 'lesson.table' && Array.isArray(block.headers)) {
    return (block.headers as string[]).join(' | ');
  }
  if (typeof block.title === 'string') return block.title;
  if (typeof block.caption === 'string') return block.caption;
  return '';
}

function summarizeSectionBlocksForIllustration(blocks: LessonBlock[]): string {
  return blocks
    .map((b, i) => {
      const kind = b.__component.replace('lesson.', '');
      const preview = truncate(previewBlockText(b).replace(/\s+/g, ' ').trim(), ILLUSTRATION_PREVIEW_MAX);
      return `[${i}] ${kind}: ${preview}`;
    })
    .join('\n');
}

function buildIllustrationPrompt(
  outline: { title: string; summary: string; parameter: GeneratedLessonParameter | null },
  section: { heading: string; goal: string },
  blocksSummary: string,
  contextText: string,
): string {
  return [
    `Lesson: "${outline.title}" — ${outline.summary}`,
    outline.parameter
      ? `This lesson declares a reader-controlled ${outline.parameter.label.toLowerCase()} picker, starting on ${outline.parameter.default}. A theory-mode diagram MAY set useParam: true to follow it — but ONLY if its own root is ${outline.parameter.default} AND its caption names no note at all (no "${outline.parameter.default}", no note letters, no note run). Any diagram rooted on a different note, or captioned with note names, keeps useParam: false. Always set root either way.`
      : 'This lesson declares NO reader-controlled parameter — set useParam: false on every illustration.',
    '',
    `Section: "${section.heading}" — ${section.goal}`,
    '',
    "This section's finished text. The bracketed number starting each line is a placement address for `after=` — it is not content, and must not appear in a caption:",
    blocksSummary,
    '',
    'Source videos (cite by the [bracketed] id if an illustration is drawn from one):',
    contextText,
  ].join('\n');
}

/**
 * Whether a theory-mode diagram may follow the lesson's key picker.
 *
 * `useParam` substitutes the reader's chosen key for the diagram's ROOT,
 * which is only meaningful for a diagram whose root IS the key. A live run
 * produced the counter-example: a `vii°` diagram (root B) with
 * `useParam: true` on a lesson keyed to C — turn the picker to anything
 * and it draws a diminished triad on THAT note, while the caption still
 * says "the vii° chord", which is only B in the key of C. No error, no
 * empty diagram; just a chord that quietly stops matching its own caption.
 *
 * The checkable invariant: at the parameter's DEFAULT value the diagram
 * must draw exactly what it would draw without `useParam`. Root equal to
 * the default means moving the picker transposes the whole lesson
 * together; root different from it means the model picked a scale-degree
 * chord, and the picker would desynchronise it from its caption. Not a
 * judgment call the prompt can be trusted with — a code check, because the
 * failure is silent.
 */
function honoursLessonParameter(
  root: unknown,
  parameter: GeneratedLessonParameter | null,
): boolean {
  if (!parameter) return false;
  return typeof root === 'string' && root.trim() === parameter.default;
}


/**
 * Inserts illustration blocks into a section's text blocks at their
 * requested positions. `anchorRequested` is clamped to this section's
 * actual length here rather than at parse time, which doesn't know it
 * yet: -1 stays -1 (before everything), null resolves to "after the last
 * block" (the common case), and anything else clamps into
 * [-1, sectionBlocks.length - 1]. Multiple illustrations anchored to the
 * same index are inserted together, in the order given.
 */
function mergeIllustrations(
  sectionBlocks: LessonBlock[],
  illustrations: Array<{ anchorRequested: number | null; block: LessonBlock }>,
): LessonBlock[] {
  const lastIndex = sectionBlocks.length - 1;
  const byAnchor = new Map<number, LessonBlock[]>();
  for (const { anchorRequested, block } of illustrations) {
    const anchor =
      anchorRequested === null
        ? lastIndex
        : Math.max(-1, Math.min(lastIndex, anchorRequested));
    const bucket = byAnchor.get(anchor) ?? [];
    bucket.push(block);
    byAnchor.set(anchor, bucket);
  }

  const result: LessonBlock[] = [...(byAnchor.get(-1) ?? [])];
  sectionBlocks.forEach((block, i) => {
    result.push(block);
    result.push(...(byAnchor.get(i) ?? []));
  });
  return result;
}

// -----------------------------------------------------------------------------
// Step 6: assemble
// -----------------------------------------------------------------------------

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'lesson';
}

const CONTRADICTIONS_HEADING = 'Where the sources disagree';
// Digest.contradictions has no upper bound in its schema — cap what we turn
// into callouts so a chatty synthesis can't blow out the lesson body.
const MAX_CONTRADICTION_CALLOUTS = 5;
const CONTRADICTION_CALLOUT_MAX = 500;

// The highest-value thing a generated lesson can offer that a single-video
// summary can't: where two sources actually disagree. Built deterministically
// from the digest's own structured `contradictions` field — never left to the
// model to notice or phrase on its own, and never given a `source` (a
// disagreement is inherently cross-video, so no single transcript grounds it).
function buildContradictionCallouts(digest: Digest, startId: number): LessonBlock[] {
  const contradictions = digest.contradictions.slice(0, MAX_CONTRADICTION_CALLOUTS);
  if (contradictions.length === 0) return [];

  const blocks: LessonBlock[] = [];
  let id = startId;
  blocks.push({
    __component: 'lesson.heading',
    id,
    text: CONTRADICTIONS_HEADING,
    level: 'h2',
  });
  id += 1;

  for (const c of contradictions) {
    const stance = c.positions.map((p) => `${p.videoTitle}: ${p.stance}`).join(' — vs. — ');
    const body = truncate(`${c.topic}. ${stance}`, CONTRADICTION_CALLOUT_MAX);
    blocks.push({ __component: 'lesson.callout', id, tone: 'note', body });
    id += 1;
  }

  return blocks;
}

// -----------------------------------------------------------------------------
// Phase 1: planLesson — resolve tier → retrieve → coverage → digest → outline
// -----------------------------------------------------------------------------

/**
 * Runs the first half of lesson generation: picks the model tier, retrieves
 * and coverage-checks candidate source videos, resolves (or synthesizes) a
 * cross-video digest, and drafts an outline. Does NOT write section content
 * or persist anything — that's `writeLesson`'s job, given this function's
 * `ok: true` output (possibly user-edited) back.
 */
export async function planLesson(
  input: PlanLessonInput,
  onProgress?: ProgressFn,
): Promise<PlanLessonResult> {
  const topic = input.topic.trim();
  if (!topic) return { ok: false, error: 'Topic is required.' };
  const requestedMax =
    typeof input.maxVideos === 'number' && input.maxVideos > 0
      ? input.maxVideos
      : DEFAULT_MAX_VIDEOS;
  // The digest step (step 2) hard-caps at DIGEST_MAX_VIDEOS — never select
  // more videos than a digest can actually synthesize over.
  const maxVideos = Math.min(requestedMax, DIGEST_MAX_VIDEOS);

  // Decided ONCE, up front — the only place tier/model choice happens (see
  // lesson-model.ts). Every chat() call below (in both phases) uses this
  // same adapter (writeLesson re-resolves it independently, but from the
  // same env, so it never mixes tiers within one generation).
  const lessonModel = resolveLessonModel();
  logPhase(topic, `model ✓ ${lessonModel.tier}`, { model: lessonModel.model });
  emit(onProgress, { type: 'tier', tier: lessonModel.tier, model: lessonModel.model });

  // --- 1: retrieve + relevance floor ------------------------------------
  let allRanked: RankedVideo[];
  try {
    allRanked = await rankVideosByTopic(topic);
  } catch (err) {
    const message = redactAnthropicKey(err instanceof Error ? err.message : 'Retrieval failed');
    logPhase(topic, 'retrieve ✗ failed', { error: message });
    // A dead backend is not an Ollama problem, and must not be reported as an
    // empty library — that sends the user off to regenerate summaries they
    // already have.
    const friendly = err instanceof BackendUnreachableError ? message : friendlyOllamaError(message);
    emit(onProgress, { type: 'error', step: 'retrieve', message: friendly });
    return { ok: false, error: friendly };
  }

  if (allRanked.length === 0) {
    logPhase(topic, 'retrieve ✗ no videos with embeddings');
    const message =
      'No videos in the library have embeddings yet — generate summaries first, then retry.';
    emit(onProgress, { type: 'error', step: 'retrieve', message });
    return { ok: false, error: message };
  }

  logPhase(topic, 'retrieve · scored', {
    floor: RELEVANCE_FLOOR,
    scores: allRanked.slice(0, 10).map((r) => ({
      youtubeVideoId: r.video.youtubeVideoId,
      score: round3(r.score),
    })),
  });

  const aboveFloor = allRanked.filter((r) => r.score >= RELEVANCE_FLOOR);
  const ranked = aboveFloor.slice(0, maxVideos);

  // The digest this pipeline is built around needs at least DIGEST_MIN_VIDEOS
  // (2) to synthesize anything. Fewer than that above the floor — whether
  // zero or exactly one — means the library doesn't have enough on-topic
  // breadth to ground a cross-video lesson, so refuse rather than generate
  // from a single loosely-related video. See the report for the full
  // reasoning on why 2 (the digest's own floor) rather than a stricter 3.
  if (ranked.length < DIGEST_MIN_VIDEOS) {
    logPhase(topic, 'retrieve ✗ below relevance floor', {
      aboveFloorCount: aboveFloor.length,
      needed: DIGEST_MIN_VIDEOS,
    });
    const message = `The library doesn't have enough videos closely related to "${topic}" to build a lesson — nothing scored above the relevance floor. Try a broader topic, or add more videos on this subject.`;
    emit(onProgress, { type: 'error', step: 'retrieve', message });
    return { ok: false, error: message };
  }

  const sources: SourceVideo[] = ranked.map((r) => ({
    documentId: r.video.documentId,
    youtubeVideoId: r.video.youtubeVideoId,
    title: r.video.summaryTitle ?? r.video.videoTitle,
    score: r.score,
  }));
  logPhase(topic, 'retrieve ✓', {
    videos: sources.length,
    top: sources[0]?.title ?? null,
  });
  emit(onProgress, {
    type: 'retrieve',
    considered: allRanked.length,
    floor: RELEVANCE_FLOOR,
    videos: sources,
  });

  // --- 1.5: coverage — refuse before paying for the digest ----------------
  const candidatesText = ranked.map((r) => buildCoverageCandidateText(r.video)).join('\n');
  let coverage: CoverageVerdict | null;
  try {
    const raw = await withRetry(
      () =>
        chat({
          adapter: lessonModel.adapter,
          messages: [
            { role: 'system', content: COVERAGE_SYSTEM },
            { role: 'user', content: buildCoveragePrompt(topic, candidatesText) },
          ] as never,
          outputSchema: CoverageVerdictSchema,
          modelOptions: buildModelOptions(lessonModel, 0.1),
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          const cause = redactAnthropicKey(err instanceof Error ? err.message : 'unknown');
          logPhase(topic, `coverage ↻ retry ${attempt}/1 in ${delayMs}ms`, { cause });
          emit(onProgress, { type: 'retry', step: 'coverage', attempt, reason: cause });
        },
      },
    );
    coverage = sanitizeCoverageVerdict(raw);
  } catch (err) {
    const message = redactAnthropicKey(
      err instanceof Error ? err.message : 'Coverage check failed',
    );
    logPhase(topic, 'coverage ✗ call failed — refusing rather than proceeding', {
      error: message,
    });
    const friendly = friendlyModelError(lessonModel.tier, message);
    emit(onProgress, { type: 'error', step: 'coverage', message: friendly });
    return { ok: false, error: friendly };
  }

  if (!coverage) {
    // Model failure (unusable shape) is never permission to continue — see
    // the header comment above this step. Not retried — see this step's
    // header comment for why a refusal-shaped failure isn't re-asked.
    logPhase(topic, 'coverage ✗ unusable verdict shape — refusing rather than proceeding');
    const message = `Could not verify whether the library actually covers "${topic}" — refusing rather than risk generating a lesson from the wrong material. Try again, or rephrase the topic.`;
    emit(onProgress, { type: 'error', step: 'coverage', message });
    return { ok: false, error: message };
  }

  if (!coverage.covered) {
    const closest = coverage.actualTopic
      ? ` The closest material the library has is about ${coverage.actualTopic}.`
      : '';
    const reasonSuffix = coverage.reason ? ` (${coverage.reason})` : '';
    logPhase(topic, 'coverage ✗ not covered — refusing before digest', {
      actualTopic: coverage.actualTopic ?? null,
      reason: coverage.reason ?? null,
    });
    // A coverage refusal is information, not an error — the `coverage`
    // event itself (covered: false + what the library does cover) IS the
    // terminal frame for this run; no separate `error` event follows.
    emit(onProgress, {
      type: 'coverage',
      covered: false,
      actualTopic: coverage.actualTopic ?? null,
      reason: coverage.reason ?? null,
    });
    return {
      ok: false,
      error: `The library doesn't actually cover "${topic}".${closest}${reasonSuffix} Try a topic closer to what the library has, or add videos on "${topic}".`,
    };
  }
  logPhase(topic, 'coverage ✓ sources cover the topic');
  emit(onProgress, { type: 'coverage', covered: true, actualTopic: null, reason: null });

  // --- 2: digest — cached reuse, or synthesize (never persist) ----------
  const youtubeVideoIds = ranked.map((r) => r.video.youtubeVideoId);
  const digestStart = performance.now();
  const digestResolution = await getOrCreateDigest(topic, youtubeVideoIds);
  const digestMs = Math.round(performance.now() - digestStart);
  if (!digestResolution.ok) {
    const friendly = friendlyOllamaError(digestResolution.error);
    emit(onProgress, { type: 'error', step: 'digest', message: friendly });
    return { ok: false, error: friendly };
  }
  const { digest, fullVideos, cacheHit } = digestResolution;
  emit(onProgress, { type: 'digest', cacheHit, ms: digestMs });

  // --- 3: context ---------------------------------------------------------
  const contextText = fullVideos.map((v) => buildVideoContextText(v)).join('\n');
  const digestContextText = buildDigestContextText(digest);

  // --- 4: outline, with a single retry on failure/unusable-shape/thin ----
  type OutlineAttemptOutcome =
    | { kind: 'ok'; outline: LessonOutline }
    | { kind: 'invalid' }
    | { kind: 'error'; message: string };

  async function attemptOutline(): Promise<OutlineAttemptOutcome> {
    try {
      const raw = await chat({
        adapter: lessonModel.adapter,
        messages: [
          { role: 'system', content: getOutlineSystemWithGuide() },
          {
            role: 'user',
            content: buildOutlinePrompt(topic, contextText, digestContextText),
          },
        ] as never,
        outputSchema: LessonOutlineSchema,
        modelOptions: buildModelOptions(lessonModel, 0.3),
      });
      const sanitized = sanitizeOutline(raw);
      return sanitized ? { kind: 'ok', outline: sanitized } : { kind: 'invalid' };
    } catch (err) {
      return {
        kind: 'error',
        message: redactAnthropicKey(
          err instanceof Error ? err.message : 'Lesson outline generation failed',
        ),
      };
    }
  }

  let outline: LessonOutline | null = null;
  let outlineFailureMessage: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await attemptOutline();
    const isLastAttempt = attempt === 2;

    if (outcome.kind === 'ok') {
      const thin = outcome.outline.sections.length < MIN_OUTLINE_SECTIONS;
      if (!thin || isLastAttempt) {
        // Accept: either it's not thin, or this was the retry — a thin
        // retry result is accepted rather than retried again (single retry
        // budget, per the brief).
        outline = outcome.outline;
        if (thin) {
          logPhase(
            topic,
            `outline ⚠ still thin after retry (${outcome.outline.sections.length} section(s), target ≥${MIN_OUTLINE_SECTIONS})`,
            { title: outcome.outline.title },
          );
        }
        break;
      }
      logPhase(
        topic,
        `outline ⚠ thin (${outcome.outline.sections.length} section(s), target ≥${MIN_OUTLINE_SECTIONS}) — retrying once`,
        { title: outcome.outline.title },
      );
      emit(onProgress, { type: 'retry', step: 'outline', attempt, reason: 'thin outline' });
      continue;
    }

    if (outcome.kind === 'invalid') {
      if (isLastAttempt) {
        outlineFailureMessage = 'The model returned an unusable lesson outline.';
        break;
      }
      logPhase(topic, `outline ✗ unusable shape (attempt ${attempt}) — retrying once`);
      emit(onProgress, { type: 'retry', step: 'outline', attempt, reason: 'unusable shape' });
      continue;
    }

    // outcome.kind === 'error'
    if (isLastAttempt) {
      outlineFailureMessage = friendlyModelError(lessonModel.tier, outcome.message);
      break;
    }
    logPhase(topic, `outline ✗ failed (attempt ${attempt}) — retrying once`, {
      error: outcome.message,
    });
    emit(onProgress, { type: 'retry', step: 'outline', attempt, reason: outcome.message });
  }

  if (!outline) {
    const message = outlineFailureMessage ?? 'The model returned an unusable lesson outline.';
    logPhase(topic, 'outline ✗ failed after retry', { error: message });
    emit(onProgress, { type: 'error', step: 'outline', message });
    return { ok: false, error: message };
  }

  logPhase(topic, 'outline ✓', {
    title: outline.title,
    sections: outline.sections.length,
  });
  emit(onProgress, {
    type: 'outline',
    title: outline.title,
    level: outline.level,
    sections: outline.sections.map((s) => s.heading),
  });

  return { ok: true, topic, outline, sources, digest, tier: lessonModel.tier, model: lessonModel.model };
}

// -----------------------------------------------------------------------------
// Phase 2: writeLesson — per-section generation → grounding → assembly
// -----------------------------------------------------------------------------

// The trust boundary for phase 2: `outline` has round-tripped through the
// browser and may have been edited by the user (headings/title), so it is
// validated here rather than trusted — deliberately NOT the same schema as
// LessonOutlineSchema above (that one is shaped by Anthropic's `.max(6)` /
// no-`.min()` structured-output constraints, which are about what the MODEL
// is allowed to emit, not what OUR OWN client is allowed to send back).
const LessonOutlineInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(500),
  level: z.enum(['beginner', 'intermediate', 'advanced']),
  instrument: z.enum(['guitar', 'piano', 'push', 'any']),
  duration: z.string().trim().max(40).nullable(),
  // `.optional()` as well as `.nullable()`: a phase-1 result always carries
  // this field now, but the browser round-trip is a wire format other
  // callers (and this repo's own route tests) construct by hand — an older
  // payload that predates the parameter must still write a lesson, just
  // without one. Normalized to `null` immediately below in writeLesson.
  parameter: z
    .object({
      name: z.literal('key'),
      label: z.string().trim().min(1).max(40),
      default: z.enum(PITCH_CLASS_ENUM),
    })
    .nullable()
    .optional(),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(200),
        goal: z.string().trim().max(500),
      }),
    )
    .min(1)
    .max(12),
});

const SourceVideoInputSchema = z.object({
  documentId: z.string().min(1),
  youtubeVideoId: z.string().min(1),
  title: z.string().nullable(),
  score: z.number(),
});

const WriteLessonRequestSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  outline: LessonOutlineInputSchema,
  sources: z.array(SourceVideoInputSchema).min(1),
  digest: DigestSchema,
});

export type WriteLessonInput = z.input<typeof WriteLessonRequestSchema>;

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Runs the second half of lesson generation: takes phase 1's output back
 * (possibly user-edited) and writes per-section content, grounds citations
 * against the real transcript, and assembles the final lesson body. Does
 * NOT persist — the caller (the `/api/lesson-write` route) saves the
 * result and reports the slug.
 */
export async function writeLesson(
  rawInput: WriteLessonInput,
  onProgress?: ProgressFn,
): Promise<GenerateLessonResult> {
  const parsed = WriteLessonRequestSchema.safeParse(rawInput);
  if (!parsed.success) {
    const message = `The lesson plan sent back for writing is malformed: ${formatZodIssues(parsed.error)}`;
    emit(onProgress, { type: 'error', step: 'validate', message });
    return { ok: false, error: message };
  }
  const { topic, sources, digest } = parsed.data;
  // Normalized once, here, so nothing downstream has to care that the wire
  // format allows the field to be absent as well as null.
  const outline = { ...parsed.data.outline, parameter: parsed.data.outline.parameter ?? null };

  const lessonModel = resolveLessonModel();
  logPhase(topic, `model ✓ ${lessonModel.tier}`, { model: lessonModel.model });
  emit(onProgress, { type: 'tier', tier: lessonModel.tier, model: lessonModel.model });

  // Re-fetch full videos (with transcriptSegments) for context + grounding —
  // phase 1 only sent back the lightweight SourceVideo shape over the wire.
  const { videos: fullVideos, missing } = await resolveFullVideos(
    sources.map((s) => s.youtubeVideoId),
  );
  if (fullVideos.length === 0) {
    const message = 'Could not reload the selected source videos to write the lesson.';
    logPhase(topic, 'context ✗ no source videos resolved', { missing });
    emit(onProgress, { type: 'error', step: 'context', message });
    return { ok: false, error: message };
  }
  if (missing.length > 0) {
    logPhase(topic, 'context ⚠ some source videos no longer resolve — continuing with the rest', {
      missing,
    });
  }

  const contextText = fullVideos.map((v) => buildVideoContextText(v)).join('\n');
  const validVideoIds = new Set(fullVideos.map((v) => v.youtubeVideoId));
  const bm25ByVideoId = new Map<string, BM25Index>();
  for (const v of fullVideos) {
    const stored = loadStoredIndex(v.transcriptSegments);
    if (stored) bm25ByVideoId.set(v.youtubeVideoId, stored.bm25);
  }
  const titleByVideoId = new Map<string, string>(
    fullVideos
      .map((v) => [v.youtubeVideoId, v.videoTitle ?? ''] as const)
      .filter(([, title]) => title.length > 0),
  );
  const ground: GroundingContext = {
    validVideoIds,
    bm25ByVideoId,
    titleByVideoId,
    parameter: outline.parameter,
    warn: (reason, meta) => logPhase(topic, `block ✗ dropped — ${reason}`, meta),
  };

  // The write pass's own source material — see `retrieveSectionPassages`.
  // A video with no stored BM25 index can contribute no passage to any
  // section; that is a real, silent-by-default degradation (the lesson
  // quietly falls back to summary cards for it), so it is logged once here
  // rather than left to be inferred from thin prose later.
  const videosWithoutIndex = fullVideos
    .filter((v) => !bm25ByVideoId.has(v.youtubeVideoId))
    .map((v) => v.youtubeVideoId);
  if (videosWithoutIndex.length > 0) {
    logPhase(topic, 'passages ⚠ some sources have no stored transcript index', {
      videos: videosWithoutIndex,
    });
  }
  const passageVideoIds = fullVideos.map((v) => v.youtubeVideoId);
  const continuityText = buildDigestContinuityText(digest);

  // --- 5: sections (WRITE), with a single retry on a failed call or zero
  //        usable blocks. A THIN (but non-empty) result is accepted without
  //        retry — see MIN_SECTION_BLOCKS's comment. Text blocks only — no
  //        diagram budget, no diagram fields, no `id`/heading assembly yet:
  //        that all happens after step 5.5 illustrates each section, so a
  //        section's real, final id numbering can only be decided once its
  //        diagrams are known. ------------------------------------------
  type SectionResult = { heading: string; blocks: LessonBlock[] };
  const sectionResults: SectionResult[] = [];
  let succeededSections = 0;
  const totalSections = outline.sections.length;

  for (let index = 0; index < totalSections; index++) {
    const section = outline.sections[index];
    let sectionBlocks: LessonBlock[] = [];
    let sectionDropped = 0;
    let sectionUnsourced = 0;

    // Retrieved ONCE per section, not per attempt — BM25 is deterministic,
    // so a retry would get the identical passages; re-running it would only
    // cost time.
    const passages = retrieveSectionPassages(section, passageVideoIds, bm25ByVideoId);
    const passagesText = formatSectionPassages(passages);
    const rosterText = buildSectionRosterText(
      fullVideos,
      new Set(passages.map((p) => p.videoId)),
    );
    logPhase(topic, `passages · "${section.heading}"`, {
      passages: passages.length,
      videos: new Set(passages.map((p) => p.videoId)).size,
      chars: passagesText.length,
    });

    for (let attempt = 1; attempt <= 2; attempt++) {
      const isLastAttempt = attempt === 2;
      try {
        const raw = await chat({
          adapter: lessonModel.adapter,
          messages: [
            { role: 'system', content: getSectionSystemWithGuide() },
            {
              role: 'user',
              content: buildSectionPrompt(
                outline,
                section,
                rosterText,
                passagesText,
                continuityText,
              ),
            },
          ] as never,
          // No structured output here — this pass answers in markdown.
          // Every Anthropic structured-output restriction on this branch
          // was found at this call site, and none of them applies to a
          // text response. See the step-5 header and markdown-blocks.ts.
          stream: false,
          modelOptions: buildModelOptions(lessonModel, 0.4),
        });

        const markdown = typeof raw === 'string' ? raw : '';
        const { blocks: parsed, issues } = parseLessonMarkdown(markdown, {
          allowed: WRITE_DIRECTIVES,
          bareText: 'prose',
        });
        logParseIssues(topic, `section "${section.heading}"`, issues);
        // The backstop truncation is a DROP like any other — it used to
        // happen inside the argument list, logging nothing and counting
        // nowhere, so a section that blew the backstop reported the same
        // `dropped` as one that didn't.
        const overBackstop = countBackstopOverflow(
          topic,
          `section "${section.heading}"`,
          parsed.length,
          SECTION_BLOCKS_BACKSTOP,
        );
        // Local per-section ids — reassigned sequentially once the whole
        // lesson body (text + illustrations) is flattened in step 6.
        const grounded = groundParsedBlocks(parsed.slice(0, SECTION_BLOCKS_BACKSTOP), ground);
        const built = grounded.items.map((p) => p.block);

        if (built.length > 0) {
          sectionBlocks = built;
          sectionDropped =
            issues.filter((i) => i.severity === 'error').length +
            overBackstop +
            grounded.stats.dropped;
          sectionUnsourced = grounded.stats.unsourced;
          break;
        }
        // Zero usable blocks is treated the same as a failed call: retry
        // once before giving up on the section.
        if (isLastAttempt) {
          logPhase(topic, `section "${section.heading}" ⚠ too few usable blocks after retry, dropping`, {
            parsed: parsed.length,
            chars: markdown.length,
          });
          break;
        }
        logPhase(topic, `section "${section.heading}" ⚠ zero usable blocks (attempt ${attempt}) — retrying once`, {
          parsed: parsed.length,
          chars: markdown.length,
        });
        emit(onProgress, {
          type: 'retry',
          step: 'section',
          attempt,
          reason: 'zero usable blocks',
          label: section.heading,
        });
      } catch (err) {
        const message = redactAnthropicKey(err instanceof Error ? err.message : 'unknown');
        if (isLastAttempt) {
          logPhase(topic, `section "${section.heading}" ✗ failed after retry, dropping`, {
            error: message,
          });
          break;
        }
        logPhase(topic, `section "${section.heading}" ✗ failed (attempt ${attempt}) — retrying once`, {
          error: message,
        });
        emit(onProgress, {
          type: 'retry',
          step: 'section',
          attempt,
          reason: message,
          label: section.heading,
        });
      }
    }

    sectionResults.push({ heading: section.heading, blocks: sectionBlocks });
    if (sectionBlocks.length > 0) {
      if (sectionBlocks.length < MIN_SECTION_BLOCKS) {
        logPhase(
          topic,
          `section "${section.heading}" ⚠ thin (${sectionBlocks.length} block, target ≥${MIN_SECTION_BLOCKS})`,
        );
      }
      succeededSections += 1;
      logPhase(topic, `section "${section.heading}" ✓`, {
        blocks: sectionBlocks.length,
        dropped: sectionDropped,
        unsourced: sectionUnsourced,
      });
      emit(onProgress, {
        type: 'section',
        index,
        total: totalSections,
        heading: section.heading,
        blocks: sectionBlocks.length,
        passages: passages.length,
        dropped: sectionDropped,
        unsourced: sectionUnsourced,
      });
      // An unlinked sourcing claim cannot be repaired here without guessing
      // which video it came from, so it is surfaced instead — and `error`
      // is the only frame the run log actually renders, so a count on the
      // `section` event alone would be invisible. Non-fatal: the run
      // continues and still saves.
      if (sectionUnsourced > 0) {
        emit(onProgress, {
          type: 'error',
          step: 'citation',
          message: `Section "${section.heading}": ${sectionUnsourced} block${sectionUnsourced === 1 ? '' : 's'} name a source in the text but carry no citation. Check the lesson before trusting the attribution.`,
        });
      }
    } else {
      // A single-section failure is non-fatal — drop it and keep going.
      // Only "every section failed" (checked below) fails the whole run.
      // But it must not be SILENT: this branch used to emit nothing at
      // all, so the UI showed a retry for the section and then simply
      // moved on, and the reader watched a step it had been promised
      // disappear with no explanation anywhere but the server log.
      logPhase(topic, `section "${section.heading}" ✗ dropped — no usable blocks after retry`);
      emit(onProgress, {
        type: 'error',
        step: 'section',
        message: `Section "${section.heading}" produced no usable blocks after a retry — it was dropped, and the lesson is missing that step.`,
      });
    }
  }

  if (succeededSections === 0) {
    logPhase(topic, '✗ every section failed — no usable body');
    const message = friendlyModelError(lessonModel.tier, 'Every lesson section failed to generate.');
    emit(onProgress, { type: 'error', step: 'section', message });
    return { ok: false, error: message };
  }

  // --- 5.5: illustrate, one call PER section that has text, run
  //          CONCURRENTLY since every section's illustrate call only reads
  //          that section's own finished text — see the illustrate-pass
  //          header comment above for why. Runs BEFORE assembly: the final
  //          per-block `id` numbering (step 6) can only be decided once
  //          each section's diagrams are known. ----------------------------
  const illustrationOutcomes = await Promise.all(
    sectionResults.map(async (sr, index) => {
      if (sr.blocks.length === 0)
        return {
          illustrations: [] as Array<{ anchorRequested: number | null; block: LessonBlock }>,
          dropped: 0,
        };

      const blocksSummary = summarizeSectionBlocksForIllustration(sr.blocks);
      const section = outline.sections[index];
      let illustrations: Array<{ anchorRequested: number | null; block: LessonBlock }> = [];
      let dropped = 0;

      for (let attempt = 1; attempt <= 2; attempt++) {
        const isLastAttempt = attempt === 2;
        try {
          const raw = await chat({
            adapter: lessonModel.adapter,
            messages: [
              { role: 'system', content: getIllustrationSystemWithGuide() },
              {
                role: 'user',
                content: buildIllustrationPrompt(outline, section, blocksSummary, contextText),
              },
            ] as never,
            // Markdown, same as the write pass — which is what makes the
            // whole visual vocabulary reachable here: chord boxes, pattern
            // pickers, explicit dots with all four style flags, inversions
            // and fret windows were all cut to stay under the 16-union cap
            // a structured schema imposed.
            stream: false,
            modelOptions: buildModelOptions(lessonModel, 0.3),
          });
          const markdown = typeof raw === 'string' ? raw : '';
          const { blocks: parsed, issues } = parseLessonMarkdown(markdown, {
            allowed: ILLUSTRATE_DIRECTIVES,
            // The illustrate pass must not write. Bare markdown here is a
            // model narrating its answer, not content — reported, never
            // turned into prose.
            bareText: 'ignore',
            allowAfter: true,
          });
          logParseIssues(topic, `illustrate "${section.heading}"`, issues);
          const grounded = groundParsedBlocks(
            parsed.slice(0, ILLUSTRATIONS_PER_SECTION_BACKSTOP),
            ground,
          );
          // Same silent-truncation fix as the write pass above.
          dropped =
            issues.filter((i) => i.severity === 'error').length +
            countBackstopOverflow(
              topic,
              `illustrate "${section.heading}"`,
              parsed.length,
              ILLUSTRATIONS_PER_SECTION_BACKSTOP,
            ) +
            grounded.stats.dropped;
          illustrations = grounded.items.map((p) => ({
            anchorRequested: p.after ?? null,
            block: p.block,
          }));
          // Success even when illustrations.length === 0 — "nothing here
          // earns a diagram" is a valid, expected editorial outcome for
          // this pass, unlike the write pass's "zero usable blocks", which
          // is always a failure. Never retried for that reason alone.
          break;
        } catch (err) {
          const message = redactAnthropicKey(err instanceof Error ? err.message : 'unknown');
          if (isLastAttempt) {
            logPhase(topic, `illustrate "${section.heading}" ✗ failed after retry — section keeps its text only`, {
              error: message,
            });
            break;
          }
          logPhase(topic, `illustrate "${section.heading}" ✗ failed (attempt ${attempt}) — retrying once`, {
            error: message,
          });
          emit(onProgress, {
            type: 'retry',
            step: 'illustrate',
            attempt,
            reason: message,
            label: section.heading,
          });
        }
      }

      return { illustrations, dropped };
    }),
  );

  // Budget + merge run SEQUENTIALLY, after every concurrent call has
  // settled — deterministic regardless of which call happened to resolve
  // first, and it's what makes ILLUSTRATIONS_PER_LESSON_BACKSTOP a real
  // shared budget rather than a race between concurrent sections.
  let lessonDiagramBudget = ILLUSTRATIONS_PER_LESSON_BACKSTOP;
  const illustratedSections: SectionResult[] = sectionResults.map((sr, index) => {
    const { illustrations, dropped } = illustrationOutcomes[index];
    const kept: typeof illustrations = [];
    let overBudget = 0;
    for (const item of illustrations) {
      if (kept.length >= ILLUSTRATIONS_PER_SECTION_BACKSTOP || lessonDiagramBudget <= 0) {
        logPhase(topic, `illustrate "${sr.heading}" ⚠ dropped illustration — over the runaway backstop`, {
          perSection: ILLUSTRATIONS_PER_SECTION_BACKSTOP,
          lessonRemaining: lessonDiagramBudget,
        });
        overBudget += 1;
        continue;
      }
      kept.push(item);
      lessonDiagramBudget -= 1;
    }
    const blocks = kept.length > 0 ? mergeIllustrations(sr.blocks, kept) : sr.blocks;
    const droppedTotal = dropped + overBudget;
    if (sr.blocks.length > 0) {
      logPhase(topic, `illustrate "${sr.heading}" ✓`, { diagrams: kept.length, dropped: droppedTotal });
    }
    emit(onProgress, {
      type: 'illustrate',
      index,
      total: sectionResults.length,
      heading: sr.heading,
      diagrams: kept.length,
      dropped: droppedTotal,
    });
    return { heading: sr.heading, blocks };
  });

  // --- 6: assemble ----------------------------------------------------------
  // Only now — with every section's text AND diagrams both known — do
  // blocks get their real, final, sequential `id`s. Sections with zero
  // surviving blocks (failed even after retry) are skipped entirely, same
  // as before this branch's write/illustrate split.
  const body: LessonBlock[] = [];
  let blockId = 1;
  // `lesson.parameter` is one per lesson, so one picker for it is enough —
  // but sections are generated independently and each one only knows that
  // a parameter exists, not whether another section already put a picker
  // on the page. Deduped here, at the only point that sees the whole body:
  // first wins, the rest are dropped loudly.
  let paramPickerSeen = false;
  for (const { heading, blocks } of illustratedSections) {
    if (blocks.length === 0) continue;
    body.push({ __component: 'lesson.heading', id: blockId, text: truncate(heading, 150), level: 'h2' });
    blockId += 1;
    for (const block of blocks) {
      if (block.__component === 'lesson.param-picker') {
        if (paramPickerSeen) {
          logPhase(topic, 'block ✗ dropped — a second param-picker (one per lesson)', {
            section: heading,
          });
          continue;
        }
        paramPickerSeen = true;
      }
      block.id = blockId;
      body.push(block);
      blockId += 1;
    }
  }

  // A key picker the reader can move that changes NOTHING on screen is the
  // same silence wearing a different hat. `useParam` is the only consumer
  // of the lesson parameter's value (diagram-params.ts reads it nowhere
  // else), so a picker with no `useParam` diagram behind it is inert. That
  // now happens honestly — every candidate diagram can have had its
  // `useParam` switched off for naming a note in its caption — which is
  // exactly why it has to be said out loud instead of shipped as a control
  // that does nothing.
  if (paramPickerSeen) {
    const followers = body.filter((b) => b.useParam === true).length;
    if (followers === 0) {
      logPhase(topic, '⚠ the key picker is inert — no diagram follows it', {
        parameter: outline.parameter?.label ?? null,
      });
      emit(onProgress, {
        type: 'error',
        step: 'param-picker',
        message:
          'The lesson has a key picker but no diagram that follows it — moving the picker will change nothing on screen.',
      });
    }
  }

  // Steps are generated per-section independently, so numbering restarts
  // at 1 in every section. Renumber sequentially across the whole assembled
  // body so a flattened lesson never has two "Step 1"s.
  let stepCounter = 0;
  for (const block of body) {
    if (block.__component === 'lesson.step') {
      stepCounter += 1;
      block.number = stepCounter;
    }
  }

  // Grounding stats: how many blocks got a citation at all, and how many of
  // those a real BM25 timecode (vs. video-only, no timestamp).
  let citedBlocks = 0;
  let groundedBlocks = 0;
  for (const block of body) {
    const source = block.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    citedBlocks += 1;
    if (typeof (source as Record<string, unknown>).timeSec === 'number') groundedBlocks += 1;
  }
  emit(onProgress, { type: 'grounding', grounded: groundedBlocks, total: citedBlocks });

  // The highest-value thing the digest offers: genuine cross-video
  // disagreements. Appended deterministically, after we know the body is
  // non-empty.
  const contradictionBlocks = buildContradictionCallouts(digest, blockId);
  if (contradictionBlocks.length > 0) {
    body.push(...contradictionBlocks);
    blockId += contradictionBlocks.length;
    logPhase(topic, 'contradictions ✓ appended', { callouts: contradictionBlocks.length - 1 });
  }

  const title = truncate(outline.title, 160);
  const lesson: GeneratedLesson = {
    title,
    slug: slugify(title),
    summary: truncate(outline.summary, 400),
    level: outline.level,
    instrument: outline.instrument,
    duration: outline.duration ? truncate(outline.duration, 40) : null,
    status: 'ai-generated',
    // Kept even when nothing emitted a picker: a `useParam` diagram also
    // needs it, and a lesson parameter with no picker is still coherent
    // (the reader just can't change it). Dropped to null when the outline
    // never declared one.
    parameter: outline.parameter,
    body,
  };

  logPhase(topic, '✓ generation complete', {
    sections: `${succeededSections}/${totalSections}`,
    blocks: body.length,
    parameter: outline.parameter ? outline.parameter.label : null,
    paramPicker: paramPickerSeen,
    videoRefs: body.filter((b) => b.__component === 'lesson.video-ref').length,
    tier: lessonModel.tier,
    model: lessonModel.model,
  });

  return { ok: true, lesson, sources, tier: lessonModel.tier, model: lessonModel.model };
}
