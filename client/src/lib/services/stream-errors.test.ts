import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, toServerSentEventsResponse, type StreamChunk } from '@tanstack/ai';
import { withFriendlyErrors } from './stream-errors';
import type { ResolvedModel } from './model-policy';
import { friendlyOllamaError } from './ollama-errors';
import { friendlyAnthropicError } from './anthropic-errors';

// Stand-in models, built to the same shape model-policy.ts / frontier-model.ts
// produce. Only the four members this module touches are populated: the
// adapter is never used here, so it is not constructed (which also keeps
// @tanstack/ai-anthropic out of this test's import graph, exactly as
// model-policy.test.ts requires of every module but frontier-model.ts).
const FAKE_KEY = 'sk-ant-fake-000';

const local = {
  tier: 'local',
  model: 'gemma3:4b',
  friendlyError: friendlyOllamaError,
  redact: (raw: string) => raw,
} as unknown as ResolvedModel;

const frontier = {
  tier: 'frontier',
  model: 'claude-sonnet-5',
  // Same composition frontier-model.ts:121 uses: redact, then the
  // never-echoing mapper.
  friendlyError: (raw: string) =>
    friendlyAnthropicError(raw.split(FAKE_KEY).join('[redacted]')),
  redact: (raw: string) => raw.split(FAKE_KEY).join('[redacted]'),
} as unknown as ResolvedModel;

function streamOf(...chunks: unknown[]): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c as StreamChunk;
    },
  };
}

function throwingStream(err: unknown): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'partial' } as StreamChunk;
      throw err;
    },
  };
}

async function drain(
  stream: AsyncIterable<StreamChunk>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for await (const chunk of stream) out.push(chunk as Record<string, unknown>);
  return out;
}

describe('withFriendlyErrors', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes non-RUN_ERROR chunks through untouched', async () => {
    const chunks = await drain(
      withFriendlyErrors(
        local,
        streamOf(
          { type: 'TEXT_MESSAGE_CONTENT', delta: 'hi' },
          { type: 'RUN_FINISHED', finishReason: 'stop' },
        ),
        'test',
      ),
    );
    expect(chunks).toEqual([
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'hi' },
      { type: 'RUN_FINISHED', finishReason: 'stop' },
    ]);
  });

  it('maps a local RUN_ERROR with the Ollama mapper', async () => {
    const [chunk] = await drain(
      withFriendlyErrors(
        local,
        streamOf({ type: 'RUN_ERROR', timestamp: 1, message: 'fetch failed' }),
        'test',
      ),
    );
    expect(chunk.message).toBe(
      'AI server unreachable. Is Ollama running on port 11434?',
    );
  });

  it('maps a frontier RUN_ERROR with the Anthropic mapper, NOT the Ollama one', async () => {
    // The exact regression ADR 0011 introduced: this raw text is what an
    // Anthropic 401 produces, and friendlyOllamaError would echo it verbatim
    // to the user instead of naming ANTHROPIC_API_KEY.
    const raw =
      '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
    const [chunk] = await drain(
      withFriendlyErrors(
        frontier,
        streamOf({ type: 'RUN_ERROR', timestamp: 1, message: raw }),
        'test',
      ),
    );
    expect(chunk.message).toBe(
      'Anthropic rejected the configured API key. Check ANTHROPIC_API_KEY, or leave it unset to use the local model instead.',
    );
    expect(chunk.message).not.toBe(friendlyOllamaError(raw));
  });

  it('never lets the API key reach the mapped frontier message', async () => {
    const [chunk] = await drain(
      withFriendlyErrors(
        frontier,
        streamOf({
          type: 'RUN_ERROR',
          timestamp: 1,
          message: `Connection error while sending x-api-key ${FAKE_KEY}`,
        }),
        'test',
      ),
    );
    expect(String(chunk.message)).not.toContain(FAKE_KEY);
  });

  it('drops the provider payload `rawEvent` from RUN_ERROR', async () => {
    // @tanstack/ai-anthropic attaches the provider's structured error body
    // (adapters/text.js:98-109); @tanstack/ai's stripToSpecMiddleware does not
    // remove it, so without this it reaches the browser untranslated.
    const [chunk] = await drain(
      withFriendlyErrors(
        frontier,
        streamOf({
          type: 'RUN_ERROR',
          timestamp: 1,
          message: 'rate_limit_error',
          code: 'rate_limit_error',
          rawEvent: { type: 'rate_limit_error', message: 'slow down' },
        }),
        'test',
      ),
    );
    expect(chunk).not.toHaveProperty('rawEvent');
    // `code` is kept — it is a provider error *class*, not payload, and it is
    // what makes the failure identifiable in a network trace.
    expect(chunk.code).toBe('rate_limit_error');
  });

  it('reads the legacy nested dialect and drops the nested object', async () => {
    const [chunk] = await drain(
      withFriendlyErrors(
        local,
        streamOf({ type: 'RUN_ERROR', error: { message: 'fetch failed' } }),
        'test',
      ),
    );
    expect(chunk.message).toBe(
      'AI server unreachable. Is Ollama running on port 11434?',
    );
    expect(chunk).not.toHaveProperty('error');
  });

  it('maps a thrown iteration failure and preserves its code', async () => {
    const err = Object.assign(new Error('fetch failed'), { code: 'ECONN' });
    const iter = withFriendlyErrors(local, throwingStream(err), 'test')[
      Symbol.asyncIterator
    ]();
    await iter.next(); // the TEXT_MESSAGE_CONTENT chunk
    await expect(iter.next()).rejects.toMatchObject({
      message: 'AI server unreachable. Is Ollama running on port 11434?',
      code: 'ECONN',
    });
  });

  it('rethrows an abort untouched', async () => {
    // @tanstack/ai normalizes abort-shaped errors to
    // `{ message: 'Request aborted', code: 'aborted' }`. Wrapping one in a
    // fresh Error would report a user cancel as a run failure.
    const abort = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    const iter = withFriendlyErrors(frontier, throwingStream(abort), 'test')[
      Symbol.asyncIterator
    ]();
    await iter.next();
    await expect(iter.next()).rejects.toBe(abort);
  });

  it('logs the RAW failure server-side, redacted, without the model object', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await drain(
      withFriendlyErrors(
        frontier,
        streamOf({
          type: 'RUN_ERROR',
          message: `boom ${FAKE_KEY}`,
        }),
        'ask',
      ),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain('[ask]');
    expect(line).toContain('frontier/claude-sonnet-5');
    expect(line).toContain('boom [redacted]');
    expect(line).not.toContain(FAKE_KEY);
  });
});

describe('withFriendlyErrors → toServerSentEventsResponse (@tanstack/ai 0.52.0)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('puts translated text — and no provider payload — on the wire', async () => {
    // End-to-end through the real chat() pipeline and the real SSE encoder,
    // with an adapter that fails exactly the way @tanstack/ai-anthropic does
    // on a 401 (adapters/text.js:98-109). This is the whole fix in one
    // assertion: the bytes the browser receives.
    const adapter = {
      name: 'probe',
      type: 'text',
      async *chatStream() {
        yield {
          type: 'RUN_ERROR',
          timestamp: 1,
          message:
            '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
          code: 'authentication_error',
          rawEvent: {
            type: 'authentication_error',
            message: 'invalid x-api-key',
          },
        };
      },
    } as never;

    const stream = chat({
      adapter,
      model: 'probe',
      messages: [{ role: 'user', content: 'hi' }],
    } as never);
    const res = toServerSentEventsResponse(
      withFriendlyErrors(frontier, stream as AsyncIterable<StreamChunk>, 'probe'),
    );
    const text = await res.text();

    expect(text).toContain(
      'Anthropic rejected the configured API key. Check ANTHROPIC_API_KEY, or leave it unset to use the local model instead.',
    );
    expect(text).not.toContain('rawEvent');
    expect(text).not.toContain('x-api-key');
    expect(text).not.toContain('Ollama');
  });
});
