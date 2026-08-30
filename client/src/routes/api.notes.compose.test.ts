// Contract tests for POST /api/notes/compose.
//
// This route used to return SSE and now returns JSON. Nothing covered it when
// that changed — the component was the only thing that knew the shape, so a
// mismatch would have surfaced as a silently empty draft in the editor rather
// than as a failing test. These pin the contract both sides rely on.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const streamToTextMock = vi.fn();
const chatMock = vi.fn();

vi.mock('@tanstack/ai', () => ({
  chat: (...a: unknown[]) => chatMock(...a),
  streamToText: (...a: unknown[]) => streamToTextMock(...a),
}));
vi.mock('#/lib/services/videos', () => ({
  fetchVideoByVideoIdService: async () => ({
    documentId: 'v1',
    videoId: 'yt1',
    title: 'A video',
    summary: 'A summary that is ready.',
    summaryStatus: 'generated',
  }),
  fetchTranscriptByVideoIdService: async () => ({ transcript: 'some transcript text' }),
}));
vi.mock('#/lib/services/transcript', () => ({ cleanTranscript: (t: string) => t }));
vi.mock('#/lib/services/chat-model-request', () => ({
  resolveRequestModel: async () => ({
    model: { adapter: {}, modelOptions: () => ({}), tier: 'local' },
    notice: null,
  }),
  withSystem: (_m: unknown, system: string, messages: unknown[]) => ({ system, messages }),
}));
vi.mock('#/lib/services/stream-errors', () => ({
  withFriendlyErrors: (_m: unknown, s: unknown) => s,
}));

const { notesComposeHandler } = await import('./api.notes.compose');

const post = (body: unknown) =>
  new Request('http://localhost/api/notes/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const VALID = { videoId: 'yt1', prompt: 'Draft a note', modelChoice: 'default' };

beforeEach(() => {
  chatMock.mockReset();
  streamToTextMock.mockReset();
  chatMock.mockReturnValue({});
  streamToTextMock.mockResolvedValue('# Title\n\nBody.');
});

describe('POST /api/notes/compose', () => {
  it('returns the draft as JSON, not SSE', async () => {
    const res = await notesComposeHandler(post(VALID));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ markdown: '# Title\n\nBody.' });
  });

  it('collapses the stream exactly once', async () => {
    await notesComposeHandler(post(VALID));
    expect(streamToTextMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run as a 500 with the already-translated message', async () => {
    // withFriendlyErrors has already mapped this with the tier that answered;
    // the route must pass it through, not re-map or swallow it.
    streamToTextMock.mockRejectedValue(new Error('Ollama is not running.'));

    const res = await notesComposeHandler(post(VALID));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Ollama is not running.' });
  });

  it('rejects invalid JSON without calling the model', async () => {
    const res = await notesComposeHandler(
      new Request('http://localhost/api/notes/compose', { method: 'POST', body: 'not json' }),
    );
    expect(res.status).toBe(400);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('requires videoId and prompt', async () => {
    expect((await notesComposeHandler(post({ prompt: 'x' }))).status).toBe(400);
    expect((await notesComposeHandler(post({ videoId: 'yt1' }))).status).toBe(400);
    expect(chatMock).not.toHaveBeenCalled();
  });

  it('caps prompt length', async () => {
    const res = await notesComposeHandler(post({ ...VALID, prompt: 'x'.repeat(4001) }));
    expect(res.status).toBe(400);
    expect(chatMock).not.toHaveBeenCalled();
  });
});
