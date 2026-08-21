// Chooses which model backs AI lesson generation: a frontier Anthropic
// model when ANTHROPIC_API_KEY is configured, the existing local Ollama
// path otherwise. This is the ONLY place that choice is made —
// lesson-generation.ts calls resolveLessonModel() once and uses whatever it
// gets back; it never branches on tier itself except to pick which
// friendly-error mapper applies to a failure (see anthropic-errors.ts /
// ollama-errors.ts). Both tiers run through the exact same staged pipeline,
// so a frontier lesson and a local lesson are comparable, not divergent
// code paths.
//
// Security: ANTHROPIC_API_KEY is read once, here, via env.ts (server-side
// only — this module is never imported from a client component, same
// boundary STRAPI_API_TOKEN already relies on in strapi-client.ts). The
// key itself never appears in `LessonModel` — only the constructed adapter
// (which the @tanstack/ai-anthropic SDK closes over internally), the tier,
// and the model id. Never log the key. Never return it.
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
import { createOllamaChat } from '@tanstack/ai-ollama';
import type { AnyTextAdapter } from '@tanstack/ai';
import { ANTHROPIC_API_KEY, LESSON_MODEL, OLLAMA_HOST, OLLAMA_MODEL } from '#/lib/env';

export type ModelTier = 'frontier' | 'local';

export type LessonModel = {
  adapter: AnyTextAdapter;
  tier: ModelTier;
  model: string;
};

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
    `[lesson-model] LESSON_MODEL=${JSON.stringify(configured)} is not a recognized Anthropic model id — falling back to ${DEFAULT_FRONTIER_MODEL}. Valid ids: ${ANTHROPIC_MODELS.join(', ')}`,
  );
  return DEFAULT_FRONTIER_MODEL;
}

/**
 * Frontier when ANTHROPIC_API_KEY is set, else local Ollama. The ONLY place
 * this decision is made.
 */
export function resolveLessonModel(): LessonModel {
  if (ANTHROPIC_API_KEY) {
    const model = resolveFrontierModel();
    return {
      adapter: createAnthropicChat(model, ANTHROPIC_API_KEY),
      tier: 'frontier',
      model,
    };
  }
  return {
    adapter: createOllamaChat(OLLAMA_MODEL, OLLAMA_HOST),
    tier: 'local',
    model: OLLAMA_MODEL,
  };
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
