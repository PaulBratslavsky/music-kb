// (music-kb) AI music extraction — the structured layer CLAUDE.md plans:
// chords, key, techniques, and referenced songs as per-video fields.
//
// Design constraints carried over from the base pipeline:
//  - ADR 0004: the model NEVER emits timecodes. It emits a short verbatim
//    `context` phrase per item; we ground that against the video's STORED
//    BM25 index (transcriptSegments) via findEvidenceForQuote, and items
//    that don't ground simply have no timeSec.
//  - Best-effort: extraction runs after summary generation with the same
//    "log but never fail" stance as the embedding refresh, and can be
//    re-triggered manually per video.
//  - Self-contained versioned blob (passageEmbeddings pattern): bump
//    MUSIC_EXTRACTION_VERSION when the prompt/sanitizer changes meaning;
//    stored version/model mismatch ⇒ stale ⇒ eligible for re-extraction.
//  - Cached transcript only — like the verdict-only re-rate, this path
//    never fetches from YouTube.

import { chat } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { z } from 'zod';
import {
  fetchTranscriptByVideoIdService,
  fetchVideoByVideoIdService,
  updateVideoMusicExtractionService,
  type ExtractedMusicData,
} from '#/lib/services/videos';
import {
  cleanTranscript,
  findEvidenceForQuote,
  loadStoredIndex,
  type BM25Index,
} from '#/lib/services/transcript';
import { withRetry } from '#/lib/retry';
import { OLLAMA_HOST, OLLAMA_MODEL as SUMMARY_MODEL } from '#/lib/env';

export const MUSIC_EXTRACTION_VERSION = 1;

type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

const ollamaAdapter = createOllamaChat(SUMMARY_MODEL, OLLAMA_HOST);

// -----------------------------------------------------------------------------
// Status (invalidation) — mirrors passageStatus semantics.
// -----------------------------------------------------------------------------

export type MusicExtractionStatus = 'current' | 'stale' | 'missing';

export function musicExtractionStatus(
  blob: ExtractedMusicData | null | undefined,
  currentModel: string = SUMMARY_MODEL,
): MusicExtractionStatus {
  if (!blob || typeof blob !== 'object') return 'missing';
  if (typeof blob.version !== 'number' || !Array.isArray(blob.chords)) {
    return 'missing';
  }
  if (blob.version !== MUSIC_EXTRACTION_VERSION) return 'stale';
  if (blob.model !== currentModel) return 'stale';
  return 'current';
}

// -----------------------------------------------------------------------------
// Heuristic gate — cheap pre-filter so the background path doesn't burn an
// Ollama call on a video with no music-instruction signals. The manual
// trigger bypasses it with force.
// -----------------------------------------------------------------------------

const MUSIC_TERMS =
  /\b(chord|chords|scale|scales|arpeggio|riff|lick|strum|strumming|fingerpick|fret|fretboard|capo|tuning|voicing|progression|key of|tempo|bpm|time signature|melody|harmony|bassline|groove|solo|interval|triad|pentatonic|mixolydian|dorian|lydian|phrygian|major|minor|piano|guitar|bass|ukulele|drums|synth|ableton|push)\b/i;

// How much transcript the gate looks at. Music-lesson vocabulary shows up
// early; scanning everything just makes false-positives more likely.
const GATE_HEAD_CHARS = 2000;

export function looksLikeMusicInstruction(
  title: string,
  cleanedTranscript: string,
): boolean {
  return (
    MUSIC_TERMS.test(title) ||
    MUSIC_TERMS.test(cleanedTranscript.slice(0, GATE_HEAD_CHARS))
  );
}

// -----------------------------------------------------------------------------
// Model output schema. NO timecodes here — see ADR 0004 note above.
// -----------------------------------------------------------------------------

const MusicExtractionOutputSchema = z.object({
  isMusicInstruction: z
    .boolean()
    .describe(
      'true only if the video actually teaches or demonstrates music — chords, technique, theory, a song. false for talk/gear-news/non-music content.',
    ),
  key: z
    .object({
      root: z.string().describe("Tonic pitch class, e.g. 'C', 'F#', 'Bb'."),
      type: z
        .string()
        .describe(
          "Key type: 'major', 'minor', or a mode name like 'dorian'. Lowercase.",
        ),
      confidence: z.enum(['high', 'medium', 'low']),
    })
    .nullable()
    .describe(
      'The key the lesson mainly works in, or null when none is stated or clearly implied. Do not guess a key from a single chord.',
    ),
  chords: z
    .array(
      z.object({
        root: z.string().describe("Pitch class, e.g. 'A', 'F#', 'Eb'."),
        quality: z
          .string()
          .describe(
            "Chord quality, e.g. 'maj', 'min', '7', 'maj7', 'min7', 'dim', 'sus2', 'sus4', 'add9'.",
          ),
        context: z
          .string()
          .describe(
            'SHORT phrase quoting the transcript wording where this chord is taught or used (max ~15 words). Quote the transcript — do not paraphrase.',
          ),
      }),
    )
    .max(24)
    .describe('Chords actually taught or played in the lesson, in order of importance. Empty if none.'),
  techniques: z
    .array(
      z.object({
        name: z.string().describe("e.g. 'alternate picking', 'travis picking', 'sidechain compression'"),
        description: z.string().describe('One sentence: what the video shows about this technique.'),
        context: z
          .string()
          .describe('SHORT phrase quoting the transcript wording where the technique is demonstrated (max ~15 words).'),
      }),
    )
    .max(12)
    .describe('Named techniques demonstrated or taught. Empty if none.'),
  songs: z
    .array(
      z.object({
        title: z.string(),
        artist: z.string().nullable(),
        context: z
          .string()
          .describe('SHORT phrase quoting the transcript wording where the song is referenced (max ~15 words).'),
      }),
    )
    .max(12)
    .describe('Real songs referenced or taught. Only songs explicitly named in the transcript — never invent.'),
});

type MusicExtractionOutput = z.infer<typeof MusicExtractionOutputSchema>;

const EXTRACTION_SYSTEM = [
  'You extract STRUCTURED MUSIC DATA from a music-tutorial transcript.',
  'Output only the schema fields. Rules:',
  ' • Only report what the transcript actually teaches, plays, or names. Never infer chords from vibes or invent song titles.',
  ' • `context` fields must QUOTE the transcript wording (short, ~15 words max) — they are used to locate the exact moment in the video, so paraphrasing breaks the link.',
  ' • Do NOT output timestamps anywhere. They are recovered separately.',
  ' • Chord spellings: root as a pitch class (A–G with # or b), quality as a short label (maj, min, 7, maj7, min7, dim, sus2, sus4, add9...).',
  ' • If the video is not music instruction at all, set isMusicInstruction=false and leave key null and all arrays empty.',
].join('\n');

// -----------------------------------------------------------------------------
// Sanitization — pure, exported for tests. Drops invalid pitch classes,
// clamps strings, dedupes chords, enforces caps. The model output is
// schema-validated but still untrusted in content.
// -----------------------------------------------------------------------------

const CLAMPS = {
  context: 200,
  techniqueName: 80,
  techniqueDescription: 300,
  songTitle: 140,
  songArtist: 120,
  keyType: 40,
  chordQuality: 24,
} as const;

// Salvage the pitch-class PREFIX: models sometimes pack quality into the
// root ('C#m', 'Emaj'); the quality field carries it separately, so taking
// the leading pitch class is lossless. Non-pitch letters ('H') drop.
function normalizeRoot(raw: string): string | null {
  const cleaned = raw.trim().replace('♯', '#').replace('♭', 'b');
  const m = /^([A-Ga-g])(#|b)?/.exec(cleaned);
  if (!m) return null;
  return m[1].toUpperCase() + (m[2] ?? '');
}

function clampStr(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max);
}

// Common aliases the model emits for key types, mapped to the Loop
// collection's vocabulary so the theory panel can seed without mapping.
const KEY_TYPE_ALIASES: Record<string, string> = {
  maj: 'major',
  m: 'minor',
  min: 'minor',
  ionian: 'major',
  aeolian: 'minor',
};

export function sanitizeMusicExtraction(
  raw: MusicExtractionOutput,
): Pick<ExtractedMusicData, 'key' | 'chords' | 'techniques' | 'songs'> {
  let key: ExtractedMusicData['key'] = null;
  if (raw.key) {
    const root = normalizeRoot(raw.key.root);
    if (root) {
      const lowered = clampStr(raw.key.type, CLAMPS.keyType).toLowerCase();
      key = {
        root,
        type: KEY_TYPE_ALIASES[lowered] ?? lowered,
        confidence: raw.key.confidence,
      };
    }
  }

  const seenChords = new Set<string>();
  const chords: ExtractedMusicData['chords'] = [];
  for (const c of raw.chords) {
    const root = normalizeRoot(c.root);
    if (!root) continue;
    const quality = clampStr(c.quality, CLAMPS.chordQuality).toLowerCase();
    const dedupeKey = `${root}|${quality}`;
    if (seenChords.has(dedupeKey)) continue;
    seenChords.add(dedupeKey);
    chords.push({ root, quality, context: clampStr(c.context, CLAMPS.context) });
  }

  const techniques: ExtractedMusicData['techniques'] = raw.techniques
    .filter((t) => t.name.trim().length > 0)
    .map((t) => ({
      name: clampStr(t.name, CLAMPS.techniqueName),
      description: clampStr(t.description, CLAMPS.techniqueDescription),
      context: clampStr(t.context, CLAMPS.context),
    }));

  const songs: ExtractedMusicData['songs'] = raw.songs
    .filter((s) => s.title.trim().length > 0)
    .map((s) => ({
      title: clampStr(s.title, CLAMPS.songTitle),
      artist: s.artist ? clampStr(s.artist, CLAMPS.songArtist) : null,
      context: clampStr(s.context, CLAMPS.context),
    }));

  return { key, chords, techniques, songs };
}

// -----------------------------------------------------------------------------
// Timecode grounding — pure, exported for tests. Same pattern as section
// grounding in the summary pipeline: BM25 the context phrase against the
// stored transcript index; below MIN_GROUND_SCORE means "no timecode" —
// better absent than confidently wrong.
// -----------------------------------------------------------------------------

const MIN_GROUND_SCORE = 1.0;

export function groundMusicExtraction<
  T extends { context: string; timeSec?: number },
>(items: T[], index: BM25Index): T[] {
  return items.map((item) => {
    const evidence = findEvidenceForQuote(item.context, index, MIN_GROUND_SCORE);
    return evidence ? { ...item, timeSec: evidence.timeSec } : item;
  });
}

// -----------------------------------------------------------------------------
// Orchestration: cached transcript → gate → one-shot extraction → sanitize
// → ground → write. Mirrors the verdict-only mini-pipeline shape.
// -----------------------------------------------------------------------------

function logPhase(videoId: string, phase: string, extra?: Record<string, unknown>) {
  const ts = new Date().toISOString().slice(11, 23);
  const body = extra ? ` ${JSON.stringify(extra)}` : '';
  // eslint-disable-next-line no-console
  console.log(`[${ts}] [music ${videoId}] ${phase}${body}`);
}

export async function extractMusicForVideo(
  videoId: string,
  opts: { force?: boolean } = {},
): Promise<ServiceResult<ExtractedMusicData>> {
  const video = await fetchVideoByVideoIdService(videoId);
  if (!video) return { success: false, error: 'Video not found' };

  // Cached transcript only — this path never fetches from YouTube.
  let rawText: string | null = video.transcript?.rawText ?? null;
  if (!rawText) {
    const byId = await fetchTranscriptByVideoIdService(videoId);
    rawText = byId?.rawText ?? null;
  }
  if (!rawText || rawText.length < 50) {
    return {
      success: false,
      error: 'No cached transcript — run a full Regenerate first.',
    };
  }
  const cleaned = cleanTranscript(rawText);

  if (!opts.force && !looksLikeMusicInstruction(video.videoTitle ?? '', cleaned)) {
    return {
      success: false,
      error: 'No music-instruction signals in title/transcript (manual trigger overrides this).',
    };
  }

  const displayTitle = video.videoTitle ?? video.summaryTitle ?? null;
  const userPrompt = [
    displayTitle ? `Video title: ${displayTitle}` : null,
    video.videoAuthor ? `Channel: ${video.videoAuthor}` : null,
    '',
    'Transcript:',
    cleaned,
  ]
    .filter(Boolean)
    .join('\n');

  const started = performance.now();
  logPhase(videoId, 'extract → start', {
    model: SUMMARY_MODEL,
    transcriptChars: cleaned.length,
  });

  let object: MusicExtractionOutput;
  try {
    object = (await withRetry(
      () =>
        chat({
          adapter: ollamaAdapter,
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM },
            { role: 'user', content: userPrompt },
          ] as never,
          outputSchema: MusicExtractionOutputSchema,
          temperature: 0.2,
        }),
      {
        attempts: 2,
        onRetry: (err, attempt, delayMs) => {
          logPhase(videoId, `extract ↻ retry ${attempt}/1 in ${delayMs}ms`, {
            cause: err instanceof Error ? err.message : 'unknown',
          });
        },
      },
    )) as MusicExtractionOutput;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'music extraction failed';
    logPhase(videoId, 'extract ✗ failed', { error: message });
    return { success: false, error: message };
  }

  // A non-music verdict still gets WRITTEN (as an empty blob): it marks
  // "analyzed, nothing found" so the background path doesn't re-burn an
  // Ollama call on every regeneration.
  const sanitized = object.isMusicInstruction
    ? sanitizeMusicExtraction(object)
    : { key: null, chords: [], techniques: [], songs: [] };

  // Ground context phrases against the STORED index when one exists.
  // Freshly generated summaries always have it; very old rows may not —
  // their items just carry no timeSec.
  const stored = loadStoredIndex(video.transcriptSegments);
  const grounded: ExtractedMusicData = {
    version: MUSIC_EXTRACTION_VERSION,
    model: SUMMARY_MODEL,
    generatedAt: new Date().toISOString(),
    key: sanitized.key,
    chords: stored ? groundMusicExtraction(sanitized.chords, stored.bm25) : sanitized.chords,
    techniques: stored
      ? groundMusicExtraction(sanitized.techniques, stored.bm25)
      : sanitized.techniques,
    songs: stored ? groundMusicExtraction(sanitized.songs, stored.bm25) : sanitized.songs,
  };

  const written = await updateVideoMusicExtractionService({
    documentId: video.documentId,
    musicExtraction: grounded,
  });
  if (!written.success) {
    logPhase(videoId, 'extract ✗ save failed', { error: written.error });
    return { success: false, error: written.error };
  }

  logPhase(videoId, 'extract ✓ done', {
    took: `${Math.round(performance.now() - started)}ms`,
    isMusic: object.isMusicInstruction,
    key: grounded.key ? `${grounded.key.root} ${grounded.key.type}` : null,
    chords: grounded.chords.length,
    techniques: grounded.techniques.length,
    songs: grounded.songs.length,
    grounded: [
      ...grounded.chords,
      ...grounded.techniques,
      ...grounded.songs,
    ].filter((x) => typeof x.timeSec === 'number').length,
  });

  return { success: true, data: grounded };
}
