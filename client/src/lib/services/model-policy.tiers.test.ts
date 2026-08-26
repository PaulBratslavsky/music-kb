// THE LOCAL-FIRST PIN, part 2 of 2: env-varying + constructor spying.
//
// Sibling of `model-policy.test.ts`, which asserts on REAL adapters and so
// can mock nothing. This file is the opposite half: `#/lib/env` is mocked so
// each test can set ANTHROPIC_API_KEY / the three OLLAMA_* constants
// independently (env.ts reads process.env once at module load — mocking the
// module is the only way to vary it per test), and both adapter
// constructors are spied.
//
// The assertion this file exists for:
//
//     ANTHROPIC_API_KEY IS SET, AND createAnthropicChat IS NEVER CALLED
//     FOR ANY OF THE ELEVEN LOCAL SURFACES.
//
// Asserting `tier === 'local'` alone would pass while an Anthropic client
// was quietly being constructed on the way there. "Never called" is the
// assertion that bites.

import { inspect } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
  ANTHROPIC_API_KEY: undefined as string | undefined,
  LESSON_MODEL: 'claude-sonnet-5',
  OLLAMA_MODEL: 'gemma4-kb:latest',
  OLLAMA_CHAT_MODEL: 'chat-model:latest',
  OLLAMA_SYNTHESIS_MODEL: 'synthesis-model:latest',
  OLLAMA_HOST: 'http://localhost:11434',
  OLLAMA_BASE_URL: 'http://localhost:11434/v1',
}));

vi.mock('#/lib/env', () => ({
  get ANTHROPIC_API_KEY() {
    return envState.ANTHROPIC_API_KEY;
  },
  get LESSON_MODEL() {
    return envState.LESSON_MODEL;
  },
  get OLLAMA_MODEL() {
    return envState.OLLAMA_MODEL;
  },
  get OLLAMA_CHAT_MODEL() {
    return envState.OLLAMA_CHAT_MODEL;
  },
  get OLLAMA_SYNTHESIS_MODEL() {
    return envState.OLLAMA_SYNTHESIS_MODEL;
  },
  get OLLAMA_HOST() {
    return envState.OLLAMA_HOST;
  },
  get OLLAMA_BASE_URL() {
    return envState.OLLAMA_BASE_URL;
  },
}));

const OLLAMA_MARKER = Symbol('ollama-adapter');
const ANTHROPIC_MARKER = Symbol('anthropic-adapter');
const createOllamaChatMock = vi.fn((..._args: unknown[]) => ({ marker: OLLAMA_MARKER }));
// The spy returns an object that HOLDS THE KEY the way the real adapter
// does. Measured against @tanstack/ai-anthropic 0.16.6 + @anthropic-ai/sdk:
// `adapter.client.apiKey` is the raw key, reachable at depth 2 — which is
// Node's default inspect depth. A spy that returned a bare marker would make
// the key-containment test below pass vacuously; it was written that way
// first, and a mutation test that deleted the inspect hook stayed green.
const createAnthropicChatMock = vi.fn((_model?: unknown, apiKey?: unknown) => ({
  marker: ANTHROPIC_MARKER,
  client: { apiKey },
}));

vi.mock('@tanstack/ai-ollama', () => ({
  createOllamaChat: (...args: unknown[]) => createOllamaChatMock(...args),
}));

vi.mock('@tanstack/ai-anthropic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/ai-anthropic')>();
  return {
    // Real ANTHROPIC_MODELS — resolveFrontierModel validates LESSON_MODEL
    // against this for real, not against a test-only stand-in.
    ANTHROPIC_MODELS: actual.ANTHROPIC_MODELS,
    createAnthropicChat: (...args: unknown[]) => createAnthropicChatMock(...args),
  };
});

import { LOCAL_SURFACES, modelIdFor, resolveModel } from './model-policy';
import { resolveLessonModel } from './lesson-model';

beforeEach(() => {
  envState.ANTHROPIC_API_KEY = undefined;
  envState.LESSON_MODEL = 'claude-sonnet-5';
  envState.OLLAMA_MODEL = 'gemma4-kb:latest';
  envState.OLLAMA_CHAT_MODEL = 'chat-model:latest';
  envState.OLLAMA_SYNTHESIS_MODEL = 'synthesis-model:latest';
  createOllamaChatMock.mockClear();
  createAnthropicChatMock.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('local-first policy — a configured ANTHROPIC_API_KEY changes NOTHING for local surfaces', () => {
  it.each([...LOCAL_SURFACES])(
    'resolveModel(%s) stays local and constructs no Anthropic client, key present',
    (surface) => {
      envState.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const m = resolveModel(surface);

      expect(m.tier).toBe('local');
      expect((m.adapter as unknown as { marker: symbol }).marker).toBe(OLLAMA_MARKER);
      // The assertion that bites: proves no Anthropic client was built on
      // the way to producing that `tier: 'local'` string.
      expect(createAnthropicChatMock).not.toHaveBeenCalled();
      expect(createOllamaChatMock).toHaveBeenCalledWith(modelIdFor(surface), envState.OLLAMA_HOST);
    },
  );

  it('each surface follows its OWN env constant, not a neighbour\'s', () => {
    // Re-pointing OLLAMA_CHAT_MODEL must move video-chat / query-rewrite /
    // digest-chat and nothing else. This is the guard against the "merge
    // note-summarize with note-compose" class of silent re-pointing, which
    // is invisible on a default .env where all three constants collapse to
    // the same value.
    envState.OLLAMA_MODEL = 'model-A';
    envState.OLLAMA_CHAT_MODEL = 'model-B';
    envState.OLLAMA_SYNTHESIS_MODEL = 'model-C';

    expect(resolveModel('summary').model).toBe('model-A');
    expect(resolveModel('music-extraction').model).toBe('model-A');
    expect(resolveModel('reader').model).toBe('model-A');
    expect(resolveModel('note-summarize').model).toBe('model-A');
    expect(resolveModel('digest-synthesis').model).toBe('model-A');
    expect(resolveModel('digest-article').model).toBe('model-A');
    expect(resolveModel('video-chat').model).toBe('model-B');
    expect(resolveModel('query-rewrite').model).toBe('model-B');
    expect(resolveModel('digest-chat').model).toBe('model-B');
    expect(resolveModel('library-ask').model).toBe('model-C');
    expect(resolveModel('note-compose').model).toBe('model-C');
  });
});

describe('frontier tier — shape, pairing, and key containment', () => {
  it('resolveLessonModel is the ONLY thing that produces a frontier model', () => {
    envState.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    const m = resolveLessonModel();

    expect(m.tier).toBe('frontier');
    expect((m.adapter as unknown as { marker: symbol }).marker).toBe(ANTHROPIC_MARKER);
    // Frontier sends NO sampling knobs — claude-sonnet-5 answers a request
    // carrying `temperature` with a 400 invalid_request_error.
    expect(m.modelOptions(0.3)).toEqual({});
    // The non-echoing mapper, paired to the tier by being a member of the
    // same object the adapter is on. There is no `tier` value left for a
    // caller to hand to the wrong function.
    expect(m.friendlyError('some raw provider payload nobody recognises')).toBe(
      'Frontier AI request failed. Check server logs for detail, or leave ANTHROPIC_API_KEY unset to use the local model instead.',
    );
    expect(m.friendlyError('401 authentication_error')).toContain('ANTHROPIC_API_KEY');
  });

  it('the local fallback branch produces the SAME shape as the frontier branch', () => {
    envState.ANTHROPIC_API_KEY = undefined;

    const m = resolveLessonModel();

    expect(m.tier).toBe('local');
    expect(m.model).toBe('gemma4-kb:latest');
    expect(createAnthropicChatMock).not.toHaveBeenCalled();
    expect(createOllamaChatMock).toHaveBeenCalledWith('gemma4-kb:latest', 'http://localhost:11434');
    // Structurally identical to the frontier twin, tier-specific values. If
    // these diverge, "the wrong pairing is unrepresentable" is only half
    // true and lesson-generation.ts reads `undefined` at a call site.
    expect(typeof m.modelOptions).toBe('function');
    expect(typeof m.friendlyError).toBe('function');
    expect(typeof m.redact).toBe('function');
    expect(m.modelOptions(0.3)).toEqual({
      model: 'gemma4-kb:latest',
      options: { temperature: 0.3 },
    });
    // Local echoes; frontier cans. The two must not be the same function.
    expect(m.friendlyError('unrecognised blurb')).toBe('unrecognised blurb');
  });

  it('a resolved frontier model cannot leak the API key through console.log', () => {
    // RED without the `toJSON` + custom-inspect hooks on the frontier
    // object. Measured against @tanstack/ai-anthropic 0.16.6 +
    // @anthropic-ai/sdk 0.97.1: `adapter.client.apiKey` IS the raw key, and
    // Node's default inspect depth is 2 — so a bare `console.log(model)`, or
    // a `logPhase(topic, '…', { model })` typo one character away from the
    // correct `{ model: model.model }`, prints it. redactAnthropicKey cannot
    // help there: it scrubs strings, and this is object traversal.
    //
    // The adapter here is the spy, so this cannot observe the real client's
    // reachability — it pins the CONTAINMENT, which is the part that lives
    // in our code and can regress.
    envState.ANTHROPIC_API_KEY = 'sk-ant-leak-canary-value';

    const m = resolveLessonModel();

    // Controls: the key really IS reachable from this object's adapter — at
    // Node's DEFAULT inspect depth of 2, which is what `console.log` uses.
    // So the assertions below are testing the containment hooks, not an
    // inspect-depth accident. (`{...m}` would not work as the control: a
    // spread copies symbol-keyed own properties, so it carries the custom
    // inspect hook along with it.)
    expect(inspect(m.adapter, { depth: 2 })).toContain('sk-ant-leak-canary-value');
    const unhooked = { tier: m.tier, model: m.model, adapter: m.adapter };
    expect(inspect(unhooked)).toContain('sk-ant-leak-canary-value');

    expect(inspect(m, { depth: 6 })).not.toContain('sk-ant-leak-canary-value');
    expect(inspect(m)).not.toContain('sk-ant-leak-canary-value');
    expect(JSON.stringify(m)).toBe('{"tier":"frontier","model":"claude-sonnet-5"}');
  });

  it('a LOCAL resolved model needs no hooks — nothing in it holds a secret', () => {
    envState.ANTHROPIC_API_KEY = 'sk-ant-leak-canary-value';
    const m = resolveModel('summary');
    expect(inspect(m, { depth: 6 })).not.toContain('sk-ant-leak-canary-value');
  });
});
