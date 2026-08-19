// Note CRUD + chat-to-note summarizer.
//
// Notes are markdown rows on api::note.note, related many-to-many with
// Video. Four sources:
//   - 'chat'        — summarized from a single-video in-app conversation
//   - 'digest-chat' — summarized from a /digest cross-video conversation
//   - 'mcp'         — written by an external MCP client (e.g. Claude Desktop)
//   - 'manual'      — user-authored scratchpad / freeform
//
// The summarizer feeds the conversation + the video's cleaned transcript +
// its structured summary fields into Ollama, using a long-form markdown
// prompt similar to the reader article. The transcript is the source of
// truth — the chat just narrows WHAT from the transcript the user cared
// about. That way the resulting note is evidence-rich, not limited to
// whatever the chat happened to surface.

import { chat } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { OLLAMA_HOST, OLLAMA_MODEL } from '#/lib/env';
import { withRetry } from '#/lib/retry';
import { strapiFetch, type StrapiQuery } from './strapi-client';
import {
  cleanTranscript,
  prepareSegmentedTranscript,
  type TimedTextSegment,
} from './transcript';
import { fetchTranscriptByVideoIdService, type StrapiVideo } from './videos';
import { getSkill } from '#/lib/skills';
import { samplingOptions } from '#/lib/services/ollama-model-options';

type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

// =============================================================================
// Types
// =============================================================================

export type NoteSource = 'chat' | 'digest-chat' | 'mcp' | 'manual';

export type StrapiNoteVideo = {
  id: number;
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
};

export type StrapiNote = {
  id: number;
  documentId: string;
  title: string | null;
  body: string;
  source: NoteSource;
  author: string | null;
  videos: StrapiNoteVideo[];
  createdAt: string;
  updatedAt: string;
};

// =============================================================================
// CRUD
// =============================================================================

// Notes always populate their `videos` relation so the UI can show
// which video(s) a note belongs to without a second round-trip.
const noteQuery: StrapiQuery = { populate: ['videos'] };

export async function createNoteService(input: {
  title?: string | null;
  body: string;
  source: NoteSource;
  author?: string | null;
  videoDocumentIds: string[];
}): Promise<ServiceResult<StrapiNote>> {
  const result = await strapiFetch<StrapiNote>('POST', '/api/notes', {
    query: noteQuery,
    body: {
      data: {
        title: input.title ?? null,
        body: input.body,
        source: input.source,
        author: input.author ?? null,
        videos: input.videoDocumentIds,
      },
    },
  });
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export async function listNotesForVideoService(
  videoDocumentId: string,
): Promise<ServiceResult<StrapiNote[]>> {
  const result = await strapiFetch<StrapiNote[]>('GET', '/api/notes', {
    query: {
      ...noteQuery,
      filters: { videos: { documentId: { $eq: videoDocumentId } } },
      sort: 'createdAt:desc',
      pagination: { pageSize: 100 },
    },
  });
  return result.ok
    ? { success: true, data: result.data ?? [] }
    : { success: false, error: result.error };
}

export async function updateNoteService(input: {
  documentId: string;
  title?: string | null;
  body?: string;
}): Promise<ServiceResult<StrapiNote>> {
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.body !== undefined) data.body = input.body;
  const result = await strapiFetch<StrapiNote>(
    'PUT',
    `/api/notes/${input.documentId}`,
    { query: noteQuery, body: { data } },
  );
  return result.ok
    ? { success: true, data: result.data }
    : { success: false, error: result.error };
}

export async function deleteNoteService(
  documentId: string,
): Promise<ServiceResult<void>> {
  const result = await strapiFetch<unknown>('DELETE', `/api/notes/${documentId}`);
  if (!result.ok && result.status !== 404) {
    return { success: false, error: result.error };
  }
  return { success: true, data: undefined };
}

// =============================================================================
// Summarizer — chat conversation + full transcript → long-form markdown note
// =============================================================================

const summaryAdapter = createOllamaChat(OLLAMA_MODEL, OLLAMA_HOST);

export type ConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type NoteSummary = { title: string; body: string };

const NOTE_SYSTEM = [
  'You write a personal study note in markdown for a knowledge base, grounded in a YouTube video the reader watched.',
  'You are given:',
  ' • the video\'s title/author,',
  ' • a Q&A conversation the reader had with an assistant about the video,',
  ' • the cleaned transcript of the video for additional context.',
  '',
  'Your job: produce a single coherent markdown note that captures the ideas the CONVERSATION surfaced, enriched with details the reader would want from the transcript even if the chat didn\'t ask about them. The chat tells you WHAT the reader cared about; the transcript tells you the full picture of those topics.',
  '',
  'REQUIRED STRUCTURE (follow exactly, in order):',
  '',
  '1. `#` H1 TITLE — one short, descriptive title. Not "Chat Summary" or "Note".',
  '',
  '2. TL;DR SECTION — bold label (NOT a heading), then a bulleted list of 3-5 key takeaways. Each bullet: one crisp sentence, max two sentences.',
  '   Example:',
  '   **TL;DR**',
  '',
  '   - First takeaway.',
  '   - Second takeaway.',
  '',
  '3. MAIN CONTENT — `##` H2 sections organized around the topics raised in the conversation. Weave in specifics the transcript mentions about each topic — examples, numbers, names, quotes — even if the chat didn\'t explicitly ask about them. Use `###` H3 sparingly. Prose with occasional bullets where the speaker enumerates things. Fenced code blocks when the speaker shows code or commands. Block quotes for memorable direct lines.',
  '',
  '4. `## Bottom line` — one short paragraph: what the reader should walk away with.',
  '',
  'RULES:',
  ' • Ground every claim in the transcript. If the chat is wrong or incomplete, the transcript wins.',
  ' • Preserve `[mm:ss]` timecodes from the assistant\'s answers verbatim — they render as clickable chips that seek the player.',
  ' • Use the speaker\'s own terminology. Do not invent names or products.',
  ' • Write in personal-note voice — first-person fine ("I learned…", "the key idea is…"). Not a transcript, not a corporate summary.',
  ' • Strip filler, sponsor reads, outros. Skip tangents.',
  ' • No "thanks for reading" footer. No meta-commentary about the chat itself.',
].join('\n');

// The reader article already cleans transcripts identically — reuse its
// two helpers. Keeping the segment path preserves sentence boundaries
// that downstream heading generation benefits from.
function loadTranscriptText(row: {
  rawSegments: TimedTextSegment[] | null;
  rawText: string | null;
}): string {
  const segments = row.rawSegments ?? [];
  if (segments.length > 0) {
    return prepareSegmentedTranscript(segments).cleanedText;
  }
  return cleanTranscript(row.rawText ?? '');
}

function formatConversation(messages: ConversationMessage[]): string {
  return messages
    .filter((m) => m.content && m.content.trim().length > 0)
    .map((m) => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content.trim()}`)
    .join('\n\n');
}

// Split the model's markdown output into `{ title, body }`. Title = the
// first `# Heading` line (required by the prompt). Body = everything
// after. If no H1 is found (model disobeyed), fall back to a placeholder
// title + the whole output as body so the save still succeeds.
function splitTitleAndBody(markdown: string): NoteSummary {
  const trimmed = markdown.trim();
  const h1Match = trimmed.match(/^#\s+(.+?)\s*$/m);
  if (!h1Match) {
    return { title: 'Conversation note', body: trimmed };
  }
  const title = h1Match[1].trim().slice(0, 200);
  const rest = trimmed
    .slice(h1Match.index! + h1Match[0].length)
    .replace(/^\n+/, '');
  return { title, body: rest };
}

// Drop any ```markdown / ``` fences the model sometimes wraps output in.
function stripFences(raw: string): string {
  const text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return fence ? fence[1].trim() : text;
}

export async function summarizeConversationToNote(input: {
  video: StrapiVideo;
  messages: ConversationMessage[];
  /** Active chat skill at the time of save. If the skill defines its own
   * `notePrompt`, that becomes the system prompt — so Social Post saves
   * preserve drafts verbatim, Tutor saves capture the learning arc, etc.
   * Omitted / unknown slug → fall back to the generic NOTE_SYSTEM. */
  skillSlug?: string | null;
}): Promise<ServiceResult<NoteSummary>> {
  const trimmedMessages = input.messages.filter(
    (m) => m.content && m.content.trim().length > 0,
  );
  if (trimmedMessages.length < 2) {
    return {
      success: false,
      error: 'Need at least one question-and-answer exchange before summarizing.',
    };
  }

  // Transcript is the richer context source. Prefer the populated relation;
  // fall back to a fresh fetch if the row didn't include it.
  let transcriptText = '';
  const directRow = input.video.transcript ?? null;
  const row =
    directRow ??
    (await fetchTranscriptByVideoIdService(input.video.youtubeVideoId).catch(
      () => null,
    ));
  if (row) {
    transcriptText = loadTranscriptText({
      rawSegments: row.rawSegments,
      rawText: row.rawText,
    });
  }

  const title = input.video.videoTitle ?? input.video.summaryTitle ?? 'Untitled';
  const author = input.video.videoAuthor ?? 'Unknown';

  const userPrompt = [
    `Video: ${title}`,
    `Author: ${author}`,
    '',
    'Conversation (Q = user, A = assistant):',
    formatConversation(trimmedMessages),
    '',
    transcriptText
      ? `Full transcript (cleaned) — use for additional context, specifics, and accuracy:\n${transcriptText}`
      : 'Full transcript: (unavailable — rely on the conversation alone)',
  ].join('\n');

  // Skill-aware system prompt: if the active skill provides a `notePrompt`,
  // use that (Social Post → preserve drafts verbatim; Tutor → first-person
  // learning note). Otherwise fall back to the generic study-note format.
  const skill = input.skillSlug ? getSkill(input.skillSlug) : null;
  const systemPrompt = skill?.notePrompt ?? NOTE_SYSTEM;

  try {
    const raw = (await withRetry(
      () =>
        chat({
          adapter: summaryAdapter,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ] as never,
          stream: false,
          modelOptions: samplingOptions(OLLAMA_MODEL, 0.3),
        }),
      { attempts: 2 },
    )) as string;

    const markdown = stripFences(raw);
    return { success: true, data: splitTitleAndBody(markdown) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Note summarization failed';
    return { success: false, error: message };
  }
}
