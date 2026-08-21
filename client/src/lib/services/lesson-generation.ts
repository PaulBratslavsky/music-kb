// AI lesson generation — builds a Strapi-shaped lesson body from the video
// library, staged as several SMALL model calls instead of one big one.
//
// Why staged, not one shot: a local model cannot reliably emit a 20-block
// lesson body as a single JSON object — it drifts, drops fields, or produces
// invalid enum values, and the failure is silent (the block just doesn't
// render, see LessonBody.tsx's `default: return null`). So the pipeline
// asks for a SMALL structured result at every step:
//
//   1. retrieve — embed the topic, cosine over stored video embeddings, top N
//   2. context  — title + summary + musicExtraction per retrieved video
//   3. outline  — ONE chat() call → { title, summary, level, sections[] }
//   4. sections — ONE chat() call PER section → 2-4 blocks each
//   5. assemble — flatten to LessonBlock[], dropping anything invalid
//
// This mirrors the map-reduce shape in learning.ts (many small model calls,
// one deterministic assembly step) and the structured-extraction shape in
// music-extraction.ts (schema-validated but content-untrusted, sanitized
// after the fact). Persistence is NOT this module's job — the caller (an
// in-app server function or an MCP tool, both built later) saves the result.

import { chat } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { z } from 'zod';
import { OLLAMA_HOST, OLLAMA_MODEL } from '#/lib/env';
import { withRetry } from '#/lib/retry';
import { cosineSimilarity, embedText } from '#/lib/services/embeddings';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';
import { samplingOptions } from '#/lib/services/ollama-model-options';
import {
  buildMusicExtractionText,
  listAllVideosForEmbeddingService,
  type StrapiVideo,
} from '#/lib/services/videos';
import type { LessonBlock } from '#/lib/services/lessons';

const ollamaAdapter = createOllamaChat(OLLAMA_MODEL, OLLAMA_HOST);

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
  | { ok: true; lesson: GeneratedLesson; sources: SourceVideo[] }
  | { ok: false; error: string };

// -----------------------------------------------------------------------------
// Step 1+2: retrieve + context
// -----------------------------------------------------------------------------

const DEFAULT_MAX_VIDEOS = 5;

// Keeps every prompt in this pipeline small — a per-video context card, not
// the whole summary. Consistent with the "small structured calls" design:
// lean input, lean output.
const CONTEXT_SNIPPET_MAX_CHARS = 400;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function buildVideoContextText(v: StrapiVideo): string {
  const title = v.summaryTitle ?? v.videoTitle ?? 'Untitled video';
  const desc = v.summaryDescription ?? v.summaryOverview ?? '';
  const music = buildMusicExtractionText(v.musicExtraction);
  const lines = [`- "${title}"`];
  if (desc.trim()) lines.push(`  ${truncate(desc.trim(), CONTEXT_SNIPPET_MAX_CHARS)}`);
  if (music) lines.push(`  ${music.split('\n').join(' | ')}`);
  return lines.join('\n');
}

type RankedVideo = { video: StrapiVideo; score: number };

async function retrieveSourceVideos(
  topic: string,
  maxVideos: number,
): Promise<RankedVideo[]> {
  const queryVec = await embedText(topic, 'query');
  const all = await listAllVideosForEmbeddingService();
  const withEmbeddings = all.filter(
    (v) => Array.isArray(v.summaryEmbedding) && v.summaryEmbedding.length > 0,
  );
  return withEmbeddings
    .map((video) => ({
      video,
      score: cosineSimilarity(queryVec, video.summaryEmbedding as number[]),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxVideos);
}

// -----------------------------------------------------------------------------
// Step 3: outline — one small structured call
// -----------------------------------------------------------------------------

const LessonOutlineSchema = z.object({
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
    .min(2)
    .max(6)
    .describe('2 to 6 teaching beats, in the order the lesson should cover them.'),
});

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
  '`instrument` should reflect what the sources are teaching (guitar/piano/push), or "any" when the lesson is instrument-agnostic theory.',
].join('\n');

function buildOutlinePrompt(topic: string, contextText: string): string {
  return [
    `Topic: ${topic}`,
    '',
    'Source videos (ground the lesson in these — do not invent content beyond them):',
    contextText,
  ].join('\n');
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
  if (sections.length === 0) return null;

  return { title, summary, level, instrument, duration, sections };
}

// -----------------------------------------------------------------------------
// Step 4: sections — one small structured call PER section
// -----------------------------------------------------------------------------

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
  }),
  z.object({
    type: z.literal('callout'),
    tone: z.enum(['note', 'tip', 'warning']),
    body: z.string().describe('One short aside. MAX 500 characters.'),
  }),
  z.object({
    type: z.literal('step'),
    number: z.number().int().min(1),
    title: z.string().describe('Verb-led short step title. MAX 120 characters.'),
    lede: z.string().nullable().describe('One-sentence lede, or null.'),
    body: z.string().nullable().describe('Step detail (markdown), or null.'),
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

const SectionBlocksSchema = z.object({
  blocks: z.array(LessonBlockOutputSchema).min(2).max(4),
});

const SECTION_SYSTEM = [
  'You write ONE section of a music lesson as 2 to 4 short structured blocks.',
  'Allowed block types: heading, prose, callout, step, table, degree-chips. Never use any other type — a diagram/keyboard-diagram block is NOT available in this pipeline.',
  'Start with a `heading` block (level "h2") whose `text` is EXACTLY the section heading you are given — copy it verbatim, do not paraphrase.',
  'Then add 1 to 3 more blocks that teach the section goal. Use `step` for sequenced instructions, `table` for comparisons, `degree-chips` for scale-degree sequences, `callout` for a short aside, `prose` for everything else.',
  'Ground content in the provided source videos. Do not invent chords, keys, techniques, or songs the sources do not mention.',
].join('\n');

function buildSectionPrompt(
  outline: LessonOutline,
  section: { heading: string; goal: string },
  contextText: string,
): string {
  return [
    `Lesson: "${outline.title}" — ${outline.summary}`,
    '',
    `This section's heading (copy verbatim into the heading block): "${section.heading}"`,
    `This section's goal: ${section.goal}`,
    '',
    'Source videos (ground this section in these):',
    contextText,
  ].join('\n');
}

// Truncate on a hard boundary (no ellipsis) — captions are short labels, not
// prose, so an ellipsis reads oddly. Matches the brief's "truncate, don't
// fail" rule for the 255-char Strapi `string` cap on `caption`.
const CAPTION_MAX = 255;

// Validates + coerces ONE raw block from the model into a LessonBlock, or
// drops it. Deliberately does NOT trust that `raw` matches
// LessonBlockOutputSchema's inferred type — `chat()` only enforces that
// against a live Ollama call; here we treat the value as fully untrusted
// content (same stance as sanitizeMusicExtraction / sanitizeSummary).
// Returns null for anything that fails validation, including block types
// outside the six this pipeline is allowed to emit (lesson.diagram /
// lesson.keyboard-diagram never come out of here even if the model tries).
function toLessonBlock(raw: unknown, id: number): LessonBlock | null {
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
      return { __component: 'lesson.prose', id, body };
    }

    case 'callout': {
      const body = typeof r.body === 'string' ? r.body.trim() : '';
      if (!body) return null;
      const tone = r.tone === 'tip' || r.tone === 'warning' ? r.tone : 'note';
      return { __component: 'lesson.callout', id, tone, body };
    }

    case 'step': {
      const title = typeof r.title === 'string' ? r.title.trim() : '';
      if (!title) return null;
      const numberRaw = Number(r.number);
      const number = Number.isFinite(numberRaw) && numberRaw >= 1 ? Math.floor(numberRaw) : 1;
      const block: LessonBlock = { __component: 'lesson.step', id, number, title };
      const lede = typeof r.lede === 'string' ? r.lede.trim() : '';
      if (lede) block.lede = lede;
      const body = typeof r.body === 'string' ? r.body.trim() : '';
      if (body) block.body = body;
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

// -----------------------------------------------------------------------------
// Step 5: orchestrate
// -----------------------------------------------------------------------------

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'lesson';
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
  const maxVideos =
    typeof input.maxVideos === 'number' && input.maxVideos > 0
      ? input.maxVideos
      : DEFAULT_MAX_VIDEOS;

  // --- 1+2: retrieve + context ----------------------------------------------
  let ranked: RankedVideo[];
  try {
    ranked = await retrieveSourceVideos(topic, maxVideos);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Retrieval failed';
    logPhase(topic, 'retrieve ✗ failed', { error: message });
    return { ok: false, error: friendlyOllamaError(message) };
  }

  if (ranked.length === 0) {
    logPhase(topic, 'retrieve ✗ no videos with embeddings');
    return {
      ok: false,
      error:
        'No videos in the library have embeddings yet — generate summaries first, then retry.',
    };
  }

  const sources: SourceVideo[] = ranked.map((r) => ({
    documentId: r.video.documentId,
    youtubeVideoId: r.video.youtubeVideoId,
    title: r.video.summaryTitle ?? r.video.videoTitle,
    score: r.score,
  }));
  const contextText = ranked.map((r) => buildVideoContextText(r.video)).join('\n');
  logPhase(topic, 'retrieve ✓', {
    videos: sources.length,
    top: sources[0]?.title ?? null,
  });

  // --- 3: outline -------------------------------------------------------------
  let outline: LessonOutline | null;
  try {
    const raw = await withRetry(
      () =>
        chat({
          adapter: ollamaAdapter,
          messages: [
            { role: 'system', content: OUTLINE_SYSTEM },
            { role: 'user', content: buildOutlinePrompt(topic, contextText) },
          ] as never,
          outputSchema: LessonOutlineSchema,
          modelOptions: samplingOptions(OLLAMA_MODEL, 0.3),
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(topic, `outline ↻ retry ${attempt}/1 in ${delayMs}ms`, {
            cause: err instanceof Error ? err.message : 'unknown',
          });
        },
      },
    );
    outline = sanitizeOutline(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lesson outline generation failed';
    logPhase(topic, 'outline ✗ failed', { error: message });
    return { ok: false, error: friendlyOllamaError(message) };
  }

  if (!outline) {
    logPhase(topic, 'outline ✗ unusable shape');
    return { ok: false, error: 'The model returned an unusable lesson outline.' };
  }
  logPhase(topic, 'outline ✓', {
    title: outline.title,
    sections: outline.sections.length,
  });

  // --- 4: sections --------------------------------------------------------
  let blockId = 1;
  const body: LessonBlock[] = [];
  let succeededSections = 0;

  for (const section of outline.sections) {
    try {
      const raw = await withRetry(
        () =>
          chat({
            adapter: ollamaAdapter,
            messages: [
              { role: 'system', content: SECTION_SYSTEM },
              {
                role: 'user',
                content: buildSectionPrompt(outline as LessonOutline, section, contextText),
              },
            ] as never,
            outputSchema: SectionBlocksSchema,
            modelOptions: samplingOptions(OLLAMA_MODEL, 0.4),
          }),
        {
          attempts: 2,
          onRetry: (err, attempt, delayMs) => {
            logPhase(topic, `section "${section.heading}" ↻ retry ${attempt}/1 in ${delayMs}ms`, {
              cause: err instanceof Error ? err.message : 'unknown',
            });
          },
        },
      );

      const rawBlocks = Array.isArray((raw as { blocks?: unknown })?.blocks)
        ? (raw as { blocks: unknown[] }).blocks
        : [];

      let addedInSection = 0;
      for (const rawBlock of rawBlocks) {
        const block = toLessonBlock(rawBlock, blockId);
        if (!block) continue;
        body.push(block);
        blockId += 1;
        addedInSection += 1;
      }

      if (addedInSection > 0) {
        succeededSections += 1;
        logPhase(topic, `section "${section.heading}" ✓`, { blocks: addedInSection });
      } else {
        logPhase(topic, `section "${section.heading}" ⚠ zero usable blocks`, {
          rawCount: rawBlocks.length,
        });
      }
    } catch (err) {
      // Single-section failure is non-fatal: drop it and keep going. Only
      // "every section failed" (checked below) fails the whole run.
      logPhase(topic, `section "${section.heading}" ✗ failed, dropping`, {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  if (succeededSections === 0 || body.length === 0) {
    logPhase(topic, '✗ every section failed — no usable body');
    return {
      ok: false,
      error: friendlyOllamaError('Every lesson section failed to generate.'),
    };
  }

  // --- 5: assemble ----------------------------------------------------------
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
  });

  return { ok: true, lesson, sources };
}
