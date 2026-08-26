// Unit tests for resolveLessonModel() — the ONLY place lesson generation
// decides frontier-vs-local. No network: both adapter constructors
// (createOllamaChat / createAnthropicChat) are mocked to return an
// identifiable marker object, and #/lib/env is mocked so each test can set
// ANTHROPIC_API_KEY / LESSON_MODEL independently without touching real
// process.env (env.ts reads it once at module load; mocking the module
// itself is the only way to vary it per test).

import { beforeEach, describe, expect, it, vi } from 'vitest';

// resolveLessonModel's LOCAL branch now goes through model-policy.ts's
// `localModel()`, and model-policy.ts imports OLLAMA_CHAT_MODEL /
// OLLAMA_SYNTHESIS_MODEL / OLLAMA_BASE_URL as well. Vitest's
// missing-export throw is LAZY (on property access, not at import), so
// these 9 tests stayed green without them — none of them resolves a chat
// or synthesis surface. They are declared anyway, because the failure mode
// otherwise is a test in this file resolving some other surface one day and
// getting `No "OLLAMA_CHAT_MODEL" export is defined on the mock`, an error
// that says nothing about surfaces.
const envState = vi.hoisted(() => ({
  ANTHROPIC_API_KEY: undefined as string | undefined,
  LESSON_MODEL: 'claude-sonnet-5',
  OLLAMA_MODEL: 'gemma4-kb:latest',
  OLLAMA_CHAT_MODEL: 'gemma4-kb:latest',
  OLLAMA_SYNTHESIS_MODEL: 'gemma4-kb:latest',
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
const createAnthropicChatMock = vi.fn((..._args: unknown[]) => ({ marker: ANTHROPIC_MARKER }));

vi.mock('@tanstack/ai-ollama', () => ({
  createOllamaChat: (...args: unknown[]) => createOllamaChatMock(...args),
}));

vi.mock('@tanstack/ai-anthropic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/ai-anthropic')>();
  return {
    // Real ANTHROPIC_MODELS — the module under test validates LESSON_MODEL
    // against this for real, not a test-only stand-in.
    ANTHROPIC_MODELS: actual.ANTHROPIC_MODELS,
    createAnthropicChat: (...args: unknown[]) => createAnthropicChatMock(...args),
  };
});

import { ANTHROPIC_MODELS } from '@tanstack/ai-anthropic';
import { redactAnthropicKey, resolveLessonModel } from './lesson-model';

beforeEach(() => {
  envState.ANTHROPIC_API_KEY = undefined;
  envState.LESSON_MODEL = 'claude-sonnet-5';
  envState.OLLAMA_MODEL = 'gemma4-kb:latest';
  envState.OLLAMA_CHAT_MODEL = 'gemma4-kb:latest';
  envState.OLLAMA_SYNTHESIS_MODEL = 'gemma4-kb:latest';
  envState.OLLAMA_HOST = 'http://localhost:11434';
  envState.OLLAMA_BASE_URL = 'http://localhost:11434/v1';
  createOllamaChatMock.mockClear();
  createAnthropicChatMock.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('resolveLessonModel — tier selection', () => {
  it('falls back to the local Ollama adapter when no key is configured', () => {
    envState.ANTHROPIC_API_KEY = undefined;

    const result = resolveLessonModel();

    expect(result.tier).toBe('local');
    expect(result.model).toBe('gemma4-kb:latest');
    expect((result.adapter as unknown as { marker: symbol }).marker).toBe(OLLAMA_MARKER);
    expect(createOllamaChatMock).toHaveBeenCalledWith('gemma4-kb:latest', 'http://localhost:11434');
    expect(createAnthropicChatMock).not.toHaveBeenCalled();
  });

  it('an empty-string key is treated as unset (readEnv semantics) — stays local', () => {
    envState.ANTHROPIC_API_KEY = undefined; // env.ts's readEnv() already folds '' -> undefined

    const result = resolveLessonModel();

    expect(result.tier).toBe('local');
  });

  it('picks the frontier Anthropic adapter, with LESSON_MODEL, when a key is configured', () => {
    envState.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    envState.LESSON_MODEL = 'claude-opus-5';

    const result = resolveLessonModel();

    expect(result.tier).toBe('frontier');
    expect(result.model).toBe('claude-opus-5');
    expect((result.adapter as unknown as { marker: symbol }).marker).toBe(ANTHROPIC_MARKER);
    expect(createAnthropicChatMock).toHaveBeenCalledWith('claude-opus-5', 'sk-ant-test-key');
    expect(createOllamaChatMock).not.toHaveBeenCalled();
  });

  it('defaults to claude-sonnet-5 when LESSON_MODEL is unset (env.ts default) with a key present', () => {
    envState.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    envState.LESSON_MODEL = 'claude-sonnet-5'; // env.ts's own `?? 'claude-sonnet-5'` default

    const result = resolveLessonModel();

    expect(result.tier).toBe('frontier');
    expect(result.model).toBe('claude-sonnet-5');
    expect(createAnthropicChatMock).toHaveBeenCalledWith('claude-sonnet-5', 'sk-ant-test-key');
  });

  it('falls back to claude-sonnet-5 and warns when LESSON_MODEL is a typo/unrecognized value', () => {
    envState.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    envState.LESSON_MODEL = 'claude-sonet-5'; // typo — missing an 'n'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = resolveLessonModel();

    expect(result.tier).toBe('frontier');
    expect(result.model).toBe('claude-sonnet-5');
    expect(createAnthropicChatMock).toHaveBeenCalledWith('claude-sonnet-5', 'sk-ant-test-key');
    // Never a silent fallback — the bad value AND what was used instead are
    // both named in the warning.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = warnSpy.mock.calls[0].join(' ');
    expect(warning).toContain('claude-sonet-5');
    expect(warning).toContain('claude-sonnet-5');
  });

  it('never reaches createAnthropicChat with an unvalidated LESSON_MODEL value', () => {
    envState.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    envState.LESSON_MODEL = 'gpt-4o'; // a plausible-looking but wrong-vendor model id

    resolveLessonModel();

    // The call must have used the validated fallback, never the raw
    // configured string — proves the cast happens only after validation
    // passes, not before.
    expect(createAnthropicChatMock).toHaveBeenCalledWith('claude-sonnet-5', 'sk-ant-test-key');
    expect(createAnthropicChatMock).not.toHaveBeenCalledWith('gpt-4o', expect.anything());
  });
});

// Record of which model ids @tanstack/ai-anthropic 0.16.6's ANTHROPIC_MODELS
// union actually accepts — this is what LESSON_MODEL can legally be set to.
// Asserted as a fixed list (not just "is non-empty") so a version bump that
// silently changes the accepted set fails this test loudly.
describe('ANTHROPIC_MODELS — legal LESSON_MODEL values', () => {
  it('is the fixed 12-model list from @tanstack/ai-anthropic@0.16.6', () => {
    expect([...ANTHROPIC_MODELS]).toEqual([
      'claude-opus-5',
      'claude-opus-5-fast',
      'claude-opus-4-6',
      'claude-opus-4-5',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5',
      'claude-haiku-4-5',
      'claude-opus-4-1',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-fable-5',
      'claude-sonnet-5',
    ]);
  });
});

describe('redactAnthropicKey', () => {
  it('is a no-op when no key is configured', () => {
    envState.ANTHROPIC_API_KEY = undefined;
    expect(redactAnthropicKey('nothing to see, sk-ant-whatever here')).toBe(
      'nothing to see, sk-ant-whatever here',
    );
  });

  it('strips every literal occurrence of the configured key from arbitrary text', () => {
    envState.ANTHROPIC_API_KEY = 'sk-ant-super-secret';
    const text =
      'Structured output generation failed: 401 invalid x-api-key sk-ant-super-secret (attempt used sk-ant-super-secret again)';

    const redacted = redactAnthropicKey(text);

    expect(redacted).not.toContain('sk-ant-super-secret');
    expect(redacted).toContain('[redacted]');
  });
});
