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
//   5. sections (WRITE) — ONE chat() call PER section → text blocks only
//                 (prose/callout/step/table/degree-chips, as many or as few
//                 as the content needs) — no diagram type is even in this
//                 call's schema; the section heading is injected
//                 deterministically, never trusted from the model
//   5.5. illustrate — a SEPARATE chat() call PER section, run CONCURRENTLY
//                 (each section's call is independent), given that
//                 section's own finished text: decides what would be
//                 clearer shown than described and returns diagram/
//                 keyboard-diagram blocks plus where each belongs. Split
//                 from step 5 on purpose — see that step's own comment.
//   6. assemble — flatten to LessonBlock[], renumber steps + ids, append
//                 contradiction callouts, drop anything invalid
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
  resolveDiagramDots,
  resolveDiagramMarks,
  type DiagramBlock,
  type KeyboardDiagramBlock,
  type NeckDotInput,
  type KeyMarkInput,
} from '#/lib/lesson/diagram-params';
import { STRING_SETS } from '@music-kb/music/theory/triad-shapes';
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
import type { JsonValue, LessonBlock } from '#/lib/services/lessons';

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
// Exported (along with LessonOutlineSchema and SectionBlocksSchema below)
// so lesson-generation.test.ts can walk every schema actually passed to
// `outputSchema` and assert none of them carries an array `.min(n)` with
// n > 1 — Anthropic's structured-output validator 400s on that (see
// LessonOutlineSchema's `sections` field comment for the exact error).
// This schema itself has no arrays today, but it's exported alongside the
// other two so the guard test enumerates "every outputSchema", not a
// hand-picked subset that can silently miss the next one added here.
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
   * a `useParam` diagram) when this is non-null. See `toLessonBlock`'s
   * `param-picker` case.
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
// Step 5: sections — one small structured call PER section
// -----------------------------------------------------------------------------

// `heading` stays in the allowed `type` enum defensively (a local model
// can ignore instructions) but the pipeline never trusts a model-emitted
// heading — see `buildSectionBlocks` below, which drops any `type:
// 'heading'` block a section call returns and injects the outline's
// heading instead.
//
// NOT a z.discriminatedUnion here, even though the six block shapes really
// are one — Anthropic's structured-output schema support rejects the
// `oneOf` a discriminated union compiles to: a real run against the live
// frontier tier 400'd every single section call with
// `output_config.format.schema: Schema type 'oneOf' is not supported`,
// caught only by exercising this against Anthropic for real (Ollama, the
// local tier, accepts a discriminated union fine — another instance of the
// pattern documented on LessonOutlineSchema's `sections` field above).
// Flattened instead: one object with every field from every block type,
// each nullable and `.describe()`d with which type(s) it belongs to.
// `toLessonBlock` below already treats the model's response as fully
// untrusted content — it reads fields off a `Record<string, unknown>` by
// name per `type`, never assuming the schema's shape — so flattening this
// costs nothing on the sanitization side; only the schema declaration
// changes.
// Reused, not re-typed: the theory layer (`@music-kb/music`) is the single
// source of truth for the 4 guitar string-set names (with their EN DASH
// separators) — see docs/lesson-authoring.md's `stringSet` field of
// `lesson.diagram` for why byte-identical fidelity here matters: a
// hyphenated string-set lookalike is a different (and empty-rendering)
// value. Cast to a non-empty tuple only because zod's `.enum()` wants that
// shape at the type level — the runtime values come straight from the
// theory package, never hand-copied. (PITCH_CLASS_ENUM is declared much
// further up, next to the outline schema, because the outline call needs
// it too — see its own comment there.)
const STRING_SET_ENUM = STRING_SETS.map((s) => s.name) as [string, ...string[]];
// Triads only — the theory layer only voices triads, so a seventh-chord
// quality can never be rendered. See docs/lesson-authoring.md's
// `lesson.diagram.quality` row for why this specific four-value list is
// the whole set, not an example of it.
const TRIAD_QUALITY_ENUM = ['major', 'minor', 'augmented', 'diminished'] as const;

// Text blocks ONLY — no diagram type in this enum at all. Diagrams are the
// separate ILLUSTRATE pass's job (see the schema and system prompt further
// below), given this pass's finished text; see docs/lesson-authoring.md's
// "Generation is two passes" note for why splitting frees up schema budget
// (the combined schema used to sit at 15 union-typed/nullable fields, which
// forced dropping inversion/fromFret/toFret/explicit-mode dots+marks and
// locking generation to theory-mode-only diagrams — see
// SectionIllustrationsSchema below for how much room a schema with no
// prose fields has instead).
// `param-picker` and `video-ref` are back in this enum as of the passage
// change. They were cut when the combined write+illustrate schema sat at
// the ceiling of Anthropic's 16 union-typed-parameter cap; the two-pass
// split moved every diagram field out of this schema, and restoring both
// costs exactly ONE new union-typed field (`label`) because `video-ref`
// re-uses `sourceVideoId` for its target and `body` for its (never
// rendered, grounding-only) moment description. Count after: 11 of 16 —
// see lesson-generation.test.ts's union-cap guard, which asserts it.
const LessonBlockOutputSchema = z.object({
  type: z.enum(['prose', 'callout', 'step', 'table', 'degree-chips', 'param-picker', 'video-ref']),
  // heading
  body: z
    .string()
    .nullable()
    .describe(
      'prose/callout/step/video-ref: prose is markdown paragraph(s) (MAX 2000 chars), callout is one short aside (MAX 500 chars), step is optional detail markdown. On video-ref ONLY, this is NOT shown to the reader — it is a short description of the moment you are pointing at, in the source video\'s own words as far as you can recall them, used to locate the timecode. Null for heading/table/degree-chips/param-picker.',
    ),
  sourceVideoId: z
    .string()
    .nullable()
    .describe(
      'prose/callout/step/video-ref only: the youtubeVideoId (copied exactly from the [bracketed] id in the source list) that THIS content is drawn from — on video-ref, the video it links TO (REQUIRED there) — or null if it synthesizes multiple sources evenly. Never invent an id — only use one from the list. Copy this id into THIS field only, never into the block\'s own text (body/caption/label) — a reader-facing sentence must never contain a raw video id; refer to a source by its title or a natural phrase instead. Null for heading/table/degree-chips/param-picker.',
    ),
  // callout
  tone: z
    .enum(['note', 'tip', 'warning'])
    .nullable()
    .describe('callout only: the aside tone. Null for every other type.'),
  // step. Plain z.number(), NOT .int() — zod compiles `.int()` to a JSON
  // schema `{"type":"integer","minimum":...,"maximum":...}` with implicit
  // safe-integer bounds (caught in a real run: Anthropic 400s with
  // "output_config.format.schema: For 'integer' type, properties maximum,
  // minimum are not supported" — the SAME "Anthropic rejects bounds on
  // primitive schema types" pattern as the array minItems/maxItems bugs
  // above, just on numbers instead of arrays). `toLessonBlock` below
  // already coerces this to an integer >= 1 defensively regardless of what
  // the schema declares, so dropping `.int()` here costs nothing at
  // runtime.
  number: z
    .number()
    .nullable()
    .describe('step only: the step number, starting at 1. Null for every other type.'),
  title: z
    .string()
    .nullable()
    .describe('step only: verb-led short step title. MAX 120 characters. Null for every other type.'),
  lede: z
    .string()
    .nullable()
    .describe('step only: one-sentence lede, or null. Null for every other type.'),
  // table
  headers: z
    .array(z.string())
    .nullable()
    .describe('table only: column headers. Null for every other type.'),
  // NOT .max() on headers/rows/degrees below — Anthropic rejects `maxItems`
  // on any array at all (see LessonOutlineSchema's `sections` comment for
  // the exact error and where THAT was caught). TABLE_HEADERS_MAX /
  // TABLE_ROWS_MAX / DEGREE_CHIPS_MAX enforce the caps in code instead, in
  // toLessonBlock below.
  rows: z
    .array(z.array(z.string()))
    .nullable()
    .describe('table only: rows, each an array of cell strings. Null for every other type.'),
  caption: z
    .string()
    .nullable()
    .describe(
      'table/diagram/keyboard-diagram only: MAX 255 characters, or null. On diagram/keyboard-diagram, a caption that adds information beyond "here is a diagram" — e.g. why the third\'s dot sits where it does, not just that it\'s a triad. Never a raw video id — refer to a source by title/natural phrase, the id belongs in sourceVideoId. Null for every other type.',
    ),
  // degree-chips
  degrees: z
    .array(z.string())
    .nullable()
    .describe('degree-chips only: scale degrees like "I", "ii", "IV", "V7". Null for every other type.'),
  // param-picker / video-ref. ONE field for both, deliberately — it means
  // the same thing on each (the visible text of the control/link) and a
  // second nullable string would cost a second union-typed parameter for
  // no gain. See this schema's own header comment on the 16-union cap.
  label: z
    .string()
    .nullable()
    .describe(
      'param-picker/video-ref only: param-picker — the picker\'s label, or null to use the lesson parameter\'s own. video-ref — the link text, a short verb phrase naming what the reader will see there (e.g. "Watch the barre-chord demo"), MAX 120 characters. Null for every other type.',
    ),
}).strict();

// Code-enforced maxima for the array fields Anthropic won't let the schema
// cap (see the `table`/`degree-chips` schema comments above). Matches the
// bounds the system prompt still asks for — these are backstops against a
// model that ignores the prompt, not the primary control.
const TABLE_HEADERS_MAX = 6;
const TABLE_ROWS_MAX = 12;
const DEGREE_CHIPS_MAX = 12;

export const SectionBlocksSchema = z.object({
  // NOT .min(2) AND NOT .max(4) here — same two Anthropic array-schema
  // restrictions as LessonOutlineSchema's `sections` above (minItems other
  // than 0/1 rejected; maxItems rejected outright). "A section with one
  // block is thin" is tracked in code below via MIN_SECTION_BLOCKS
  // (logged, reported via a `section` progress event); the upper bound is
  // enforced by `buildSectionBlocks` slicing to SECTION_BLOCKS_BACKSTOP.
  blocks: z.array(LessonBlockOutputSchema),
}).strict();

// NOT a shaping cap — the brief this branch implements ("stop templating")
// deleted the old MAX_SECTION_BLOCKS=4 shaping behaviour deliberately: a
// section's real length should be decided by what it needs to teach, not a
// constant invented up front. This is only a runaway backstop, an order of
// magnitude above the old shaping cap, so a badly-behaved model can't emit
// an unbounded array (Anthropic rejects a schema `maxItems`, so this has
// to live in code either way — see the schema comment above).
const SECTION_BLOCKS_BACKSTOP = 40;

// The target "2 to 4 blocks" a section should contain — see the schema
// comment above for why this can't live in the schema itself for the
// frontier tier. A section with 0 usable blocks is retried once (see the
// section loop in `writeLesson`); a section with 1..MIN_SECTION_BLOCKS-1
// usable blocks stays accept-and-log — a thin-but-grounded section is real
// content, and failing/retrying it over a 1-vs-2 block count would cost an
// extra call for a quantity target, not a correctness one. Checked against
// the SANITIZED block count (after toLessonBlock has dropped anything
// invalid), not the raw model output count, so a section that named 3
// blocks but had 2 rejected is correctly flagged thin.
const MIN_SECTION_BLOCKS = 2;

// WRITE pass only — no diagram guidance here at all. This call never sees
// the diagram vocabulary and its schema has no diagram fields (see
// LessonBlockOutputSchema's comment above); the ILLUSTRATE pass further
// below is given this pass's finished text and decides what earns a
// diagram, entirely separately. Do not reintroduce diagram language here —
// that reunites the two passes this branch split apart.
const SECTION_SYSTEM = [
  'You write ONE section of a music lesson as short structured content blocks — as many as the content actually needs, not a fixed count.',
  'Allowed block types: prose, callout, step, table, degree-chips, video-ref, param-picker. Never use any other type — diagrams are added separately, by a later pass, after this section\'s text is finished. Do not try to describe a diagram in prose either; if something would be clearer shown than described, say what it is and trust the illustration pass to show it.',
  'Do NOT emit a `heading` block. The section heading is added automatically from the outline — start straight in with content.',
  'Use `step` for sequenced instructions, `table` for comparisons, `degree-chips` for scale-degree sequences, `callout` for a short aside that carries one specific, checkable fact, `prose` for the reasoning that connects them — why, not just what.',
  'Use `video-ref` when a source shows something a reader really should watch rather than read — a demonstration, a sound, a hand position. Set `sourceVideoId` to the video, `label` to the link text, and `body` to a short description of that exact moment (in the video\'s own words as best you recall them) — the `body` is never shown to the reader, it is what locates the timecode. At most one or two per section; it is a pointer, not a substitute for teaching the material.',
  'Use `param-picker` ONLY if the user prompt below says this lesson declares a reader-controlled parameter. At most ONE per lesson, placed early in the section it belongs to. On a lesson with no parameter it renders as nothing at all, so never emit one speculatively.',
  'Ground content in the PASSAGES quoted from the source transcripts below. They are the actual words of the videos — prefer their specifics (note names, fret numbers, chord names, the exact wording of a rule) over generalities. Do not invent chords, keys, techniques, or songs the passages and source list do not mention.',
  'Write what the passages actually say, concretely. "The minor third sits three frets up from the root" is a lesson; "focus on understanding the pattern" is filler. If a passage names a note, a fret, a string or a chord, name it too.',
  'On every prose/callout/step/video-ref block, set `sourceVideoId` to the exact id shown in [brackets] next to the source video this content is drawn from, or null if the content blends several sources evenly. Copy the id exactly — never invent or guess one.',
  'NEVER write a bare video id into a block\'s own text (body/label) — that id is for `sourceVideoId` only. Refer to a source in text by its title or a natural phrase ("one video recommends..."), never by the [bracketed] id itself.',
  'The `[id @ m:ss]` header on each passage is metadata for you, not content: never copy a timecode or an id into a block\'s text. Timecodes are added automatically afterwards.',
  'Every block shares one field set (each field belongs to only some block types — see each field\'s own description for which). Set every field that does not apply to this block\'s `type` to null; only fill in the fields that belong to the chosen type.',
].join('\n');

// Loaded once at module scope — see OUTLINE_GUIDE_EXCERPT's comment above.
// The block-reference entries for exactly the text block types this call is
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

// Truncate on a hard boundary (no ellipsis) — captions are short labels, not
// prose, so an ellipsis reads oddly. Matches the brief's "truncate, don't
// fail" rule for the 255-char Strapi `string` cap on `caption`.
const CAPTION_MAX = 255;

// `lesson.param-picker.label` / `lesson.video-ref.label` are Strapi
// `string` columns (255) but are rendered as a control label and a link —
// both want to stay on one line, so they're capped well below the column.
const PARAM_PICKER_LABEL_MAX = 40;
const VIDEO_REF_LABEL_MAX = 120;

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

// Every reader-facing free-text field (prose/callout/step body+lede+title,
// diagram/keyboard-diagram/table caption) is read through this, not a bare
// `.trim()` — see stripLeakedVideoIds above for why.
function sanitizeReaderText(raw: unknown, ground: GroundingContext): string {
  if (typeof raw !== 'string') return '';
  return stripLeakedVideoIds(raw.trim(), ground).trim();
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

// Validates + coerces ONE raw block from the model into a LessonBlock, or
// drops it. Deliberately does NOT trust that `raw` matches
// LessonBlockOutputSchema's inferred type — `chat()` only enforces that
// against a live Ollama call; here we treat the value as fully untrusted
// content (same stance as sanitizeMusicExtraction / sanitizeSummary).
// Returns null for anything that fails validation, including block types
// outside the seven this WRITE pass is allowed to emit — lesson.diagram /
// lesson.keyboard-diagram are never in this call's schema at all, let alone
// this function; see toIllustrationBlock further below for those two,
// which is the separate ILLUSTRATE pass's equivalent of this function.
// Never reads a model-supplied `timeSec` — there isn't one in the schema,
// and even if a model emits an unrequested extra field, this function only
// ever pulls known fields off `r`, so it's ignored by construction.
/**
 * Explicit-mode dots/marks come straight from the model, so every field is
 * re-derived rather than trusted. Returns null for anything unusable — the
 * resolve check downstream then drops the whole diagram if too little
 * survives. Shared by toIllustrationBlock below (the only caller now that
 * diagram fields are gone from the write pass's schema).
 */
function normalizeNeckDot(raw: unknown): NeckDotInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const string = Number(d.string);
  const fret = Number(d.fret);
  if (!Number.isFinite(string) || string < 0 || string > 5) return null;
  if (!Number.isFinite(fret) || fret < 0) return null;
  const out: NeckDotInput = { string: Math.floor(string), fret: Math.floor(fret) };
  if (typeof d.label === 'string' && d.label.trim()) out.label = d.label.trim();
  if (d.root === true) out.root = true;
  if (d.dim === true) out.dim = true;
  return out;
}

function normalizeKeyMark(raw: unknown): KeyMarkInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const pc = typeof m.pc === 'string' ? m.pc.trim() : '';
  if (!pc) return null;
  const out: KeyMarkInput = { pc: pc as KeyMarkInput['pc'] };
  if (typeof m.label === 'string' && m.label.trim()) out.label = m.label.trim();
  if (m.root === true) out.root = true;
  if (m.flag === true) out.flag = true;
  return out;
}

function toLessonBlock(raw: unknown, id: number, ground: GroundingContext): LessonBlock | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = typeof r.type === 'string' ? r.type : null;

  switch (type) {
    case 'heading': {
      const text = typeof r.text === 'string' ? r.text.trim() : '';
      if (!text) return null;
      const level = r.level === 'h3' ? 'h3' : 'h2';
      return { __component: 'lesson.heading', id, text, level };
    }

    case 'prose': {
      const body = sanitizeReaderText(r.body, ground);
      if (!body) return null;
      const block: LessonBlock = { __component: 'lesson.prose', id, body };
      const source = resolveBlockSource(r.sourceVideoId, body, ground);
      if (source) block.source = source;
      return block;
    }

    case 'callout': {
      const body = sanitizeReaderText(r.body, ground);
      if (!body) return null;
      const tone = r.tone === 'tip' || r.tone === 'warning' ? r.tone : 'note';
      const block: LessonBlock = { __component: 'lesson.callout', id, tone, body };
      const source = resolveBlockSource(r.sourceVideoId, body, ground);
      if (source) block.source = source;
      return block;
    }

    case 'step': {
      // Trailing colons are a common model tic ("Identify the Root:") —
      // strip trailing `:`/whitespace so titles read as titles, not labels.
      const title = sanitizeReaderText(r.title, ground).replace(/[\s:]+$/, '');
      if (!title) return null;
      const numberRaw = Number(r.number);
      const number = Number.isFinite(numberRaw) && numberRaw >= 1 ? Math.floor(numberRaw) : 1;
      const block: LessonBlock = { __component: 'lesson.step', id, number, title };
      const lede = sanitizeReaderText(r.lede, ground);
      if (lede) block.lede = lede;
      const body = sanitizeReaderText(r.body, ground);
      if (body) block.body = body;
      const groundingText = [title, lede, body].filter(Boolean).join('. ');
      const source = resolveBlockSource(r.sourceVideoId, groundingText, ground);
      if (source) block.source = source;
      return block;
    }

    case 'table': {
      // .slice() caps below enforce TABLE_HEADERS_MAX/TABLE_ROWS_MAX in
      // code — see SectionBlocksSchema's `table` field comment for why the
      // schema itself can't (Anthropic rejects array `maxItems`).
      const headers = Array.isArray(r.headers)
        ? r.headers.slice(0, TABLE_HEADERS_MAX).map((h) => String(h))
        : [];
      const rowsRaw = Array.isArray(r.rows) ? r.rows.slice(0, TABLE_ROWS_MAX) : [];
      const rows = rowsRaw
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map((cell) => String(cell)));
      if (headers.length === 0 || rows.length === 0) return null;
      const block: LessonBlock = { __component: 'lesson.table', id, headers, rows };
      const caption = sanitizeReaderText(r.caption, ground);
      if (caption) block.caption = truncate(caption, CAPTION_MAX);
      return block;
    }

    case 'degree-chips': {
      // DEGREE_CHIPS_MAX enforced by .slice() — see the schema comment above.
      const degrees = Array.isArray(r.degrees)
        ? r.degrees.slice(0, DEGREE_CHIPS_MAX).map((d) => String(d))
        : [];
      if (degrees.length === 0) return null;
      const block: LessonBlock = { __component: 'lesson.degree-chips', id, degrees };
      if (r.size === 'sm' || r.size === 'md') block.size = r.size;
      return block;
    }

    case 'param-picker': {
      // Dropped outright on a lesson with no `parameter` — see
      // GroundingContext.parameter. The one-per-lesson rule is NOT
      // enforced here (this function sees one block, not the lesson);
      // assembly in `writeLesson` keeps the first and drops the rest.
      if (!ground.parameter) {
        ground.warn('param-picker on a lesson that declares no parameter', {});
        return null;
      }
      const block: LessonBlock = { __component: 'lesson.param-picker', id };
      const label = sanitizeReaderText(r.label, ground);
      if (label) block.label = truncate(label, PARAM_PICKER_LABEL_MAX);
      return block;
    }

    case 'video-ref': {
      // `videoId` is REQUIRED by the component (and by LessonBody, which
      // renders nothing without it), so an unresolvable one drops the
      // block rather than shipping a dead link.
      const rawVideoId = typeof r.sourceVideoId === 'string' ? r.sourceVideoId.trim() : '';
      if (!rawVideoId || !ground.validVideoIds.has(rawVideoId)) {
        ground.warn('video-ref names a video outside this lesson\'s source set', {
          sourceVideoId: rawVideoId,
        });
        return null;
      }
      const label = sanitizeReaderText(r.label, ground);
      // `body` on a video-ref is grounding material, never rendered: the
      // model describes the moment it is pointing at, and BM25 turns that
      // into the real caption-segment start. Same rule as every other
      // timecode in this codebase — the model names WHICH video, code
      // decides WHEN. Falls back to the label when body is missing (a
      // weaker query, so more likely to yield a video-only link).
      const momentText = sanitizeReaderText(r.body, ground) || label;
      const resolved = resolveBlockSource(rawVideoId, momentText, ground);
      if (!resolved) return null;
      const block: LessonBlock = {
        __component: 'lesson.video-ref',
        id,
        videoId: resolved.videoId,
        // LessonBody defaults to "Watch this moment" when absent; set it
        // explicitly so a generated lesson never leans on that fallback.
        label: label ? truncate(label, VIDEO_REF_LABEL_MAX) : 'Watch this moment',
      };
      if (typeof resolved.timeSec === 'number') {
        block.timeSec = resolved.timeSec;
      } else {
        ground.warn('video-ref grounded to a video but not to a timecode — linking to 0:00', {
          videoId: resolved.videoId,
        });
      }
      return block;
    }

    // Covers unknown/missing `type`, and any block outside the seven this
    // WRITE pass is allowed to emit — including 'diagram'/'keyboard-diagram'
    // if a model ignores the schema and emits one anyway (impossible under
    // real structured-output decoding, but this stays defensive since `raw`
    // is treated as fully untrusted content, not just an untrusted shape).
    default:
      return null;
  }
}

function isModelHeadingBlock(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'heading';
}

// Builds a section's content blocks from the model's raw `blocks` array,
// WITHOUT committing them anywhere — the caller decides what to do with an
// empty result (retry) vs a non-empty one (accept, possibly thin-and-logged).
// No diagram budget here — the write pass never emits a diagram block at
// all (see LessonBlockOutputSchema's comment); diagram budgeting happens in
// mergeIllustrations further below, against the separate illustrate pass's
// output.
function buildSectionBlocks(
  rawBlocks: unknown[],
  startId: number,
  ground: GroundingContext,
): LessonBlock[] {
  const blocks: LessonBlock[] = [];
  let nextId = startId;
  for (const rawBlock of rawBlocks) {
    // SECTION_BLOCKS_BACKSTOP enforced here in code, not the schema — see
    // SectionBlocksSchema's comment for why (Anthropic rejects array
    // `maxItems`). Not a shaping cap — see the constant's own comment.
    if (blocks.length >= SECTION_BLOCKS_BACKSTOP) break;
    // The model is instructed not to emit a heading; if it does anyway,
    // drop it — the outline's heading is injected separately, never this one.
    if (isModelHeadingBlock(rawBlock)) continue;
    const block = toLessonBlock(rawBlock, nextId, ground);
    if (!block) continue;
    blocks.push(block);
    nextId += 1;
  }
  return blocks;
}

// -----------------------------------------------------------------------------
// Step 5.5: illustrate — one small structured call PER SECTION, given that
// section's OWN finished text (from step 5), answering a different question
// than the write pass: "what here would be clearer shown than described?"
// Returns diagram/keyboard-diagram blocks plus where each belongs in the
// section. See docs/lesson-authoring.md's "Generation is two passes" note
// for the full rationale; the short version: a combined write+illustrate
// call makes a diagram an afterthought, AND its schema had to carry every
// prose field alongside every diagram field in one request, which is what
// forced dropping inversion/fromFret/toFret/explicit-mode dots+marks and
// locking generation to theory-mode-only. An illustration-only schema
// carries none of the prose fields, so the full vocabulary comes back.
//
// Run PER SECTION rather than once for the whole lesson — same "small,
// independent calls" shape as the write pass, and, unlike the write pass,
// every section's illustrate call is fully independent of every other
// section's (it only reads that one section's already-finished text), so
// `writeLesson` below fires them all with `Promise.all` instead of a
// sequential loop — otherwise this pass would roughly double total
// generation time for no reason.
// -----------------------------------------------------------------------------

// Sub-components for explicit-mode positions. Fields that Half A documents
// as optional (label/root/dim, label/root/flag) are declared here as
// PLAIN, non-nullable types (string/boolean) rather than `.nullable()` —
// unlike the top-level illustration fields, these never mean "does not
// apply to this block's type," only "not meaningful for this one dot/mark"
// (an empty label, a false flag), so a plain default-shaped value costs
// nothing and keeps these two sub-schemas out of the union-parameter count
// entirely (see IllustrationItemSchema's own comment on that count).
const NeckDotOutputSchema = z.object({
  string: z.number(),
  fret: z.number(),
  label: z.string(),
  root: z.boolean(),
  dim: z.boolean(),
}).strict();

const KeyMarkOutputSchema = z.object({
  pc: z.enum(PITCH_CLASS_ENUM),
  label: z.string(),
  root: z.boolean(),
  flag: z.boolean(),
}).strict();

// One flattened object covering BOTH lesson.diagram and lesson.keyboard-
// diagram, same oneOf-avoidance reasoning as LessonBlockOutputSchema above
// (Anthropic rejects the `oneOf` a discriminated union compiles to).
//
// Union-parameter count: 12 nullable (anyOf) fields at the top level
// (afterBlockIndex, sourceVideoId, instrument, root, quality, stringSet,
// inversion, fretWindow, octaves, dots, marks, caption) plus
// `type`/`mode`/`useParam` as plain required enums/booleans — 12 total,
// walking the WHOLE compiled request
// schema recursively (including NeckDotOutputSchema/KeyMarkOutputSchema
// nested inside `dots`/`marks`, which contribute zero more because their
// own fields are plain, not nullable — see those schemas' comment). Well
// under Anthropic's 16-union cap, with room to spare — see
// lesson-generation.test.ts's schema-lint suite, which walks this exact
// schema the same way.
export const IllustrationItemSchema = z.object({
  type: z.enum(['diagram', 'keyboard-diagram']),
  mode: z.enum(['theory', 'explicit']),
  afterBlockIndex: z
    .number()
    .nullable()
    .describe(
      'Where this illustration belongs, addressed by the [bracketed] index of the section-text block it should follow. -1 = before every block in the section. null = at the end of the section (the common case: the text describes something, then the diagram shows it).',
    ),
  sourceVideoId: z
    .string()
    .nullable()
    .describe(
      'The youtubeVideoId (copied exactly from the [bracketed] id in the source list) this illustration is drawn from, or null if it is not drawn from one specific source. Never invent an id.',
    ),
  instrument: z
    .enum(['guitar', 'bass'])
    .nullable()
    .describe('diagram only: which fretboard this depicts. Null for keyboard-diagram (no strings).'),
  root: z
    .enum(PITCH_CLASS_ENUM)
    .nullable()
    .describe(
      'mode="theory" only: the chord root, one of the 12 sharps-only pitch classes (no flats). REQUIRED together with quality (and stringSet, on diagram) in theory mode. Null in explicit mode.',
    ),
  quality: z
    .enum(TRIAD_QUALITY_ENUM)
    .nullable()
    .describe(
      'mode="theory" only: TRIADS ONLY (major/minor/augmented/diminished) — never a seventh-chord quality. REQUIRED together with root (and stringSet, on diagram) in theory mode. Null in explicit mode.',
    ),
  stringSet: z
    .enum(STRING_SET_ENUM)
    .nullable()
    .describe(
      'diagram mode="theory" only: one of these four EXACT strings, using an EN DASH (–, U+2013) between letters, NOT a hyphen — a hyphenated lookalike silently renders an empty diagram. REQUIRED together with root+quality in theory mode. Null otherwise, including on keyboard-diagram.',
    ),
  inversion: z
    .number()
    .nullable()
    .describe('diagram mode="theory" only: 0 = root position, 1 = first inversion, 2 = second. Null otherwise.'),
  fretWindow: z
    .array(z.number())
    .nullable()
    .describe('diagram only: [fromFret, toFret] to constrain the fret window shown, or null to let it be inferred. Null for keyboard-diagram.'),
  octaves: z
    .number()
    .nullable()
    .describe('keyboard-diagram only: how many octaves the keyboard spans, 1-3. Null for diagram.'),
  // Plain required boolean, NOT nullable — it means the same thing on both
  // diagram types and in both modes ("does the reader's key drive this"),
  // never "does not apply", so it costs zero union-typed parameters
  // (same reasoning as NeckDotOutputSchema's fields — see its comment).
  useParam: z
    .boolean()
    .describe(
      'mode="theory" only: true if this diagram should follow the reader\'s chosen key from the lesson\'s key picker instead of its own fixed root. ONLY allowed when the user prompt says this lesson declares a parameter, AND this diagram\'s `root` is that same key — a chord on some OTHER scale degree (the vi, the vii°) must set false, or the picker would slide it away from what the caption says it is. Still set `root` when true: it is the fallback, and a diagram with no root draws nothing. When true, do not name the specific root in the caption; it changes.',
    ),
  dots: z
    .array(NeckDotOutputSchema)
    .nullable()
    .describe(
      'diagram mode="explicit" only: hand-placed dots. string: 0 = highest-pitched string (high e), increasing toward the lowest. fret: 0 = open string. Set label/root/dim to "" / false when not meaningful for a given dot, never omit them. Null unless mode="explicit".',
    ),
  marks: z
    .array(KeyMarkOutputSchema)
    .nullable()
    .describe(
      'keyboard-diagram mode="explicit" only: hand-placed marks. Set label/root/flag to "" / false when not meaningful for a given mark, never omit them. Null unless mode="explicit".',
    ),
  caption: z
    .string()
    .nullable()
    .describe(
      'MAX 255 characters, or null. A caption that adds information beyond "here is a diagram" — e.g. why the third\'s dot sits where it does, not just that it\'s a triad. Never a raw video id — the id belongs in sourceVideoId.',
    ),
}).strict();

export const SectionIllustrationsSchema = z.object({
  // NOT .max() here — same Anthropic array-schema restriction as every
  // other array in this pipeline (see LessonOutlineSchema's `sections`
  // comment). ILLUSTRATIONS_PER_SECTION_BACKSTOP enforces a generous
  // runaway cap in code instead, below.
  illustrations: z.array(IllustrationItemSchema),
}).strict();

// A triad has 3 notes; 6 gives room for a doubled note or two without
// letting an explicit-mode diagram/keyboard-diagram sprawl. Correctness
// limit, not a shaping cap — kept exactly as it was before this branch's
// write/illustrate split (see docs/lesson-authoring.md's "Keep every
// correctness limit" framing in the brief this branch implements).
const MAX_DIAGRAM_DOTS = 6;
const MAX_KEYBOARD_MARKS = 6;

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
  'You will be given the section\'s text as an indexed list of blocks. For each illustration, set `afterBlockIndex` to the index of the block it should follow, -1 to place it before every block, or leave it null to place it at the end of the section (the common case).',
  'Not every section needs an illustration. If nothing in this section\'s text would be clearer shown than described, return an EMPTY `illustrations` array — that is a correct, expected answer, not a failure.',
  'There is no fixed count. A section naming five pentatonic positions wants five diagrams; a section explaining a relationship or a reason wants zero. Decide by fit, never by habit or to fill a quota — see the guide below for what each diagram type is for.',
  'If the section\'s text names an ordered chord progression — a chord sequence like G–C–D, or a Roman-numeral pattern like ii–V–I — illustrate it: emit ONE diagram PER chord in the progression, in the order named, not a single diagram or none at all.',
  'PREFER mode="theory" (root+quality, and stringSet on diagram) over mode="explicit" (hand-placed dots/marks) — theory mode cannot be musically wrong the way hand-placed positions can. Use explicit mode only when theory mode genuinely cannot express the shape (e.g. a specific fret window, or a voicing that is not a plain triad).',
  'quality is TRIADS ONLY: major, minor, augmented, or diminished — never a seventh-chord quality. stringSet on a theory-mode diagram MUST use an EN DASH (–) between letters, e.g. "e–B–G", never a hyphen — a hyphenated lookalike silently renders an empty diagram.',
  'Set `sourceVideoId` to the exact id shown in [brackets] next to the source video an illustration is drawn from, or null if it is not drawn from one specific source. Never invent or guess one.',
  '`useParam` is false unless the user prompt below explicitly says this lesson declares a reader-controlled key picker AND this diagram\'s root IS that key. A diagram of a different scale degree — the vi chord, the vii° — keeps its own fixed root and sets useParam: false, because the picker replaces the root outright and would leave the caption describing a chord that is no longer on screen. Always set `root` alongside useParam as the fallback — a diagram with no root draws nothing.',
  'Every illustration shares one field set (each field belongs to only some type/mode combination — see each field\'s own description). Set every field that does not apply to null; for the small dots/marks sub-object fields specifically (label/root/dim/flag), use "" / false rather than omitting them.',
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
      ? `This lesson declares a reader-controlled ${outline.parameter.label.toLowerCase()} picker, starting on ${outline.parameter.default}. A theory-mode diagram MAY set useParam: true to follow it — but ONLY if its own root is ${outline.parameter.default}. Any diagram rooted on a different note keeps useParam: false. Always set root either way.`
      : 'This lesson declares NO reader-controlled parameter — set useParam: false on every illustration.',
    '',
    `Section: "${section.heading}" — ${section.goal}`,
    '',
    "This section's finished text, indexed for you to anchor illustrations against:",
    blocksSummary,
    '',
    'Source videos (cite by the [bracketed] id if an illustration is drawn from one):',
    contextText,
  ].join('\n');
}

/**
 * Converts one raw illustration item into a diagram/keyboard-diagram
 * LessonBlock plus its REQUESTED anchor (not yet clamped to a section's
 * actual length — the caller does that once it knows how many text blocks
 * the section has). Returns null for anything unusable, INCLUDING a
 * diagram that resolves to zero dots/marks — same non-negotiable resolve
 * check as toLessonBlock's old diagram/keyboard-diagram cases, run against
 * the exact renderer function, not just schema validity.
 */
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

function toIllustrationBlock(
  raw: unknown,
  ground: GroundingContext,
): { anchorRequested: number | null; block: LessonBlock } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = r.type === 'keyboard-diagram' ? 'keyboard-diagram' : r.type === 'diagram' ? 'diagram' : null;
  if (!type) return null;

  const anchorRaw = r.afterBlockIndex;
  const anchorRequested =
    typeof anchorRaw === 'number' && Number.isFinite(anchorRaw) ? Math.floor(anchorRaw) : null;

  const mode = r.mode === 'explicit' ? 'explicit' : 'theory';

  if (type === 'diagram') {
    const block: LessonBlock = {
      __component: 'lesson.diagram',
      id: 0, // reassigned sequentially once the whole lesson body is flattened
      instrument: r.instrument === 'bass' ? 'bass' : 'guitar',
      mode,
    };
    for (const key of ['root', 'quality', 'stringSet'] as const) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) block[key] = v.trim();
    }
    // Only honoured on a lesson that declares a parameter AND when the
    // diagram's own root matches it — see `honoursLessonParameter`.
    if (mode === 'theory' && r.useParam === true) {
      if (honoursLessonParameter(block.root, ground.parameter)) {
        block.useParam = true;
      } else {
        ground.warn('illustration useParam ignored — root does not match the lesson key', {
          root: block.root,
          parameterDefault: ground.parameter?.default ?? null,
        });
      }
    }
    const inv = Number(r.inversion);
    if (Number.isFinite(inv) && inv >= 0) block.inversion = Math.floor(inv);
    if (Array.isArray(r.fretWindow) && r.fretWindow.length === 2) {
      const from = Number(r.fretWindow[0]);
      const to = Number(r.fretWindow[1]);
      if (Number.isFinite(from) && from >= 0) block.fromFret = Math.floor(from);
      if (Number.isFinite(to) && to >= 0) block.toFret = Math.floor(to);
    }
    if (mode === 'explicit' && Array.isArray(r.dots)) {
      const dots = r.dots
        .slice(0, MAX_DIAGRAM_DOTS)
        .map((d) => normalizeNeckDot(d))
        .filter((d): d is NeckDotInput => d !== null);
      if (dots.length) block.dots = dots as unknown as JsonValue;
    }
    const caption = sanitizeReaderText(r.caption, ground);
    if (caption) block.caption = truncate(caption, CAPTION_MAX);

    // THE check. See toLessonBlock's old comment (now here): a diagram
    // that draws nothing is worse than no diagram, because it renders as
    // an invisible gap with no error anywhere. Schema-valid is not the bar.
    if (resolveDiagramDots(block as unknown as DiagramBlock).length === 0) {
      ground.warn('illustration diagram resolves to zero dots', {
        mode,
        root: block.root,
        quality: block.quality,
        stringSet: block.stringSet,
      });
      return null;
    }
    const source = resolveBlockSource(r.sourceVideoId, caption, ground);
    if (source) block.source = source;
    return { anchorRequested, block };
  }

  // type === 'keyboard-diagram'
  const block: LessonBlock = { __component: 'lesson.keyboard-diagram', id: 0, mode };
  for (const key of ['root', 'quality'] as const) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) block[key] = v.trim();
  }
  if (mode === 'theory' && r.useParam === true) {
    if (honoursLessonParameter(block.root, ground.parameter)) {
      block.useParam = true;
    } else {
      ground.warn('illustration useParam ignored — root does not match the lesson key', {
        root: block.root,
        parameterDefault: ground.parameter?.default ?? null,
      });
    }
  }
  const oct = Number(r.octaves);
  if (Number.isFinite(oct) && oct >= 1) block.octaves = Math.floor(oct);
  if (mode === 'explicit' && Array.isArray(r.marks)) {
    const marks = r.marks
      .slice(0, MAX_KEYBOARD_MARKS)
      .map((m) => normalizeKeyMark(m))
      .filter((m): m is KeyMarkInput => m !== null);
    if (marks.length) block.marks = marks as unknown as JsonValue;
  }
  const caption = sanitizeReaderText(r.caption, ground);
  if (caption) block.caption = truncate(caption, CAPTION_MAX);

  if (resolveDiagramMarks(block as unknown as KeyboardDiagramBlock).length === 0) {
    ground.warn('illustration keyboard-diagram resolves to zero marks', {
      mode,
      root: block.root,
      quality: block.quality,
    });
    return null;
  }
  const source = resolveBlockSource(r.sourceVideoId, caption, ground);
  if (source) block.source = source;
  return { anchorRequested, block };
}

/**
 * Inserts illustration blocks into a section's text blocks at their
 * requested positions. `anchorRequested` is clamped to this section's
 * actual length here (not in toIllustrationBlock, which doesn't know it
 * yet): -1 stays -1 (before everything), null resolves to "after the last
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
          outputSchema: SectionBlocksSchema,
          modelOptions: buildModelOptions(lessonModel, 0.4),
        });

        const rawBlocks = Array.isArray((raw as { blocks?: unknown })?.blocks)
          ? (raw as { blocks: unknown[] }).blocks
          : [];
        // Local per-section ids — reassigned sequentially once the whole
        // lesson body (text + illustrations) is flattened in step 6.
        const built = buildSectionBlocks(rawBlocks, 1, ground);

        if (built.length > 0) {
          sectionBlocks = built;
          break;
        }
        // Zero usable blocks is treated the same as a failed call: retry
        // once before giving up on the section.
        if (isLastAttempt) {
          logPhase(topic, `section "${section.heading}" ⚠ too few usable blocks after retry, dropping`, {
            rawCount: rawBlocks.length,
          });
          break;
        }
        logPhase(topic, `section "${section.heading}" ⚠ zero usable blocks (attempt ${attempt}) — retrying once`, {
          rawCount: rawBlocks.length,
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
      logPhase(topic, `section "${section.heading}" ✓`, { blocks: sectionBlocks.length });
      emit(onProgress, {
        type: 'section',
        index,
        total: totalSections,
        heading: section.heading,
        blocks: sectionBlocks.length,
        passages: passages.length,
      });
    }
    // else: single-section failure is non-fatal — drop it and keep going.
    // Only "every section failed" (checked below) fails the whole run.
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
      if (sr.blocks.length === 0) return { illustrations: [] as Array<{ anchorRequested: number | null; block: LessonBlock }> };

      const blocksSummary = summarizeSectionBlocksForIllustration(sr.blocks);
      const section = outline.sections[index];
      let illustrations: Array<{ anchorRequested: number | null; block: LessonBlock }> = [];

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
            outputSchema: SectionIllustrationsSchema,
            modelOptions: buildModelOptions(lessonModel, 0.3),
          });
          const rawItems = Array.isArray((raw as { illustrations?: unknown })?.illustrations)
            ? (raw as { illustrations: unknown[] }).illustrations
            : [];
          illustrations = rawItems
            .slice(0, ILLUSTRATIONS_PER_SECTION_BACKSTOP)
            .map((item) => toIllustrationBlock(item, ground))
            .filter(
              (x): x is { anchorRequested: number | null; block: LessonBlock } => x !== null,
            );
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

      return { illustrations };
    }),
  );

  // Budget + merge run SEQUENTIALLY, after every concurrent call has
  // settled — deterministic regardless of which call happened to resolve
  // first, and it's what makes ILLUSTRATIONS_PER_LESSON_BACKSTOP a real
  // shared budget rather than a race between concurrent sections.
  let lessonDiagramBudget = ILLUSTRATIONS_PER_LESSON_BACKSTOP;
  const illustratedSections: SectionResult[] = sectionResults.map((sr, index) => {
    const { illustrations } = illustrationOutcomes[index];
    const kept: typeof illustrations = [];
    for (const item of illustrations) {
      if (kept.length >= ILLUSTRATIONS_PER_SECTION_BACKSTOP || lessonDiagramBudget <= 0) {
        logPhase(topic, `illustrate "${sr.heading}" ⚠ dropped illustration — over the runaway backstop`, {
          perSection: ILLUSTRATIONS_PER_SECTION_BACKSTOP,
          lessonRemaining: lessonDiagramBudget,
        });
        continue;
      }
      kept.push(item);
      lessonDiagramBudget -= 1;
    }
    const blocks = kept.length > 0 ? mergeIllustrations(sr.blocks, kept) : sr.blocks;
    if (sr.blocks.length > 0) {
      logPhase(topic, `illustrate "${sr.heading}" ✓`, { diagrams: kept.length });
    }
    emit(onProgress, {
      type: 'illustrate',
      index,
      total: sectionResults.length,
      heading: sr.heading,
      diagrams: kept.length,
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
