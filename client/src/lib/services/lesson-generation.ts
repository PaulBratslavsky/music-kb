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
//   5. sections — ONE chat() call PER section → 2-4 content blocks each;
//                 the section heading is injected deterministically, never
//                 trusted from the model
//   6. assemble — flatten to LessonBlock[], renumber steps, append
//                 contradiction callouts, drop anything invalid
//
// This mirrors the map-reduce shape in learning.ts (many small model calls,
// one deterministic assembly step) and the structured-extraction shape in
// music-extraction.ts (schema-validated but content-untrusted, sanitized
// after the fact). Persistence is NOT this module's job — the caller (an
// in-app server function or an MCP tool, both built later) saves the result.
// That includes the digest: on a cache miss this module synthesizes one via
// `synthesizeDigest` but never calls `createDigestService` — persisting it
// is the /digest page's job (an explicit user Save), not an implicit side
// effect of generating a lesson.
//
// WHICH model runs steps 4/5 is decided exactly once, by
// `resolveLessonModel()` (lesson-model.ts) — a frontier Anthropic model
// when ANTHROPIC_API_KEY is set, the local Ollama model otherwise. This
// module never picks an adapter itself; it asks once and uses whatever it
// gets back for every chat() call, so a lesson never mixes tiers. Both
// tiers run this exact same staged pipeline — see lesson-model.ts for why
// (comparability between a local and a frontier lesson matters more than
// letting a frontier model collapse the staging into one call).

import { chat } from '@tanstack/ai';
import { z } from 'zod';
import { withRetry } from '#/lib/retry';
import {
  getOutlineGuideExcerpt,
  getSectionBlockGuideExcerpt,
} from '#/lib/lesson/authoring-guide';
import {
  DIGEST_MAX_VIDEOS,
  DIGEST_MIN_VIDEOS,
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
  type BM25Index,
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
// Public types
// -----------------------------------------------------------------------------

export type GenerateLessonInput = { topic: string; maxVideos?: number };

export type SourceVideo = {
  documentId: string;
  youtubeVideoId: string;
  title: string | null;
  /** Cosine similarity of the topic embedding against this video's stored
   * summary embedding. Not a percentage — see MatchTier commentary in
   * embeddings.ts for why raw cosine isn't shown to users directly. */
  score: number;
};

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
// Biased toward refusing: a false "covered" ships a confidently wrong
// lesson; a false "not covered" only costs the user a rephrase. Those
// costs are not symmetric, so (a) the system prompt instructs the model
// that partial/tangential coverage does NOT count, (b) an unusable/failed
// verdict refuses rather than proceeding (see the catch block and the
// `!coverage` check in generateLesson — model failure is never treated as
// permission to continue), and (c) on refusal the message names both the
// requested topic and what the library actually has, so the user knows
// what to search for or add.
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
      'true ONLY if the sources substantively teach the requested topic itself. Partial, adjacent, or tangential coverage is NOT coverage — answer false for that.',
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
});

/** What the sources DO cover, when they don't cover the topic. */
export type CoverageVerdict = {
  covered: boolean;
  actualTopic?: string;
  reason?: string;
};

const COVERAGE_SYSTEM = [
  'You judge whether a set of source videos actually covers a requested lesson topic — not merely whether they are topically adjacent or related.',
  'Partial or tangential coverage is NOT coverage. If the sources share vocabulary or a broad subject with the topic but do not substantively teach the topic itself, answer covered: false.',
  'Example: sources about triads and harmonic movement do NOT cover "barre chords", even though both are guitar-chord topics — a learner asking for barre chords would find nothing about barre chords in that material.',
  'When in doubt, or when coverage is only partial, answer covered: false — a false "not covered" only costs the user a rephrase; a false "covered" ships a confidently wrong lesson.',
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
  | { ok: true; digest: Digest; fullVideos: StrapiVideo[] }
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
    return { ok: true, digest: strapiRowToDigest(cached.data), fullVideos };
  }

  logPhase(topic, 'digest ▶ cache miss, synthesizing', { videoSetKey });
  const synthesized = await synthesizeDigest(fullVideos);
  if (!synthesized.success) {
    logPhase(topic, 'digest ✗ synthesis failed', { error: synthesized.error });
    return { ok: false, error: synthesized.error };
  }
  return { ok: true, digest: synthesized.data, fullVideos };
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
    lines.push('What each source uniquely contributes:');
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
  sections: z
    .array(
      z.object({
        heading: z.string().describe('Section heading. MAX 150 characters.'),
        goal: z
          .string()
          .describe(
            'ONE sentence: what this section should teach. Used to prompt the next generation step — never shown to the learner.',
          ),
      }),
    )
    // NOT .min(2) here — Anthropic's structured-output schema support
    // rejects `minItems` values other than 0 or 1 on an array
    // (`output_config.format.schema: For 'array' type, 'minItems' values
    // other than 0 or 1 are not supported`), so a `.min(2)` here 400s
    // every frontier call at the outline step. The local Ollama tier
    // accepts it fine, which is exactly why this shipped unnoticed — mocked
    // tests and local runs never exercise Anthropic's schema validator.
    // The "at least MIN_OUTLINE_SECTIONS sections" intent still holds; see
    // that constant, sanitizeOutline, and the 'outline ⚠ thin' log below.
    .max(6)
    .describe('2 to 6 teaching beats, in the order the lesson should cover them.'),
});

// The target minimum section count — see LessonOutlineSchema's comment
// above for why it isn't a schema `.min()`. Below this, sanitizeOutline
// still accepts the outline (a single-beat topic is real, and failing the
// whole generation over a quantity target would throw away real content),
// but it's logged as thin — see the 'outline ⚠ thin' log in
// generateLesson — rather than silently treated as if nothing were short.
const MIN_OUTLINE_SECTIONS = 2;

type LessonOutline = {
  title: string;
  summary: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  instrument: 'guitar' | 'piano' | 'push' | 'any';
  duration: string | null;
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
].join('\n');

// Loaded once at module scope, not per call — see authoring-guide.ts's own
// comment for why this reads from disk instead of a Vite `?raw` import.
// Only the structural-judgment excerpt, not the block reference: the
// outline call never emits a block, so the block vocabulary would be dead
// weight in this prompt (see getOutlineGuideExcerpt's own comment).
const OUTLINE_GUIDE_EXCERPT = getOutlineGuideExcerpt();
const OUTLINE_SYSTEM_WITH_GUIDE = `${OUTLINE_SYSTEM}\n\n---\n\n${OUTLINE_GUIDE_EXCERPT}`;

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
    .filter((s): s is { heading: string; goal: string } => s !== null);
  // Only the empty case is treated as unusable (same bar as before this
  // sanitizer existed). 2 is the real target minimum — see
  // LessonOutlineSchema's comment above for why it can't live in the
  // schema's `.min()` for the frontier tier — but this pipeline already
  // tolerates a shorter-than-intended lesson (a single successful section
  // still assembles into a real, if thin, lesson body) and a personal-KB
  // topic genuinely can be one teaching beat. Failing the WHOLE generation
  // over a thin-but-usable outline would throw away real content for a
  // quantity target, not a correctness one. The shortfall is logged
  // instead (see the 'outline ✓' log below) — visible, not silent, which
  // is what actually mattered here; see `MIN_SECTION_BLOCKS` above for the
  // matching per-section call.
  if (sections.length === 0) return null;

  return { title, summary, level, instrument, duration, sections };
}

// -----------------------------------------------------------------------------
// Step 5: sections — one small structured call PER section
// -----------------------------------------------------------------------------

// `heading` stays in the allowed output union defensively (a local model
// can ignore instructions) but the pipeline never trusts a model-emitted
// heading — see the section loop below, which drops any `type: 'heading'`
// block a section call returns and injects the outline's heading instead.
const LessonBlockOutputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('heading'),
    text: z.string().describe('Heading text. MAX 150 characters.'),
    level: z
      .enum(['h2', 'h3'])
      .describe('h2 for the section heading, h3 for a sub-heading within it.'),
  }),
  z.object({
    type: z.literal('prose'),
    body: z
      .string()
      .describe('Markdown paragraph(s) teaching this part of the section. MAX 2000 characters.'),
    sourceVideoId: z
      .string()
      .nullable()
      .describe(
        'The youtubeVideoId (copied exactly from the [bracketed] id in the source list) that THIS content is drawn from, or null if it synthesizes multiple sources evenly. Never invent an id — only use one from the list.',
      ),
  }),
  z.object({
    type: z.literal('callout'),
    tone: z.enum(['note', 'tip', 'warning']),
    body: z.string().describe('One short aside. MAX 500 characters.'),
    sourceVideoId: z
      .string()
      .nullable()
      .describe('Same rule as prose.sourceVideoId — an id from the list, or null.'),
  }),
  z.object({
    type: z.literal('step'),
    number: z.number().int().min(1),
    title: z.string().describe('Verb-led short step title. MAX 120 characters.'),
    lede: z.string().nullable().describe('One-sentence lede, or null.'),
    body: z.string().nullable().describe('Step detail (markdown), or null.'),
    sourceVideoId: z
      .string()
      .nullable()
      .describe('Same rule as prose.sourceVideoId — an id from the list, or null.'),
  }),
  z.object({
    type: z.literal('table'),
    headers: z.array(z.string()).min(1).max(6),
    rows: z.array(z.array(z.string())).min(1).max(12),
    caption: z.string().nullable().describe('MAX 255 characters, or null.'),
  }),
  z.object({
    type: z.literal('degree-chips'),
    degrees: z
      .array(z.string())
      .min(1)
      .max(12)
      .describe('Scale degrees like "I", "ii", "IV", "V7".'),
    size: z.enum(['sm', 'md']).nullable(),
  }),
]);

export const SectionBlocksSchema = z.object({
  // NOT .min(2) here — same Anthropic `minItems` restriction as the
  // outline's `sections` array above (only 0 or 1 are accepted); a
  // `.min(2)` 400s every frontier section call. "A section with one block
  // is thin" is real intent, so it's tracked in code below via
  // MIN_SECTION_BLOCKS — logged when a section falls short, not silently
  // accepted as if nothing were missing. See that constant's own comment
  // for why a shortfall is logged rather than dropped.
  blocks: z.array(LessonBlockOutputSchema).max(4),
});

// The target "2 to 4 blocks" a section should contain — see the schema
// comment above for why this can't live in the schema itself for the
// frontier tier. Below this, a section is "thin" (logged) rather than
// dropped: `sectionBlocks.length > 0` (below) still assembles it into the
// lesson body, because a thin-but-grounded section is real content, and
// failing the whole section over a 1-vs-2 block count would throw away
// content for a quantity target, not a correctness one. Checked against
// the SANITIZED block count (after toLessonBlock has dropped anything
// invalid), not the raw model output count, so a section that named 3
// blocks but had 2 rejected is correctly flagged thin.
const MIN_SECTION_BLOCKS = 2;

const SECTION_SYSTEM = [
  'You write ONE section of a music lesson as 2 to 4 short structured content blocks.',
  'Allowed block types: prose, callout, step, table, degree-chips. Never use any other type — a diagram/keyboard-diagram block is NOT available in this pipeline.',
  'Do NOT emit a `heading` block. The section heading is added automatically from the outline — start straight in with content.',
  'Use `step` for sequenced instructions, `table` for comparisons, `degree-chips` for scale-degree sequences, `callout` for a short aside, `prose` for everything else.',
  'Ground content in the provided source videos. Do not invent chords, keys, techniques, or songs the sources do not mention.',
  'On every prose/callout/step block, set `sourceVideoId` to the exact id shown in [brackets] next to the source video this content is drawn from, or null if the content blends several sources evenly. Copy the id exactly — never invent or guess one.',
].join('\n');

// Loaded once at module scope — see OUTLINE_GUIDE_EXCERPT's comment above.
// The block-reference entries for exactly the five block types this call
// is allowed to emit, plus the judgment on what makes those blocks good
// rather than generic (see getSectionBlockGuideExcerpt's own comment).
const SECTION_GUIDE_EXCERPT = getSectionBlockGuideExcerpt();
const SECTION_SYSTEM_WITH_GUIDE = `${SECTION_SYSTEM}\n\n---\n\n${SECTION_GUIDE_EXCERPT}`;

function buildSectionPrompt(
  outline: LessonOutline,
  section: { heading: string; goal: string },
  contextText: string,
): string {
  return [
    `Lesson: "${outline.title}" — ${outline.summary}`,
    '',
    `This section's heading (already added automatically — do not repeat it): "${section.heading}"`,
    `This section's goal: ${section.goal}`,
    '',
    'Source videos (ground this section in these; cite by the [bracketed] id):',
    contextText,
  ].join('\n');
}

// Truncate on a hard boundary (no ellipsis) — captions are short labels, not
// prose, so an ellipsis reads oddly. Matches the brief's "truncate, don't
// fail" rule for the 255-char Strapi `string` cap on `caption`.
const CAPTION_MAX = 255;

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
};

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
// outside the six this pipeline is allowed to emit (lesson.diagram /
// lesson.keyboard-diagram never come out of here even if the model tries).
// Never reads a model-supplied `timeSec` — there isn't one in the schema,
// and even if a model emits an unrequested extra field, this function only
// ever pulls known fields off `r`, so it's ignored by construction.
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
      const body = typeof r.body === 'string' ? r.body.trim() : '';
      if (!body) return null;
      const block: LessonBlock = { __component: 'lesson.prose', id, body };
      const source = resolveBlockSource(r.sourceVideoId, body, ground);
      if (source) block.source = source;
      return block;
    }

    case 'callout': {
      const body = typeof r.body === 'string' ? r.body.trim() : '';
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
      const title = (typeof r.title === 'string' ? r.title.trim() : '').replace(/[\s:]+$/, '');
      if (!title) return null;
      const numberRaw = Number(r.number);
      const number = Number.isFinite(numberRaw) && numberRaw >= 1 ? Math.floor(numberRaw) : 1;
      const block: LessonBlock = { __component: 'lesson.step', id, number, title };
      const lede = typeof r.lede === 'string' ? r.lede.trim() : '';
      if (lede) block.lede = lede;
      const body = typeof r.body === 'string' ? r.body.trim() : '';
      if (body) block.body = body;
      const groundingText = [title, lede, body].filter(Boolean).join('. ');
      const source = resolveBlockSource(r.sourceVideoId, groundingText, ground);
      if (source) block.source = source;
      return block;
    }

    case 'table': {
      const headers = Array.isArray(r.headers) ? r.headers.map((h) => String(h)) : [];
      const rowsRaw = Array.isArray(r.rows) ? r.rows : [];
      const rows = rowsRaw
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => row.map((cell) => String(cell)));
      if (headers.length === 0 || rows.length === 0) return null;
      const block: LessonBlock = { __component: 'lesson.table', id, headers, rows };
      if (typeof r.caption === 'string' && r.caption.trim()) {
        block.caption = truncate(r.caption.trim(), CAPTION_MAX);
      }
      return block;
    }

    case 'degree-chips': {
      const degrees = Array.isArray(r.degrees) ? r.degrees.map((d) => String(d)) : [];
      if (degrees.length === 0) return null;
      const block: LessonBlock = { __component: 'lesson.degree-chips', id, degrees };
      if (r.size === 'sm' || r.size === 'md') block.size = r.size;
      return block;
    }

    // Covers unknown/missing `type`, and any block outside the six this
    // pipeline is allowed to emit (e.g. a stray "diagram").
    default:
      return null;
  }
}

function isModelHeadingBlock(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'heading';
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

/**
 * Generates a lesson body from the video library. Does NOT persist —
 * callers (an in-app server function, an MCP tool) own saving the result
 * and deduping `slug` against existing lessons.
 */
export async function generateLesson(
  input: GenerateLessonInput,
): Promise<GenerateLessonResult> {
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
  // lesson-model.ts). Every chat() call below uses this same adapter, so a
  // lesson never mixes tiers mid-generation.
  const lessonModel = resolveLessonModel();
  logPhase(topic, `model ✓ ${lessonModel.tier}`, { model: lessonModel.model });

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
    if (err instanceof BackendUnreachableError) return { ok: false, error: message };
    return { ok: false, error: friendlyOllamaError(message) };
  }

  if (allRanked.length === 0) {
    logPhase(topic, 'retrieve ✗ no videos with embeddings');
    return {
      ok: false,
      error:
        'No videos in the library have embeddings yet — generate summaries first, then retry.',
    };
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
    return {
      ok: false,
      error: `The library doesn't have enough videos closely related to "${topic}" to build a lesson — nothing scored above the relevance floor. Try a broader topic, or add more videos on this subject.`,
    };
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
          logPhase(topic, `coverage ↻ retry ${attempt}/1 in ${delayMs}ms`, {
            cause: redactAnthropicKey(err instanceof Error ? err.message : 'unknown'),
          });
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
    return { ok: false, error: friendlyModelError(lessonModel.tier, message) };
  }

  if (!coverage) {
    // Model failure (unusable shape) is never permission to continue — see
    // the header comment above this step.
    logPhase(topic, 'coverage ✗ unusable verdict shape — refusing rather than proceeding');
    return {
      ok: false,
      error: `Could not verify whether the library actually covers "${topic}" — refusing rather than risk generating a lesson from the wrong material. Try again, or rephrase the topic.`,
    };
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
    return {
      ok: false,
      error: `The library doesn't actually cover "${topic}".${closest}${reasonSuffix} Try a topic closer to what the library has, or add videos on "${topic}".`,
    };
  }
  logPhase(topic, 'coverage ✓ sources cover the topic');

  // --- 2: digest — cached reuse, or synthesize (never persist) ----------
  const youtubeVideoIds = ranked.map((r) => r.video.youtubeVideoId);
  const digestResolution = await getOrCreateDigest(topic, youtubeVideoIds);
  if (!digestResolution.ok) {
    return { ok: false, error: friendlyOllamaError(digestResolution.error) };
  }
  const { digest, fullVideos } = digestResolution;

  // --- 3: context ---------------------------------------------------------
  const contextText = fullVideos.map((v) => buildVideoContextText(v)).join('\n');
  const digestContextText = buildDigestContextText(digest);

  const validVideoIds = new Set(fullVideos.map((v) => v.youtubeVideoId));
  const bm25ByVideoId = new Map<string, BM25Index>();
  for (const v of fullVideos) {
    const stored = loadStoredIndex(v.transcriptSegments);
    if (stored) bm25ByVideoId.set(v.youtubeVideoId, stored.bm25);
  }
  const ground: GroundingContext = { validVideoIds, bm25ByVideoId };

  // --- 4: outline -------------------------------------------------------------
  let outline: LessonOutline | null;
  try {
    const raw = await withRetry(
      () =>
        chat({
          adapter: lessonModel.adapter,
          messages: [
            { role: 'system', content: OUTLINE_SYSTEM_WITH_GUIDE },
            {
              role: 'user',
              content: buildOutlinePrompt(topic, contextText, digestContextText),
            },
          ] as never,
          outputSchema: LessonOutlineSchema,
          modelOptions: buildModelOptions(lessonModel, 0.3),
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(topic, `outline ↻ retry ${attempt}/1 in ${delayMs}ms`, {
            cause: redactAnthropicKey(err instanceof Error ? err.message : 'unknown'),
          });
        },
      },
    );
    outline = sanitizeOutline(raw);
  } catch (err) {
    const message = redactAnthropicKey(
      err instanceof Error ? err.message : 'Lesson outline generation failed',
    );
    logPhase(topic, 'outline ✗ failed', { error: message });
    return { ok: false, error: friendlyModelError(lessonModel.tier, message) };
  }

  if (!outline) {
    logPhase(topic, 'outline ✗ unusable shape');
    return { ok: false, error: 'The model returned an unusable lesson outline.' };
  }
  // See MIN_OUTLINE_SECTIONS's own comment for why this isn't a hard
  // failure — a 1-section outline still generates, but it's worth knowing
  // it happened, not discovering it by reading a suspiciously short lesson
  // later.
  if (outline.sections.length < MIN_OUTLINE_SECTIONS) {
    logPhase(topic, `outline ⚠ thin (${outline.sections.length} section(s), target ≥${MIN_OUTLINE_SECTIONS})`, {
      title: outline.title,
    });
  }
  logPhase(topic, 'outline ✓', {
    title: outline.title,
    sections: outline.sections.length,
  });

  // --- 5: sections --------------------------------------------------------
  let blockId = 1;
  const body: LessonBlock[] = [];
  let succeededSections = 0;

  for (const section of outline.sections) {
    try {
      const raw = await withRetry(
        () =>
          chat({
            adapter: lessonModel.adapter,
            messages: [
              { role: 'system', content: SECTION_SYSTEM_WITH_GUIDE },
              {
                role: 'user',
                content: buildSectionPrompt(outline as LessonOutline, section, contextText),
              },
            ] as never,
            outputSchema: SectionBlocksSchema,
            modelOptions: buildModelOptions(lessonModel, 0.4),
          }),
        {
          attempts: 2,
          onRetry: (err, attempt, delayMs) => {
            logPhase(topic, `section "${section.heading}" ↻ retry ${attempt}/1 in ${delayMs}ms`, {
              cause: redactAnthropicKey(err instanceof Error ? err.message : 'unknown'),
            });
          },
        },
      );

      const rawBlocks = Array.isArray((raw as { blocks?: unknown })?.blocks)
        ? (raw as { blocks: unknown[] }).blocks
        : [];

      // Build the section's content blocks WITHOUT committing them to
      // `body` yet — the heading is only injected once we know the section
      // actually produced usable content, so a failed section never leaves
      // an orphan heading with nothing under it.
      const sectionBlocks: LessonBlock[] = [];
      let nextId = blockId + 1; // id 0 (blockId) reserved for the heading
      for (const rawBlock of rawBlocks) {
        // The model is instructed not to emit a heading; if it does anyway,
        // drop it — the outline's heading is injected below, never this one.
        if (isModelHeadingBlock(rawBlock)) continue;
        const block = toLessonBlock(rawBlock, nextId, ground);
        if (!block) continue;
        sectionBlocks.push(block);
        nextId += 1;
      }

      // Only "zero usable blocks" fails the section outright (same bar as
      // before this comment existed) — a single-block section is thin
      // relative to MIN_SECTION_BLOCKS (see SectionBlocksSchema's comment
      // for why that target can't be a schema `.min()` on the frontier
      // tier), but it's still real, grounded content; dropping a whole
      // section over a 1-vs-2 block count would throw away content for a
      // quantity target, not a correctness one — the same call made for
      // sanitizeOutline's section count above. Logged as thin instead, so
      // it's visible rather than silently accepted.
      if (sectionBlocks.length > 0 && sectionBlocks.length < MIN_SECTION_BLOCKS) {
        logPhase(topic, `section "${section.heading}" ⚠ thin (${sectionBlocks.length} block, target ≥${MIN_SECTION_BLOCKS})`);
      }
      if (sectionBlocks.length > 0) {
        body.push(
          {
            __component: 'lesson.heading',
            id: blockId,
            text: truncate(section.heading, 150),
            level: 'h2',
          },
          ...sectionBlocks,
        );
        blockId = nextId;
        succeededSections += 1;
        logPhase(topic, `section "${section.heading}" ✓`, { blocks: sectionBlocks.length });
      } else {
        logPhase(topic, `section "${section.heading}" ⚠ too few usable blocks, dropping`, {
          rawCount: rawBlocks.length,
          usableCount: sectionBlocks.length,
          minRequired: MIN_SECTION_BLOCKS,
        });
      }
    } catch (err) {
      // Single-section failure is non-fatal: drop it and keep going. Only
      // "every section failed" (checked below) fails the whole run.
      logPhase(topic, `section "${section.heading}" ✗ failed, dropping`, {
        error: redactAnthropicKey(err instanceof Error ? err.message : 'unknown'),
      });
    }
  }

  if (succeededSections === 0 || body.length === 0) {
    logPhase(topic, '✗ every section failed — no usable body');
    return {
      ok: false,
      error: friendlyModelError(lessonModel.tier, 'Every lesson section failed to generate.'),
    };
  }

  // --- 6: assemble ----------------------------------------------------------
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
    body,
  };

  logPhase(topic, '✓ generation complete', {
    sections: `${succeededSections}/${outline.sections.length}`,
    blocks: body.length,
    tier: lessonModel.tier,
    model: lessonModel.model,
  });

  return { ok: true, lesson, sources, tier: lessonModel.tier, model: lessonModel.model };
}
