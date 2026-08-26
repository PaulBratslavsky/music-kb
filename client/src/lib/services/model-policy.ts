// Surface → model policy. ONE place decides which model backs which AI
// surface and — the load-bearing part — which surfaces may reach a frontier
// model at all.
//
// LOCAL-FIRST (CLAUDE.md, "Local-first, with exactly one documented
// exception"): every surface in LOCAL_SURFACES resolves to a local Ollama
// adapter, permanently, and that is expressed in the TYPE rather than in a
// config row. `resolveModel` accepts only a LocalSurface and returns only a
// LocalModel, so no env value and no table edit can point summaries, chat,
// extraction, reading mode, notes or digests at Anthropic. Lesson
// generation — the single documented exception — is resolved by
// resolveLessonModel() in lesson-model.ts, which is the ONLY module in the
// app that imports @tanstack/ai-anthropic as a value, and which
// model-policy.test.ts pins to a single importer.
//
// There is deliberately NO `Surface` union and no 'lesson' key here. A
// surface key exists only for surfaces that are local; frontier is not a
// value this module can produce or name, so there is no union for a future
// edit to widen and no second lawful home for a surface key.
//
// ONE HONEST CAVEAT, so nobody reads a stronger claim than is true:
// `synthesizeDigest` accepts a `ResolvedModel` override and lesson
// generation passes its own (possibly frontier) model into it, so digest
// synthesis IS frontier-reachable at runtime by tier inheritance. What
// `resolveModel` guarantees is narrower and still the thing that matters:
// no surface can reach frontier *by resolving its own model*. The digest's
// own default is local, and its only frontier path is an explicit argument
// from the one module allowed to build a frontier adapter.
//
// The `import type` below is erased (verbatimModuleSyntax: true, see
// client/tsconfig.json), so nothing here puts @anthropic-ai/sdk in the
// import graph of learning.ts / api.chat.tsx / the other nine local
// surfaces.
//
// Promoting a surface to frontier therefore takes an edit to THIS file and
// to lesson-model.ts — a reviewed code change, which is the bar CLAUDE.md
// sets. Pinned by model-policy.test.ts.
//
// Why this table does not live in env.ts: env.ts is the leaf module every
// other module imports, and it currently imports nothing. Putting the
// policy there would drag @tanstack/ai-ollama (and `samplingOptions` /
// `friendlyOllamaError`) into the import graph of every consumer of a
// single env constant.

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
export const LOCAL_SURFACES = [
  'summary', //           learning.ts — single-pass, map, reduce, verdict re-rate
  'video-chat', //        api.chat.tsx (stream) + learning.ts askAboutVideoService
  'query-rewrite', //     chat-retrieval.ts RRF leg
  'digest-chat', //       api.digest-chat.tsx
  'digest-synthesis', //  digest.ts synthesizeDigest
  'digest-article', //    digest.ts synthesizeDigestArticle
  'music-extraction', //  music-extraction.ts
  'reader', //            reader.ts
  'note-summarize', //    notes.ts summarizeConversationToNote
  'note-compose', //      api.notes.compose.tsx
  'library-ask', //       api.ask.tsx
] as const;

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
   * Log-safety hooks, supplied by lesson-model.ts's frontier branch.
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
 * would record a lie. Consumed only by lesson-model.ts's local branch.
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
 * Build a local model binding. Exported because lesson-model.ts's LOCAL
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
