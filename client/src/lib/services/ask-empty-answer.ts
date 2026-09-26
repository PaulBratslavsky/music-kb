// `/api/ask`'s reply when library retrieval finds nothing to answer from.
//
// It used to be three hand-written frames with a constant
// `messageId: 'ask-empty'` and no run or message lifecycle. useChat's stream
// processor resumes an existing message whose id matches, so a second
// no-match question in the same conversation appended to the FIRST answer's
// bubble — persisted, since library conversations live in Strapi (ADR 0014).
// (Issue #8.)
//
// It is now an ordinary one-message run, encoded by the same SDK encoder as a
// real answer, so the two paths cannot disagree about the wire format again.

import { EventType, toServerSentEventsResponse, type StreamChunk } from '@tanstack/ai';
import { prependSseFrame } from '#/lib/services/sse-prepend';

export const EMPTY_ANSWER_TEXT =
  "I couldn't find anything in your library that matches this question. Try rephrasing, or add more videos that cover the topic.";

async function* emptyAnswerRun(): AsyncGenerator<StreamChunk> {
  // Fresh ids per reply are the whole fix: a reused messageId is what made
  // the processor merge two answers into one.
  const threadId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const timestamp = Date.now();
  yield { type: EventType.RUN_STARTED, threadId, runId, timestamp };
  yield { type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant', timestamp };
  yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: EMPTY_ANSWER_TEXT, timestamp };
  yield { type: EventType.TEXT_MESSAGE_END, messageId, timestamp };
  yield { type: EventType.RUN_FINISHED, threadId, runId, finishReason: 'stop', timestamp };
}

/** The complete SSE response for a question nothing in the library matches. */
export function emptyAnswerResponse(): Response {
  const citationsFrame = `data: ${JSON.stringify({ type: 'CITATIONS', citations: [] })}\n\n`;
  return prependSseFrame(citationsFrame, toServerSentEventsResponse(emptyAnswerRun()));
}
