// The transport-level frame interceptor.
//
// This is the mechanism that lets /api/ask keep its pre-message CITATIONS
// frame AND use the shared <Chat> component. It has to do two things without
// fail: bind captured payloads to the right message id, and hand the SDK a
// stream that is otherwise byte-identical — a dropped or reordered frame here
// would corrupt the transcript with no error anywhere.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createCapturingFetcher } from './capture-frames';
import askWire from './__fixtures__/ask-wire-0.52.json';

const sse = (frames: unknown[]) =>
  frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + 'data: [DONE]\n\n';

/** Serve `body`, split across chunks, the way a real stream arrives. */
function mockFetch(body: string, chunkSize = 24) {
  return vi.fn(async (_url?: unknown, _init?: unknown) => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < body.length; i += chunkSize) {
          c.enqueue(enc.encode(body.slice(i, i + chunkSize)));
        }
        c.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
}

const CITATIONS = { type: 'CITATIONS', citations: [{ index: 0, videoTitle: 'A' }] };
const START = { type: 'TEXT_MESSAGE_START', messageId: 'msg-1', role: 'assistant' };
const DELTA = { type: 'TEXT_MESSAGE_CONTENT', delta: 'hello' };

// A REAL UIMessage, not an empty array. The first version of this suite passed
// `messages: []`, which serialises identically whether or not the fetcher
// converts to the wire format — so it proved nothing, and the missing
// conversion only surfaced as a 400 in the browser.
const input = {
  messages: [
    { id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, content: 'hello' }] },
  ],
  threadId: 't',
  runId: 'r',
  data: { modelChoice: 'default' },
};
const opts = { signal: new AbortController().signal };

beforeEach(() => vi.unstubAllGlobals());

describe('createCapturingFetcher', () => {
  it('binds a pre-message frame to the id of the message that follows', async () => {
    vi.stubGlobal('fetch', mockFetch(sse([CITATIONS, START, DELTA])));
    const onCapture = vi.fn();

    const fetcher = createCapturingFetcher('/api/ask', {
      match: (f) => (f.type === 'CITATIONS' ? f.citations : null),
      onCapture,
    });
    await (await fetcher(input, opts)).text();

    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith('msg-1', CITATIONS.citations);
  });

  it('withholds the captured frame but passes everything else through intact', async () => {
    vi.stubGlobal('fetch', mockFetch(sse([CITATIONS, START, DELTA])));
    const fetcher = createCapturingFetcher('/api/ask', {
      match: (f) => (f.type === 'CITATIONS' ? f.citations : null),
      onCapture: () => {},
    });

    const out = await (await fetcher(input, opts)).text();

    expect(out).not.toContain('CITATIONS');
    expect(out).toContain('TEXT_MESSAGE_START');
    expect(out).toContain('"delta":"hello"');
    expect(out).toContain('[DONE]');
  });

  it('reassembles frames split across chunk boundaries', async () => {
    // A 7-byte chunk size cuts through the middle of nearly every frame.
    vi.stubGlobal('fetch', mockFetch(sse([CITATIONS, START, DELTA]), 7));
    const onCapture = vi.fn();
    const fetcher = createCapturingFetcher('/api/ask', {
      match: (f) => (f.type === 'CITATIONS' ? f.citations : null),
      onCapture,
    });

    const out = await (await fetcher(input, opts)).text();

    expect(onCapture).toHaveBeenCalledWith('msg-1', CITATIONS.citations);
    expect(out).toContain('"delta":"hello"');
  });

  it('does not fire when nothing matches', async () => {
    vi.stubGlobal('fetch', mockFetch(sse([START, DELTA])));
    const onCapture = vi.fn();
    const fetcher = createCapturingFetcher('/api/ask', {
      match: (f) => (f.type === 'CITATIONS' ? f.citations : null),
      onCapture,
    });

    await (await fetcher(input, opts)).text();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it('holds a captured frame that arrives with no message after it', async () => {
    // A run that errors before generating: nothing to bind to, and binding to
    // a WRONG message would be worse than dropping it.
    vi.stubGlobal('fetch', mockFetch(sse([CITATIONS, { type: 'RUN_ERROR', message: 'boom' }])));
    const onCapture = vi.fn();
    const fetcher = createCapturingFetcher('/api/ask', {
      match: (f) => (f.type === 'CITATIONS' ? f.citations : null),
      onCapture,
    });

    const out = await (await fetcher(input, opts)).text();
    expect(onCapture).not.toHaveBeenCalled();
    expect(out).toContain('RUN_ERROR'); // the error still reaches the client
  });

  it('posts an AG-UI body with forwardedProps from `data`', async () => {
    const f = mockFetch(sse([START]));
    vi.stubGlobal('fetch', f);
    const fetcher = createCapturingFetcher('/api/ask', { match: () => null, onCapture: () => {} });

    await fetcher(input, opts);

    const init = f.mock.calls[0]?.[1] as unknown as { body: string };
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      threadId: 't',
      runId: 'r',
      forwardedProps: { modelChoice: 'default' },
    });
    // Converted to the AG-UI wire shape: `content`, not `parts`. Posting
    // UIMessages raw is a 400 the client surfaces as an empty answer bubble.
    expect(body.messages).toEqual([{ id: 'm1', role: 'user', content: 'hello' }]);
  });

  it('returns a non-OK response untouched rather than parsing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const fetcher = createCapturingFetcher('/api/ask', { match: () => null, onCapture: () => {} });

    const res = await fetcher(input, opts);
    expect(res.status).toBe(500);
    await expect(res.text()).resolves.toBe('nope');
  });
});

// The real /api/ask stream — captured, not written.
//
// The interceptor depends on a frame ORDER and a field name that live in the
// SDK, not in our code: CITATIONS arrives before the TEXT_MESSAGE_START whose
// `messageId` names the message it grounds. If a bump renames that field or
// reorders these frames, citations stop binding and NOTHING fails — the answer
// still renders, the sources disclosure just never appears. That is the exact
// silent regression this fixture exists to make loud.
describe('against a captured /api/ask stream', () => {
  const frames = askWire.frames as Array<Record<string, unknown>>;

  it('the capture really has CITATIONS before TEXT_MESSAGE_START', () => {
    // Guard on the fixture. If a re-capture ever reverses this, the binding
    // test below would still pass while proving nothing.
    const types = frames.map((f) => f.type);
    expect(types.indexOf('CITATIONS')).toBeLessThan(types.indexOf('TEXT_MESSAGE_START'));
    expect(frames.find((f) => f.type === 'TEXT_MESSAGE_START')?.messageId).toEqual(
      expect.any(String),
    );
  });

  it('binds the real citations to the real message id', async () => {
    vi.stubGlobal('fetch', mockFetch(sse(frames)));
    const onCapture = vi.fn();

    const fetcher = createCapturingFetcher('/api/ask', {
      match: (f) => (f.type === 'CITATIONS' ? f.citations : null),
      onCapture,
    });
    const out = await (await fetcher(input, opts)).text();

    const expectedId = frames.find((f) => f.type === 'TEXT_MESSAGE_START')?.messageId;
    const expectedCitations = frames.find((f) => f.type === 'CITATIONS')?.citations;
    expect(onCapture).toHaveBeenCalledWith(expectedId, expectedCitations);

    // And the SDK still receives a stream it fully understands.
    expect(out).toContain('TEXT_MESSAGE_START');
    expect(out).toContain('TEXT_MESSAGE_CONTENT');
    expect(out).not.toContain('CITATIONS');
  });
});
