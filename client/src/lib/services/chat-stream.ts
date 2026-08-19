// SSE parser for TanStack AI's AG-UI chat stream. The server emits
// `data: <json>\n\n` blocks via `toServerSentEventsResponse`; this
// module turns those raw bytes into a typed `StreamEvent` async
// iterator. The single transport for every streaming-chat consumer:
// `VideoChat` (per-video chat), `DigestChat` (cross-video digest chat),
// `useLibraryChat` (library-wide ask), and `NoteComposer` (note
// drafting) — was previously duplicated across consumers with subtle
// field-name drift between the copies.
//
// The parser is pure with respect to networking — it consumes a `Response`
// the caller already issued. Each consumer handles its own URL, body,
// and abort logic.

import { friendlyOllamaError } from '#/lib/services/ollama-errors';

// -----------------------------------------------------------------------------
// Public Interface
// -----------------------------------------------------------------------------

// Citation payload carried by the CITATIONS frame `/api/ask` emits
// before the text stream — retrieved-passage metadata so the client can
// render clickable chips. Mirrors `toCitationPayload` in
// `routes/api.ask.tsx`.
export type Citation = {
  index: number;
  videoDocumentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
  startSec: number;
  endSec: number;
  text: string;
};

// Events the UI cares about. Run-start / run-end / step / text-start /
// text-end / tool-args (intermediate) are silently dropped — only the
// minimal set needed to update the UI is surfaced. RUN_ERROR is the
// exception: it throws instead of yielding, so a failed run can't end
// the stream as an empty assistant message with no error.
export type StreamEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'citations'; citations: Citation[] }
  | { kind: 'tool_start'; id: string; name: string }
  | {
      kind: 'tool_end';
      id: string;
      name: string;
      input: unknown;
      result: string | null;
    };

// -----------------------------------------------------------------------------
// Stream parser
// -----------------------------------------------------------------------------

export async function* streamChatSSE(
  response: Response,
): AsyncGenerator<StreamEvent, void, void> {
  if (!response.ok) {
    // Pull the body so the upstream message survives — collapsing every
    // non-OK response to a bare status code hides the actual cause
    // (Ollama down, retrieval errored, etc).
    const text = await response.text().catch(() => '');
    throw new Error(text || `Request failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error('chat-stream: empty response body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const eventBlock = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSseEventBlock(eventBlock);
        if (event) yield event;
        idx = buffer.indexOf('\n\n');
      }
    }
    // Flush any trailing block after the stream closes (rare — most
    // streams end with the `\n\n` after [DONE], but be defensive).
    buffer += decoder.decode();
    const tail = parseSseEventBlock(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

// Parse one SSE event block (newline-joined `data:` lines) into a typed
// event, null to skip — or throw, for RUN_ERROR frames. The AG-UI wire
// format has had two field-name dialects observed in the wild —
// `toolName` / `input` vs. `toolCallName` / `args` — so we accept both
// shapes via `??` fallbacks. Keeps the parser robust to upstream
// TanStack AI version drift.
function parseSseEventBlock(block: string): StreamEvent | null {
  const lines = block.split('\n');
  let payload = '';
  for (const line of lines) {
    if (line.startsWith('data:')) {
      payload += line.slice(5).trimStart();
    }
  }
  if (!payload || payload === '[DONE]') return null;

  let event: AgUiEvent;
  try {
    event = JSON.parse(payload) as AgUiEvent;
  } catch {
    return null;
  }

  switch (event.type) {
    case 'TEXT_MESSAGE_CONTENT':
      return typeof event.delta === 'string'
        ? { kind: 'text', delta: event.delta }
        : null;
    case 'CITATIONS':
      // Pre-stream frame from /api/ask. The frame's `model` field is
      // informational only (eval harness records it) — dropped here.
      return Array.isArray(event.citations)
        ? { kind: 'citations', citations: event.citations }
        : null;
    case 'RUN_ERROR': {
      // @tanstack/ai emits RUN_ERROR when generation fails mid-stream
      // (e.g. Ollama dies). Dropping it would end the stream as an
      // empty assistant message with no error — throw so consumer
      // catch sites fire. Translated here because the message is raw
      // adapter/Ollama text; friendlyOllamaError is idempotent on its
      // own output, so consumers re-translating in their catch is safe.
      // 0.45 emits `{ type, model, timestamp, message, code }`; 0.10 and
      // earlier nested it as `{ error: { message } }`. Read the flat field
      // first and fall back, so neither dialect degrades to the generic
      // message — that string is what reaches the user, and losing the
      // real one costs them the Ollama recovery hint.
      const raw =
        (typeof event.message === 'string' && event.message) ||
        (typeof event.error?.message === 'string' && event.error.message) ||
        'AI run failed';
      throw new Error(friendlyOllamaError(raw));
    }
    case 'TOOL_CALL_START': {
      const id = event.toolCallId;
      const name = event.toolName ?? event.toolCallName;
      return id && name ? { kind: 'tool_start', id, name } : null;
    }
    case 'TOOL_CALL_END': {
      const id = event.toolCallId;
      // tool_end is the source of truth for `input` (TOOL_CALL_ARGS
      // events stream args incrementally; we ignore those).
      const name = event.toolName ?? event.toolCallName ?? '';
      if (!id) return null;
      return {
        kind: 'tool_end',
        id,
        name,
        input: event.input ?? event.args ?? null,
        result: event.result ?? null,
      };
    }
    default:
      return null;
  }
}

// Loose shape of an AG-UI event JSON. The optional fields cover both
// dialects (`toolName` vs `toolCallName`, `input` vs `args`) so the
// parser doesn't break across TanStack AI versions.
type AgUiEvent = {
  type?: string;
  delta?: string;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolCallName?: string;
  input?: unknown;
  args?: unknown;
  result?: string | null;
  citations?: Citation[];
  // RUN_ERROR dialects: TanStack AI <= 0.10 nested the failure under
  // `error`; 0.45 flattened it onto the event as `message` / `code`.
  message?: string;
  code?: string;
  error?: { message?: string; code?: string };
};
