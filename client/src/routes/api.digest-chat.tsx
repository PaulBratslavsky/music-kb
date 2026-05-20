import { createFileRoute } from '@tanstack/react-router';
import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { fetchVideoByVideoIdService } from '#/lib/services/videos';
import { prepareDigestChatPrompt } from '#/lib/services/learning';
import { webSearchTool } from '#/lib/services/chat-tools';
import { OLLAMA_HOST, OLLAMA_CHAT_MODEL as CHAT_MODEL } from '#/lib/env';

// Streaming chat endpoint for the /digest page — cross-video chat against
// N selected videos (2-5). Mirrors `/api/chat` in wire shape (AG-UI SSE,
// same ClientToolCall / ChatMessage / ModelMessage shapes) but:
//   - accepts `videoIds: string[]` instead of a single videoId
//   - retrieves top-k BM25 chunks from each video and labels them with
//     the source video title in the system prompt
//   - instructs the model to cite as `[<Video title> mm:ss]`
//
// The model has the same `web_search` tool available since cross-video
// questions often spill outside the selected transcripts.

type ClientToolCall = {
  id: string;
  name: string;
  input: unknown | null;
  result: string | null;
  status: 'running' | 'done';
};
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ClientToolCall[];
};

type ModelMessage = {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
};

function expandHistoryForModel(messages: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }
    const completedCalls = (msg.toolCalls ?? []).filter((tc) => tc.status === 'done');
    if (completedCalls.length > 0) {
      out.push({
        role: 'assistant',
        content: null,
        toolCalls: completedCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: tc.input != null ? JSON.stringify(tc.input) : '{}',
          },
        })),
      });
      for (const tc of completedCalls) {
        if (tc.result !== null) {
          out.push({
            role: 'tool',
            toolCallId: tc.id,
            content: tc.result,
          });
        }
      }
    }
    if (msg.content && msg.content.trim().length > 0) {
      out.push({ role: 'assistant', content: msg.content });
    }
  }
  return out;
}

export const Route = createFileRoute('/api/digest-chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { videoIds?: unknown; messages?: ChatMessage[] };
        try {
          body = await request.json();
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }

        const videoIds = Array.isArray(body.videoIds)
          ? body.videoIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
          : [];
        if (videoIds.length < 2 || videoIds.length > 5) {
          return new Response('videoIds must contain 2–5 items', { status: 400 });
        }
        if (!Array.isArray(body.messages)) {
          return new Response('messages required', { status: 400 });
        }

        const videos = [];
        for (const id of videoIds) {
          const v = await fetchVideoByVideoIdService(id);
          if (!v) {
            return new Response(`Video not found: ${id}`, { status: 404 });
          }
          if (v.summaryStatus !== 'generated') {
            return new Response(`Summary not ready for ${id}`, { status: 409 });
          }
          videos.push(v);
        }

        const { system, retrievedCount } = await prepareDigestChatPrompt(
          videos,
          body.messages,
        );
        const expanded = expandHistoryForModel(body.messages);
        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [digest-chat] → streaming`,
          {
            videos: videos.length,
            retrievedChunks: retrievedCount,
            messages: body.messages.length,
          },
        );

        const adapter = createOllamaChat(CHAT_MODEL, OLLAMA_HOST);
        const messagesWithSystem: ModelMessage[] = [
          { role: 'system', content: system },
          ...expanded,
        ];
        const stream = chat({
          adapter,
          messages: messagesWithSystem as never,
          tools: [webSearchTool],
        });

        return toServerSentEventsResponse(stream);
      },
    },
  },
});
