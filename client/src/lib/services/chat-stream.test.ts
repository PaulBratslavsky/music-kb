import { describe, expect, it } from 'vitest';
import { streamChatSSE, type StreamEvent } from './chat-stream';

// Build a Response whose body streams the given byte chunks one-by-one
// (so the parser sees realistic split-across-reads behaviour, not a
// single mega-chunk). Used to verify the parser handles partial
// `data:` blocks correctly.
function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(response: Response): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of streamChatSSE(response)) events.push(event);
  return events;
}

describe('streamChatSSE', () => {
  it('yields text events for TEXT_MESSAGE_CONTENT frames', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"Hello "}\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"world"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'text', delta: 'Hello ' },
      { kind: 'text', delta: 'world' },
    ]);
  });

  it('skips events whose type is not in the surfaced set', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"RUN_STARTED"}\n\n',
        'data: {"type":"TEXT_MESSAGE_START","messageId":"m1"}\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"hi"}\n\n',
        'data: {"type":"TEXT_MESSAGE_END"}\n\n',
        'data: {"type":"STEP_FINISHED"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'hi' }]);
  });

  it('parses tool_start + tool_end with `toolName` + `input` (VideoChat dialect)', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1","toolName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"t1","toolName":"web_search","input":{"query":"foo"},"result":"[]"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 't1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 't1',
        name: 'web_search',
        input: { query: 'foo' },
        result: '[]',
      },
    ]);
  });

  it('parses tool_start + tool_end with `toolCallName` + `args` (DigestChat dialect)', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1","toolCallName":"web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"t1","toolCallName":"web_search","args":{"q":"x"},"result":null}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 't1', name: 'web_search' },
      {
        kind: 'tool_end',
        id: 't1',
        name: 'web_search',
        input: { q: 'x' },
        result: null,
      },
    ]);
  });

  it('handles a frame split across multiple chunks', async () => {
    // The first read ends mid-JSON; the parser must buffer and only
    // emit when it sees the `\n\n` block delimiter.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESS',
        'AGE_CONTENT","delta":"chunked"}',
        '\n\ndata: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'chunked' }]);
  });

  it('handles multiple frames inside one chunk', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"a"}\n\ndata: {"type":"TEXT_MESSAGE_CONTENT","delta":"b"}\n\ndata: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'text', delta: 'a' },
      { kind: 'text', delta: 'b' },
    ]);
  });

  it('skips invalid JSON in a data: line without throwing', async () => {
    const events = await collect(
      streamingResponse([
        'data: {garbage\n\n',
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"recovered"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'recovered' }]);
  });

  it('skips events missing required fields', async () => {
    const events = await collect(
      streamingResponse([
        // No delta
        'data: {"type":"TEXT_MESSAGE_CONTENT"}\n\n',
        // No toolCallId
        'data: {"type":"TOOL_CALL_START","toolName":"x"}\n\n',
        // No name (neither dialect)
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([]);
  });

  it('throws when the response has no body', async () => {
    const empty = new Response(null, { status: 200 });
    await expect(collect(empty)).rejects.toThrow(/empty response body/);
  });

  it('flushes a trailing block that lacks the final \\n\\n', async () => {
    // Some servers omit the terminating blank line. Defensive parse.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"end"}\n\ndata: [DONE]',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'end' }]);
  });
});
