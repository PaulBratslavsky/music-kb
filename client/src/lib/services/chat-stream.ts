// What survives of the hand-rolled AG-UI layer.
//
// This file used to be the SSE parser every chat surface streamed through.
// All four now use @tanstack/ai-react's useChat, which parses the wire itself,
// so the parser is gone — along with the two `expandHistoryForModel` copies and
// three component-level stream reducers it fed.
//
// Two things outlived it and are still load-bearing:
//
//   friendlyStreamError — the CLIENT half of error translation. A run failure
//     arrives already mapped by the tier that answered (stream-errors.ts, which
//     runs server-side and must stay there); this handles the transport
//     failures the server never saw, and passes the former through untouched.
//
//   Citation — the payload of /api/ask's CITATIONS frame, produced server-side
//     and re-bound to its message by the transport interceptor
//     (components/chat/capture-frames.ts).
//
// The filename is now wider than its contents. Renaming it is a mechanical
// follow-up, deliberately not bundled into the migration that emptied it.

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


// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------



