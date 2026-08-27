import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The modules under test read env at import time, so stub before importing.
vi.mock('#/lib/env', () => ({
  OLLAMA_HOST: 'http://localhost:11434',
  OLLAMA_BASE_URL: 'http://localhost:11434/v1',
  OLLAMA_MODEL: 'gemma4-kb:latest',
  OLLAMA_CHAT_MODEL: 'gemma4-kb:latest',
  OLLAMA_SYNTHESIS_MODEL: 'gemma4-kb:latest',
  ANTHROPIC_API_KEY: '',
  LESSON_MODEL: 'claude-sonnet-5',
}));

const { parseModelChoice, resolveChatModel, frontierAvailable } = await import(
  './frontier-model'
);
const { listInstalledOllamaModels } = await import('./ollama-catalog');

describe('parseModelChoice — the wire token is never trusted', () => {
  it('treats absent/empty/unknown tokens as the surface default', () => {
    for (const token of [undefined, null, '', 'default', 'garbage', 42, {}]) {
      expect(parseModelChoice(token)).toEqual({ tier: 'default' });
    }
  });

  it('parses a local id', () => {
    expect(parseModelChoice('local:qwen3:14b')).toEqual({
      tier: 'local',
      model: 'qwen3:14b',
    });
  });

  it('parses frontier', () => {
    expect(parseModelChoice('frontier')).toEqual({ tier: 'frontier' });
  });

  it('a bare "local:" with no id is the default, not an empty model name', () => {
    // An empty model id would reach createOllamaChat and fail deep in the
    // adapter with "model is required" rather than here.
    expect(parseModelChoice('local:')).toEqual({ tier: 'default' });
    expect(parseModelChoice('local:   ')).toEqual({ tier: 'default' });
  });
});

describe('resolveChatModel — an uninstalled model is REFUSED, not downgraded silently', () => {
  const installed = ['qwen3:14b', 'gemma4:26b', 'gemma4-kb:latest'];

  it('honours an installed local choice', () => {
    const { model, notice } = resolveChatModel('video-chat', 'local:qwen3:14b', installed);
    expect(model.tier).toBe('local');
    expect(model.model).toBe('qwen3:14b');
    expect(notice).toBeUndefined();
  });

  it('falls back WITH A NOTICE when the model is not installed', () => {
    // The notice is the point: answering from a different model than the
    // picker displays, silently, would misattribute the answer.
    const { model, notice } = resolveChatModel(
      'video-chat',
      'local:not-installed:70b',
      installed,
    );
    expect(model.tier).toBe('local');
    expect(model.model).toBe('gemma4-kb:latest');
    expect(notice).toMatch(/not installed/i);
  });

  it('a default choice resolves the surface default with no notice', () => {
    const { model, notice } = resolveChatModel('video-chat', 'default', installed);
    expect(model.tier).toBe('local');
    expect(notice).toBeUndefined();
  });

  it('frontier without a key falls back to local and says so', () => {
    // ANTHROPIC_API_KEY is '' in the mock above.
    expect(frontierAvailable()).toBe(false);
    const { model, notice } = resolveChatModel('video-chat', 'frontier', installed);
    expect(model.tier).toBe('local');
    expect(notice).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('a resolved local model carries the ECHOING error mapper (tier pairing)', () => {
    const { model } = resolveChatModel('video-chat', 'local:qwen3:14b', installed);
    expect(model.tier).toBe('local');
    // Local errors are safe to echo; frontier ones are not. The pairing lives
    // on the object so a caller cannot mismatch them.
    expect(model.redact('anything')).toBe('anything');
  });
});

describe('ollama-catalog — embedding models never reach the chat picker', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockTags(models: Array<{ name: string; family?: string }>) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: models.map((m) => ({
          name: m.name,
          size: 1000,
          details: { family: m.family, parameter_size: '14B' },
        })),
      }),
    }) as never;
  }

  it('filters embedding families and id hints, keeps chat models', async () => {
    mockTags([
      { name: 'qwen3:14b', family: 'qwen3' },
      { name: 'gemma4:26b', family: 'gemma4' },
      { name: 'nomic-embed-text:latest', family: 'nomic-bert' },
      { name: 'all-minilm:latest', family: 'bert' },
    ]);
    const out = await listInstalledOllamaModels();
    expect(out.map((m) => m.id)).toEqual(['gemma4:26b', 'qwen3:14b']);
  });

  it('an unreachable Ollama yields [] rather than throwing', async () => {
    // The picker degrading to "default only" must not take down the chat page.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    await expect(listInstalledOllamaModels()).resolves.toEqual([]);
  });

  it('a non-OK response yields [] rather than throwing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false }) as never;
    await expect(listInstalledOllamaModels()).resolves.toEqual([]);
  });

  it('malformed JSON yields [] rather than throwing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    }) as never;
    await expect(listInstalledOllamaModels()).resolves.toEqual([]);
  });
});
