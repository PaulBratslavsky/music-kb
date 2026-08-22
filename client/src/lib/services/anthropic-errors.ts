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

/**
 * Pull just the human-readable `message` out of an Anthropic error payload.
 *
 * Returns undefined rather than guessing when the shape is unfamiliar — the
 * caller then falls back to the generic text. Deliberately narrow: we lift one
 * short string, never the whole untrusted payload, and cap its length so a
 * hostile or enormous body cannot become the UI.
 */
function extractProviderMessage(raw: string): string | undefined {
  const start = raw.indexOf('{');
  if (start === -1) return undefined;
  try {
    const parsed = JSON.parse(raw.slice(start)) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const msg = parsed.error?.message ?? parsed.message;
    if (typeof msg !== 'string') return undefined;
    const clean = msg.trim();
    if (!clean) return undefined;
    return clean.length > 200 ? `${clean.slice(0, 200)}…` : clean;
  } catch {
    return undefined;
  }
}

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

  // Unknown shape. Surface the provider's own `message` when we can parse one
  // out, because "check server logs" is useless to anyone not already tailing
  // them — a real 400 (`temperature` is deprecated for this model) cost a
  // round trip precisely because this branch hid it. Only the `message` field
  // is lifted, never the whole payload, and it goes through the key redactor
  // on the way out.
  const detail = extractProviderMessage(trimmed);
  if (detail) {
    return `Frontier AI request failed: ${detail} (or leave ANTHROPIC_API_KEY unset to use the local model instead.)`;
  }
  return 'Frontier AI request failed. Check server logs for detail, or leave ANTHROPIC_API_KEY unset to use the local model instead.';
}
