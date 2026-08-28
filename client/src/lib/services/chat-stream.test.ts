import { describe, expect, it } from 'vitest';
import {
  FriendlyStreamError,
  friendlyStreamError,
  streamChatSSE,
  type Citation,
  type StreamEvent,
} from './chat-stream';
import { friendlyOllamaError } from './ollama-errors';
import wire052 from './__fixtures__/tool-call-wire-0.52.json';

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
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1","toolName":"kb_web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"t1","toolName":"kb_web_search","input":{"query":"foo"},"result":"[]"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 't1', name: 'kb_web_search' },
      {
        kind: 'tool_end',
        id: 't1',
        name: 'kb_web_search',
        input: { query: 'foo' },
        result: '[]',
      },
    ]);
  });

  it('parses tool_start + tool_end with `toolCallName` + `args` (DigestChat dialect)', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"t1","toolCallName":"kb_web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"t1","toolCallName":"kb_web_search","args":{"q":"x"},"result":null}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 't1', name: 'kb_web_search' },
      {
        kind: 'tool_end',
        id: 't1',
        name: 'kb_web_search',
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
        // `model` is the id that ACTUALLY answered, resolved server-side.
        // It used to be dropped as informational; since the model became
        // user-selectable it is the only signal that can reveal a mismatch
        // between the picker and the answer, so the typed event carries it.
        `data: ${JSON.stringify({ type: 'CITATIONS', citations: [citation], model: 'gemma3' })}\n\n`,
        'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"answer [1]"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'citations', citations: [citation], model: 'gemma3' },
      { kind: 'text', delta: 'answer [1]' },
    ]);
  });

  it('a CITATIONS frame with no model yields undefined rather than crashing', async () => {
    // Older servers, and every surface other than /api/ask, send no model.
    const events = await collect(
      streamingResponse([
        `data: ${JSON.stringify({ type: 'CITATIONS', citations: [] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'citations', citations: [], model: undefined }]);
  });

  it('a non-string model on the wire is ignored rather than rendered', async () => {
    const events = await collect(
      streamingResponse([
        `data: ${JSON.stringify({ type: 'CITATIONS', citations: [], model: { evil: true } })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    );
    expect(events).toEqual([{ kind: 'citations', citations: [], model: undefined }]);
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

  it('throws on a RUN_ERROR frame instead of ending the stream', async () => {
    // RUN_ERROR is what @tanstack/ai emits when e.g. Ollama dies
    // mid-stream. It must throw — not silently end the stream. The message
    // is whatever the server already mapped (stream-errors.ts).
    await expect(
      collect(
        streamingResponse([
          'data: {"type":"TEXT_MESSAGE_CONTENT","delta":"partial"}\n\n',
          'data: {"type":"RUN_ERROR","message":"AI server unreachable. Is Ollama running on port 11434?"}\n\n',
        ]),
      ),
    ).rejects.toThrow('AI server unreachable. Is Ollama running on port 11434?');
  });

  it('emits tool_result from the separate TOOL_CALL_RESULT frame (0.45)', async () => {
    // 0.45 splits the tool result off TOOL_CALL_END onto its own frame:
    // TOOL_CALL_END carries `input` and no result, then TOOL_CALL_RESULT
    // arrives with `content` keyed by toolCallId. Dropping that frame left
    // every tool call with result === null, which the UI renders as no
    // output panel at all. Frame shapes captured from a live llama3.2:3b
    // run through toServerSentEventsResponse.
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_START","toolCallId":"call_1","toolName":"kb_web_search"}\n\n',
        'data: {"type":"TOOL_CALL_END","toolCallId":"call_1","toolName":"kb_web_search","input":{"query":"berklee"}}\n\n',
        'data: {"type":"TOOL_CALL_RESULT","toolCallId":"call_1","content":"{\\"results\\":[\\"1945\\"]}"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_start', id: 'call_1', name: 'kb_web_search' },
      {
        kind: 'tool_end',
        id: 'call_1',
        name: 'kb_web_search',
        input: { query: 'berklee' },
        result: null,
      },
      { kind: 'tool_result', id: 'call_1', result: '{"results":["1945"]}' },
    ]);
  });

  it('still reads a result carried on TOOL_CALL_END (pre-0.45 dialect)', async () => {
    const events = await collect(
      streamingResponse([
        'data: {"type":"TOOL_CALL_END","toolCallId":"c2","toolName":"t","input":{},"result":"inline"}\n\n',
      ]),
    );
    expect(events).toEqual([
      { kind: 'tool_end', id: 'c2', name: 't', input: {}, result: 'inline' },
    ]);
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
          'data: {"type":"RUN_ERROR","model":"m","timestamp":1,"message":"AI server unreachable. Is Ollama running on port 11434?"}\n\n',
        ]),
      ),
    ).rejects.toThrow('AI server unreachable. Is Ollama running on port 11434?');
  });

  it('passes RUN_ERROR text through UNTRANSLATED', async () => {
    // The server already mapped it with the answering model's own mapper
    // (stream-errors.ts). Translating again here is what ADR 0011 broke: a
    // frontier failure would get Ollama advice. Raw Ollama-shaped text must
    // now survive verbatim — proof that no local mapper runs on this path.
    await expect(
      collect(
        streamingResponse([
          'data: {"type":"RUN_ERROR","model":"m","timestamp":1,"message":"fetch failed"}\n\n',
        ]),
      ),
    ).rejects.toThrow('fetch failed');
  });

  it('reads the legacy nested RUN_ERROR dialect', async () => {
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

  it('tags a RUN_ERROR as FriendlyStreamError so consumers do not remap it', async () => {
    // The regression this guards: friendlyOllamaError's /timed ?out/i branch
    // rewrites the FRONTIER timeout message into Ollama advice about the
    // model loading. friendlyStreamError must return it verbatim.
    const frontierTimeout =
      'Frontier AI request timed out. Try again, or leave ANTHROPIC_API_KEY unset to use the local model instead.';
    let caught: unknown;
    try {
      await collect(
        streamingResponse([
          `data: ${JSON.stringify({
            type: 'RUN_ERROR',
            message: frontierTimeout,
          })}\n\n`,
        ]),
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FriendlyStreamError);
    expect(friendlyStreamError(caught, 'Chat failed')).toBe(frontierTimeout);
    // And the mapper it bypasses would indeed have corrupted it:
    expect(friendlyOllamaError(frontierTimeout)).not.toBe(frontierTimeout);
  });

  it('friendlyStreamError still translates a transport failure locally', async () => {
    // A fetch rejection never crossed the wire, so no server mapper touched
    // it — the local hint is still the right answer there.
    expect(
      friendlyStreamError(new TypeError('fetch failed'), 'Chat failed'),
    ).toBe('AI server unreachable. Is Ollama running on port 11434?');
    expect(friendlyStreamError('not an error', 'Chat failed')).toBe(
      'Chat failed',
    );
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

// ---------------------------------------------------------------------------
// The 0.52 spec-only wire.
//
// Every tool fixture ABOVE this line is hand-authored in the 0.45 dialect, and
// that is exactly why they could not catch this: @tanstack/ai 0.48 made the SSE
// wire spec-only, TOOL_CALL_END lost its top-level `toolName`/`input`, and the
// parser went on reading fields that are no longer there. Tool cards render
// blank and `expandHistoryForModel` reports a nameless tool called with `{}` —
// with no error anywhere. The fixtures stayed green through the whole thing
// because they assert the parser matches what we BELIEVED the SDK emits.
//
// The frames below are captured from a live run instead. See the fixture file.
// ---------------------------------------------------------------------------
describe('0.52 spec-only wire (captured fixtures)', () => {
  type Frame = Record<string, unknown>;
  const frames = wire052.frames as Frame[];
  const byType = (t: string): Frame => {
    const f = frames.find((x) => x.type === t);
    if (!f) throw new Error(`captured fixture is missing a ${t} frame`);
    return f;
  };
  const sse = (fs: Frame[]) =>
    streamingResponse([...fs.map((f) => `data: ${JSON.stringify(f)}\n\n`), 'data: [DONE]\n\n']);

  const START = byType('TOOL_CALL_START');
  const ARGS = byType('TOOL_CALL_ARGS');
  const END = byType('TOOL_CALL_END');
  const RESULT = byType('TOOL_CALL_RESULT');
  const EXPECTED_INPUT = { query: 'Berklee college of music founding date' };

  it('the captured END frame really has no top-level name or input', () => {
    // Guard on the fixture itself. If a future capture reinstates these
    // fields, the tests below stop proving anything and this fails loudly.
    expect(END.toolName).toBeUndefined();
    expect(END.input).toBeUndefined();
  });

  it('recovers name and input from a captured exchange', async () => {
    const events = await collect(sse([START, ARGS, END, RESULT]));
    const end = events.find((e) => e.kind === 'tool_end');
    expect(end).toMatchObject({ name: 'kb_web_search', input: EXPECTED_INPUT });
  });

  it('recovers input from ARGS deltas alone when metadata is stripped', async () => {
    // metadata.tanstack is a VENDOR EXTENSION, outside the spec. If a release
    // or an intermediary drops it, accumulated TOOL_CALL_ARGS is the only
    // remaining source, so it has to stand on its own.
    const strip = (f: Frame): Frame => {
      const { metadata: _metadata, ...rest } = f;
      return rest;
    };
    const events = await collect(sse([strip(START), ARGS, strip(END)]));
    const end = events.find((e) => e.kind === 'tool_end');
    expect(end).toMatchObject({ name: 'kb_web_search', input: EXPECTED_INPUT });
  });

  it('still surfaces the tool result from its own frame', async () => {
    const events = await collect(sse([START, ARGS, END, RESULT]));
    const result = events.find((e) => e.kind === 'tool_result');
    expect(result?.result).toContain('RESULT for');
  });

  it('keeps concurrent tool calls apart', async () => {
    // The accumulator is per-stream and keyed by toolCallId. Single-slot or
    // module-global state would swap these two calls' arguments.
    const events = await collect(
      sse([
        { type: 'TOOL_CALL_START', toolCallId: 'a', toolCallName: 'first' },
        { type: 'TOOL_CALL_START', toolCallId: 'b', toolCallName: 'second' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'a', delta: '{"x":1}' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'b', delta: '{"y":2}' },
        { type: 'TOOL_CALL_END', toolCallId: 'b' },
        { type: 'TOOL_CALL_END', toolCallId: 'a' },
      ]),
    );
    const ends = events.filter((e) => e.kind === 'tool_end');
    expect(ends.find((e) => e.id === 'a')?.input).toEqual({ x: 1 });
    expect(ends.find((e) => e.id === 'b')?.input).toEqual({ y: 2 });
  });

  it('reassembles arguments split across several delta frames', async () => {
    const events = await collect(
      sse([
        { type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'kb_web_search' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '{"que' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: 'ry":"ber' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: 'klee"}' },
        { type: 'TOOL_CALL_END', toolCallId: 'c' },
      ]),
    );
    expect(events.find((e) => e.kind === 'tool_end')?.input).toEqual({ query: 'berklee' });
  });

  it('degrades rather than throwing on a malformed argument buffer', async () => {
    const events = await collect(
      sse([
        { type: 'TOOL_CALL_START', toolCallId: 'z', toolCallName: 't' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'z', delta: '{not json' },
        { type: 'TOOL_CALL_END', toolCallId: 'z' },
      ]),
    );
    const end = events.find((e) => e.kind === 'tool_end');
    expect(end?.name).toBe('t');      // name still recovered
    expect(end?.input).toBeNull();    // input degraded, stream intact
  });
});
