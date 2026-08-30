import { createFileRoute } from '@tanstack/react-router';
import {
  chat,
  chatParamsFromRequestBody,
  toServerSentEventsResponse,
} from '@tanstack/ai';
import { fetchVideoByVideoIdService } from '#/lib/services/videos';
import { getSkill } from '#/lib/skills';
import { prepareChatPrompt } from '#/lib/services/learning';
import { webSearchTool } from '#/lib/services/chat-tools';

/** The tools this route hands the model. Single source of truth for both
 *  the system prompt's TOOLS AVAILABLE block and the chat() call. */
const CHAT_TOOLS = [webSearchTool];
import { resolveRequestModel, withSystem } from '#/lib/services/chat-model-request';
import { withFriendlyErrors } from '#/lib/services/stream-errors';
import { dropOrphanToolCalls, latestUserText } from '#/lib/services/ui-message';

// Streaming chat endpoint (TanStack AI migration).
//
// The endpoint produces Server-Sent Events in AG-UI format:
//   data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"...","delta":"..."}\n\n
//   ...
//   data: [DONE]\n\n
//
// Retrieval (BM25 top-k + query rewriting + contextual retrieval) is shared
// with the non-streaming `askAboutVideoService` via `prepareChatPrompt`.
//
// Ollama host: the TanStack AI Ollama adapter talks to the native Ollama HTTP
// API (not the OpenAI-compat `/v1` endpoint). Our existing env var points at
// `.../v1`, so we strip the suffix here for backward compatibility with any
// existing `.env` files.

// Client-side message shape. `toolCalls` on an assistant message carries
// the tool invocations + their results from that turn — the server
// expands these into proper `role: 'tool'` message entries so the model
// maintains agentic continuity across turns (knows it already searched
// for X, etc.) instead of losing its tool-use history every message.
// No local message or tool-call types: the wire is AG-UI RunAgentInput and
// chatParamsFromRequestBody validates it. These described what VideoChat used
// to hand-assemble and post.

// Expand the client's (user/assistant + inline toolCalls) history into the
// proper ModelMessage sequence the LLM's agent loop expects:
//   user       → { role: 'user', content }
//   assistant  → if toolCalls: { role: 'assistant', toolCalls }, then one
//                { role: 'tool', toolCallId, content: result } per call,
//                then (if there's also text) { role: 'assistant', content }
//   assistant  → otherwise just { role: 'assistant', content }
// Preserves conversation + tool-use continuity across turns.
export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // The client is useChat, so the body is an AG-UI RunAgentInput.
        let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
        try {
          params = await chatParamsFromRequestBody(await request.json());
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'invalid body';
          return new Response(`Invalid AG-UI request body: ${detail}`, { status: 400 });
        }

        // Per-conversation options ride in forwardedProps. Still untrusted.
        const forwarded = params.forwardedProps as {
          videoId?: unknown;
          skillSlug?: unknown;
          /**
           * Model choice token from the picker: 'default' | 'local:<id>' |
           * 'frontier'. Never a bare model id — see chat-model-request.ts.
           */
          modelChoice?: unknown;
        };
        const videoId = typeof forwarded.videoId === 'string' ? forwarded.videoId : '';
        const skillSlugRaw =
          typeof forwarded.skillSlug === 'string' ? forwarded.skillSlug : undefined;
        const modelChoice =
          typeof forwarded.modelChoice === 'string' ? forwarded.modelChoice : undefined;

        if (!videoId || params.messages.length === 0) {
          return new Response('videoId and messages required', { status: 400 });
        }

        // An assistant tool_use with no matching tool_result is a 400 on
        // Anthropic. The SDK's conversion admits one (see dropOrphanToolCalls);
        // the hand-rolled expandHistoryForModel this replaced filtered them out
        // via `status === 'done'`, so dropping it unguarded would regress.
        const history = dropOrphanToolCalls(params.messages);

        const video = await fetchVideoByVideoIdService(videoId);
        if (!video) {
          return new Response('Video not found', { status: 404 });
        }
        if (video.summaryStatus !== 'generated') {
          return new Response('Summary not ready', { status: 409 });
        }

        // Skill lookup — synchronous, in-memory registry (`#/lib/skills`).
        // Unknown slug falls back to the default persona; logged so
        // misconfigured clients surface during dev.
        const skill = skillSlugRaw ? getSkill(skillSlugRaw) : null;
        if (skillSlugRaw && !skill) {
          console.warn(
            `[chat ${videoId}] skillSlug="${skillSlugRaw}" not found in registry — using default persona`,
          );
        }

        // CHAT_TOOLS is declared once and used twice — for the prompt's
        // TOOLS AVAILABLE block and for chat() itself — so the prompt cannot
        // advertise a tool the model is not actually given.
        const { system, retrievedCount } = await prepareChatPrompt(
          video,
          [{ role: 'user', content: latestUserText(params.messages) }],
          { skillPrompt: skill?.systemPrompt, tools: CHAT_TOOLS },
        );
        // Expand the client's (user/assistant + inline toolCalls) history
        // into proper ModelMessage sequences so the agent loop sees its
        // own prior tool calls/results and maintains continuity.
        const toolCallCount = history.filter(
          (m) => (m as { role?: string }).role === 'tool',
        ).length;
        // Per-request model choice (CLAUDE.md amendment 2026-08-27, ADR 0011).
        // With no choice this returns exactly what resolveModel('video-chat')
        // always did, so the default path is unchanged.
        //
        // Resolved BEFORE the log so the tag names the model that actually
        // answers, matching `[ask/<model>]` and `[digest-chat/<model>]`.
        const { model, notice } = await resolveRequestModel('video-chat', modelChoice);
        if (notice) {
          console.warn(`[chat ${videoId}] ${notice}`);
        }
        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [chat/${model.model} ${videoId}${skill ? `/${skill.slug}` : ''}] → streaming response`,
          {
            retrievedChunks: retrievedCount,
            messages: params.messages.length,
            historyMessages: history.length,
            priorToolResults: toolCallCount,
            skill: skill?.slug ?? null,
          },
        );
        const stream = chat({
          adapter: model.adapter,
          // Tier-correct system delivery. See withSystem() — Anthropic drops a
          // `role: 'system'` message silently, which would lose the retrieved
          // transcript context and the skill persona without failing.
          ...withSystem(model, system, history),
          // Agent loop: model can call `kb_web_search(query)` when the
          // retrieved transcript passages don't answer the question.
          // Execution happens server-side; tool events stream as
          // TOOL_CALL_* SSE frames.
          tools: CHAT_TOOLS,
          // Every other chat() call site sets a low temperature; this one
          // was the exception, so it ran at Ollama's default of 1.0 — and
          // it is the call that most needs deterministic output, because a
          // tool call is structured. At 1.0 the model intermittently
          // *narrated* the call instead of emitting it, printing
          // `[{"tool_name":"kb_web_search",...}]` as ordinary prose: the tool
          // never ran, and the surrounding invented text reached the user
          // looking like a real result.
          // Tier-paired: the local branch returns Ollama sampling options, the
          // frontier branch returns {} because claude-sonnet-5 400s on
          // `temperature`. The pairing lives on the resolved object, so this
          // call site cannot get it wrong.
          modelOptions: model.modelOptions(0.3),
        });

        // Translate the run's failure with the RESOLVED model's tier-paired
        // mapper before it reaches the wire. The client cannot do this: it does
        // not know which tier answered, and ADR 0011 made that vary per request.
        return toServerSentEventsResponse(
          withFriendlyErrors(model, stream, `chat ${videoId}`),
        );
      },
    },
  },
});
