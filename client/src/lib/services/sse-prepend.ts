// Put one extra SSE frame in front of an SDK event-stream response.
//
// `/api/ask` leads every answer with its own CITATIONS frame, then the normal
// AG-UI stream. Both of its paths — a real answer and "nothing matched" — go
// through here, so the frame assembly and its failure handling exist once.

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

/**
 * A Response whose body is `frame` followed by `response`'s body, byte for
 * byte. Failure and cancellation propagate across the join — see below.
 */
export function prependSseFrame(frame: string, response: Response): Response {
  const reader = response.body!.getReader();
  const encoder = new TextEncoder();

  const combined = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(frame));
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        // NOT `finally { close() }`. A closed stream cannot then transition to
        // errored, so closing on the way out of a rejected read swallows the
        // failure: the client sees a truncated body with no error frame and no
        // RUN_FINISHED, and the message withFriendlyErrors just produced is lost —
        // the exact silent failure the route's error translation exists to
        // prevent.
        controller.error(err);
      }
    },
    async cancel(reason) {
      // The browser aborted. Without this the upstream model run keeps
      // generating to completion, holding a connection nobody is reading.
      await reader.cancel(reason);
    },
  });

  return new Response(combined, { headers: SSE_HEADERS });
}
