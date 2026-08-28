import { createFileRoute } from '@tanstack/react-router';
import {
  chat,
  chatParamsFromRequestBody,
  toServerSentEventsResponse,
} from '@tanstack/ai';
import { fetchVideoByVideoIdService } from '#/lib/services/videos';
import { prepareDigestChatPrompt } from '#/lib/services/learning';
import { webSearchTool } from '#/lib/services/chat-tools';
import { resolveRequestModel, withSystem } from '#/lib/services/chat-model-request';
import { withFriendlyErrors } from '#/lib/services/stream-errors';
import { dropOrphanToolCalls, latestUserText } from '#/lib/services/ui-message';

// Streaming chat endpoint for the /digest page — cross-video chat against
// N selected videos (2-5). Mirrors `/api/chat` in wire shape (AG-UI SSE,
// same ClientToolCall / ChatMessage / ModelMessage shapes) but:
//   - accepts `videoIds: string[]` instead of a single videoId
//   - retrieves top-k BM25 chunks from each video and labels them with
//     the source video title in the system prompt
//   - instructs the model to cite as `[<Video title> mm:ss]`
//
// The model has the same `kb_web_search` tool available since cross-video
// questions often spill outside the selected transcripts.

// The client's wire shape is now AG-UI RunAgentInput (see the handler), so
// this route no longer declares its own message or tool-call types. They lived
// here to describe what DigestChat hand-assembled and posted; useChat sends
// the standard shape and chatParamsFromRequestBody validates it.

export const Route = createFileRoute('/api/digest-chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // The client is @tanstack/ai-react's useChat, so the body is an AG-UI
        // RunAgentInput. chatParamsFromRequestBody validates it and returns
        // `messages` ready for chat() — which is what replaced this route's
        // hand-rolled expandHistoryForModel: reconstructing assistant
        // tool-call turns and their tool results is exactly the fan-out the
        // SDK already does, and did more correctly.
        let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
        try {
          params = await chatParamsFromRequestBody(await request.json());
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'invalid body';
          return new Response(`Invalid AG-UI request body: ${detail}`, { status: 400 });
        }

        // Per-conversation options ride in forwardedProps, not the message
        // array. They are still untrusted client input and validated here.
        const forwarded = params.forwardedProps as {
          videoIds?: unknown;
          modelChoice?: unknown;
        };
        const videoIds = Array.isArray(forwarded.videoIds)
          ? forwarded.videoIds.filter((v): v is string => typeof v === 'string' && v.length > 0)
          : [];
        if (videoIds.length < 2 || videoIds.length > 5) {
          return new Response('videoIds must contain 2–5 items', { status: 400 });
        }
        const modelChoice =
          typeof forwarded.modelChoice === 'string' ? forwarded.modelChoice : undefined;
        if (params.messages.length === 0) {
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

        // prepareDigestChatPrompt only needs the latest user turn — it seeds
        // per-video retrieval with it. Passing a single synthetic message is
        // honest about that, rather than handing it a thread it ignores.
        const query = latestUserText(params.messages);
        // Same guard as /api/chat: an unanswered tool_use is a 400 on the
        // frontier tier. This surface has tools too (kb_web_search).
        const history = dropOrphanToolCalls(params.messages);
        const { system, retrievedCount } = await prepareDigestChatPrompt(videos, [
          { role: 'user', content: query },
        ]);
        // Model resolved BEFORE the log line so the tag names the model that
        // actually answers — matching api.ask.tsx's `[ask/<model>]`. Without
        // it there is no way to tell from the outside whether the picker's
        // choice reached the server, which is exactly the class of bug this
        // codebase has shipped twice.
        const { model, notice } = await resolveRequestModel('digest-chat', modelChoice);
        if (notice) console.warn(`[digest-chat] ${notice}`);
        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [digest-chat/${model.model}] → streaming`,
          {
            videos: videos.length,
            retrievedChunks: retrievedCount,
            messages: params.messages.length,
          },
        );
        const stream = chat({
          // No modelOptions below: this surface deliberately runs at
          // Ollama's default temperature. That is the pre-existing
          // behaviour, not an oversight — adding sampling here is a
          // generation-quality change, not a refactor.
          adapter: model.adapter,
          ...withSystem(model, system, history),
          tools: [webSearchTool],
        });

        // See api.chat.tsx — tier-correct error translation, server-side.
        return toServerSentEventsResponse(
          withFriendlyErrors(model, stream, 'digest-chat'),
        );
      },
    },
  },
});
