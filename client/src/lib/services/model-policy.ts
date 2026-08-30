// Surface → model policy. ONE place decides which model backs which AI
// surface, and which surfaces a user may re-point at another model.
//
// LOCAL-BY-DEFAULT (CLAUDE.md, amended 2026-08-27 — see ADR 0011). Every
// surface still RESOLVES local by default: `resolveModel(surface)` takes a
// LocalSurface and returns a LocalModel, exactly as before, and no env value
// or table edit changes that. What the amendment added is an explicit,
// per-request override on the four INTERACTIVE surfaces in
// SWITCHABLE_SURFACES, routed through `resolveChatModel` in
// frontier-model.ts.
//
// What did NOT change, and is still mechanised:
//
//   1. LOCAL_ONLY_SURFACES cannot be re-pointed at all. Bulk and background
//      jobs — summaries, extraction, re-embedding, digest synthesis, query
//      rewriting — have no override path, because CLAUDE.md's economic
//      argument for local-first ("bulk jobs like re-embedding the whole
//      library are free") applies to precisely those and not to a chat turn
//      a human is waiting on.
//
//   2. frontier-model.ts is STILL the only module in the app that imports
//      @tanstack/ai-anthropic as a value or reads ANTHROPIC_API_KEY. The
//      widening moved which surfaces may ASK for a frontier model; it did
//      not add a second place that can BUILD one. model-policy.test.ts pins
//      that, same as before — only the filename in the assertion changed.
//
//   3. Tier-pairing by construction. A FrontierModel carries its own
//      non-echoing friendlyError, its own redact, and toJSON/inspect hooks
//      that stop `console.log(model)` traversing into the SDK client's live
//      `.apiKey`. Those live ON the returned object, so a caller cannot pair
//      a frontier adapter with the echoing local error mapper.
//
//   4. The key is server-side only and never reaches the browser. The client
//      sends a CHOICE TOKEN ('default' | 'local:<id>' | 'frontier'), never a
//      model id or a key, and the server validates it against the installed
//      Ollama catalogue before constructing anything.
//
// The honest caveat from the original header still stands: `synthesizeDigest`
// accepts a `ResolvedModel` override, so digest synthesis is frontier-reachable
// by inheritance from a caller that already resolved one. Its own default is
// local and digest.test.ts pins that no other caller passes an override.
//
// The `import type` below is erased (verbatimModuleSyntax: true, see
// client/tsconfig.json), so nothing here puts @anthropic-ai/sdk in the import
// graph of the local surfaces.
//
// Why this table does not live in env.ts: env.ts is the leaf module every
// other module imports, and it currently imports nothing. Putting the policy
// there would drag @tanstack/ai-ollama (and `samplingOptions` /
// `friendlyOllamaError`) into the import graph of every consumer of a single
// env constant.

import { createOllamaChat, type OllamaTextAdapter } from '@tanstack/ai-ollama';
import type { AnthropicChatModel, createAnthropicChat } from '@tanstack/ai-anthropic';
import {
  OLLAMA_BASE_URL,
  OLLAMA_CHAT_MODEL,
  OLLAMA_HOST,
  OLLAMA_MODEL,
  OLLAMA_SYNTHESIS_MODEL,
} from '#/lib/env';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';
import { samplingOptions } from '#/lib/services/ollama-model-options';

export type ModelTier = 'frontier' | 'local';

/**
 * Every AI surface that is local by policy.
 *
 * Keys are per MODEL-ID BINDING, not per user-facing feature:
 * `note-summarize` and `note-compose` are one feature on two different
 * models, and the three digest bindings have three different policies.
 * Merging any of those pairs would silently re-point one of each for anyone
 * who sets OLLAMA_SYNTHESIS_MODEL or OLLAMA_CHAT_MODEL — invisible on a
 * default .env, and it would pass every test.
 *
 * Conversely, two call sites that share a model id AND a policy share one
 * key: `api.chat.tsx`'s stream and `learning.ts`'s non-streaming
 * `askAboutVideoService` are both 'video-chat'.
 */
/**
 * Surfaces that are local by policy and NOT user-switchable.
 *
 * These are the bulk / background jobs. CLAUDE.md's operative argument for
 * local-first is economic — "the local-first constraint is what makes bulk jobs
 * like re-embedding the whole library free" — and that argument still holds
 * exactly here even after the 2026-08-27 amendment opened the interactive
 * surfaces to a switcher. A summary pass or a re-extraction runs over the whole
 * library unattended; nothing user-facing chooses its model, so nothing can
 * quietly turn a bulk job into a metered one.
 */
export const LOCAL_ONLY_SURFACES = [
  'summary', //           learning.ts — single-pass, map, reduce, verdict re-rate
  'query-rewrite', //     chat-retrieval.ts RRF leg
  'digest-synthesis', //  digest.ts synthesizeDigest
  'digest-article', //    digest.ts synthesizeDigestArticle
  'music-extraction', //  music-extraction.ts
  'reader', //            reader.ts
  'note-summarize', //    notes.ts summarizeConversationToNote
] as const;

/**
 * Interactive surfaces a user may re-point at another model per request.
 *
 * The line is "a human is waiting for this one answer", not "this feature is
 * important". Each of these is user-initiated, one at a time, and its cost is
 * bounded by someone sitting there — which is what makes an opt-in frontier
 * call reasonable here and not in LOCAL_ONLY_SURFACES.
 *
 * A surface being switchable changes nothing by default: with no explicit
 * choice, `resolveModel(surface)` still returns the same local model it always
 * did, from the same env constant.
 */
export const SWITCHABLE_SURFACES = [
  'video-chat', //    api.chat.tsx (stream) + learning.ts askAboutVideoService
  'digest-chat', //   api.digest-chat.tsx
  'library-ask', //   api.ask.tsx
  'note-compose', //  api.notes.compose.tsx
] as const;

export type LocalOnlySurface = (typeof LOCAL_ONLY_SURFACES)[number];
export type SwitchableSurface = (typeof SWITCHABLE_SURFACES)[number];

/**
 * Every surface whose DEFAULT is local — which is still all of them. Kept as a
 * single list so `resolveModel` and `modelIdFor` keep their exhaustiveness
 * guarantee over the whole set.
 */
export const LOCAL_SURFACES = [
  ...LOCAL_ONLY_SURFACES,
  ...SWITCHABLE_SURFACES,
] as const;

/** True when a surface may be re-pointed by an explicit user choice. */
export function isSwitchableSurface(s: string): s is SwitchableSurface {
  return (SWITCHABLE_SURFACES as readonly string[]).includes(s);
}

export type LocalSurface = (typeof LOCAL_SURFACES)[number];

type FrontierAdapter = ReturnType<typeof createAnthropicChat<AnthropicChatModel>>;

export type LocalModel = {
  tier: 'local';
  adapter: OllamaTextAdapter<string>;
  model: string;
  /** Ollama nests sampling under `.options` and needs a top-level `model`. */
  modelOptions: (temperature: number) => ReturnType<typeof samplingOptions>;
  /** Tier-paired mapper. Local => friendlyOllamaError (safe to echo). */
  friendlyError: (raw: string) => string;
  /** No-op locally; the frontier branch scrubs the API key. */
  redact: (raw: string) => string;
};

export type FrontierModel = {
  tier: 'frontier';
  adapter: FrontierAdapter;
  model: AnthropicChatModel;
  /** Frontier => NO sampling knobs. claude-sonnet-5 400s on `temperature`. */
  modelOptions: (temperature: number) => Record<string, never>;
  /** Tier-paired mapper. Frontier => friendlyAnthropicError (never echoes). */
  friendlyError: (raw: string) => string;
  redact: (raw: string) => string;
  /**
   * Log-safety hooks, supplied by frontier-model.ts's frontier branch.
   *
   * The Anthropic adapter closes over a live SDK client whose `.apiKey`
   * property holds the raw key at depth 2, so plain `console.log(model)` —
   * or a `logPhase(topic, '…', { model })` typo, one character away from the
   * correct `{ model: model.model }` — would print it. `redactAnthropicKey`
   * cannot help: it scrubs strings, and this is object traversal. These two
   * hooks cut the traversal off. Declared on the type (rather than left as
   * excess properties) so removing them is a compile error, not a silent
   * regression. Optional because the LOCAL tier has nothing to hide.
   */
  toJSON: () => { tier: 'frontier'; model: string };
};

export type ResolvedModel = LocalModel | FrontierModel;

/**
 * The local Ollama model lesson generation falls back to when
 * ANTHROPIC_API_KEY is unset. Named separately, and NOT reachable through
 * `modelIdFor`, precisely because a lesson run's model id depends on its
 * tier: a `modelIdFor('lesson')` would return the local id even on a
 * frontier run, and the first caller who stamped it into a persisted row
 * would record a lie. Consumed only by frontier-model.ts's local branch.
 */
export const LESSON_LOCAL_MODEL = OLLAMA_MODEL;

/**
 * The model id for a surface, WITHOUT constructing an adapter. Needed by
 * pure/sync callers: musicExtractionStatus's staleness key, persisted
 * provenance stamps, and log lines that run before the enclosing try (see
 * `localModel`'s note on why construction can throw). Always agrees with
 * resolveModel(s).model — pinned by model-policy.test.ts.
 *
 * The `default: never` is the exhaustiveness gate: adding an entry to
 * LOCAL_SURFACES without declaring its model here fails typecheck, so a new
 * surface can never inherit a model by accident.
 */
export function modelIdFor(surface: LocalSurface): string {
  switch (surface) {
    case 'summary':
    case 'music-extraction':
    case 'reader':
    case 'note-summarize':
    case 'digest-synthesis':
    case 'digest-article':
      return OLLAMA_MODEL;
    case 'video-chat':
    case 'query-rewrite':
    case 'digest-chat':
      return OLLAMA_CHAT_MODEL;
    case 'library-ask':
    case 'note-compose':
      return OLLAMA_SYNTHESIS_MODEL;
    default: {
      const exhaustive: never = surface;
      throw new Error(`Unhandled AI surface: ${String(exhaustive)}`);
    }
  }
}

/**
 * Build a local model binding. Exported because frontier-model.ts's LOCAL
 * branch uses it — the two tiers must produce structurally identical
 * objects or the tier-pairing guarantee is only half true.
 *
 * NOT memoized, deliberately. `createOllamaChat` does no I/O (it assigns
 * config and runs `new URL(host)`), and a cache would reintroduce exactly
 * the process-lifetime binding this module exists to remove — plus it would
 * hold `Ollama.ongoingStreamedRequests` entries for the life of the process
 * on any stream that ends by throw or early break.
 *
 * CAN THROW: `new URL(host)` inside the Ollama client rejects a malformed
 * OLLAMA_BASE_URL with `TypeError: Invalid URL`. That used to happen at
 * import time (an SSR 500 at boot); it now happens per call. Call sites
 * therefore resolve INSIDE their existing try, and use `modelIdFor` for any
 * log line that runs before it. `validateHostOnce` below keeps the
 * boot-time signal.
 */
export function localModel(model: string): LocalModel {
  return {
    tier: 'local',
    adapter: createOllamaChat(model, OLLAMA_HOST),
    model,
    modelOptions: (temperature: number) => samplingOptions(model, temperature),
    friendlyError: friendlyOllamaError,
    redact: (raw: string) => raw,
  };
}

/** The single entry point for every local surface. */
export function resolveModel(surface: LocalSurface): LocalModel {
  return localModel(modelIdFor(surface));
}

// Adapter construction moved from module scope to call time, which moves a
// malformed OLLAMA_BASE_URL from an import-time crash (loud, at boot) to a
// per-request `TypeError: Invalid URL` that friendlyOllamaError does not
// recognise and would echo verbatim. Warn once at load so the boot-time
// signal survives. Mirrors env.ts's validateOnce(): warn, never throw.
let hostValidated = false;
function validateHostOnce() {
  if (hostValidated) return;
  hostValidated = true;
  try {
    new URL(OLLAMA_HOST);
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[model-policy] OLLAMA_BASE_URL=${JSON.stringify(OLLAMA_BASE_URL)} does not parse as a URL (host resolved to ${JSON.stringify(OLLAMA_HOST)}) — every AI call will throw "Invalid URL".`,
    );
  }
}
validateHostOnce();
