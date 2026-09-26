// The browser-side error helper must never re-translate a message the server
// already translated.
//
// Chat failures are translated on the SERVER by the tier that answered
// (stream-errors.ts). The browser then runs whatever it caught through
// `friendlyStreamError`, which exists for the OTHER class of failure —
// transport errors the server never saw. For that split to hold, a message
// that is already friendly has to pass through untouched.
//
// It used to hold via an `instanceof FriendlyStreamError` check. But useChat
// turns a RUN_ERROR frame into a plain `Error`, and nothing constructs the
// class any more, so every server-translated message went through the Ollama
// mapper a second time. The frontier timeout text contains "timed out", which
// that mapper matches — so a user on the frontier tier was told "the model may
// be loading", which is advice about Ollama. (Issue #7; a regression of
// docs/known-issues.md #2.)
import { describe, expect, it } from 'vitest';
import { FriendlyStreamError, friendlyStreamError } from './chat-errors';
import { friendlyAnthropicError } from './anthropic-errors';
import { friendlyOllamaError } from './ollama-errors';

// One raw input per branch of each mapper, so the pass-through claim is made
// for every message a mapper can actually produce, not just the one that
// happened to break.
const ANTHROPIC_RAW = [
  '',
  'authentication_error: invalid x-api-key',
  'rate_limit_error: too many requests',
  'Request timed out',
  'invalid_request_error: temperature is not supported',
  'something nobody anticipated',
];
const OLLAMA_RAW = ['', 'fetch failed', 'model "gemma" not found', 'Request timed out'];

describe('a server-translated message reaches the user unchanged', () => {
  it('the frontier timeout message is not rewritten as Ollama advice', () => {
    // The exact regression: useChat hands the component a plain Error whose
    // message the server already translated for the frontier tier.
    const serverText = friendlyAnthropicError('Request timed out');
    expect(serverText).toMatch(/Frontier AI request timed out/);
    const shown = friendlyStreamError(new Error(serverText), 'Chat failed');
    expect(shown).toBe(serverText);
    expect(shown).not.toMatch(/model may be loading/);
  });

  it.each(ANTHROPIC_RAW)('every frontier message passes through (raw: %j)', (raw) => {
    const serverText = friendlyAnthropicError(raw);
    expect(friendlyStreamError(new Error(serverText), 'Chat failed')).toBe(serverText);
  });

  it.each(OLLAMA_RAW)('every local message passes through (raw: %j)', (raw) => {
    const serverText = friendlyOllamaError(raw);
    expect(friendlyStreamError(new Error(serverText), 'Chat failed')).toBe(serverText);
  });

  it('a FriendlyStreamError passes through', () => {
    const err = new FriendlyStreamError('Video not found');
    expect(friendlyStreamError(err, 'Chat failed')).toBe('Video not found');
  });
});

describe('a transport failure the server never saw is still translated', () => {
  it('a rejected fetch becomes the unreachable hint', () => {
    expect(friendlyStreamError(new TypeError('fetch failed'), 'Chat failed')).toBe(
      friendlyOllamaError('fetch failed'),
    );
    expect(friendlyStreamError(new TypeError('fetch failed'), 'Chat failed')).not.toBe(
      'fetch failed',
    );
  });

  it('a non-Error value falls back to the caller-supplied text', () => {
    expect(friendlyStreamError('boom', 'Chat failed')).toBe(friendlyOllamaError('Chat failed'));
  });
});
