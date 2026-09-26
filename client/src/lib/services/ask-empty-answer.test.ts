// `/api/ask`'s "nothing in your library matches" reply, driven through the
// real @tanstack/ai StreamProcessor that useChat uses — not a mock of it.
//
// The route used to hand-write this reply as three raw frames with a constant
// `messageId: 'ask-empty'` and no run or message lifecycle. The processor
// resumes an existing message whose id matches, so in one conversation the
// second no-match answer was appended to the first bubble — and library
// conversations persist in Strapi (ADR 0014), so the merged bubble survived a
// reload. (Issue #8.)
import { describe, expect, it } from 'vitest';
import { StreamProcessor } from '@tanstack/ai';
import { EMPTY_ANSWER_TEXT, emptyAnswerResponse } from './ask-empty-answer';

type Chunk = { type: string; [k: string]: unknown };

/** SSE body → the chunks useChat would feed its processor. */
async function chunksOf(res: Response): Promise<Chunk[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .map((f) => f.replace(/^data: /, '').trim())
    .filter((f) => f && f !== '[DONE]')
    .map((f) => JSON.parse(f) as Chunk)
    // CITATIONS is this app's own frame; LibraryChat handles it, the
    // processor has no business with it.
    .filter((c) => c.type !== 'CITATIONS');
}

function assistantTexts(p: StreamProcessor): string[] {
  return p
    .getMessages()
    .filter((m) => m.role === 'assistant')
    .map((m) =>
      m.parts
        .filter((part) => part.type === 'text')
        .map((part) => (part as { content: string }).content)
        .join(''),
    );
}

// The exact frames the route used to send, kept as a record of the bug.
const OLD_FRAMES: Chunk[] = [
  { type: 'TEXT_MESSAGE_CONTENT', messageId: 'ask-empty', delta: EMPTY_ANSWER_TEXT },
];

describe('the old fixed-id reply (reproduction of #8)', () => {
  it('merges a second no-match answer into the first bubble', () => {
    const p = new StreamProcessor();
    p.addUserMessage('what about lydian dominant?');
    for (const c of OLD_FRAMES) p.processChunk(c as never);
    p.addUserMessage('and phrygian dominant?');
    for (const c of OLD_FRAMES) p.processChunk(c as never);

    const texts = assistantTexts(p);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toBe(EMPTY_ANSWER_TEXT + EMPTY_ANSWER_TEXT);
  });
});

describe('emptyAnswerResponse', () => {
  it('gives each no-match question its own answer', async () => {
    const p = new StreamProcessor();
    p.addUserMessage('what about lydian dominant?');
    for (const c of await chunksOf(emptyAnswerResponse())) p.processChunk(c as never);
    p.addUserMessage('and phrygian dominant?');
    for (const c of await chunksOf(emptyAnswerResponse())) p.processChunk(c as never);

    expect(assistantTexts(p)).toEqual([EMPTY_ANSWER_TEXT, EMPTY_ANSWER_TEXT]);
  });

  it('uses a fresh message id every time', async () => {
    const idOf = async () =>
      (await chunksOf(emptyAnswerResponse())).find((c) => c.type === 'TEXT_MESSAGE_START')
        ?.messageId;
    const [a, b] = [await idOf(), await idOf()];
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('carries the full run and message lifecycle, like the streaming path', async () => {
    const types = (await chunksOf(emptyAnswerResponse())).map((c) => c.type);
    expect(types).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
  });

  it('leads with an empty CITATIONS frame and ends on RUN_FINISHED, not [DONE]', async () => {
    const body = await emptyAnswerResponse().text();
    const frames = body.split('\n\n').filter(Boolean);
    expect(JSON.parse(frames[0].replace(/^data: /, ''))).toEqual({
      type: 'CITATIONS',
      citations: [],
    });
    // RUN_FINISHED is the stream terminator. The old reply ended with an
    // OpenAI-style `data: [DONE]`, which @tanstack/ai-client logs as
    // deprecated on every receipt, and which the SDK encoder the streaming
    // path uses never sends.
    expect(JSON.parse(frames.at(-1)!.replace(/^data: /, '')).type).toBe('RUN_FINISHED');
    expect(body).not.toContain('[DONE]');
  });

  it('is an event stream', () => {
    expect(emptyAnswerResponse().headers.get('Content-Type')).toBe('text/event-stream');
  });
});
