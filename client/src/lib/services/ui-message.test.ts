// The seam between the two message shapes.
//
// `messageText` is called with a UIMessage on the client (parts) and with
// whatever chatParamsFromRequestBody returns on the server — which is typed
// `UIMessage | ModelMessage` and is a ModelMessage (content) for a plain text
// turn. The first version handled only `parts` and was reached through an
// `as UIMessage[]` cast, so it typechecked and threw
// "Cannot read properties of undefined (reading 'filter')" on the first real
// request. These tests exist so that shape can't regress silently.

import { describe, expect, it } from 'vitest';
import { latestUserText, messageText, messageToolCalls } from './ui-message';

describe('messageText', () => {
  it('reads a UIMessage built from parts', () => {
    expect(
      messageText({
        id: 'm', role: 'assistant',
        parts: [
          { type: 'text', content: 'Hello ' },
          { type: 'text', content: 'world' },
        ],
      } as never),
    ).toBe('Hello world');
  });

  it('reads a wire ModelMessage with plain string content', () => {
    // THE REGRESSION. This is what the AG-UI wire actually delivers.
    expect(messageText({ role: 'user', content: 'a question' } as never)).toBe('a question');
  });

  it('reads a multimodal ModelMessage content array', () => {
    expect(
      messageText({
        role: 'user',
        content: [
          { type: 'text', content: 'describe ' },
          { type: 'image', image: 'data:...' },
          { type: 'text', content: 'this' },
        ],
      } as never),
    ).toBe('describe this');
  });

  it('excludes thinking parts from visible prose', () => {
    expect(
      messageText({
        id: 'm', role: 'assistant',
        parts: [
          { type: 'thinking', content: 'scratchpad the user must not see' },
          { type: 'text', content: 'the answer' },
        ],
      } as never),
    ).toBe('the answer');
  });

  it('returns empty string rather than throwing on an unknown shape', () => {
    expect(messageText({ role: 'user' } as never)).toBe('');
    expect(messageText({ role: 'user', content: null } as never)).toBe('');
  });
});

describe('messageToolCalls', () => {
  const call = (over: Record<string, unknown> = {}) => ({
    type: 'tool-call', id: 't1', name: 'kb_web_search',
    arguments: '{"query":"berklee"}', state: 'complete', ...over,
  });

  it('pairs a tool result with its call', () => {
    const calls = messageToolCalls({
      id: 'm', role: 'assistant',
      parts: [call(), { type: 'tool-result', toolCallId: 't1', content: '{"results":[]}' }],
    } as never);
    expect(calls).toEqual([
      { id: 't1', name: 'kb_web_search', input: { query: 'berklee' }, result: '{"results":[]}', status: 'done' },
    ]);
  });

  it('marks a call with no result yet as running', () => {
    const calls = messageToolCalls({
      id: 'm', role: 'assistant',
      parts: [call({ state: 'input-complete' })],
    } as never);
    expect(calls[0].status).toBe('running');
  });

  it('falls back to the raw arguments string when input is not yet parsed', () => {
    const calls = messageToolCalls({
      id: 'm', role: 'assistant', parts: [call()],
    } as never);
    expect(calls[0].input).toEqual({ query: 'berklee' });
  });

  it('prefers the parsed input when present', () => {
    const calls = messageToolCalls({
      id: 'm', role: 'assistant',
      parts: [call({ input: { query: 'parsed' }, arguments: '{"query":"raw"}' })],
    } as never);
    expect(calls[0].input).toEqual({ query: 'parsed' });
  });

  it('degrades to null on unparseable arguments', () => {
    const calls = messageToolCalls({
      id: 'm', role: 'assistant',
      parts: [call({ arguments: '{partial' })],
    } as never);
    expect(calls[0].input).toBeNull();
  });

  it('returns [] for a wire ModelMessage, which has no parts', () => {
    expect(messageToolCalls({ role: 'user', content: 'hi' } as never)).toEqual([]);
  });

  it('stringifies structured tool-result content rather than rendering [object Object]', () => {
    const calls = messageToolCalls({
      id: 'm', role: 'assistant',
      parts: [call(), { type: 'tool-result', toolCallId: 't1', content: [{ type: 'text', content: 'x' }] }],
    } as never);
    expect(calls[0].result).toContain('"type":"text"');
  });
});

describe('latestUserText', () => {
  it('takes the LAST user turn, not the first and not the whole thread', () => {
    // Retrieval is seeded with this. Concatenating the thread would drown the
    // current question in earlier topics.
    expect(
      latestUserText([
        { role: 'user', content: 'about modal interchange' },
        { role: 'assistant', content: 'here you go' },
        { role: 'user', content: 'now about tritone subs' },
      ] as never),
    ).toBe('now about tritone subs');
  });

  it('works across both message shapes in one thread', () => {
    expect(
      latestUserText([
        { role: 'user', content: 'first' },
        { id: 'm', role: 'user', parts: [{ type: 'text', content: 'second' }] },
      ] as never),
    ).toBe('second');
  });

  it('returns empty string when there is no user turn', () => {
    expect(latestUserText([{ role: 'assistant', content: 'hi' }] as never)).toBe('');
    expect(latestUserText([])).toBe('');
  });
});
