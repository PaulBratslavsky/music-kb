// Durable chat transcripts — the Strapi side of TanStack AI's persistence port.
//
// WHY THIS EXISTS. `useChat`'s `ChatClientPersistence` is three methods over a
// `ChatPersistedState` record, and every one of them is allowed to return a
// promise (verified in
// `node_modules/@tanstack/ai-client/dist/esm/types.d.ts:482-486`). That is the
// whole reason a server-backed transcript is possible without touching <Chat>:
// the adapter is the only thing that changes, and this module is what it talks
// to through a server function.
//
// The row is addressed by `threadId`, because that is the only identifier the
// SDK hands a persistence adapter — `getItem(id)` / `setItem(id, state)` /
// `removeItem(id)`. Making it `unique` in the schema is what turns
// read-modify-write into an upsert instead of a duplicate-row generator; the
// same trick Digest plays with `videoSetKey` (ADR 0006).
//
// Server-only, like every other module that imports `strapi-client`.

import { strapiFetch } from './strapi-client';
import type { Citation } from './citations';

type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

// =============================================================================
// Types — mirror server/src/api/chat-conversation/content-types/.../schema.json
// =============================================================================

/**
 * Citations for one message, as stored.
 *
 * An array of pairs rather than an object, because that is what
 * `[...map]` / `new Map(pairs)` round-trips through JSON without a
 * key-coercion step — and the LibraryChat code already held them in a Map.
 */
export type StoredCitations = Array<[string, Citation[]]>;

/**
 * Anything that survives a JSON column.
 *
 * `unknown` would be more honest about our indifference to the contents, but
 * it does not cross a TanStack Start server function: the seroval boundary
 * types unserialisable values as `SerializationError`, and `unknown` includes
 * them. `JsonValue` says the same thing — "we do not interpret this" — in a
 * form the boundary can check.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The persisted record, shaped to the SDK's `ChatPersistedState` plus the
 * citations that ride alongside it.
 *
 * `messages` and `resume` are stored VERBATIM and typed as opaque JSON on
 * purpose. This module's job is durability, not interpretation: the SDK owns
 * the `UIMessage` shape, it changes between minor versions, and re-declaring
 * it here would create a second source of truth that silently drifts. The one
 * thing we assert is that `messages` is an array — enough to reject a
 * corrupted row without pretending to know what is inside it.
 */
export type StoredConversation = {
  messages: JsonValue[];
  resume?: JsonValue;
  citations: StoredCitations;
};

type StrapiChatConversation = {
  id: number;
  documentId: string;
  threadId: string;
  surface: string | null;
  messages: JsonValue;
  resume: JsonValue;
  citations: JsonValue;
};

// =============================================================================
// Read
// =============================================================================

/**
 * Load one conversation, or `null` when the thread has never been saved.
 *
 * "Never saved" and "backend unreachable" are DIFFERENT answers and are kept
 * apart deliberately: the adapter must not treat a dead Strapi as an empty
 * conversation, or a reload during an outage would present a blank chat and
 * then overwrite the real transcript with it on the next message.
 */
export async function findConversationByThreadIdService(
  threadId: string,
): Promise<ServiceResult<StoredConversation | null>> {
  const result = await strapiFetch<StrapiChatConversation[]>('GET', '/api/chat-conversations', {
    query: {
      filters: { threadId: { $eq: threadId } },
      pagination: { pageSize: 1 },
    },
  });
  if (!result.ok) return { success: false, error: result.error };

  const row = result.data?.[0];
  if (!row) return { success: true, data: null };

  // A row whose `messages` is not an array is corrupt — a hand-edit in the
  // admin UI, or a half-written record. Report it as absent rather than
  // handing the SDK something it will throw on mid-render.
  if (!Array.isArray(row.messages)) return { success: true, data: null };

  return {
    success: true,
    data: {
      messages: row.messages,
      ...(row.resume == null ? {} : { resume: row.resume }),
      citations: Array.isArray(row.citations) ? (row.citations as StoredCitations) : [],
    },
  };
}

// =============================================================================
// Write
// =============================================================================

async function findRowId(threadId: string): Promise<ServiceResult<string | null>> {
  const result = await strapiFetch<StrapiChatConversation[]>('GET', '/api/chat-conversations', {
    query: {
      fields: ['threadId'],
      filters: { threadId: { $eq: threadId } },
      pagination: { pageSize: 1 },
    },
  });
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, data: result.data?.[0]?.documentId ?? null };
}

/**
 * Upsert a conversation by `threadId`.
 *
 * Find-then-write is two round trips and therefore racy: two writers can both
 * see "absent" and both POST. The `unique` constraint on `threadId` turns that
 * race into a rejected insert rather than a duplicate row, and the retry below
 * turns the rejected insert into the update it should have been. Without the
 * retry the loser of the race silently loses its turn of the conversation —
 * which is exactly the cross-device case this feature exists to serve.
 */
export async function saveConversationService(input: {
  threadId: string;
  surface: string;
  state: StoredConversation;
}): Promise<ServiceResult<void>> {
  const body = {
    data: {
      threadId: input.threadId,
      surface: input.surface,
      messages: input.state.messages,
      resume: input.state.resume ?? null,
      citations: input.state.citations,
    },
  };

  const existing = await findRowId(input.threadId);
  if (!existing.success) return { success: false, error: existing.error };

  if (existing.data) {
    const updated = await strapiFetch<StrapiChatConversation>(
      'PUT',
      `/api/chat-conversations/${existing.data}`,
      { body },
    );
    return updated.ok ? { success: true, data: undefined } : { success: false, error: updated.error };
  }

  const created = await strapiFetch<StrapiChatConversation>('POST', '/api/chat-conversations', {
    body,
  });
  if (created.ok) return { success: true, data: undefined };

  // Lost the insert race (or the row appeared between our two calls). Re-read
  // and update in place. One retry only — a second failure is a real error.
  const raced = await findRowId(input.threadId);
  if (!raced.success) return { success: false, error: raced.error };
  if (!raced.data) return { success: false, error: created.error };

  const updated = await strapiFetch<StrapiChatConversation>(
    'PUT',
    `/api/chat-conversations/${raced.data}`,
    { body },
  );
  return updated.ok ? { success: true, data: undefined } : { success: false, error: updated.error };
}

/**
 * Delete a conversation. A missing row is success — the SDK calls `removeItem`
 * on every clear, including clears of threads that were never written.
 */
export async function deleteConversationService(
  threadId: string,
): Promise<ServiceResult<void>> {
  const existing = await findRowId(threadId);
  if (!existing.success) return { success: false, error: existing.error };
  if (!existing.data) return { success: true, data: undefined };

  const result = await strapiFetch<unknown>(
    'DELETE',
    `/api/chat-conversations/${existing.data}`,
  );
  if (!result.ok && result.status !== 404) {
    return { success: false, error: result.error };
  }
  return { success: true, data: undefined };
}
