// Upsert-by-threadId, and the two ways it can quietly lose a conversation.
//
// The Strapi shapes asserted here were verified against the LIVE backend
// before this file was written — create, filtered find, update, delete, and a
// duplicate-threadId insert (which returns 400, because the column is
// `unique`). That 400 is not hypothetical: it is what the retry path exists
// for, and it is reachable the moment two devices write the same conversation.

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./strapi-client', () => ({ strapiFetch: vi.fn() }));

import { strapiFetch } from './strapi-client';
import {
  findConversationByThreadIdService,
  saveConversationService,
  deleteConversationService,
} from './chat-conversations';

const mocked = vi.mocked(strapiFetch);
beforeEach(() => mocked.mockReset());

const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  documentId: 'doc-1',
  threadId: 'library-ask:v1',
  surface: 'library-ask',
  messages: [{ id: 'm1', role: 'user', parts: [] }],
  resume: null,
  citations: [['m1', [{ index: 0 }]]],
  ...over,
});

const ok = (data: unknown) => ({ ok: true as const, data });
const fail = (status = 500, error = 'boom') => ({ ok: false as const, status, error });

describe('findConversationByThreadIdService', () => {
  it('filters by the threadId it was given', async () => {
    // The ENTIRE contract of this module is upsert-by-threadId, and nothing
    // asserted it: a query that filtered on nothing, or on the wrong field,
    // would return the first conversation in the table and every other test
    // here would still pass. With one user that reads as "my chat came back";
    // with two it is one user reading another's transcript.
    mocked.mockResolvedValueOnce(ok([row()]) as never);
    await findConversationByThreadIdService('library-ask:v1');

    const [, path, init] = mocked.mock.calls[0] as [string, string, { query: any }];
    expect(path).toBe('/api/chat-conversations');
    expect(init.query.filters).toEqual({ threadId: { $eq: 'library-ask:v1' } });
  });

  it('reads only one row — this is a lookup, not a listing', async () => {
    // pageSize 1 is the difference between a keyed read and pulling every
    // conversation over the wire to use the first one.
    mocked.mockResolvedValueOnce(ok([row()]) as never);
    await findConversationByThreadIdService('library-ask:v1');
    const [, , init] = mocked.mock.calls[0] as [string, string, { query: any }];
    expect(init.query.pagination).toEqual({ pageSize: 1 });
  });

  it('returns the stored record for a saved thread', async () => {
    mocked.mockResolvedValueOnce(ok([row()]) as never);
    const result = await findConversationByThreadIdService('library-ask:v1');

    expect(result).toEqual({
      success: true,
      data: {
        messages: [{ id: 'm1', role: 'user', parts: [] }],
        citations: [['m1', [{ index: 0 }]]],
      },
    });
  });

  it('returns null — not an error — for a thread never saved', async () => {
    mocked.mockResolvedValueOnce(ok([]) as never);
    await expect(findConversationByThreadIdService('nope')).resolves.toEqual({
      success: true,
      data: null,
    });
  });

  it('keeps "backend down" distinct from "nothing stored"', async () => {
    // The adapter must not treat an outage as an empty conversation: doing so
    // would paint a blank chat and then overwrite the real transcript with it.
    mocked.mockResolvedValueOnce(fail(0, 'network unreachable') as never);
    const result = await findConversationByThreadIdService('library-ask:v1');
    expect(result).toEqual({ success: false, error: 'network unreachable' });
  });

  it('treats a row with non-array messages as absent', async () => {
    // A hand-edit in the admin UI, or a half-written record. Better to lose
    // the transcript than to hand the SDK something it throws on mid-render.
    mocked.mockResolvedValueOnce(ok([row({ messages: { oops: true } })]) as never);
    await expect(findConversationByThreadIdService('library-ask:v1')).resolves.toEqual({
      success: true,
      data: null,
    });
  });

  it('tolerates a row with no citations', async () => {
    mocked.mockResolvedValueOnce(ok([row({ citations: null })]) as never);
    const result = await findConversationByThreadIdService('library-ask:v1');
    expect(result).toMatchObject({ success: true, data: { citations: [] } });
  });

  it('round-trips a resume snapshot', async () => {
    // Dropping `resume` would break resume-after-reload while leaving the
    // transcript looking perfectly fine.
    const resume = { resumeState: { runId: 'r1' }, pendingInterrupts: [] };
    mocked.mockResolvedValueOnce(ok([row({ resume })]) as never);
    const result = await findConversationByThreadIdService('library-ask:v1');
    expect(result).toMatchObject({ success: true, data: { resume } });
  });
});

describe('saveConversationService', () => {
  const state = { messages: [{ id: 'm1' }], citations: [] as never };

  it('updates in place when the thread already exists', async () => {
    mocked
      .mockResolvedValueOnce(ok([{ documentId: 'doc-1' }]) as never) // find
      .mockResolvedValueOnce(ok(row()) as never); // update

    await expect(
      saveConversationService({ threadId: 'library-ask:v1', surface: 'library-ask', state }),
    ).resolves.toEqual({ success: true, data: undefined });

    expect(mocked.mock.calls[1][0]).toBe('PUT');
    expect(mocked.mock.calls[1][1]).toBe('/api/chat-conversations/doc-1');

    // The BODY, not just the verb and URL. An implementation that PUT an empty
    // object to the right address passed every assertion above.
    const { body } = mocked.mock.calls[1][2] as { body: { data: Record<string, unknown> } };
    expect(body.data.threadId).toBe('library-ask:v1');
    expect(body.data.messages).toEqual(state.messages);
    expect(body.data.citations).toEqual(state.citations);
  });

  it('creates when the thread is new', async () => {
    mocked
      .mockResolvedValueOnce(ok([]) as never) // find: absent
      .mockResolvedValueOnce(ok(row()) as never); // create

    await expect(
      saveConversationService({ threadId: 'library-ask:v1', surface: 'library-ask', state }),
    ).resolves.toEqual({ success: true, data: undefined });

    expect(mocked.mock.calls[1][0]).toBe('POST');
  });

  it('recovers when it loses the insert race to another device', async () => {
    // Both writers see "absent", both POST, the unique constraint rejects one
    // with a 400. Without the retry, the loser silently drops its turn of the
    // conversation — the exact cross-device case this feature is for.
    mocked
      .mockResolvedValueOnce(ok([]) as never) // find: absent
      .mockResolvedValueOnce(fail(400, 'This attribute must be unique') as never) // create loses
      .mockResolvedValueOnce(ok([{ documentId: 'doc-9' }]) as never) // re-find: now present
      .mockResolvedValueOnce(ok(row()) as never); // update

    await expect(
      saveConversationService({ threadId: 'library-ask:v1', surface: 'library-ask', state }),
    ).resolves.toEqual({ success: true, data: undefined });

    expect(mocked.mock.calls[3][0]).toBe('PUT');
    expect(mocked.mock.calls[3][1]).toBe('/api/chat-conversations/doc-9');
  });

  it('reports the original error when a create fails for a non-race reason', async () => {
    mocked
      .mockResolvedValueOnce(ok([]) as never)
      .mockResolvedValueOnce(fail(500, 'disk full') as never)
      .mockResolvedValueOnce(ok([]) as never); // re-find: still absent → not a race

    await expect(
      saveConversationService({ threadId: 'library-ask:v1', surface: 'library-ask', state }),
    ).resolves.toEqual({ success: false, error: 'disk full' });
  });

  it('sends resume as null rather than omitting it', async () => {
    // Strapi keeps the previous column value for an omitted key, so a run that
    // finished would keep a stale resume pointer forever.
    mocked
      .mockResolvedValueOnce(ok([{ documentId: 'doc-1' }]) as never)
      .mockResolvedValueOnce(ok(row()) as never);

    await saveConversationService({ threadId: 't', surface: 'library-ask', state });

    const body = mocked.mock.calls[1][2] as { body: { data: { resume: unknown } } };
    expect(body.body.data.resume).toBeNull();
  });
});

describe('deleteConversationService', () => {
  it('deletes the row for a saved thread', async () => {
    mocked
      .mockResolvedValueOnce(ok([{ documentId: 'doc-1' }]) as never)
      .mockResolvedValueOnce(ok(null) as never);

    await expect(deleteConversationService('library-ask:v1')).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(mocked.mock.calls[1][0]).toBe('DELETE');
  });

  it('succeeds when there is nothing to delete', async () => {
    // The SDK calls removeItem on every clear, including clears of threads
    // that were never written. That is not an error.
    mocked.mockResolvedValueOnce(ok([]) as never);
    await expect(deleteConversationService('never-saved')).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('treats a 404 on delete as success', async () => {
    mocked
      .mockResolvedValueOnce(ok([{ documentId: 'doc-1' }]) as never)
      .mockResolvedValueOnce(fail(404, 'Not Found') as never);
    await expect(deleteConversationService('library-ask:v1')).resolves.toEqual({
      success: true,
      data: undefined,
    });
  });

  it('reports a real delete failure', async () => {
    mocked
      .mockResolvedValueOnce(ok([{ documentId: 'doc-1' }]) as never)
      .mockResolvedValueOnce(fail(500, 'boom') as never);
    await expect(deleteConversationService('library-ask:v1')).resolves.toEqual({
      success: false,
      error: 'boom',
    });
  });
});
