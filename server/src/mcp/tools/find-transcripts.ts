// Cross-transcript search — find candidate videos to drill into. Matches
// on title / youtubeVideoId / rawText substring and returns truncated
// previews (≤244 chars) so the response stays compact. The agent should
// call getTranscript or searchTranscript with the chosen videoId for full
// detail.
//
// Mirrors the findTranscripts tool in strapi-plugin-ai-sdk-yt-transcripts
// (including the 244-char preview hint) so prompts from that plugin work
// here verbatim.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { buildTokenAndFilter, tokenizeQuery } from './query-helpers';

const PREVIEW_LEN = 244;
const FIELDS = ['title', 'youtubeVideoId', 'rawText'];

const schema = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe('Free-text query — tokenized and matched against title, youtubeVideoId, and transcript content (rawText). Every non-stopword token must appear in at least one field, so "Rethinking AI Agents Harness" matches a title like "Rethinking AI Agents: The Rise of Harness Engineering".'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Max matches to return. Default 10.'),
  includeFullContent: z
    .boolean()
    .default(false)
    .describe('If true, include the full transcript text per match. Default false (returns previews only).'),
});

type TranscriptRow = {
  documentId: string;
  youtubeVideoId: string;
  title?: string | null;
  author?: string | null;
  durationSec?: number | null;
  rawText?: string | null;
  createdAt?: string;
};

async function runQuery(strapi: any, filters: Record<string, unknown>, limit: number) {
  return (await strapi.documents('api::transcript.transcript').findMany({
    filters,
    pagination: { start: 0, limit },
    sort: 'createdAt:desc',
  })) as TranscriptRow[];
}

export const findTranscriptsTool: ToolDef<z.infer<typeof schema>> = {
  name: 'findTranscripts',
  description:
    'Tokenized search across all saved transcripts — title, youtubeVideoId, and transcript content. Every non-stopword token in the query must appear in at least one of those fields. Falls back to any-token-matches when the strict search is empty. Returns truncated previews (244 chars) — use getTranscript for full content. Ideal for "what have we got about X?" discovery.',
  schema,
  execute: async ({ query, limit, includeFullContent }, { strapi }) => {
    const tokens = tokenizeQuery(query);

    // Strict-only: every token must match. Skipping OR-fallback because
    // transcript `rawText` is huge and common tokens match almost every
    // row, producing meaningless noise instead of an honest empty result.
    const rows = await runQuery(strapi, buildTokenAndFilter(query, FIELDS), limit);
    const mode: 'strict' = 'strict';

    const results = rows.map((row) => {
      const text = row.rawText ?? '';
      const preview = buildPreview(text, tokens[0] ?? query, PREVIEW_LEN);
      return {
        youtubeVideoId: row.youtubeVideoId,
        title: row.title ?? null,
        author: row.author ?? null,
        durationSec: row.durationSec ?? null,
        createdAt: row.createdAt ?? null,
        preview,
        ...(includeFullContent ? { transcript: text } : {}),
      };
    });

    return {
      query,
      tokens,
      matchMode: mode,
      matchCount: results.length,
      results,
      ...(includeFullContent
        ? {}
        : { note: 'Transcript content truncated to 244 chars. Use getTranscript for full content or set includeFullContent=true.' }),
      ...(results.length === 0
        ? {
            hint: 'No transcripts matched. Call `listTranscripts` to browse everything in the KB, or `fetchTranscript({ videoId })` to ingest a specific video from YouTube.',
          }
        : {}),
    };
  },
};

// Return a snippet of `text` centered on the first occurrence of `query`.
// Falls back to the document prefix when the match is only in title/id.
function buildPreview(text: string, query: string, len: number): string {
  if (!text) return '';
  const needle = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(needle);
  if (idx < 0) {
    return text.slice(0, len) + (text.length > len ? '…' : '');
  }
  const half = Math.floor(len / 2);
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, start + len);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + text.slice(start, end) + suffix;
}
