// CLIENT-side translation of a chat failure into something a person can act on.
//
// Formerly chat-stream.ts, which was the hand-rolled AG-UI parser every chat
// surface streamed through. All three now use @tanstack/ai-react's useChat,
// which parses the wire itself, so the parser and its consumers are gone and
// only this half remains.
//
// It is deliberately the SECOND half of a pair. A failed RUN arrives already
// translated by the tier that answered — stream-errors.ts does that on the
// server, because the server is the only place that knows which model ran, and
// the frontier mapper must redact before it echoes anything. What reaches here
// is the other class: transport failures the server never saw at all.

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
 * The single error-to-message helper for every chat surface.
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
