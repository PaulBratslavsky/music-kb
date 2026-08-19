import { describe, expect, it } from 'vitest';
import { streamChatSSE, type Citation, type StreamEvent } from './chat-stream';
import { friendlyOllamaError } from './ollama-errors';

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

  it('yields a citations event for the CITATIONS frame (/api/ask)', async () => {
    const citation: Citation = {
      index: 0,
      videoDocumentId: 'doc1',
      youtubeVideoId: 'yt1',
      videoTitle: 'Modal interchange',
      videoAuthor: 'Author',
      videoThumbnailUrl: null,
      startSec: 12,
      endSec: 30,
      text: 'borrowed chords come from the parallel minor',
    };
    const events = await collect(
      streamingResponse([
        // `model` rides along on the wire frame but is informational —
        // the typed event carries citations only.
        `data: ${JSON.stringify({ type: 'CITATIONS', citations: [citation], model: 'gemma3' })}\n\n`,
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"answer [1]"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'citations', citations: [citation] },
      { kind: 'text', delta: 'answer [1]' },
    ]);
  });

  it('skips a CITATIONS frame whose citations field is not an array', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"CITATIONS","citations":"oops"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([]);
  });

  it('joins multi-line data: frames into one payload', async () => {
    // SSE allows one event to span several `data:` lines; the inline
    // parsers this module replaced dropped everything after the first.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TEXT_MESSAGE_CONTENT",\ndata: "delta":"multi"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'text', delta: 'multi' }]);
  });

  it('throws a translated error on a RUN_ERROR frame', async () => {
    // RUN_ERROR is what @tanstack/ai emits when e.g. Ollama dies
    // mid-stream. It must throw — not silently end the stream.
    await expect(
      collect(
        streamingResponse([
          'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"partial"}\n\n',
          'data: {"type":"RUN_ERROR","error":{"message":"fetch failed"}}\n\n',
        ]),
      ),
    ).rejects.toThrow('AI server unreachable. Is Ollama running on port 11434?');
  });

  it('reads the flat RUN_ERROR shape emitted by @tanstack/ai 0.45', async () => {
    // 0.45 flattened the payload to `{ type, model, timestamp, message,
    // code }`. Reading only the old nested `error.message` silently
    // degraded every failure to the generic 'AI run failed', costing the
    // user the recovery hint. Verified against a live adapter pointed at
    // a closed port.
    await expect(
      collect(
        streamingResponse([
          'data: {"type":"RUN_ERROR","model":"m","timestamp":1,"message":"fetch failed"}\n\n',
        ]),
      ),
    ).rejects.toThrow('AI server unreachable. Is Ollama running on port 11434?');
  });

  it('passes a RUN_ERROR message matching no Ollama pattern through unchanged', async () => {
    await expect(
      collect(
        streamingResponse([
          'data: {"type":"RUN_ERROR","error":{"message":"tool exploded"}}\n\n',
        ]),
      ),
    ).rejects.toThrow('tool exploded');
  });

  it('throws a fallback message when RUN_ERROR carries no detail', async () => {
    await expect(
      collect(streamingResponse(['data: {"type":"RUN_ERROR"}\n\n'])),
    ).rejects.toThrow('AI run failed');
  });

  it('RUN_ERROR translation is idempotent at consumer catch sites', async () => {
    // Consumers (VideoChat, DigestChat, useLibraryChat, NoteComposer)
    // run caught errors through friendlyOllamaError again — the already
    // translated message must survive the second pass unchanged.
    let caught = '';
    try {
      await collect(
        streamingResponse([
          'data: {"type":"RUN_ERROR","error":{"message":"ECONNREFUSED 127.0.0.1:11434"}}\n\n',
        ]),
      );
    } catch (err) {
      caught = err instanceof Error ? err.message : '';
    }
    expect(caught).toBe('AI server unreachable. Is Ollama running on port 11434?');
    expect(friendlyOllamaError(caught)).toBe(caught);
  });

  it('throws the response body text on a non-OK response', async () => {
    const res = new Response('retrieval failed: index not built', {
      status: 500,
    });
    await expect(collect(res)).rejects.toThrow(
      'retrieval failed: index not built',
    );
  });

  it('falls back to the status code when a non-OK response has no body', async () => {
    const res = new Response(null, { status: 503 });
    await expect(collect(res)).rejects.toThrow('Request failed: 503');
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
