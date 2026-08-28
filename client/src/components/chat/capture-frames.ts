// A `useChat` fetcher that pulls custom SSE frames out of the stream and binds
// them to the message they belong to.
//
// THE PROBLEM. `/api/ask` retrieves passages BEFORE it generates, so it emits
// its citations ahead of the answer they support — a `CITATIONS` frame written
// as raw bytes in front of the SDK's own stream. `useChat` has no slot for
// that: `onCustomEvent`'s context carries a `toolCallId` and nothing else
// (ai-client types.d.ts:696), so a citation arriving before its message cannot
// be correlated with one.
//
// THE FIX. Correlate in the transport, where both halves are visible. The
// stream is read once on the way through: frames matching `match` are pulled
// aside, and the next `TEXT_MESSAGE_START` names the message they belong to —
// that frame carries `messageId` by construction. Verified live:
//
//   {"type":"TEXT_MESSAGE_START","messageId":"msg-…","role":"assistant",
//    "metadata":{"tanstack":{"model":"gemma4-kb:latest"}}}
//
// Everything else is passed through byte-for-byte, so the SDK still parses a
// stream it fully understands and no server change is needed. This is why
// `/api/ask` can keep its wire format AND use the shared component.

/** A parsed SSE frame. Shape is the server's business; we only route it. */
type Frame = Record<string, unknown>;

export type CaptureConfig<T> = {
  /** Return a payload to capture this frame, or null to pass it through. */
  match: (frame: Frame) => T | null;
  /** Called once the captured payload can be named by its message id. */
  onCapture: (messageId: string, payload: T) => void;
};

/**
 * Build a `useChat` fetcher that captures matching frames.
 *
 * Captured frames are withheld from the SDK — it would ignore an unknown
 * `type` anyway, but dropping them keeps the stream strictly spec-shaped.
 */
export function createCapturingFetcher<T>(
  endpoint: string,
  capture: CaptureConfig<T>,
) {
  return async (
    input: { messages: unknown[]; threadId: string; runId: string; data?: unknown },
    options: { signal: AbortSignal; headers?: Record<string, string> },
  ): Promise<Response> => {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      body: JSON.stringify({
        threadId: input.threadId,
        runId: input.runId,
        messages: input.messages,
        tools: [],
        context: [],
        state: {},
        forwardedProps: input.data ?? {},
      }),
      signal: options.signal,
    });

    if (!upstream.ok || !upstream.body) return upstream;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const reader = upstream.body.getReader();

    // Payloads seen before any TEXT_MESSAGE_START. The first message id that
    // arrives claims them — which is correct, because the server emitted them
    // as the grounding for the answer it is about to write.
    let pending: T[] = [];
    let buffer = '';

    // A `start` pump rather than `pull`: this transform can consume a chunk
    // and emit nothing (the frame was captured, or is still incomplete), and a
    // pull-driven source that enqueues nothing on a turn is easy to stall.
    // Pumping to completion has no such failure mode.
    const filtered = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let out = '';
            let idx = buffer.indexOf('\n\n');

            while (idx !== -1) {
              const block = buffer.slice(0, idx + 2);
              buffer = buffer.slice(idx + 2);

              const frame = parseFrame(block);
              if (frame) {
                const captured = capture.match(frame);
                if (captured !== null) {
                  // Withhold it and hold onto the payload.
                  pending.push(captured);
                  idx = buffer.indexOf('\n\n');
                  continue;
                }
                if (frame.type === 'TEXT_MESSAGE_START' && typeof frame.messageId === 'string') {
                  for (const payload of pending) capture.onCapture(frame.messageId, payload);
                  pending = [];
                }
              }
              out += block;
              idx = buffer.indexOf('\n\n');
            }

            if (out.length > 0) controller.enqueue(encoder.encode(out));
          }

          buffer += decoder.decode();
          if (buffer.length > 0) controller.enqueue(encoder.encode(buffer));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
      cancel(reason) {
        void reader.cancel(reason);
      },
    });

    return new Response(filtered, {
      status: upstream.status,
      headers: upstream.headers,
    });
  };
}

/** Parse one `data:`-prefixed SSE block. Returns null for `[DONE]` and junk. */
function parseFrame(block: string): Frame | null {
  let payload = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('data:')) payload += line.slice(5).trimStart();
  }
  if (!payload || payload === '[DONE]') return null;
  try {
    return JSON.parse(payload) as Frame;
  } catch {
    return null;
  }
}
