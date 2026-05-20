// SSE parser for TanStack AI's AG-UI chat stream. The server emits
// `data: <json>\n\n` blocks via `toServerSentEventsResponse`; this
// module turns those raw bytes into a typed `StreamEvent` async
// iterator. Used by both `VideoChat` (per-video chat) and `DigestChat`
// (cross-video digest chat); was previously duplicated across both
// consumers with subtle field-name drift between the two copies.
//
// The parser is pure with respect to networking — it consumes a `Response`
// the caller already issued. Each consumer handles its own URL, body,
// and abort logic.

// -----------------------------------------------------------------------------
// Public Interface
// -----------------------------------------------------------------------------

// Events the UI cares about. Run-start / run-end / step / text-start /
// text-end / tool-args (intermediate) are silently dropped — only the
// minimal set needed to update the UI is surfaced.
export type StreamEvent =
  | { kind: 'text'; delta: string }
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
// event, or null to skip. The AG-UI wire format has had two field-name
// dialects observed in the wild — `toolName` / `input` vs.
// `toolCallName` / `args` — so we accept both shapes via `??` fallbacks.
// Keeps the parser robust to upstream TanStack AI version drift.
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
};
