import { createFileRoute } from '@tanstack/react-router';
import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import {
  fetchVideoByVideoIdService,
  fetchTranscriptByVideoIdService,
} from '#/lib/services/videos';
import { cleanTranscript } from '#/lib/services/transcript';
import { getSkill } from '#/lib/skills';
import {
  OLLAMA_HOST,
  OLLAMA_SYNTHESIS_MODEL as CHAT_MODEL,
} from '#/lib/env';
import { samplingOptions } from '#/lib/services/ollama-model-options';

function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}:${String(rest).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

// Streaming note-composer endpoint.
//
// POST /api/notes/compose
//   { videoId, prompt, currentContent?, skillSlug? }
//
// The active skill (resolved via the in-code registry, same as /api/chat)
// supplies the system prompt from its `composerPrompt` field. Falls back
// to the default Note skill's prompt when unspecified or unknown.
//
// The user prompt carries:
//   • a VIDEO CONTEXT block (title, author, description, overview,
//     takeaways, timestamped sections, cleaned transcript excerpt)
//   • (optionally) a CURRENT DRAFT block — the existing note body the
//     AI should revise rather than replace from scratch
//   • the USER INSTRUCTION (what they typed)
//
// Output stream is AG-UI style SSE (TEXT_MESSAGE_CONTENT deltas + [DONE]).
// The client accumulates deltas and pushes the markdown into the Tiptap
// editor as it streams.

const MAX_TRANSCRIPT_CHARS = 18_000; // keep tight — leave headroom for system + draft + reply

type ComposeBody = {
  videoId?: string;
  prompt?: string;
  currentContent?: string;
  skillSlug?: string;
};

function formatSectionsBlock(
  sections: Array<{ heading: string; body: string; timeSec: number | null }> | null | undefined,
): string {
  if (!sections || sections.length === 0) return '(no sections available)';
  return sections
    .map((s) => {
      const tc =
        typeof s.timeSec === 'number' ? `[${formatTimecode(s.timeSec)}] ` : '';
      return `${tc}${s.heading}\n${s.body}`;
    })
    .join('\n\n');
}

function formatTakeawaysBlock(
  takeaways: Array<{ text: string }> | null | undefined,
): string {
  if (!takeaways || takeaways.length === 0) return '(no takeaways available)';
  return takeaways.map((t) => `• ${t.text}`).join('\n');
}

export const Route = createFileRoute('/api/notes/compose')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: ComposeBody;
        try {
          body = (await request.json()) as ComposeBody;
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }

        const prompt = body.prompt?.trim();
        if (!body.videoId || !prompt) {
          return new Response('videoId and prompt required', { status: 400 });
        }
        if (prompt.length > 4000) {
          return new Response('prompt too long (max 4000 chars)', { status: 400 });
        }

        const video = await fetchVideoByVideoIdService(body.videoId);
        if (!video) return new Response('Video not found', { status: 404 });
        if (video.summaryStatus !== 'generated') {
          return new Response('Summary not ready', { status: 409 });
        }

        // Skill lookup — synchronous in-memory registry. Falls back to the
        // 'note' default skill if slug missing or unknown, so the endpoint
        // always has a composerPrompt to work with.
        const requestedSlug = body.skillSlug?.trim() || 'note';
        const skill = getSkill(requestedSlug) ?? getSkill('note');
        if (!skill?.composerPrompt) {
          return new Response(
            'Skill has no composerPrompt — only skills with applicableContexts including "notes-composer" can drive /api/notes/compose.',
            { status: 400 },
          );
        }
        if (body.skillSlug && !getSkill(body.skillSlug)) {
          console.warn(
            `[notes/compose ${body.videoId}] skillSlug="${body.skillSlug}" not found — falling back to "note"`,
          );
        }

        // Build the video context block. Keep it tighter than /api/chat
        // since we're not doing retrieval here — just the authored
        // summary fields + a transcript excerpt for grounding.
        const title = video.videoTitle ?? video.summaryTitle ?? 'Untitled';
        const author = video.videoAuthor ?? 'Unknown';
        const sectionsBlock = formatSectionsBlock(video.sections);
        const takeawaysBlock = formatTakeawaysBlock(video.keyTakeaways);

        let transcriptExcerpt = '';
        const txRow =
          video.transcript ??
          (await fetchTranscriptByVideoIdService(video.youtubeVideoId).catch(
            () => null,
          ));
        if (txRow) {
          // Prefer pre-joined rawText when present; fall back to rawSegments
          // joined with spaces. cleanTranscript takes a plain string.
          const raw = cleanTranscript(
            txRow.rawText ??
              (Array.isArray(txRow.rawSegments)
                ? txRow.rawSegments.map((s) => s.text).join(' ')
                : ''),
          );
          transcriptExcerpt =
            raw.length > MAX_TRANSCRIPT_CHARS
              ? `${raw.slice(0, MAX_TRANSCRIPT_CHARS)}\n… [transcript truncated]`
              : raw;
        }

        const userPromptSections: string[] = [
          '===== VIDEO CONTEXT =====',
          `Title: ${title}`,
          `Author: ${author}`,
        ];
        if (video.summaryDescription) {
          userPromptSections.push(`Description: ${video.summaryDescription}`);
        }
        if (video.summaryOverview) {
          userPromptSections.push('');
          userPromptSections.push('Overview:');
          userPromptSections.push(video.summaryOverview);
        }
        userPromptSections.push('');
        userPromptSections.push('---- Sections (timestamped) ----');
        userPromptSections.push(sectionsBlock);
        userPromptSections.push('');
        userPromptSections.push('---- Key takeaways ----');
        userPromptSections.push(takeawaysBlock);
        if (transcriptExcerpt) {
          userPromptSections.push('');
          userPromptSections.push('---- Transcript (cleaned) ----');
          userPromptSections.push(transcriptExcerpt);
        }

        const currentContent = body.currentContent?.trim();
        if (currentContent) {
          userPromptSections.push('');
          userPromptSections.push('===== CURRENT DRAFT =====');
          userPromptSections.push(currentContent);
          userPromptSections.push('');
          userPromptSections.push(
            "The above is the note's current state. The user's instruction below is a REVISION request — follow the skill's revision-handling rules.",
          );
        }

        userPromptSections.push('');
        userPromptSections.push('===== USER INSTRUCTION =====');
        userPromptSections.push(prompt);

        const userPrompt = userPromptSections.join('\n');

        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [notes/compose ${body.videoId}/${skill.slug}${currentContent ? ' · refine' : ' · new'}] "${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}"`,
        );

        const adapter = createOllamaChat(CHAT_MODEL, OLLAMA_HOST);
        const stream = chat({
          adapter,
          messages: [
            { role: 'system', content: skill.composerPrompt },
            { role: 'user', content: userPrompt },
          ] as never,
          modelOptions: samplingOptions(CHAT_MODEL, 0.3),
        });

        return toServerSentEventsResponse(stream);
      },
    },
  },
});
