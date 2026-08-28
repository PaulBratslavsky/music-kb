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

/**
 * A run failure the SERVER already translated (stream-errors.ts's
 * `withFriendlyErrors`, using the resolved model's tier-paired mapper).
 *
 * Exists so consumers can tell the two failure classes apart in one catch
 * block. A RUN_ERROR's text is final — re-running it through
 * `friendlyOllamaError` would be actively wrong on the frontier tier, because
 * 'Frontier AI request timed out. Try again, or leave ANTHROPIC_API_KEY
 * unset…' matches that mapper's `/timed ?out/i` pattern and would be replaced
 * with 'The model may be loading', which is advice about Ollama. Transport
 * failures (fetch rejected, non-OK response) are plain `Error`s and still need
 * local translation.
 */
export class FriendlyStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FriendlyStreamError';
  }
}

/**
 * The single error-to-message helper for every `streamChatSSE` consumer.
 *
 * Pass whatever the catch block caught. A server-translated run failure is
 * returned verbatim; anything else (fetch rejection, non-OK response body) is
 * translated locally exactly as before, because those failures are about
 * reaching this app's own server and never carry provider text.
 */
export function friendlyStreamError(err: unknown, fallback: string): string {
  if (err instanceof FriendlyStreamError) return err.message;
  const raw = err instanceof Error ? err.message : fallback;
  return friendlyOllamaError(raw);
}

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
  | { kind: 'citations'; citations: Citation[]; model?: string }
  | { kind: 'tool_start'; id: string; name: string }
  | {
      kind: 'tool_end';
      id: string;
      name: string;
      input: unknown;
      result: string | null;
    }
  // Emitted from a TOOL_CALL_RESULT frame, which @tanstack/ai 0.45 sends as
  // a *separate* event after TOOL_CALL_END rather than folding the result
  // into it. Carries only the id and the result, so consumers must merge it
  // into the existing call rather than replacing it — the name and input
  // arrived earlier and are not repeated here.
  | { kind: 'tool_result'; id: string; result: string | null };

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
  // Per-STREAM, not module-global: two chats open at once would otherwise
  // interleave their argument buffers and hand each other's JSON to the
  // wrong tool call.
  const toolCalls: ToolCallAccumulator = new Map();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const eventBlock = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseSseEventBlock(eventBlock, toolCalls);
        if (event) yield event;
        idx = buffer.indexOf('\n\n');
      }
    }
    // Flush any trailing block after the stream closes (rare — most
    // streams end with the `\n\n` after [DONE], but be defensive).
    buffer += decoder.decode();
    const tail = parseSseEventBlock(buffer, toolCalls);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

/**
 * Per-stream tool-call state: `toolCallId` → the name from TOOL_CALL_START
 * plus the argument JSON accumulated from TOOL_CALL_ARGS deltas.
 *
 * Required since @tanstack/ai 0.48, which made the SSE wire spec-only. The
 * name and arguments are no longer repeated on TOOL_CALL_END, so the only way
 * to know them at end-time is to have kept them.
 */
type ToolCallAccumulator = Map<string, { name: string; args: string }>;

// Parse one SSE event block (newline-joined `data:` lines) into a typed
// event, null to skip — or throw, for RUN_ERROR frames.
//
// WIRE DIALECTS. Verified live against 0.45.1 and 0.52.0 (client/verify-sse.mjs):
//
//   frame             0.45.1 (top level)              0.52.0 (top level)
//   TOOL_CALL_START   toolCallName, toolName, model   toolCallName
//   TOOL_CALL_ARGS    delta, args                     delta
//   TOOL_CALL_END     toolName, input                 — moved, see below
//   TOOL_CALL_RESULT  content, model                  content
//
// 0.48 made the wire spec-only: every chunk passes through `stripToSpec`, and
// TOOL_CALL_END's spec key set is `toolCallId` alone. Reading `event.toolName`
// / `event.input` there — as this parser used to — yields '' and null on any
// modern SDK: tool cards render blank, and `expandHistoryForModel` then tells
// the model it called a nameless tool with `{}`, corrupting its own tool-use
// history. Nothing throws.
//
// The name and input are NOT lost, though. Captured live from 0.52.0, they
// ride under the vendor extension:
//
//   "metadata":{"tanstack":{"toolCallName":"kb_web_search",
//                           "input":{"query":"..."},"model":"llama3.2:3b"}}
//
// So there are three sources, tried in this order:
//   1. top-level `toolName`/`input`   — pre-0.48 dialect, and a downgrade path
//   2. `metadata.tanstack`            — current, and already parsed
//   3. accumulated TOOL_CALL_ARGS     — spec-only fallback, needs JSON.parse
//
// Order matters: (2) is a vendor extension outside the spec, so (3) is kept as
// the floor that works even if `metadata` is stripped by a future release or
// an intermediary. Fixtures for all three are captured, not hand-written —
// see chat-stream.test.ts.
function parseSseEventBlock(
  block: string,
  toolCalls: ToolCallAccumulator,
): StreamEvent | null {
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
      // Pre-stream frame from /api/ask. `model` is the id that ACTUALLY
      // answered, as resolved server-side. It used to be dropped here as
      // "informational" — but once the model is user-selectable, it is the
      // only way a mismatch between the picker and the answer can be seen at
      // all. A stale or refused choice otherwise fails silently: the picker
      // shows one model, another answers, nothing throws. Surfaced, not dropped.
      return Array.isArray(event.citations)
        ? {
            kind: 'citations',
            citations: event.citations,
            model: typeof event.model === 'string' ? event.model : undefined,
          }
        : null;
    case 'RUN_ERROR': {
      // @tanstack/ai emits RUN_ERROR when generation fails mid-stream
      // (e.g. Ollama dies). Dropping it would end the stream as an
      // empty assistant message with no error — throw so consumer
      // catch sites fire.
      // 0.45 emits `{ type, model, timestamp, message, code }`; 0.10 and
      // earlier nested it as `{ error: { message } }`. Read the flat field
      // first and fall back, so neither dialect degrades to the generic
      // message — that string is what reaches the user.
      //
      // NOT TRANSLATED HERE. This line used to run every RUN_ERROR through
      // `friendlyOllamaError`, and the comment that stood here said it was
      // safe BY CONSTRUCTION because every streaming surface was a
      // `LocalSurface` — while predicting that a frontier surface streaming
      // through would make it wrong and that "nothing else would notice".
      // ADR 0011 (2026-08-27) made all four switchable. The text now arrives
      // already translated by the model that actually answered:
      // `withFriendlyErrors` (stream-errors.ts) wraps the stream inside each
      // route and applies that request's `model.friendlyError`. The server is
      // the only side that knows the tier, so mapping there and passing
      // through here is the version of this that cannot drift again.
      //
      // Thrown as a FriendlyStreamError so consumer catch sites can tell an
      // already-mapped run failure from a transport failure they must still
      // map themselves. See `friendlyStreamError` above.
      const raw =
        (typeof event.message === 'string' && event.message) ||
        (typeof event.error?.message === 'string' && event.error.message) ||
        'AI run failed';
      throw new FriendlyStreamError(raw);
    }
    case 'TOOL_CALL_START': {
      const id = event.toolCallId;
      const name = event.toolName ?? event.toolCallName;
      if (!id || !name) return null;
      // START is the ONLY frame that still carries the name. Keep it.
      toolCalls.set(id, { name, args: '' });
      return { kind: 'tool_start', id, name };
    }
    case 'TOOL_CALL_ARGS': {
      // Previously ignored, on the assumption END repeated the full input.
      // Since 0.48 these deltas are the only place the arguments exist.
      const id = event.toolCallId;
      if (!id) return null;
      const entry = toolCalls.get(id);
      if (entry) entry.args += event.delta ?? '';
      return null; // partial arguments are not a UI event
    }
    case 'TOOL_CALL_END': {
      const id = event.toolCallId;
      if (!id) return null;
      const entry = toolCalls.get(id);
      toolCalls.delete(id); // the call is over; do not leak it for the stream's life

      const meta = event.metadata?.tanstack;
      const name =
        event.toolName ?? event.toolCallName ?? meta?.toolName ?? meta?.toolCallName ?? entry?.name ?? '';

      let input: unknown = event.input ?? event.args ?? meta?.input ?? null;
      if (input == null && entry && entry.args.length > 0) {
        // A truncated or malformed buffer must not kill the stream — the
        // tool still ran; only its argument display is degraded.
        try {
          input = JSON.parse(entry.args) as unknown;
        } catch {
          input = null;
        }
      }

      // `result` is read defensively: up to 0.10 the result rode along on
      // this frame, but 0.45+ sends it separately as TOOL_CALL_RESULT.
      return {
        kind: 'tool_end',
        id,
        name,
        input,
        result: event.result ?? null,
      };
    }
    case 'TOOL_CALL_RESULT': {
      // 0.45 splits the tool result off TOOL_CALL_END onto its own frame,
      // keyed by toolCallId with the payload in `content`. Dropping it (as
      // the default branch used to) left every tool call rendering with a
      // null result forever — the UI hides the output panel in that case,
      // so the tool silently appeared to return nothing.
      const id = event.toolCallId;
      if (!id) return null;
      const result =
        typeof event.content === 'string'
          ? event.content
          : typeof event.result === 'string'
            ? event.result
            : null;
      return { kind: 'tool_result', id, result };
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
  // Also carries TOOL_CALL_RESULT's payload, which lives in `content`, not `result`.
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolCallName?: string;
  input?: unknown;
  /**
   * TanStack's vendor extension. Since 0.48 the spec-only wire strips the
   * name and input off TOOL_CALL_END's top level; they survive here.
   */
  metadata?: {
    tanstack?: {
      toolName?: string;
      toolCallName?: string;
      input?: unknown;
      model?: string;
    };
  };
  args?: unknown;
  result?: string | null;
  citations?: Citation[];
  /** On CITATIONS: the model id that actually answered, resolved server-side. */
  model?: string;
  // RUN_ERROR dialects: TanStack AI <= 0.10 nested the failure under
  // `error`; 0.45 flattened it onto the event as `message` / `code`.
  message?: string;
  code?: string;
  error?: { message?: string; code?: string };
};
