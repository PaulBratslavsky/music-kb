import { createFileRoute } from '@tanstack/react-router';
import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { fetchVideoByVideoIdService } from '#/lib/services/videos';
import { getSkill } from '#/lib/skills';
import { prepareChatPrompt } from '#/lib/services/learning';
import { webSearchTool } from '#/lib/services/chat-tools';
import { resolveRequestModel, withSystem } from '#/lib/services/chat-model-request';

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

// Expand the client's (user/assistant + inline toolCalls) history into the
// proper ModelMessage sequence the LLM's agent loop expects:
//   user       → { role: 'user', content }
//   assistant  → if toolCalls: { role: 'assistant', toolCalls }, then one
//                { role: 'tool', toolCallId, content: result } per call,
//                then (if there's also text) { role: 'assistant', content }
//   assistant  → otherwise just { role: 'assistant', content }
// Preserves conversation + tool-use continuity across turns.
function expandHistoryForModel(messages: ChatMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      out.push({ role: 'user', content: msg.content });
      continue;
    }
    // assistant
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

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: {
          videoId?: string;
          messages?: ChatMessage[];
          skillSlug?: string;
          /**
           * Model choice token from the picker: 'default' | 'local:<id>' |
           * 'frontier'. Never a bare model id — see chat-model-request.ts.
           */
          modelChoice?: string;
        };
        try {
          body = await request.json();
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }

        if (!body.videoId || !Array.isArray(body.messages)) {
          return new Response('videoId and messages required', { status: 400 });
        }

        const video = await fetchVideoByVideoIdService(body.videoId);
        if (!video) {
          return new Response('Video not found', { status: 404 });
        }
        if (video.summaryStatus !== 'generated') {
          return new Response('Summary not ready', { status: 409 });
        }

        // Skill lookup — synchronous, in-memory registry (`#/lib/skills`).
        // Unknown slug falls back to the default persona; logged so
        // misconfigured clients surface during dev.
        const skill = body.skillSlug ? getSkill(body.skillSlug) : null;
        if (body.skillSlug && !skill) {
          console.warn(
            `[chat ${body.videoId}] skillSlug="${body.skillSlug}" not found in registry — using default persona`,
          );
        }

        const { system, retrievedCount } = await prepareChatPrompt(
          video,
          body.messages,
          { skillPrompt: skill?.systemPrompt },
        );
        // Expand the client's (user/assistant + inline toolCalls) history
        // into proper ModelMessage sequences so the agent loop sees its
        // own prior tool calls/results and maintains continuity.
        const expanded = expandHistoryForModel(body.messages);
        const toolCallCount = expanded.filter((m) => m.role === 'tool').length;
        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [chat ${body.videoId}${skill ? `/${skill.slug}` : ''}] → streaming response (tanstack-ai)`,
          {
            retrievedChunks: retrievedCount,
            messages: body.messages.length,
            expandedMessages: expanded.length,
            priorToolResults: toolCallCount,
            skill: skill?.slug ?? null,
          },
        );

        // Per-request model choice (CLAUDE.md amendment 2026-08-27, ADR 0011).
        // With no choice this returns exactly what resolveModel('video-chat')
        // always did, so the default path is unchanged.
        const { model, notice } = await resolveRequestModel('video-chat', body.modelChoice);
        if (notice) {
          console.warn(`[chat ${body.videoId}] ${notice}`);
        }
        const stream = chat({
          adapter: model.adapter,
          // Tier-correct system delivery. See withSystem() — Anthropic drops a
          // `role: 'system'` message silently, which would lose the retrieved
          // transcript context and the skill persona without failing.
          ...withSystem(model, system, expanded),
          // Agent loop: model can call `kb_web_search(query)` when the
          // retrieved transcript passages don't answer the question.
          // Execution happens server-side; tool events stream as
          // TOOL_CALL_* SSE frames.
          tools: [webSearchTool],
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

        return toServerSentEventsResponse(stream);
      },
    },
  },
});
