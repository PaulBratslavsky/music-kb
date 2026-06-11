import { chat } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { z } from 'zod';
import {
  createTranscriptService,
  fetchTranscriptByVideoIdService,
  fetchVideoByVideoIdService,
  linkVideoToTranscriptService,
  markSummaryFailedService,
  updateVideoSummaryService,
  type StrapiTranscript,
  type StrapiVideo,
} from '#/lib/services/videos';
import {
  buildBM25Index,
  chunkForRetrieval,
  chunkForSummary,
  cleanTranscript,
  estimateTokens,
  findEvidenceForQuote,
  loadStoredIndex,
  makeSectionContextualizer,
  prepareSegmentedTranscript,
  searchBM25,
  type PreparedTranscript,
  type StoredTranscriptIndex,
  type TimedTextSegment,
  type TranscriptChunk,
} from '#/lib/services/transcript';
import { getChatEvidenceForVideo } from '#/lib/services/chat-retrieval';
import {
  setStep as setGenerationStep,
  type GenerationStep,
} from '#/lib/services/generation-state';
import {
  aggregateSignalScore,
  computeSignalScores,
} from '#/lib/services/content-signals';
import { withRetry } from '#/lib/retry';
import { fetchYouTubeTranscript } from '#/lib/services/youtube-transcript';
import {
  MAP_CONCURRENCY,
  OLLAMA_HOST,
  OLLAMA_MODEL as SUMMARY_MODEL,
  OLLAMA_CHAT_MODEL as CHAT_MODEL,
  TRANSCRIPT_PROXY_URL,
} from '#/lib/env';

// TanStack AI Ollama adapters. Two separate adapters because SUMMARY_MODEL
// and CHAT_MODEL can differ (you might want a bigger model for summaries
// and a faster one for chat). Each one keeps its own HTTP client.
const ollamaAdapter = createOllamaChat(SUMMARY_MODEL, OLLAMA_HOST);
const ollamaAdapterChat = createOllamaChat(CHAT_MODEL, OLLAMA_HOST);

type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

// Server-side progress logging. Lands in the terminal running `yarn dev`.
// Keep output single-line + structured so it greps well and you can see a
// whole generation run at a glance without toggling log levels.
function logPhase(
  videoId: string,
  phase: string,
  extra?: Record<string, unknown>,
) {
  const ts = new Date().toISOString().slice(11, 23);
  const body = extra ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [summary ${videoId}] ${phase}${body}`);
}

function ms(start: number): string {
  return `${Math.round(performance.now() - start)}ms`;
}

// -----------------------------------------------------------------------------
// Transcript fetch (self-contained — uses youtubei.js directly against
// YouTube's public caption tracks; no external service dependency).
// -----------------------------------------------------------------------------

type TranscriptData = {
  transcript: string;
  upstreamTitle?: string;
  language: string;
  videoId: string;
  // Real video duration in seconds as returned by youtubei.js. `null` on
  // the rare case it couldn't be resolved — chunkers then fall back to the
  // 150-wpm estimate.
  durationSec: number | null;
  // Caption segments with millisecond-precise start times. Preserved so
  // chunkers can assign real `timeSec` values instead of linear-interp
  // estimates. `null` means we never got them (old pipeline path).
  segments: TimedTextSegment[] | null;
  // Derived in-memory from `segments` in the orchestrator. Not persisted.
  // When present, downstream chunkers use it to pull exact timecodes per
  // word; when absent they fall back to linear-interp math.
  prepared?: PreparedTranscript | null;
};

async function fetchTranscript(videoId: string): Promise<ServiceResult<TranscriptData>> {
  const started = performance.now();
  logPhase(videoId, 'transcript → fetching', {
    source: 'youtubei.js',
    proxy: TRANSCRIPT_PROXY_URL ? 'on' : 'off',
  });

  try {
    const result = await withRetry(
      () => fetchYouTubeTranscript(videoId, { proxyUrl: TRANSCRIPT_PROXY_URL }),
      {
        attempts: 3,
        onRetry: (err, attempt, delayMs) => {
          const cause = err instanceof Error ? err.message : 'network error';
          logPhase(videoId, `transcript ↻ retry ${attempt}/2 in ${delayMs}ms`, {
            cause,
          });
        },
      },
    );
    logPhase(videoId, 'transcript ✓ fetched', {
      chars: result.fullTranscript.length,
      segments: result.segments.length,
      durationSec: result.durationSec,
      took: ms(started),
    });
    return {
      success: true,
      data: {
        transcript: result.fullTranscript,
        upstreamTitle: result.title,
        language: 'en',
        videoId,
        durationSec: result.durationSec,
        // Map youtubei.js segment shape → our in-pipeline shape so
        // transcript.ts doesn't import from the YouTube-specific module.
        segments: result.segments.map((s) => ({
          text: s.text,
          startMs: s.start,
          endMs: s.end,
        })),
      },
    };
  } catch (err) {
    const cause = err instanceof Error ? err.message : 'unknown error';
    logPhase(videoId, 'transcript ✗ failed', { cause, took: ms(started) });
    return {
      success: false,
      error: `Couldn't fetch transcript: ${cause}`,
    };
  }
}

// Build a `TranscriptData` from a persisted Strapi Transcript row. No
// network call — this is the fast-path for every regeneration after the
// initial share (once a Transcript is saved, we never hit YouTube again
// unless forceRefetch is passed).
async function loadTranscriptFromStrapi(
  videoId: string,
  row: StrapiTranscript,
): Promise<ServiceResult<TranscriptData>> {
  const segments: TimedTextSegment[] = (row.rawSegments ?? []).map((s) => ({
    text: s.text,
    startMs: s.startMs,
    endMs: s.endMs,
  }));
  logPhase(videoId, 'transcript ✓ loaded from Strapi', {
    segments: segments.length,
    durationSec: row.durationSec,
    transcriptDocumentId: row.documentId,
  });
  const transcript = row.rawText ?? segments.map((s) => s.text).join(' ');
  return {
    success: true,
    data: {
      transcript,
      upstreamTitle: row.title ?? undefined,
      language: row.language ?? 'en',
      videoId,
      durationSec: row.durationSec ?? null,
      segments,
    },
  };
}

// -----------------------------------------------------------------------------
// YouTube oEmbed (no API key)
// -----------------------------------------------------------------------------

type OEmbedResponse = {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
};

export type VideoMeta = {
  title?: string;
  author?: string;
  thumbnailUrl?: string;
};

export async function fetchYouTubeMeta(videoId: string): Promise<VideoMeta> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}&format=json`;
    const res = await fetch(url);
    if (!res.ok) return {};
    const json = (await res.json()) as OEmbedResponse;
    return {
      title: json.title,
      author: json.author_name,
      thumbnailUrl: json.thumbnail_url,
    };
  } catch {
    return {};
  }
}

// (Duration now comes from `fetchYouTubeTranscript` via `info.basic_info.duration`
// — no separate HTML scrape needed.)

// -----------------------------------------------------------------------------
// AI summary generation
// -----------------------------------------------------------------------------

const SummarySchema = z.object({
  title: z
    .string()
    .describe('Short punchy title for the summary. MAX 200 characters. Not a sentence.'),
  description: z
    .string()
    .describe(
      'One-sentence subtitle describing what the viewer will learn. MAX 500 characters.',
    ),
  watchVerdict: z
    .enum(['skip', 'skim', 'worth_it'])
    .describe(
      'Overall recommendation on whether to watch the full video. "worth_it" = dense with specific, actionable information the summary cannot fully replace. "skim" = some useful parts but also filler or well-known material; the summary plus spot-watching covers most of it. "skip" = mostly generic advice; the summary is enough.',
    ),
  verdictSummary: z
    .string()
    .describe(
      'ONE sentence, MAX 280 characters. Format: "Worth it if you care about X. Skip if you already know Y." Be specific about X and Y — do not write generic filler.',
    ),
  verdictReason: z
    .string()
    .describe(
      '2-4 sentences explaining the verdict. Cover what the video does well, what it assumes you already know, and who the ideal viewer is. MAX 1000 characters. No markdown.',
    ),
  valueScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'Integer 0-100 reflecting signal-to-noise of the video. RUBRIC: 0–25 = mostly fluff/padding (sponsor reads, tangents, repetition, no concrete claims). 26–55 = mixed signal — some value but lots to skim. 56–80 = solid, specific information; worth the time if you care about the topic. 81–100 = exceptional density and specificity (rare; only for end-to-end actionable, original videos). Score MUST agree with watchVerdict: <26 → skip, 26–55 → skim, ≥56 → worth_it.',
    ),
  overview: z
    .string()
    .describe(
      'Markdown TL;DR — one or two paragraphs. Do NOT duplicate the key takeaways or sections here.',
    ),
  keyTakeaways: z
    .array(z.object({ text: z.string() }))
    .describe(
      '3 to 7 punchy bullets, ONE SHORT SENTENCE EACH (MAX 280 characters, hard limit). No markdown. Each bullet is a single idea, not a paragraph.',
    ),
  sections: z
    .array(
      z.object({
        heading: z
          .string()
          .describe('Short section heading. MAX 200 characters.'),
        body: z
          .string()
          .describe(
            'Markdown body of the section. MAX 2000 characters. Focus on what was said in this section. Do NOT emit timecodes — they are added deterministically after generation.',
          ),
      }),
    )
    .min(2)
    .max(15)
    .describe(
      'Sections capturing narrative beats of the video, IN CHRONOLOGICAL ORDER from the start to the end of the video. The FIRST section must cover opening content (near 0:00); the LAST section must cover content near the end of the video\'s duration. Sections in between space evenly across the timeline. Target ~1 section per 10 minutes of duration. Break multi-part topics into SEPARATE sections, one per part (e.g., "Three Stages: Discovery, Authentication, Communication" = THREE sections, not one section with three bullets). Prefer shorter, more granular sections over one long one. Minimum 2, maximum 15.',
    ),
  actionSteps: z
    .array(
      z.object({
        title: z
          .string()
          .describe('Verb-led short title. MAX 120 characters.'),
        body: z.string().describe('Step detail. MAX 600 characters.'),
      }),
    )
    .describe('2 to 5 concrete steps the reader can follow this week.'),
});

export type GeneratedSummary = z.infer<typeof SummarySchema>;

// Strapi component/field limits. Must match:
//   - Video schema:                summaryTitle 200, summaryDescription 500
//   - components/content/*.json:   takeaway.text 280, section.heading 200,
//                                  section.body 2000, action-step.title 120,
//                                  action-step.body 600
// The Zod schema *describes* these limits so the model usually respects
// them, but local models drift. We clamp on the client before saving so a
// single long takeaway doesn't fail the entire generation run — Strapi
// returns 400 on any violation and rejects the whole document.
const LIMITS = {
  summaryTitle: 200,
  summaryDescription: 500,
  verdictSummary: 280,
  verdictReason: 1000,
  takeawayText: 280,
  sectionHeading: 200,
  sectionBody: 2000,
  actionStepTitle: 120,
  actionStepBody: 600,
} as const;

// Truncate on a word boundary with an ellipsis if possible, hard-cut
// otherwise. Keeps the tail readable instead of chopping mid-word.
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const window = text.slice(0, max - 1); // leave room for "…"
  const lastSpace = window.lastIndexOf(' ');
  const boundary = lastSpace > max * 0.6 ? lastSpace : window.length;
  return `${window.slice(0, boundary).trimEnd()}…`;
}

function sanitizeSummary(
  videoId: string,
  raw: GeneratedSummary,
): GeneratedSummary {
  const overflows: string[] = [];
  const note = (field: string, was: number, max: number) => {
    overflows.push(`${field} ${was}→${max}`);
  };

  const title = raw.title.length > LIMITS.summaryTitle
    ? (note('title', raw.title.length, LIMITS.summaryTitle),
      clamp(raw.title, LIMITS.summaryTitle))
    : raw.title;
  const description = raw.description.length > LIMITS.summaryDescription
    ? (note('description', raw.description.length, LIMITS.summaryDescription),
      clamp(raw.description, LIMITS.summaryDescription))
    : raw.description;

  const verdictSummary = raw.verdictSummary.length > LIMITS.verdictSummary
    ? (note('verdictSummary', raw.verdictSummary.length, LIMITS.verdictSummary),
      clamp(raw.verdictSummary, LIMITS.verdictSummary))
    : raw.verdictSummary;
  const verdictReason = raw.verdictReason.length > LIMITS.verdictReason
    ? (note('verdictReason', raw.verdictReason.length, LIMITS.verdictReason),
      clamp(raw.verdictReason, LIMITS.verdictReason))
    : raw.verdictReason;

  const keyTakeaways = raw.keyTakeaways.map((t, i) => {
    if (t.text.length <= LIMITS.takeawayText) return t;
    note(`keyTakeaways[${i}]`, t.text.length, LIMITS.takeawayText);
    return { text: clamp(t.text, LIMITS.takeawayText) };
  });

  const sections = raw.sections.map((s, i) => {
    const heading = s.heading.length > LIMITS.sectionHeading
      ? (note(`sections[${i}].heading`, s.heading.length, LIMITS.sectionHeading),
        clamp(s.heading, LIMITS.sectionHeading))
      : s.heading;
    const body = s.body.length > LIMITS.sectionBody
      ? (note(`sections[${i}].body`, s.body.length, LIMITS.sectionBody),
        clamp(s.body, LIMITS.sectionBody))
      : s.body;
    return { ...s, heading, body };
  });

  const actionSteps = raw.actionSteps.map((a, i) => {
    const t = a.title.length > LIMITS.actionStepTitle
      ? (note(`actionSteps[${i}].title`, a.title.length, LIMITS.actionStepTitle),
        clamp(a.title, LIMITS.actionStepTitle))
      : a.title;
    const b = a.body.length > LIMITS.actionStepBody
      ? (note(`actionSteps[${i}].body`, a.body.length, LIMITS.actionStepBody),
        clamp(a.body, LIMITS.actionStepBody))
      : a.body;
    return { title: t, body: b };
  });

  if (overflows.length > 0) {
    logPhase(videoId, 'ai ↳ clamped over-length fields before save', {
      overflows,
    });
  }

  // Cross-check: model is supposed to keep `valueScore` and `watchVerdict`
  // in agreement. Local 4B–8B models occasionally drift (e.g. emit
  // worth_it with a score of 40). We log the disagreement but don't
  // block — the verdict is the LLM's primary call; the score will be
  // off by one band in those cases. Used for prompt-tuning telemetry.
  const expectedBand =
    raw.valueScore < 26 ? 'skip' : raw.valueScore < 56 ? 'skim' : 'worth_it';
  if (expectedBand !== raw.watchVerdict) {
    logPhase(videoId, 'ai ⚠ valueScore↔watchVerdict mismatch', {
      score: raw.valueScore,
      verdict: raw.watchVerdict,
      expectedBand,
    });
  }

  return {
    ...raw,
    title,
    description,
    verdictSummary,
    verdictReason,
    keyTakeaways,
    sections,
    actionSteps,
  };
}

// Single-pass budget. If the cleaned transcript fits within this many tokens
// Lowered from 25K → 15K: at 25K, 100-minute videos (~22K tokens) squeezed
// into single-pass with <10K headroom for system prompt + structured output
// against num_ctx=32768, producing shallow sections. At 15K the cutover sits
// around ~60 minutes, which map-reduce handles with more coherent per-section
// attention.
const SINGLE_PASS_TOKEN_BUDGET = 15_000;

const SUMMARY_SYSTEM = [
  'You summarize YouTube videos for a personal knowledge base, producing structured notes someone can act on instead of rewatching.',
  'Be specific and evidence-oriented. Avoid marketing fluff, generic advice, and sentence-length filler.',
  '',
  'WATCH VERDICT — you must produce an honest "should I watch this?" judgement:',
  ' • watchVerdict=worth_it — the video contains specific, dense, actionable information the summary alone cannot fully replace.',
  ' • watchVerdict=skim — mix of useful parts and filler/well-known material. Summary plus spot-watching covers most of it.',
  ' • watchVerdict=skip — mostly generic advice or surface-level content. The summary is enough.',
  ' • verdictSummary — ONE sentence, format "Worth it if you care about X. Skip if you already know Y." Be specific about X and Y. No hedging like "it depends."',
  ' • verdictReason — 2-4 sentences on what the video does well, what it assumes you already know, and who the ideal viewer is.',
  ' • valueScore — integer 0-100 with this rubric:',
  '     0–25  = mostly fluff/padding (sponsor reads, tangents, repetition, no concrete claims) — corresponds to skip',
  '    26–55  = mixed signal — some useful parts but lots to skim — corresponds to skim',
  '    56–80  = solid, specific, actionable information — corresponds to worth_it',
  '    81–100 = exceptional density and specificity (rare — reserve for videos that are dense, original, AND end-to-end actionable)',
  '   The valueScore MUST agree with the watchVerdict band — these are two views of the same judgment, not independent signals.',
  ' • Judge the VIDEO ITSELF, not the topic. A well-known topic with dense novel framing = worth_it. A niche topic delivered as generic tips = skip.',
  '',
  'IMPORTANT — Do NOT emit timecodes. Leave `section.timeSec` unset (omit the field). Do not write `[mm:ss]` or `(mm:ss)` anywhere in section headings or bodies. Timecodes are recovered deterministically after your output via a transcript-match pass — if you try to produce them yourself they will be discarded.',
  '',
  'SECTION COVERAGE — sections must span the video from start to finish:',
  ' • First section = content near the start of the video.',
  ' • Last section = content near the end of the video.',
  ' • Intermediate sections space evenly along the timeline.',
  ' • Break multi-stage/multi-step topics into SEPARATE sections (one per step), not one section with nested bullets.',
  '',
  'Focus on: accurate heading that captures the section topic, and body prose that describes what was said (using the speaker\'s own terminology where possible — do not invent product, plugin, or person names).',
  '',
  'Action steps must be concrete and doable this week, not abstract.',
  'CRITICAL — Do NOT invent implementation details in action steps. Only reference tools, languages, libraries, products, or configurations the speaker explicitly named in the transcript. If the video only mentions a concept vaguely (e.g., "you could build an extension"), the action step should be phrased as research/exploration ("Research how X works as described by the speaker"), NOT as specific implementation ("Build a TypeScript module that hooks into Y"). Confabulated specifics make the action steps look authoritative when they are actually guesses — that undermines trust.',
].join('\n');

async function generateSummarySinglePass(
  transcript: TranscriptData,
  meta: VideoMeta,
): Promise<ServiceResult<GeneratedSummary>> {
  const displayTitle = meta.title ?? transcript.upstreamTitle;
  const started = performance.now();
  setGenerationStep(transcript.videoId, 'ai', 'single-pass');
  logPhase(transcript.videoId, 'ai → single-pass summary', {
    model: SUMMARY_MODEL,
    transcriptChars: transcript.transcript.length,
    estTokens: estimateTokens(transcript.transcript),
  });

  try {
    // TanStack AI: `chat({ outputSchema })` activates Ollama's native JSON
    // mode via the adapter, returns the parsed zod-validated object.
    //
    // Note: we DELIBERATELY pass the plain cleaned transcript here, not
    // an `annotateWithTimecodes`-annotated version. The system prompt
    // tells the model not to emit timecodes (they're recovered
    // deterministically via BM25 after generation), so injecting
    // `[mm:ss]` markers into the prompt just inflates token count for
    // zero benefit. Net effect: noticeably faster inference on long
    // transcripts.
    const userPrompt = [
      displayTitle ? `Video title: ${displayTitle}` : null,
      meta.author ? `Channel: ${meta.author}` : null,
      transcript.durationSec
        ? `Video duration: ${formatTimecode(transcript.durationSec)}. Target ~1 section per 10 minutes of video, and make sure to cover content from the LAST portion of the video, not just the opening.`
        : null,
      '',
      'Transcript:',
      transcript.transcript,
    ]
      .filter(Boolean)
      .join('\n');

    // TanStack AI: `chat({ outputSchema })` activates Ollama's native
    // JSON-mode (format: <jsonSchema>) via the adapter and returns the
    // parsed, zod-validated object directly. Same constraint-decoding
    // reliability as our previous @ai-sdk/openai + /v1 path, one fewer
    // hop (native Ollama client vs OpenAI-compat shim).
    //
    // systemPrompts workaround: @tanstack/ai-ollama@0.6.6 silently drops
    // the `systemPrompts` option — we prepend a system-role message
    // instead, which the adapter passes through to Ollama as expected.
    const object = (await withRetry(
      () =>
        chat({
          adapter: ollamaAdapter,
          messages: [
            { role: 'system', content: SUMMARY_SYSTEM },
            { role: 'user', content: userPrompt },
          ] as never,
          outputSchema: SummarySchema,
          // Low temp for summarization: cuts confabulated specifics in
          // action steps / section bodies. Ollama default is 1.0, which
          // is great for chat but invites creative drift in structured
          // tasks where we want grounded prose.
          temperature: 0.3,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(transcript.videoId, `ai ↻ single-pass retry ${attempt}/1 in ${delayMs}ms`, {
            cause: err instanceof Error ? err.message : 'unknown',
          });
        },
      },
    )) as GeneratedSummary;
    logPhase(transcript.videoId, 'ai ✓ single-pass summary', {
      took: ms(started),
      sections: object.sections?.length ?? 0,
      takeaways: object.keyTakeaways?.length ?? 0,
      actionSteps: object.actionSteps?.length ?? 0,
    });
    return { success: true, data: object as GeneratedSummary };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI generation failed';
    logPhase(transcript.videoId, 'ai ✗ single-pass failed', {
      error: message,
      took: ms(started),
    });
    return { success: false, error: message };
  }
}

// Map-reduce summary for long transcripts:
//   MAP  → each chunk gets a plain-text bulleted notes pass with rough
//          timecodes at the front (cheap, runs in sequence to avoid KV
//          thrash on a single local model).
//   REDUCE → concat all partial notes, run structured `generateObject` once
//          against that much smaller document to produce the final schema.
// Map-step concurrency. Pair this with `OLLAMA_NUM_PARALLEL` on the Ollama
// server (≥ MAP_CONCURRENCY) — Ollama serves one request per slot, so extra
// parallelism here just queues if the server isn't sized for it.
//
// Default is 1 (safe on any laptop). Bump to 2-4 when you have RAM
// headroom: each extra slot adds ~3GB for KV cache on an 8B model at
// num_ctx=32768. On a 24GB M4 with Chrome/editor/etc. open, 2 can push
// you into swap and end up slower. On a 48GB+ Mac, 2-3 is safe.
// (Resolved + clamped to [1,4] in `#/lib/env`.)

async function generateSummaryMapReduce(
  transcript: TranscriptData,
  meta: VideoMeta,
): Promise<ServiceResult<GeneratedSummary>> {
  const runStart = performance.now();
  // Prefer segment-aware chunking so the map step's per-window timecodes
  // — echoed back by the reduce step into section `timeSec` values — are
  // real caption offsets, not linear-interp estimates.
  const chunks = chunkForSummary(
    transcript.prepared ?? transcript.transcript,
    transcript.durationSec,
  );
  logPhase(transcript.videoId, 'ai → map-reduce summary', {
    model: SUMMARY_MODEL,
    chunks: chunks.length,
    transcriptChars: transcript.transcript.length,
    concurrency: MAP_CONCURRENCY,
  });

  // Worker-pool pattern: keep MAP_CONCURRENCY map calls in-flight at any
  // time. Results are written by index into `partialNotes` so the reduce
  // step always sees windows in chronological order regardless of finish
  // order. If any chunk fails after retries, the promise rejects and the
  // outer try/catch aborts the run — other in-flight chunks continue but
  // their output is discarded.
  const partialNotes: string[] = new Array(chunks.length);

  // Track aggregate progress across parallel workers. The UI label shows
  // "map X/N done · K running" instead of a single chunk index — honest
  // about parallelism, and the count actually advances even when only
  // completions matter to the viewer.
  let completedCount = 0;
  let inFlightCount = 0;
  const updateAggregateLabel = () => {
    const runningHint =
      inFlightCount > 0 ? ` · ${inFlightCount} running` : '';
    setGenerationStep(
      transcript.videoId,
      'ai',
      `map ${completedCount}/${chunks.length} done${runningHint}`,
    );
  };

  const processChunk = async (i: number): Promise<void> => {
    const chunk = chunks[i];
    const mapStart = performance.now();
    inFlightCount += 1;
    updateAggregateLabel();
    logPhase(transcript.videoId, `ai → map chunk ${i + 1}/${chunks.length}`, {
      startSec: chunk.timeSec,
      chars: chunk.text.length,
    });

    const mapSystem = [
      'You read one window of a YouTube transcript and produce concise bullet notes on what was said.',
      'Keep bullets factual, evidence-led, and specific — no marketing fluff.',
      'Do not emit timecodes. Do not speculate beyond the window. Ignore anything not actually said.',
    ].join('\n');
    const cleanChunkText = chunk.text.replace(
      /\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/g,
      '',
    );
    const mapUser = ['Transcript window:', cleanChunkText].join('\n');

    const text = (await withRetry(
      () =>
        chat({
          adapter: ollamaAdapter,
          messages: [
            { role: 'system', content: mapSystem },
            { role: 'user', content: mapUser },
          ] as never,
          stream: false,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(
            transcript.videoId,
            `ai ↻ map chunk ${i + 1}/${chunks.length} retry ${attempt}/1 in ${delayMs}ms`,
            { cause: err instanceof Error ? err.message : 'unknown' },
          );
        },
      },
    )) as string;
    partialNotes[i] = `## Window ${i + 1} — starts at ~${formatTimecode(chunk.timeSec)}\n${text.trim()}`;
    completedCount += 1;
    inFlightCount -= 1;
    updateAggregateLabel();
    logPhase(transcript.videoId, `ai ✓ map chunk ${i + 1}/${chunks.length}`, {
      took: ms(mapStart),
      outChars: text.length,
      progress: `${completedCount}/${chunks.length}`,
    });
  };

  // Shared cursor across worker promises. `cursor++` is atomic in JS's
  // single-threaded event loop — no locking needed.
  let cursor = 0;
  const workers = Array.from({ length: MAP_CONCURRENCY }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= chunks.length) return;
      await processChunk(i);
    }
  });
  try {
    await Promise.all(workers);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'map step failed';
    logPhase(transcript.videoId, 'ai ✗ map step failed', {
      error: message,
    });
    return { success: false, error: `Map step failed: ${message}` };
  }

  const reduceStart = performance.now();
  setGenerationStep(transcript.videoId, 'ai', 'synthesize final summary');
  logPhase(transcript.videoId, 'ai → reduce (synthesize final schema)', {
    partialNotesChars: partialNotes.join('\n\n').length,
  });

  const displayTitle = meta.title ?? transcript.upstreamTitle;
  try {
    const reduceUser = [
      displayTitle ? `Video title: ${displayTitle}` : null,
      meta.author ? `Channel: ${meta.author}` : null,
      transcript.durationSec
        ? `Video duration: ${formatTimecode(transcript.durationSec)}.`
        : null,
      '',
      `You are summarizing a ${transcript.durationSec ? formatTimecode(transcript.durationSec) + '-long ' : ''}video from per-window bullet notes (each window covers a distinct portion of the video).`,
      `CRITICAL: Your sections MUST cover the ENTIRE video — including the FINAL windows, not just the opening topics. If you see ${partialNotes.length} windows of notes, produce sections that collectively reference all of them. A 90-minute video typically needs 8-10 sections, a 60-minute video 5-7. Do not stop at half the video.`,
      'Synthesize these notes into the final structured summary. Ignore any timecodes in the notes — they are added deterministically after your output.',
      '',
      'Window notes:',
      partialNotes.join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n');

    const object = (await withRetry(
      () =>
        chat({
          adapter: ollamaAdapter,
          messages: [
            { role: 'system', content: SUMMARY_SYSTEM },
            { role: 'user', content: reduceUser },
          ] as never,
          outputSchema: SummarySchema,
          // Same low-temp rationale as the single-pass call: structured
          // output + grounding-over-creativity.
          temperature: 0.3,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(transcript.videoId, `ai ↻ reduce retry ${attempt}/1 in ${delayMs}ms`, {
            cause: err instanceof Error ? err.message : 'unknown',
          });
        },
      },
    )) as GeneratedSummary;

    logPhase(transcript.videoId, 'ai ✓ reduce synthesized', {
      took: ms(reduceStart),
      totalTook: ms(runStart),
      sections: object.sections?.length ?? 0,
      takeaways: object.keyTakeaways?.length ?? 0,
      actionSteps: object.actionSteps?.length ?? 0,
    });
    return { success: true, data: object };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'reduce step failed';
    logPhase(transcript.videoId, 'ai ✗ reduce failed', {
      error: message,
      took: ms(reduceStart),
    });
    return { success: false, error: `Reduce step failed: ${message}` };
  }
}

export type GenerationMode = 'auto' | 'single' | 'mapreduce';

async function generateSummaryWithAI(
  transcript: TranscriptData,
  meta: VideoMeta,
  mode: GenerationMode = 'auto',
): Promise<ServiceResult<GeneratedSummary>> {
  const tokens = estimateTokens(transcript.transcript);

  if (mode === 'single') {
    logPhase(transcript.videoId, 'ai ↳ mode=single (user override)', { estTokens: tokens });
    return generateSummarySinglePass(transcript, meta);
  }
  if (mode === 'mapreduce') {
    logPhase(transcript.videoId, 'ai ↳ mode=mapreduce (user override)', { estTokens: tokens });
    return generateSummaryMapReduce(transcript, meta);
  }

  if (tokens <= SINGLE_PASS_TOKEN_BUDGET) {
    return generateSummarySinglePass(transcript, meta);
  }
  logPhase(transcript.videoId, 'ai ↳ transcript over budget, switching to map-reduce', {
    estTokens: tokens,
    budget: SINGLE_PASS_TOKEN_BUDGET,
  });
  return generateSummaryMapReduce(transcript, meta);
}

// -----------------------------------------------------------------------------
// Generation pipeline steps. Each named step below is a seam: the spine in
// `generateVideoSummary` composes them, and partial paths (verdict-only,
// signal-only re-rates) reuse the pieces they need instead of carrying
// parallel mini-pipelines.
// -----------------------------------------------------------------------------

type ResolvedTranscript = {
  // The Strapi Transcript row, when one exists or could be persisted.
  // Null only when a fresh fetch succeeded but the row save failed —
  // generation continues with the in-memory transcript.
  row: StrapiTranscript | null;
  transcript: TranscriptData;
  source: 'relation' | 'by-id' | 'fetch';
};

// Transcript source-of-truth resolution. Three cases:
//
//   1. Video already links to a Transcript row (the common regen case):
//      use it directly, UI shows "using existing transcript".
//   2. No link yet, but a Transcript row exists for this youtubeVideoId
//      (e.g. previous run created the transcript but AI crashed before
//      linking): reuse it, link the Video to it, UI shows "using existing
//      transcript (found by id)".
//   3. No Transcript anywhere: fetch from youtubei.js, CREATE the
//      Transcript row FIRST, then link the Video. UI shows "creating
//      transcript". This ordering matters: if AI generation later
//      crashes, the Transcript survives so retry #1 or #2 kicks in.
//
// `metaPromise` is the caller's in-flight oEmbed fetch — only awaited in
// case 3 (the persisted row wants title/author/thumbnail), so transcript
// and meta keep loading in parallel. It never rejects (fetchYouTubeMeta
// returns {} on failure).
async function resolveTranscriptForGeneration(
  video: StrapiVideo,
  videoId: string,
  opts: { forceRefetch?: boolean; metaPromise: Promise<VideoMeta> },
): Promise<ServiceResult<ResolvedTranscript>> {
  let transcriptRow: StrapiTranscript | null =
    !opts.forceRefetch && video.transcript
      ? video.transcript
      : null;

  if (!transcriptRow && !opts.forceRefetch) {
    const byId = await fetchTranscriptByVideoIdService(videoId);
    if (byId) {
      transcriptRow = byId;
      // Link the Video to the existing Transcript so future lookups
      // populate via the relation and skip the by-id query.
      await linkVideoToTranscriptService(video.documentId, byId.documentId);
      logPhase(videoId, 'transcript ↳ found existing row by youtubeVideoId', {
        documentId: byId.documentId,
      });
    }
  }

  const source: ResolvedTranscript['source'] = transcriptRow
    ? video.transcript
      ? 'relation'
      : 'by-id'
    : 'fetch';

  logPhase(videoId, 'transcript → resolving', { transcriptSource: source });
  setGenerationStep(
    videoId,
    'transcript',
    transcriptRow ? 'using existing transcript' : 'creating transcript',
  );

  const fetched =
    transcriptRow &&
    transcriptRow.rawSegments &&
    transcriptRow.rawSegments.length > 0
      ? await loadTranscriptFromStrapi(videoId, transcriptRow)
      : await fetchTranscript(videoId);
  if (!fetched.success) return fetched;

  // Case 3 resolution: we just fetched from YouTube. Persist the Transcript
  // row NOW — before AI generation — so a crash mid-summary leaves the
  // transcript safely cached for next retry.
  if (!transcriptRow) {
    const meta = await opts.metaPromise;
    const created = await createTranscriptService({
      youtubeVideoId: videoId,
      title: fetched.data.upstreamTitle ?? meta.title,
      author: meta.author,
      thumbnailUrl: meta.thumbnailUrl,
      language: fetched.data.language,
      durationSec: fetched.data.durationSec,
      rawSegments: (fetched.data.segments ?? []).map((s) => ({
        text: s.text,
        startMs: s.startMs,
        endMs: s.endMs,
      })),
      rawText: fetched.data.transcript,
    });
    if (created.success) {
      transcriptRow = created.transcript;
      await linkVideoToTranscriptService(video.documentId, created.transcript.documentId);
      logPhase(videoId, 'transcript ✓ created + linked', {
        documentId: created.transcript.documentId,
      });
    } else {
      // Non-fatal: we still have the transcript in memory for this run.
      // Next retry will re-fetch (or the Strapi race settled already).
      logPhase(videoId, 'transcript ✗ save failed (continuing with in-memory)', {
        error: created.error,
      });
    }
  }

  return {
    success: true,
    data: { row: transcriptRow, transcript: fetched.data, source },
  };
}

// Score-and-save: given the sanitized AI summary plus the cleaned/grounded
// transcript artifacts, compute the programmatic signal scores and write
// the canonical summary state in ONE update. finalScore is derived inside
// updateVideoSummaryService — this step (like every score path) never
// computes it.
async function saveSummaryWithScores(args: {
  videoId: string;
  video: StrapiVideo;
  safe: GeneratedSummary;
  finalSections: Array<{ heading: string; body: string; timeSec?: number }>;
  transcriptSegments: StoredTranscriptIndex;
  rawTranscript: string;
  cleaned: string;
  prepared: PreparedTranscript | null;
  durationSec: number | null;
}): Promise<ServiceResult<StrapiVideo>> {
  const { videoId, video, safe } = args;

  // Programmatic content-quality signals — deterministic, no LLM, runs
  // in <100ms over the cleaned transcript. Stored alongside the LLM's
  // valueScore for hybrid ranking. See content-signals.ts for the
  // per-signal methodology.
  const wordCount = args.prepared
    ? args.prepared.wordStartMs.length
    : (args.cleaned.match(/\b[\w'-]+\b/g) ?? []).length;
  const signalScores = computeSignalScores({
    rawText: args.rawTranscript,
    cleanedText: args.cleaned,
    wordCount,
    durationSec: args.durationSec,
  });
  const signalScore = aggregateSignalScore(signalScores);
  logPhase(videoId, 'signals ✓ computed', { signalScore, signalScores });

  setGenerationStep(videoId, 'saving');
  const saveStart = performance.now();
  logPhase(videoId, 'db → saving summary');
  const updated = await updateVideoSummaryService({
    documentId: video.documentId,
    summaryTitle: safe.title,
    summaryDescription: safe.description,
    summaryOverview: safe.overview,
    watchVerdict: safe.watchVerdict,
    verdictSummary: safe.verdictSummary,
    verdictReason: safe.verdictReason,
    valueScore: safe.valueScore,
    valueScoreSource: 'model',
    signalScores,
    signalScore,
    aiModel: SUMMARY_MODEL,
    transcriptSegments: args.transcriptSegments,
    keyTakeaways: safe.keyTakeaways,
    sections: args.finalSections,
    actionSteps: safe.actionSteps,
  });
  if (!updated.success) {
    logPhase(videoId, '✗ db save failed', {
      error: updated.error,
      took: ms(saveStart),
    });
    return { success: false, error: updated.error };
  }
  logPhase(videoId, 'db ✓ saved', {
    finalScore: updated.video.finalScore ?? null,
  });
  return { success: true, data: updated.video };
}

// Best-effort embedding refresh: Tier-1 summary vector + Tier-2 passage
// index. The contract is "log but never fail" — Ollama down, model not
// pulled, or empty content must not sink an otherwise-successful summary;
// the user can retry embeddings alone from the learn page or /settings.
async function refreshVideoEmbeddings(
  videoId: string,
  video: StrapiVideo,
  transcriptSegments: StoredTranscriptIndex,
): Promise<void> {
  try {
    const embStart = performance.now();
    const { computeVideoEmbedding } = await import('#/lib/services/embeddings');
    const { updateVideoEmbeddingService } = await import('#/lib/services/videos');
    const computed = await computeVideoEmbedding(video);
    const saved = await updateVideoEmbeddingService({
      documentId: video.documentId,
      embedding: computed.embedding,
      model: computed.model,
      version: computed.version,
      generatedAt: computed.generatedAt,
    });
    if (!saved.success) {
      logPhase(videoId, '⚠ embedding save failed', {
        error: saved.error,
        took: ms(embStart),
      });
    } else {
      logPhase(videoId, 'embedding ✓ saved', {
        dims: computed.embedding.length,
        model: computed.model,
        version: computed.version,
        took: ms(embStart),
      });
    }
  } catch (err) {
    logPhase(videoId, '⚠ embedding skipped', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  }

  // Tier-2 passage embeddings for moment search. Same best-effort stance:
  // N embedding calls (one per ~60s chunk) can fail individually without
  // blocking the summary. Skipped silently if the transcript segments
  // aren't available (shouldn't happen for a freshly-generated summary).
  try {
    const passStart = performance.now();
    const segments = transcriptSegments.rawSegments ?? [];
    if (segments.length === 0) {
      logPhase(videoId, '⚠ passages skipped — no raw segments');
    } else {
      const { computePassageIndex } = await import('#/lib/services/embeddings');
      const { updateVideoPassagesService } = await import('#/lib/services/videos');
      const passages = await computePassageIndex({
        video,
        segments,
      });
      const saved = await updateVideoPassagesService({
        documentId: video.documentId,
        passageEmbeddings: passages,
      });
      if (!saved.success) {
        logPhase(videoId, '⚠ passages save failed', {
          error: saved.error,
          took: ms(passStart),
        });
      } else {
        logPhase(videoId, 'passages ✓ saved', {
          chunks: passages.chunks.length,
          model: passages.model,
          version: passages.version,
          took: ms(passStart),
        });
      }
    }
  } catch (err) {
    logPhase(videoId, '⚠ passages skipped', {
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}

// -----------------------------------------------------------------------------
// Orchestration: look up the Video row by videoId, fetch transcript, run AI,
// and UPDATE the Video row with the summary fields + transcript cache. The
// Video row must already exist (created by the share flow). Called from the
// detached background task in the share handler.
// -----------------------------------------------------------------------------

export async function generateVideoSummary(
  videoId: string,
  options: { forceRefetch?: boolean; mode?: GenerationMode } = {},
): Promise<ServiceResult<StrapiVideo>> {
  const runStart = performance.now();
  logPhase(videoId, '▶ generation started', {
    forceRefetch: !!options.forceRefetch,
    mode: options.mode ?? 'auto',
  });

  const video = await fetchVideoByVideoIdService(videoId);
  if (!video) {
    logPhase(videoId, '✗ aborted — video row not found');
    return { success: false, error: 'Video row not found' };
  }
  if (video.summaryStatus === 'generated') {
    logPhase(videoId, '↳ already generated, skipping');
    return { success: true, data: video };
  }

  // Transcript + meta resolution. The oEmbed fetch starts first and runs
  // in parallel with whichever path resolution takes; the resolver awaits
  // it only when it must persist a freshly-fetched row (case 3).
  const metaPromise = fetchYouTubeMeta(videoId);
  const resolved = await resolveTranscriptForGeneration(video, videoId, {
    forceRefetch: options.forceRefetch,
    metaPromise,
  });
  const meta = await metaPromise;
  logPhase(videoId, 'meta ✓ oembed', {
    title: meta.title ?? null,
    author: meta.author ?? null,
  });
  if (!resolved.success) {
    await markSummaryFailedService(video.documentId);
    logPhase(videoId, '✗ generation failed at transcript', {
      took: ms(runStart),
      error: resolved.error,
    });
    return resolved;
  }
  const transcriptData = resolved.data.transcript;

  // Clean the transcript before any model sees it — strips fillers, stage
  // directions, and caption duplication. Typically 15-25% char reduction.
  //
  // When we have per-segment captions (the normal path), we clean segment-by-
  // segment so each surviving word keeps its real millisecond start time.
  // That lets the chunker assign exact timecodes instead of linear-interp
  // estimates. Fall back to string-only cleaning when segments are missing.
  const rawChars = transcriptData.transcript.length;
  let prepared: PreparedTranscript | null = null;
  let cleaned: string;
  if (transcriptData.segments && transcriptData.segments.length > 0) {
    prepared = prepareSegmentedTranscript(transcriptData.segments);
    cleaned = prepared.cleanedText;
  } else {
    cleaned = cleanTranscript(transcriptData.transcript);
  }
  logPhase(videoId, 'transcript ✓ cleaned', {
    rawChars,
    cleanedChars: cleaned.length,
    reductionPct: Math.round(100 - (100 * cleaned.length) / Math.max(1, rawChars)),
    segmentAware: prepared !== null,
    wordCount: prepared ? prepared.wordStartMs.length : undefined,
  });
  const cleanedTranscript: TranscriptData = {
    ...transcriptData,
    transcript: cleaned,
    prepared,
  };

  setGenerationStep(videoId, 'ai');
  const summary = await generateSummaryWithAI(cleanedTranscript, meta, options.mode ?? 'auto');
  if (!summary.success) {
    await markSummaryFailedService(video.documentId);
    logPhase(videoId, '✗ generation failed at AI step', {
      took: ms(runStart),
      error: summary.error,
    });
    return summary;
  }

  // Clamp any fields the model overshot against Strapi's per-field limits.
  // A single over-length takeaway would otherwise fail the whole save.
  // Also feeds the (already-clamped) sections into the Contextual Retrieval
  // index-build below.
  const safe = sanitizeSummary(videoId, summary.data);

  // Build BM25 index from retrieval-sized chunks of the cleaned transcript.
  // Contextual Retrieval: each chunk is tokenized together with its nearest
  // summary section (heading + body snippet) so paraphrase-style queries
  // can match via the AI-generated anchor even when the raw transcript
  // doesn't contain the exact word. The stored chunks keep only the
  // original transcript text — display/prompt stays unchanged.
  const indexStart = performance.now();
  // Prefer the segment-aware `prepared` input so chunks get real caption
  // timestamps (exact seek targets in chat). Fall back to the cleaned
  // string (with linear-interp wpm math) when segments are missing.
  const retrievalChunks = chunkForRetrieval(
    prepared ?? cleaned,
    cleanedTranscript.durationSec,
  );
  // Section timestamps are recovered deterministically AFTER the BM25
  // index is built (see sectionGroundings below), so at this point the
  // sections have no timeSec to anchor on. We let the contextualizer
  // associate every section with timeSec=0; it still helps retrieval
  // by prepending heading/body text as context, just without the
  // timestamp-based nearest-section pick. This is fine — the contextual
  // text is what matters for BM25 scoring of chunks.
  const contextualize = makeSectionContextualizer(
    safe.sections.map((s) => ({
      timeSec: 0,
      heading: s.heading,
      body: s.body,
    })),
  );
  const bm25 = buildBM25Index(retrievalChunks, contextualize);
  // Cache the raw caption segments + duration alongside the BM25 index so
  // subsequent regenerations skip the youtubei.js fetch. The size bump is
  // ~10-30KB for a typical video — trivial next to the rest of the row.
  const transcriptSegments: StoredTranscriptIndex = {
    version: 1,
    bm25,
    rawSegments: cleanedTranscript.segments ?? undefined,
    durationSec: cleanedTranscript.durationSec,
  };
  logPhase(videoId, 'bm25 ✓ index built (contextual)', {
    chunks: retrievalChunks.length,
    terms: Object.keys(bm25.idf).length,
    anchoringSections: safe.sections.length,
    durationSec: cleanedTranscript.durationSec,
    lastChunkTimeSec:
      retrievalChunks.length > 0
        ? retrievalChunks[retrievalChunks.length - 1].timeSec
        : null,
    took: ms(indexStart),
  });

  // -------------------------------------------------------------------------
  // Deterministic section timecode recovery (the Le Borgne pattern).
  //
  // The model emitted no timecodes. For each section we search the BM25
  // chunk index with the section's heading + body as the query, and use
  // the best-matching chunk's REAL caption-start time as `timeSec`.
  //
  // This removes the whole class of "model picked the wrong [mm:ss] / made
  // up a number" bugs — the AI's only job is prose, timestamps are recovered
  // by deterministic lookup against the transcript.
  //
  // Sections where BM25 finds nothing above the minimum score get no
  // timeSec (undefined) — better to show "no timecode" than a confidently-
  // wrong one.
  // -------------------------------------------------------------------------
  const sectionGroundings: Array<{
    heading: string;
    timeSec: number | null;
    score: number | null;
    snippetPreview: string | null;
  }> = [];

  const finalSections = safe.sections.map((s) => {
    const query = `${s.heading}. ${s.body}`;
    const evidence = findEvidenceForQuote(query, bm25, 1.0);
    sectionGroundings.push({
      heading: s.heading.slice(0, 60),
      timeSec: evidence?.timeSec ?? null,
      score: evidence?.score ?? null,
      snippetPreview: evidence ? evidence.snippet.slice(0, 80) : null,
    });
    return {
      heading: s.heading,
      body: s.body,
      timeSec: evidence?.timeSec,
    };
  });

  logPhase(videoId, 'sections ✓ timecodes recovered deterministically', {
    total: safe.sections.length,
    grounded: sectionGroundings.filter((g) => g.timeSec !== null).length,
    ungrounded: sectionGroundings.filter((g) => g.timeSec === null).length,
    groundings: sectionGroundings,
  });

  const updated = await saveSummaryWithScores({
    videoId,
    video,
    safe,
    finalSections,
    transcriptSegments,
    rawTranscript: transcriptData.transcript,
    cleaned,
    prepared,
    durationSec: transcriptData.durationSec,
  });
  if (!updated.success) return updated;

  await refreshVideoEmbeddings(videoId, updated.data, transcriptSegments);

  logPhase(videoId, '✓ generation complete', { took: ms(runStart) });
  return { success: true, data: updated.data };
}

// -----------------------------------------------------------------------------
// In-memory progress tracker — the UI polls this via a server function to
// render a "what is it doing right now?" indicator while the background job
// runs. Not persisted; on server restart the page falls back to the DB
// status (pending/failed/generated) as the source of truth.
// -----------------------------------------------------------------------------

// Background-generation progress lives in `generation-state.ts`. The
// pipeline writes to it via `setGenerationStep` (re-exported there as
// `setStep`); the UI reads via `getLiveState`. `GenerationStep` is
// re-exported from this file for backward compatibility with existing
// imports.
export type { GenerationStep };

// -----------------------------------------------------------------------------
// Chat-with-video — non-streaming. Includes the full transcript plus the
// timestamped sections as anchors the model can cite with `[mm:ss]`.
// -----------------------------------------------------------------------------

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatChunksForPrompt(chunks: TranscriptChunk[]): string {
  return chunks
    .map((c) => `[${formatTimecode(c.timeSec)}] ${c.text}`)
    .join('\n\n');
}

// Find the most recent user question in the conversation. BM25 queries use
// the latest user message, not the full history, so a long back-and-forth
// doesn't dilute the term signal with assistant chatter.
function extractLatestUserQuery(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i].content;
  }
  return '';
}

// Default persona used when no skill is selected. Matches the Q&A skill's
// prompt (which is seeded in Strapi as the user-editable mirror) — kept
// inline here so the default Q&A path doesn't require a DB round-trip.
// If you change this, also update the `qa` skill in `server/src/seed-skills.ts`.
const DEFAULT_VIDEO_CHAT_PERSONA = [
  'You answer questions about a single YouTube video. You will NOT be shown the full transcript — only the top passages retrieved for this specific question, plus the AI-generated sections and takeaways as semantic anchors.',
  'Ground every claim in the retrieved passages or sections. If nothing in the provided material answers the question, say so plainly — do not invent.',
  'When citing, use `[mm:ss]` (or `[h:mm:ss]`) timecode notation. Prefer timecodes from the retrieved passages (they are grounded); fall back to section timecodes when appropriate.',
  'Keep answers concise (2–4 short paragraphs). No preambles like "Great question!". Use markdown for structure (bold, lists) when it actually helps clarity.',
].join('\n');

// Grounding context block: meta + sections + takeaways + retrieved
// passages + always-on tool-availability rule. Skills (and the default
// persona) are prepended to this block; it stays stable regardless of
// which skill is active so the model always has the same source material.
function buildVideoGroundingContext(
  video: StrapiVideo,
  retrieved: TranscriptChunk[],
): string {
  const sectionsBlock =
    video.sections && video.sections.length > 0
      ? video.sections
          .map((s) => {
            const tc =
              typeof s.timeSec === 'number' ? `[${formatTimecode(s.timeSec)}] ` : '';
            return `${tc}${s.heading}\n${s.body}`;
          })
          .join('\n\n')
      : '(no sections available)';

  const takeawaysBlock =
    video.keyTakeaways && video.keyTakeaways.length > 0
      ? video.keyTakeaways.map((t) => `• ${t.text}`).join('\n')
      : '(no takeaways available)';

  const retrievedBlock =
    retrieved.length > 0
      ? formatChunksForPrompt(retrieved)
      : '(no transcript chunks matched the query — answer from sections/takeaways or say you don’t know)';

  const meta = [
    video.videoTitle ? `Video title: ${video.videoTitle}` : null,
    video.videoAuthor ? `Channel: ${video.videoAuthor}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    'TOOLS AVAILABLE: `web_search(query)` — use it ONLY when the retrieved passages genuinely do not answer the user\'s question (they ask about something outside the video, or want current/external information). When you do use it, cite the source URL inline. Never call `web_search` for information that IS in the retrieved passages.',
    '',
    meta,
    '',
    '---- Sections (timestamped anchors) ----',
    sectionsBlock,
    '',
    '---- Key takeaways ----',
    takeawaysBlock,
    '',
    '---- Retrieved transcript passages (top matches for the user question) ----',
    retrievedBlock,
  ].join('\n');
}

// Compose a chat system prompt as PERSONA + GROUNDING. Persona can come
// from a Skill (the picker in the UI) or fall back to the baked-in Q&A
// default. Grounding stays constant across personas — it's the source
// material. Keeps skills focused purely on HOW to behave; WHAT to reason
// over is provided by grounding regardless of skill choice.
export function buildChatSystemPrompt(
  video: StrapiVideo,
  retrieved: TranscriptChunk[],
  skillPrompt?: string | null,
): string {
  const persona = skillPrompt && skillPrompt.trim().length > 0
    ? skillPrompt
    : DEFAULT_VIDEO_CHAT_PERSONA;
  const grounding = buildVideoGroundingContext(video, retrieved);
  return `${persona}\n\n${grounding}`;
}

export async function askAboutVideoService(
  video: StrapiVideo,
  messages: ChatMessage[],
): Promise<ServiceResult<string>> {
  try {
    const query = extractLatestUserQuery(messages);
    const retrieved = await getChatEvidenceForVideo(video, query);
    const system = buildChatSystemPrompt(video, retrieved);
    const text = (await withRetry(
      () =>
        chat({
          adapter: ollamaAdapterChat,
          messages: [
            { role: 'system', content: system },
            ...messages,
          ] as never,
          stream: false,
        }),
      { attempts: 3 },
    )) as string;
    return { success: true, data: text };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chat generation failed';
    return { success: false, error: message };
  }
}

// Exposed for the streaming endpoint (`api.chat.tsx`) so it can reuse the
// same retrieval path and prompt shape without duplicating the logic.
// `skillPrompt` is optional; when omitted the default Q&A persona is used.
export async function prepareChatPrompt(
  video: StrapiVideo,
  messages: ChatMessage[],
  opts?: { skillPrompt?: string | null },
): Promise<{ system: string; retrievedCount: number }> {
  const query = extractLatestUserQuery(messages);
  const retrieved = await getChatEvidenceForVideo(video, query);
  return {
    system: buildChatSystemPrompt(video, retrieved, opts?.skillPrompt ?? null),
    retrievedCount: retrieved.length,
  };
}

// -----------------------------------------------------------------------------
// Cross-video chat — retrieves from each selected video's BM25 index and
// builds a system prompt that labels every passage with its source video
// title + timecode. Used by `/api/digest-chat` under the digest page.
// -----------------------------------------------------------------------------

// Fewer chunks per video — with N videos we'd otherwise blow past context.
// 3 per video × 5 videos = 15 chunks ≈ 1800 words, similar footprint to
// single-video chat's top-8 retrieval.
const DIGEST_CHAT_TOP_K_PER_VIDEO = 3;

async function retrieveChunksForDigest(
  video: StrapiVideo,
  query: string,
): Promise<TranscriptChunk[]> {
  const stored = loadStoredIndex(video.transcriptSegments);
  if (!stored) return [];
  return searchBM25(stored.bm25, query, DIGEST_CHAT_TOP_K_PER_VIDEO);
}

function formatMultiVideoChunks(
  labeled: Array<{ videoTitle: string; chunks: TranscriptChunk[] }>,
): string {
  const blocks: string[] = [];
  for (const entry of labeled) {
    if (entry.chunks.length === 0) continue;
    const body = entry.chunks
      .map(
        (c) =>
          `  [${entry.videoTitle} · ${formatTimecode(c.timeSec)}] ${c.text}`,
      )
      .join('\n\n');
    blocks.push(`--- From "${entry.videoTitle}" ---\n${body}`);
  }
  return blocks.join('\n\n');
}

function buildDigestChatSystemPrompt(
  videos: StrapiVideo[],
  labeled: Array<{ videoTitle: string; chunks: TranscriptChunk[] }>,
): string {
  const videoList = videos
    .map(
      (v, i) =>
        `  ${i + 1}. "${v.videoTitle ?? v.youtubeVideoId}"${v.videoAuthor ? ` — ${v.videoAuthor}` : ''}`,
    )
    .join('\n');

  const retrievedBlock = formatMultiVideoChunks(labeled);
  const totalChunks = labeled.reduce((n, l) => n + l.chunks.length, 0);

  return [
    'You are answering questions across multiple YouTube videos that a user has grouped into a digest.',
    'You have retrieved passages from each video (labeled with the video title and timecode) and you must ground every claim in them.',
    'If the retrieved passages do not answer the question, say so plainly rather than invent content.',
    '',
    'CITATION FORMAT: When referring to a specific passage, cite it as `[<Exact video title> <mm:ss>]` — use the title string verbatim from the list below, and a timecode that came from the retrieved passages.',
    'Compare and contrast across videos when relevant. When two videos say similar things, note the overlap; when they differ, call out the difference explicitly.',
    'Keep answers concise (2–5 short paragraphs). Use markdown where it genuinely improves clarity. No preamble like "Great question!".',
    '',
    `Videos in this digest (${videos.length}):`,
    videoList,
    '',
    totalChunks === 0
      ? '(No retrieved passages matched this query — answer from general knowledge only if the question is outside the video scope, otherwise say you don\'t know.)'
      : `---- Retrieved passages (top ${DIGEST_CHAT_TOP_K_PER_VIDEO} per video) ----\n${retrievedBlock}`,
  ].join('\n');
}

export async function prepareDigestChatPrompt(
  videos: StrapiVideo[],
  messages: ChatMessage[],
): Promise<{ system: string; retrievedCount: number }> {
  const query = extractLatestUserQuery(messages);
  const labeled = await Promise.all(
    videos.map(async (v) => ({
      videoTitle: v.videoTitle ?? v.youtubeVideoId,
      chunks: await retrieveChunksForDigest(v, query),
    })),
  );
  const retrievedCount = labeled.reduce((n, l) => n + l.chunks.length, 0);
  return {
    system: buildDigestChatSystemPrompt(videos, labeled),
    retrievedCount,
  };
}

// -----------------------------------------------------------------------------
// Verdict-only regeneration
//
// Re-rates a single video's watchVerdict + valueScore + verdictSummary +
// verdictReason WITHOUT touching the rest of the summary. Used by the
// per-video "Regenerate verdict" UI and the Settings bulk regenerate.
//
// Why a separate path (vs. the existing full `generateVideoSummary`):
//  • ~5–15s per video instead of 30–120s — Settings bulk over a full
//    library finishes in minutes, not hours.
//  • Keeps existing summary content untouched. Sections, takeaways, and
//    action steps don't get re-rolled when only the verdict feels wrong.
//  • Lets the bulk path replace placeholder backfill scores (20/40/70)
//    with real model-produced numbers.
// -----------------------------------------------------------------------------

const VerdictOnlySchema = SummarySchema.pick({
  watchVerdict: true,
  verdictSummary: true,
  verdictReason: true,
  valueScore: true,
});

export type VerdictOnly = z.infer<typeof VerdictOnlySchema>;

const VERDICT_SYSTEM = [
  'You re-rate a YouTube video on a single dimension: should the user spend their time watching it?',
  'Output ONLY the four verdict fields — watchVerdict, verdictSummary, verdictReason, valueScore. No other text.',
  '',
  'WATCH VERDICT — honest "should I watch this?" judgement:',
  ' • watchVerdict=worth_it — the video contains specific, dense, actionable information.',
  ' • watchVerdict=skim — mix of useful parts and filler/well-known material.',
  ' • watchVerdict=skip — mostly generic advice or surface-level content.',
  ' • verdictSummary — ONE sentence, MAX 280 chars, format "Worth it if you care about X. Skip if you already know Y." Be specific. No hedging.',
  ' • verdictReason — 2-4 sentences on what the video does well, what it assumes you already know, and who the ideal viewer is. MAX 1000 chars.',
  ' • valueScore — integer 0-100 with this rubric:',
  '     0–25  = mostly fluff/padding (sponsor reads, tangents, repetition, no concrete claims) — corresponds to skip',
  '    26–55  = mixed signal — some useful parts but lots to skim — corresponds to skim',
  '    56–80  = solid, specific, actionable information — corresponds to worth_it',
  '    81–100 = exceptional density and specificity (rare — reserve for videos that are dense, original, AND end-to-end actionable)',
  '   The valueScore MUST agree with the watchVerdict band — these are two views of the same judgment, not independent signals.',
  ' • Judge the VIDEO ITSELF, not the topic. A well-known topic with dense novel framing = worth_it. A niche topic delivered as generic tips = skip.',
  ' • Be evidence-oriented. Avoid marketing fluff, generic advice, sentence-length filler.',
].join('\n');

export async function regenerateVerdictForVideo(
  videoId: string,
): Promise<ServiceResult<VerdictOnly>> {
  const video = await fetchVideoByVideoIdService(videoId);
  if (!video) return { success: false, error: 'Video not found' };

  // Need a transcript to rate. If the video doesn't have one, the user
  // should run the full Retry flow — this path doesn't fetch transcripts.
  let cleanedTranscript: string | null = null;
  if (video.transcript?.rawText) {
    cleanedTranscript = cleanTranscript(video.transcript.rawText);
  } else {
    const byId = await fetchTranscriptByVideoIdService(videoId);
    if (byId?.rawText) cleanedTranscript = cleanTranscript(byId.rawText);
  }
  if (!cleanedTranscript || cleanedTranscript.length < 50) {
    return {
      success: false,
      error: 'No cached transcript — run a full Regenerate first.',
    };
  }

  const displayTitle = video.videoTitle ?? video.summaryTitle ?? null;
  const userPrompt = [
    displayTitle ? `Video title: ${displayTitle}` : null,
    video.videoAuthor ? `Channel: ${video.videoAuthor}` : null,
    '',
    'Transcript:',
    cleanedTranscript,
  ]
    .filter(Boolean)
    .join('\n');

  const started = performance.now();
  logPhase(videoId, 'verdict-regen → start', {
    model: SUMMARY_MODEL,
    transcriptChars: cleanedTranscript.length,
  });

  try {
    const object = (await withRetry(
      () =>
        chat({
          adapter: ollamaAdapter,
          messages: [
            { role: 'system', content: VERDICT_SYSTEM },
            { role: 'user', content: userPrompt },
          ] as never,
          outputSchema: VerdictOnlySchema,
          temperature: 0.3,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(videoId, `verdict-regen ↻ retry ${attempt}/1 in ${delayMs}ms`, {
            cause: err instanceof Error ? err.message : 'unknown',
          });
        },
      },
    )) as VerdictOnly;

    // Clamp lengths defensively (model sometimes overshoots Strapi field limits).
    const verdictSummary = object.verdictSummary.length > LIMITS.verdictSummary
      ? clamp(object.verdictSummary, LIMITS.verdictSummary)
      : object.verdictSummary;
    const verdictReason = object.verdictReason.length > LIMITS.verdictReason
      ? clamp(object.verdictReason, LIMITS.verdictReason)
      : object.verdictReason;

    // Cross-check: same warning as the full pipeline.
    const expectedBand =
      object.valueScore < 26
        ? 'skip'
        : object.valueScore < 56
        ? 'skim'
        : 'worth_it';
    if (expectedBand !== object.watchVerdict) {
      logPhase(videoId, 'verdict-regen ⚠ valueScore↔watchVerdict mismatch', {
        score: object.valueScore,
        verdict: object.watchVerdict,
        expectedBand,
      });
    }

    logPhase(videoId, 'verdict-regen ✓ done', {
      took: ms(started),
      score: object.valueScore,
      verdict: object.watchVerdict,
    });

    return {
      success: true,
      data: {
        watchVerdict: object.watchVerdict,
        valueScore: object.valueScore,
        verdictSummary,
        verdictReason,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'verdict regen failed';
    logPhase(videoId, 'verdict-regen ✗ failed', { error: message });
    return { success: false, error: message };
  }
}
