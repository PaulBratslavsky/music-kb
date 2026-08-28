// Server-side, TIER-CORRECT translation of a chat run's failure, applied to
// the stream before it is encoded onto the wire.
//
// WHY THIS EXISTS. `chat-stream.ts` used to translate every RUN_ERROR with
// `friendlyOllamaError` and said so in a comment: safe "BY CONSTRUCTION",
// because every streaming route was a `LocalSurface` whose `resolveModel`
// return type could not be frontier — and it predicted that if a frontier
// surface ever streamed through, the line would become wrong and "nothing else
// would notice". ADR 0011 (2026-08-27) made all four streaming surfaces
// switchable, so that "if" happened: an Anthropic auth failure reached the
// Ollama mapper and the user was told to check `ollama serve`.
//
// The fix maps SERVER-SIDE rather than putting the tier on the wire, because
// the server is the only place that knows which model actually answered, and
// because the correct mapper is already a member of the resolved object
// (`model.friendlyError`, tier-paired at construction in model-policy.ts:249
// and frontier-model.ts:121). Using it here reuses that pairing instead of
// re-deriving the tier on the client, where it would have to be trusted.
//
// SECURITY. The frontier `friendlyError` runs `redactAnthropicKey` first and
// then returns only canned strings — no branch echoes any substring of its
// input (see anthropic-errors.ts:1-20). That property is why this module calls
// `model.friendlyError` and never `friendlyOllamaError`/`friendlyAnthropicError`
// directly: the object that carries the Anthropic adapter is the object that
// carries the non-echoing mapper, so the wrong pairing is unrepresentable.
//
// It also drops `rawEvent`. `@tanstack/ai-anthropic` attaches the provider's
// structured error body to RUN_ERROR (adapters/text.js:98-109 and :816-827) and
// @tanstack/ai's `stripToSpecMiddleware` does not remove it, so the raw
// provider payload reaches the wire today. Nothing in the client reads it, and
// shipping a cloud provider's payload to the browser is exactly what
// anthropic-errors.ts exists to prevent — so it is removed here, for both
// tiers, and the raw detail is logged server-side instead.

import type { StreamChunk } from '@tanstack/ai';
import type { ResolvedModel } from '#/lib/services/model-policy';

/**
 * Error names that mean "the caller went away", not "the run failed".
 * Mirrors `ABORT_ERROR_NAMES` in @tanstack/ai's
 * `dist/esm/activities/error-payload.js`, which normalizes these to
 * `{ message: 'Request aborted', code: 'aborted' }`. Rethrowing an abort
 * unchanged keeps that normalization working; wrapping it in a fresh `Error`
 * would turn a user-initiated cancel into a reported failure.
 */
const ABORT_ERROR_NAMES = new Set([
  'AbortError',
  'APIUserAbortError',
  'RequestAbortedError',
]);

function isAbortShaped(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return typeof name === 'string' && ABORT_ERROR_NAMES.has(name);
}

/**
 * Loose shape of a RUN_ERROR chunk as it exists at this point in the pipeline.
 *
 * `message` / `code` are the spec form. `error` is the pre-0.11 nested dialect:
 * @tanstack/ai 0.45.1 already strips it in `stripToSpecMiddleware`, which runs
 * inside `chat()` and therefore BEFORE this wrapper — it is read defensively so
 * a version bump that stops stripping cannot silently reintroduce untranslated
 * text. `rawEvent` is the provider's structured error body.
 */
type RunErrorChunk = {
  type: 'RUN_ERROR';
  message?: unknown;
  code?: unknown;
  rawEvent?: unknown;
  error?: { message?: unknown } | null;
};

function isRunErrorChunk(chunk: unknown): chunk is RunErrorChunk {
  return (
    typeof chunk === 'object' &&
    chunk !== null &&
    (chunk as { type?: unknown }).type === 'RUN_ERROR'
  );
}

/**
 * The raw failure text carried by a RUN_ERROR chunk. Flat `message` first,
 * nested `error.message` as the legacy fallback, then a generic default — the
 * same precedence the client parser used before this module took the job over.
 */
function rawMessageOf(chunk: RunErrorChunk): string {
  if (typeof chunk.message === 'string' && chunk.message) return chunk.message;
  const nested = chunk.error?.message;
  if (typeof nested === 'string' && nested) return nested;
  return 'AI run failed';
}

/** `code` as @tanstack/ai's `extractCode` would read it: `.code`, then `.status`. */
function codeOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const e = err as { code?: unknown; status?: unknown };
  if (typeof e.code === 'string') return e.code;
  if (typeof e.code === 'number' && Number.isFinite(e.code)) return String(e.code);
  if (typeof e.status === 'number' && Number.isFinite(e.status)) return String(e.status);
  return undefined;
}

/**
 * Log the untranslated failure server-side.
 *
 * This is what makes the frontier mapper's canned "the exact reason is in the
 * server logs" (anthropic-errors.ts:75) true on the streaming surfaces — until
 * now only lesson generation logged its raw failures. The message is passed
 * through `model.redact` first (a no-op locally, `redactAnthropicKey` on
 * frontier). Only `model.model` and `model.tier` are logged, never `model`
 * itself: the frontier adapter closes over a live SDK client whose `.apiKey`
 * sits at depth 2 (model-policy.ts:164-176).
 */
function logRunFailure(model: ResolvedModel, tag: string, raw: string): void {
  // eslint-disable-next-line no-console
  console.error(
    `[${tag}] run failed (${model.tier}/${model.model}): ${model.redact(raw)}`,
  );
}

/**
 * Wrap a `chat()` stream so any failure it reports is already translated by the
 * resolved model's own mapper by the time it is encoded.
 *
 * Covers both routes a failure can take out of `chat()`:
 *   - a yielded RUN_ERROR chunk (what the Ollama and Anthropic adapters emit
 *     for a provider failure), whose `message` is rewritten in place; and
 *   - a thrown error (iteration failure), rethrown with the translated message
 *     so @tanstack/ai's `runErrorChunk` encodes the friendly text.
 *
 * Aborts are rethrown untouched — see ABORT_ERROR_NAMES.
 *
 * @param tag  short route tag for the server-side log line, e.g. 'chat'.
 */
export async function* withFriendlyErrors(
  model: ResolvedModel,
  stream: AsyncIterable<StreamChunk>,
  tag: string,
): AsyncGenerator<StreamChunk, void, void> {
  try {
    for await (const chunk of stream) {
      if (!isRunErrorChunk(chunk)) {
        yield chunk;
        continue;
      }
      const raw = rawMessageOf(chunk);
      logRunFailure(model, tag, raw);
      // `rawEvent` (provider payload) and the legacy nested `error` are
      // dropped rather than rewritten: neither has a consumer, and leaving
      // either in would put untranslated provider text back on the wire.
      const { rawEvent: _providerBody, error: _legacyDialect, ...rest } = chunk;
      yield { ...rest, message: model.friendlyError(raw) } as StreamChunk;
    }
  } catch (err) {
    if (isAbortShaped(err)) throw err;
    const raw = err instanceof Error ? err.message : String(err);
    logRunFailure(model, tag, raw);
    const friendly = new Error(model.friendlyError(raw));
    const code = codeOf(err);
    if (code !== undefined) Object.assign(friendly, { code });
    throw friendly;
  }
}
