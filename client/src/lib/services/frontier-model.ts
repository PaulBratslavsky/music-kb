// Chooses which model backs AI lesson generation: a frontier Anthropic
// model when ANTHROPIC_API_KEY is configured, the existing local Ollama
// path otherwise. Lesson generation is the ONE documented exception to
// local-first (CLAUDE.md, decided 2026-08-21); every other AI surface is
// resolved by `resolveModel(surface)` in model-policy.ts, whose return type
// cannot be frontier.
//
// THIS IS THE ONLY MODULE IN THE APP THAT IMPORTS @tanstack/ai-anthropic AS
// A VALUE, and the only module that reads ANTHROPIC_API_KEY. That is the
// enforcement mechanism for the local-first rule, and it is not a
// convention: model-policy.test.ts pins (a) that this file is the sole
// value-importer of the Anthropic adapter, (b) that model-policy.ts imports
// it type-only, and (c) that `resolveLessonModel` has exactly one importer,
// lesson-generation.ts. Widening the exception therefore takes a code change
// in two named modules and turns a test red — which is the "same kind of
// evidence" bar CLAUDE.md sets, mechanised.
//
// lesson-generation.ts calls resolveLessonModel() once per run and uses
// whatever it gets back; it never branches on tier itself — the friendly-
// error mapper and the modelOptions shape are members OF the returned
// object, so the wrong pairing is unrepresentable. Both tiers run through
// the exact same staged pipeline, so a frontier lesson and a local lesson
// are comparable, not divergent code paths.
//
// Security: ANTHROPIC_API_KEY is read once, here, via env.ts (server-side
// only — this module is never imported from a client component, same
// boundary STRAPI_API_TOKEN already relies on in strapi-client.ts). The
// key never appears as a property of the returned model — only the
// constructed adapter (which the @tanstack/ai-anthropic SDK closes over
// internally), the tier, and the model id. The adapter's internal client
// DOES hold the raw key at `.client.apiKey`, so the frontier object carries
// `toJSON` + a custom-inspect hook to keep `console.log(model)` from
// traversing into it. Never log the key. Never return it.
//
// `@tanstack/ai-anthropic` is pinned at 0.16.6, NOT the 0.17.0 the original
// brief for this feature named — 0.17.0 declares a peer of
// `@tanstack/ai@^0.47.3` and fails at import time against this repo's
// pinned `@tanstack/ai@0.45.1` (`adapter-internals` doesn't export
// `assertUniqueToolNames` at 0.45.1 — that landed in core between 0.45.1
// and 0.47.3). 0.16.6 declares `@tanstack/ai@^0.45.0`, which the pinned
// 0.45.1 satisfies, and both imports and typechecks clean. Do not bump
// `@tanstack/ai` to chase 0.17.0 — that upgrade is its own task (see
// task-3-report.md).

import {
  ANTHROPIC_MODELS,
  createAnthropicChat,
  type AnthropicChatModel,
} from '@tanstack/ai-anthropic';
import { ANTHROPIC_API_KEY, LESSON_MODEL } from '#/lib/env';
import { friendlyAnthropicError } from '#/lib/services/anthropic-errors';
import {
  LESSON_LOCAL_MODEL,
  localModel,
  resolveModel,
  type FrontierModel,
  type ResolvedModel,
  type SwitchableSurface,
} from '#/lib/services/model-policy';

const DEFAULT_FRONTIER_MODEL: AnthropicChatModel = 'claude-sonnet-5';

// `createAnthropicChat`'s TModel generic is constrained to this literal
// union (unlike createOllamaChat's plain `TModel extends string`), so a
// runtime env string can't be handed to it directly. LESSON_MODEL is a
// runtime string, so it MUST be validated against this list before being
// cast — an env typo needs to fall back loudly (logged), not turn into an
// `as` cast that ships a value the adapter was never built to accept and
// fails silently at the API boundary instead of at config time.
function resolveFrontierModel(): AnthropicChatModel {
  const configured = LESSON_MODEL;
  if ((ANTHROPIC_MODELS as readonly string[]).includes(configured)) {
    return configured as AnthropicChatModel;
  }
  // eslint-disable-next-line no-console
  console.warn(
    `[frontier-model] LESSON_MODEL=${JSON.stringify(configured)} is not a recognized Anthropic model id — falling back to ${DEFAULT_FRONTIER_MODEL}. Valid ids: ${ANTHROPIC_MODELS.join(', ')}`,
  );
  return DEFAULT_FRONTIER_MODEL;
}

/**
 * Frontier when ANTHROPIC_API_KEY is set, else local Ollama. The ONLY place
 * this decision is made, and the ONLY place in the app that constructs an
 * Anthropic adapter.
 *
 * NEVER call `createAnthropicChat(model, undefined)` to "fall back". The
 * vendored @anthropic-ai/sdk's constructor does
 * `if (apiKey === undefined) apiKey = readEnv('ANTHROPIC_API_KEY') ?? null`
 * (client.mjs:71), so an undefined key yields a *working* frontier client
 * off the ambient environment. The `if (ANTHROPIC_API_KEY)` below IS the
 * tier gate; nothing may construct that adapter outside it.
 */
/**
 * Build the frontier binding. THE only place in the app an Anthropic adapter is
 * constructed — extracted from resolveLessonModel so lesson generation and the
 * interactive surfaces share one construction rather than two copies that could
 * drift on the log-safety hooks.
 *
 * Callers must have checked ANTHROPIC_API_KEY first; `key` is passed in so the
 * `if (ANTHROPIC_API_KEY)` tier gate stays visible at each call site rather than
 * being buried here. NEVER call createAnthropicChat with an undefined key: the
 * vendored SDK falls back to reading the ambient env var and would yield a
 * WORKING frontier client, silently defeating the gate.
 */
function buildFrontierModel(model: AnthropicChatModel, key: string): FrontierModel {
  return {
    tier: 'frontier',
    adapter: createAnthropicChat(model, key),
    model,
    // Frontier: send NO sampling knobs. Newer Anthropic models reject
    // `temperature` outright — claude-sonnet-5 answers a request carrying
    // it with `400 invalid_request_error: \`temperature\` is deprecated
    // for this model.`, which fails the whole generation. The local twin
    // still needs it, so the knob is tier-specific rather than dropped
    // everywhere. `temperature` is accepted and deliberately unused.
    modelOptions: () => ({}),
    // Tier-paired by construction: the object that carries the frontier
    // adapter is the object that carries the non-echoing mapper, so there
    // is no `tier` value left for a caller to pair wrongly.
    friendlyError: (raw: string) => friendlyAnthropicError(redactAnthropicKey(raw)),
    redact: redactAnthropicKey,
    // The adapter closes over a live `Anthropic` client whose `.apiKey`
    // property holds the raw key, reachable at depth 2 — so a bare
    // `console.log(model)` or a `logPhase(..., { model })` typo would
    // print it (verified: util.inspect(adapter, {depth: 2}) contains the
    // key). redactAnthropicKey cannot help there; it scrubs strings and
    // this is object traversal. These two hooks make the resolved object
    // safe to log by any route, and model-policy.test.ts pins it.
    toJSON: () => ({ tier: 'frontier', model }),
    [Symbol.for('nodejs.util.inspect.custom')]: () => `FrontierModel(${model})`,
  } as FrontierModel;
}

export function resolveLessonModel(): ResolvedModel {
  if (ANTHROPIC_API_KEY) {
    const model = resolveFrontierModel();
    const frontier: FrontierModel = buildFrontierModel(model, ANTHROPIC_API_KEY);
    return frontier;
  }
  return localModel(LESSON_LOCAL_MODEL);
}

/**
 * Defense in depth for the "never logged, not even partially" rule.
 * Verified against @tanstack/ai-anthropic 0.16.6 + @anthropic-ai/sdk
 * 0.97.1: an auth failure's `error.message` never actually contains the
 * submitted key (Anthropic's API error body only ever names the *header*,
 * e.g. "invalid x-api-key", never the value) — but callers (logPhase,
 * friendly-error mapping) should not have to re-derive that guarantee or
 * re-verify it survives a future SDK bump. Scrub any literal occurrence of
 * the configured key out of arbitrary text before it's logged or surfaced,
 * so the guarantee holds even if that assumption ever stops being true.
 * A no-op when no key is configured.
 */
export function redactAnthropicKey(text: string): string {
  if (!ANTHROPIC_API_KEY) return text;
  return text.split(ANTHROPIC_API_KEY).join('[redacted]');
}

// -----------------------------------------------------------------------------
// Per-request model choice for the INTERACTIVE surfaces (CLAUDE.md amendment
// 2026-08-27, ADR 0011)
// -----------------------------------------------------------------------------
//
// This section is why the module is named `frontier-model` rather than
// `lesson-model`: lesson generation is no longer the only caller that may ask
// for a frontier model. It is still the only PLACE one can be built — the
// structural test that used to pin "only lesson-model.ts calls
// createAnthropicChat" now pins this file, and everything it guarded still
// holds.

/**
 * A model choice as it crosses the wire.
 *
 *   'default'          — the surface's configured local model. Unchanged behaviour.
 *   'local:<model-id>' — a specific installed Ollama model.
 *   'frontier'         — the configured Anthropic model.
 *
 * Deliberately a TOKEN, not a model id or an adapter config. The browser must
 * never be able to hand the server an arbitrary model string: `local:` ids are
 * validated against the installed Ollama catalogue before an adapter is built,
 * and 'frontier' resolves through the same `LESSON_MODEL` allow-list check that
 * already guards lesson generation.
 */
export type ModelChoiceToken = string;

export type ParsedModelChoice =
  | { tier: 'default' }
  | { tier: 'local'; model: string }
  | { tier: 'frontier' };

/** Parse a wire token. Unknown shapes fall back to 'default' rather than throw. */
export function parseModelChoice(token: unknown): ParsedModelChoice {
  if (typeof token !== 'string' || token === '' || token === 'default') {
    return { tier: 'default' };
  }
  if (token === 'frontier') return { tier: 'frontier' };
  if (token.startsWith('local:')) {
    const model = token.slice('local:'.length).trim();
    return model ? { tier: 'local', model } : { tier: 'default' };
  }
  return { tier: 'default' };
}

/** True when a frontier choice is actually available in this deployment. */
export function frontierAvailable(): boolean {
  return Boolean(ANTHROPIC_API_KEY);
}

/**
 * Resolve the model for one interactive request.
 *
 * `allowedLocalModels` is the installed Ollama catalogue, supplied by the
 * caller (which has already fetched it) so this module stays free of I/O. A
 * `local:` choice outside that list is REFUSED rather than silently downgraded:
 * a typo'd or injected model id must not quietly answer from a different model
 * than the UI claims, because the answer gets attributed to the model the
 * picker is showing.
 *
 * A 'frontier' choice with no ANTHROPIC_API_KEY falls back to the surface
 * default and says so in the returned `notice`, matching how lesson generation
 * already degrades.
 */
export function resolveChatModel(
  surface: SwitchableSurface,
  token: ModelChoiceToken | undefined,
  allowedLocalModels: readonly string[],
): { model: ResolvedModel; notice?: string } {
  const choice = parseModelChoice(token);

  if (choice.tier === 'frontier') {
    if (!ANTHROPIC_API_KEY) {
      return {
        model: resolveModel(surface),
        notice:
          'A frontier model was requested but ANTHROPIC_API_KEY is not set — answered with the local default.',
      };
    }
    const model = resolveFrontierModel();
    return { model: buildFrontierModel(model, ANTHROPIC_API_KEY) };
  }

  if (choice.tier === 'local') {
    if (!allowedLocalModels.includes(choice.model)) {
      return {
        model: resolveModel(surface),
        notice: `Model ${JSON.stringify(choice.model)} is not installed on this Ollama host — answered with the local default.`,
      };
    }
    return { model: localModel(choice.model) };
  }

  return { model: resolveModel(surface) };
}
