// UX-friendly translation for Anthropic (frontier lesson model) failures —
// the frontier counterpart to ollama-errors.ts.
//
// Deliberately NOT symmetric with friendlyOllamaError: Ollama is local, so
// echoing its raw error text back to the user is harmless. Anthropic is a
// cloud vendor — the raw error/response body is provider payload, and the
// brief for this feature is explicit that provider payloads must never
// reach user-facing text. So every branch below returns a fully canned
// string; none of them interpolate any part of the input. That's what
// makes "the message never contains the key" true by construction, not by
// hoping the SDK never changes what it puts in `error.message` — even if a
// future SDK version embedded the raw Authorization header in an error
// somewhere, this function still could not leak it, because it never reads
// that error text into its output.
//
// `@tanstack/ai-anthropic`'s structuredOutput() wraps every failure as a
// plain `Error` with a message like `Structured output generation failed:
// <original @anthropic-ai/sdk error message>` (see node_modules/@tanstack/
// ai-anthropic/dist/esm/adapters/text.js) — so pattern-matching on that
// message text (not `instanceof`) is the only viable detection surface.

const AUTH_PATTERNS = [
  /\b401\b/,
  /authentication_error/i,
  /invalid x-api-key/i,
  /invalid api key/i,
  /x-api-key/i,
  /permission_denied/i,
  /\b403\b/,
];

const RATE_LIMIT_PATTERNS = [/\b429\b/, /rate_limit_error/i, /rate limit/i];

const TIMEOUT_PATTERNS = [
  /timeout/i,
  /timed ?out/i,
  /request aborted/i,
  /connection error/i,
  /econnrefused/i,
];

export function friendlyAnthropicError(rawError: string): string {
  const trimmed = rawError.trim();
  if (!trimmed) return 'Frontier AI request failed.';

  if (AUTH_PATTERNS.some((p) => p.test(trimmed))) {
    return 'Anthropic rejected the configured API key. Check ANTHROPIC_API_KEY, or leave it unset to use the local model instead.';
  }
  if (RATE_LIMIT_PATTERNS.some((p) => p.test(trimmed))) {
    return 'Anthropic rate limit hit. Wait a moment and try again, or leave ANTHROPIC_API_KEY unset to fall back to the local model.';
  }
  if (TIMEOUT_PATTERNS.some((p) => p.test(trimmed))) {
    return 'Frontier AI request timed out. Try again, or leave ANTHROPIC_API_KEY unset to use the local model instead.';
  }

  // Unknown shape — do NOT echo it; it's an untrusted cloud-provider
  // payload. Server logs (via chat()'s own error-category logging and this
  // module's callers) carry the raw detail for debugging.
  return 'Frontier AI request failed. Check server logs for detail, or leave ANTHROPIC_API_KEY unset to use the local model instead.';
}
