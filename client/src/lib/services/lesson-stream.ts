// SSE parser for the two lesson-generation streams (`/api/lesson-plan`,
// `/api/lesson-write`). The server emits `data: <json>\n\n` blocks, same
// wire shape as chat-stream.ts's AG-UI parser, but the payload here is
// this app's own `LessonProgressEvent` / `LessonPlanFrame` vocabulary
// (server: lesson-generation.ts, api.lesson-plan.tsx), not AG-UI's —
// there's no chat text to accumulate, no citations, no tool calls. Kept as
// a separate module from chat-stream.ts rather than folding one into the
// other: the two wire formats are unrelated and forcing a shared parser
// would just mean two dialects behind one function.

import type { LessonPlanFrame } from '#/routes/api.lesson-plan';
import type { LessonProgressEvent } from '#/lib/services/lesson-generation';

async function* streamJsonFrames<T>(response: Response): AsyncGenerator<T, void, void> {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Request failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error('lesson-stream: empty response body');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const frame = parseBlock<T>(block);
        if (frame) yield frame;
        idx = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const tail = parseBlock<T>(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseBlock<T>(block: string): T | null {
  const lines = block.split('\n');
  let payload = '';
  for (const line of lines) {
    if (line.startsWith('data:')) payload += line.slice(5).trimStart();
  }
  if (!payload) return null;
  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

/** Consumes the `/api/lesson-plan` SSE response. Yields every progress
 * event plus the terminal `plan` frame on success. */
export function streamLessonPlanSSE(response: Response): AsyncGenerator<LessonPlanFrame, void, void> {
  return streamJsonFrames<LessonPlanFrame>(response);
}

/** Consumes the `/api/lesson-write` SSE response. Yields every progress
 * event plus the terminal `saved` frame on success. */
export function streamLessonWriteSSE(
  response: Response,
): AsyncGenerator<LessonProgressEvent, void, void> {
  return streamJsonFrames<LessonProgressEvent>(response);
}
