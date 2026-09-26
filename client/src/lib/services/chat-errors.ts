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
// the frontier mapper must redact before it echoes anything. This module's
// job is the other class: transport failures the server never saw at all.
//
// But it cannot rely on only seeing that other class. useChat turns a
// RUN_ERROR frame into a plain `Error` (the class identity doesn't survive the
// wire), so server-translated text reaches here too — and running it through
// the Ollama mapper a second time is actively wrong on the frontier tier (issue
// #7). So translation is made IDEMPOTENT: text either mapper authored is
// recognised and passed through, and only foreign text is translated.

import { ANTHROPIC_ERROR_MESSAGES } from '#/lib/services/anthropic-errors';
import { OLLAMA_ERROR_MESSAGES, friendlyOllamaError } from '#/lib/services/ollama-errors';

/**
 * Every message either mapper can author. Both are closed sets of canned
 * strings (the frontier mapper never echoes its input, by design), so exact
 * membership is a sound test for "already translated". Derived from the
 * mappers' own constants so it cannot drift from what they return.
 */
const ALREADY_TRANSLATED: ReadonlySet<string> = new Set<string>([
  ...Object.values(ANTHROPIC_ERROR_MESSAGES),
  ...Object.values(OLLAMA_ERROR_MESSAGES),
]);

// -----------------------------------------------------------------------------
// Public Interface
// -----------------------------------------------------------------------------

/**
 * A failure message the SERVER already authored — for paths where the client
 * rebuilds an Error from a server response body rather than receiving a
 * RUN_ERROR frame (e.g. NoteComposer's JSON route), and the text is not
 * necessarily one of the mappers' canned messages ("Video not found").
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
  if (ALREADY_TRANSLATED.has(raw.trim())) return raw.trim();
  return friendlyOllamaError(raw);
}
