// UX-friendly translation for Ollama-related failures. The raw errors
// surface to the user from many places (chat hooks, summary generation,
// AI re-rate), all through different paths — "Request failed: 500",
// "fetch failed", "ECONNREFUSED 127.0.0.1:11434", "model 'xyz' not
// found", etc. Without translation, the user sees a JS error message
// and has to guess the cause.
//
// This helper takes any raw error string and either returns a friendly
// version with a recovery hint, or returns the input unchanged when no
// known pattern matches. Pure string-in-string-out — no logging, no
// side effects — so it's safe to call from anywhere.

const HOST_PATTERNS = [
  /fetch failed/i,
  /econnrefused/i,
  /network ?error/i,
  /failed to fetch/i,
  /11434/, // hardcoded port — strong signal it's the Ollama URL
];

const MODEL_NOT_FOUND_PATTERNS = [
  /model ['"]?[\w.:-]+['"]? not found/i,
  /model not found/i,
  /pull the model/i,
  /no such model/i,
];

const TIMEOUT_PATTERNS = [/timeout/i, /timed ?out/i, /request aborted/i];

/**
 * Every canned message `friendlyOllamaError` can return. Its final fallback
 * passes unrecognised text through as-is and is deliberately NOT listed: only
 * text this module authored counts as already translated. Exported for
 * chat-errors.ts, as with ANTHROPIC_ERROR_MESSAGES.
 */
export const OLLAMA_ERROR_MESSAGES = {
  empty: 'AI request failed.',
  unreachable: 'AI server unreachable. Is Ollama running on port 11434?',
  modelNotFound: 'Ollama can’t find the configured model. Run `ollama pull <model>` for it, or update OLLAMA_MODEL.',
  timeout: 'AI request timed out. The model may be loading or the prompt is too long.',
} as const;

export function friendlyOllamaError(rawError: string): string {
  const trimmed = rawError.trim();
  if (!trimmed) return OLLAMA_ERROR_MESSAGES.empty;

  if (HOST_PATTERNS.some((p) => p.test(trimmed))) {
    return OLLAMA_ERROR_MESSAGES.unreachable;
  }
  if (MODEL_NOT_FOUND_PATTERNS.some((p) => p.test(trimmed))) {
    return OLLAMA_ERROR_MESSAGES.modelNotFound;
  }
  if (TIMEOUT_PATTERNS.some((p) => p.test(trimmed))) {
    return OLLAMA_ERROR_MESSAGES.timeout;
  }

  return trimmed;
}
