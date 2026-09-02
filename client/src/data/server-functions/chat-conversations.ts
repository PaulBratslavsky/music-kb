// Server functions behind the durable-chat persistence adapter.
//
// The adapter in `components/chat/server-persistence.ts` calls these three and
// nothing else. Validation lives here, Strapi I/O lives in the service, per the
// server-function convention.

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  findConversationByThreadIdService,
  saveConversationService,
  deleteConversationService,
  type StoredConversation,
  type JsonValue,
} from '#/lib/services/chat-conversations';

// A thread id is an app-authored key, not user input — but it arrives over the
// wire like anything else, so it is bounded here. 200 matches the column.
const ThreadIdSchema = z.string().min(1).max(200);

/**
 * `messages` and `resume` are passed through as opaque JSON.
 *
 * Validating their INTERNALS here would mean re-declaring the SDK's `UIMessage`
 * union — a second source of truth for a shape that changes between minor
 * versions, and one whose drift would show up as messages silently failing to
 * save. What is worth validating is the envelope (it is an array) and the SIZE,
 * which is what actually protects the database.
 */
/** Bounds, not shapes — deliberately O(1) rather than walking every message. */
const MAX_MESSAGES = 2000;

const MessagesSchema = z.custom<JsonValue[]>(
  (v) => Array.isArray(v) && v.length <= MAX_MESSAGES,
  { message: `messages must be an array of at most ${MAX_MESSAGES} entries` },
);

const CitationsSchema = z.custom<Array<[string, JsonValue[]]>>(
  (v) =>
    Array.isArray(v) &&
    v.length <= MAX_MESSAGES &&
    v.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string'),
  { message: 'citations must be [messageId, Citation[]] pairs' },
);

const StoredConversationSchema = z.object({
  messages: MessagesSchema,
  resume: z.custom<JsonValue>().optional(),
  citations: CitationsSchema,
});

// =============================================================================
// Load
// =============================================================================

const LoadSchema = z.object({ threadId: ThreadIdSchema });

export type LoadConversationResult =
  | { status: 'ok'; conversation: StoredConversation | null }
  | { status: 'error'; error: string };

export const loadConversation = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof LoadSchema>) => LoadSchema.parse(data))
  .handler(async ({ data }): Promise<LoadConversationResult> => {
    const result = await findConversationByThreadIdService(data.threadId);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', conversation: result.data };
  });

// =============================================================================
// Save
// =============================================================================

const SaveSchema = z.object({
  threadId: ThreadIdSchema,
  surface: z.string().min(1).max(60),
  state: StoredConversationSchema,
});

export type SaveConversationResult =
  | { status: 'ok' }
  | { status: 'error'; error: string };

export const saveConversation = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof SaveSchema>) => SaveSchema.parse(data))
  .handler(async ({ data }): Promise<SaveConversationResult> => {
    const result = await saveConversationService({
      threadId: data.threadId,
      surface: data.surface,
      state: data.state as StoredConversation,
    });
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok' };
  });

// =============================================================================
// Delete
// =============================================================================

const DeleteSchema = z.object({ threadId: ThreadIdSchema });

export type DeleteConversationResult =
  | { status: 'ok' }
  | { status: 'error'; error: string };

export const deleteConversation = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof DeleteSchema>) => DeleteSchema.parse(data))
  .handler(async ({ data }): Promise<DeleteConversationResult> => {
    const result = await deleteConversationService(data.threadId);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok' };
  });
