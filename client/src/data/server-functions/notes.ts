import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  createNoteService,
  listNotesForVideoService,
  updateNoteService,
  deleteNoteService,
  summarizeConversationToNote,
  type StrapiNote,
} from '#/lib/services/notes';
import { fetchVideoByVideoIdService, fetchVideoByDocumentIdService, type StrapiVideo } from '#/lib/services/videos';

// =============================================================================
// List notes for a video — used by the Notes tab on the learn route.
// =============================================================================

const ListNotesSchema = z.object({
  videoDocumentId: z.string().min(1).max(64),
});

export type ListNotesResult =
  | { status: 'ok'; notes: StrapiNote[] }
  | { status: 'error'; error: string };

export const listNotesForVideo = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof ListNotesSchema>) =>
    ListNotesSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ListNotesResult> => {
    const result = await listNotesForVideoService(data.videoDocumentId);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', notes: result.data };
  });

// =============================================================================
// Create / update / delete — for the manual scratchpad + edit flows.
// =============================================================================

const NoteSourceSchema = z.enum(['chat', 'digest-chat', 'mcp', 'manual']);

const CreateNoteSchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(50_000),
  source: NoteSourceSchema.default('manual'),
  author: z.string().max(120).optional(),
  videoDocumentIds: z.array(z.string().min(1).max(64)).min(1).max(10),
});

export type CreateNoteResult =
  | { status: 'ok'; note: StrapiNote }
  | { status: 'error'; error: string };

export const createNote = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof CreateNoteSchema>) =>
    CreateNoteSchema.parse(data),
  )
  .handler(async ({ data }): Promise<CreateNoteResult> => {
    const result = await createNoteService({
      title: data.title ?? null,
      body: data.body,
      source: data.source,
      author: data.author ?? null,
      videoDocumentIds: data.videoDocumentIds,
    });
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', note: result.data };
  });

const UpdateNoteSchema = z.object({
  documentId: z.string().min(1).max(64),
  title: z.string().max(200).nullable().optional(),
  body: z.string().min(1).max(50_000).optional(),
});

export const updateNote = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof UpdateNoteSchema>) =>
    UpdateNoteSchema.parse(data),
  )
  .handler(
    async ({
      data,
    }): Promise<
      { status: 'ok'; note: StrapiNote } | { status: 'error'; error: string }
    > => {
      const result = await updateNoteService({
        documentId: data.documentId,
        title: data.title,
        body: data.body,
      });
      if (!result.success) return { status: 'error', error: result.error };
      return { status: 'ok', note: result.data };
    },
  );

const DeleteNoteSchema = z.object({
  documentId: z.string().min(1).max(64),
});

export const deleteNote = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof DeleteNoteSchema>) =>
    DeleteNoteSchema.parse(data),
  )
  .handler(
    async ({
      data,
    }): Promise<{ status: 'ok' } | { status: 'error'; error: string }> => {
      const result = await deleteNoteService(data.documentId);
      if (!result.success) return { status: 'error', error: result.error };
      return { status: 'ok' };
    },
  );

// =============================================================================
// Summarize a conversation into a note. Works for single-video chats (source
// 'chat') and cross-video digest chats (source 'digest-chat'). Persists the
// result as a new Note row with the source video(s) attached.
// =============================================================================

const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});

const SummarizeToNoteSchema = z.object({
  videoIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  messages: z.array(ConversationMessageSchema).min(2).max(100),
  source: z.enum(['chat', 'digest-chat']).default('chat'),
  /** Active chat skill at save time — threaded into the summarizer so
   * the resulting note matches the conversation type (Social Post
   * preserves drafts; Tutor captures learning; Q&A uses the generic
   * study-note format). Optional; unknown slug falls back. */
  skillSlug: z.string().min(1).max(200).nullish(),
});

export type SummarizeToNoteResult =
  | {
      status: 'ok';
      noteDocumentId: string;
      title: string;
      body: string;
    }
  | { status: 'error'; error: string };

// Accept either a youtubeVideoId or a documentId — the chat UIs carry
// youtubeVideoId, but the digest route deals in both. Try both lookups.
async function resolveVideoById(id: string): Promise<StrapiVideo | null> {
  const byVid = await fetchVideoByVideoIdService(id).catch(() => null);
  if (byVid) return byVid;
  const byDoc = await fetchVideoByDocumentIdService(id).catch(() => null);
  return byDoc;
}

export const summarizeToNote = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof SummarizeToNoteSchema>) =>
    SummarizeToNoteSchema.parse(data),
  )
  .handler(async ({ data }): Promise<SummarizeToNoteResult> => {
    const videos: StrapiVideo[] = [];
    const missing: string[] = [];
    await Promise.all(
      data.videoIds.map(async (id) => {
        const v = await resolveVideoById(id);
        if (v) videos.push(v);
        else missing.push(id);
      }),
    );
    if (missing.length > 0) {
      return { status: 'error', error: `Could not find: ${missing.join(', ')}` };
    }

    // Summarizer currently operates on a single video (feeds its transcript
    // into the prompt). Digest-chat with N videos gets the first video's
    // transcript as seed context; refining the multi-video prompt is a
    // future change (would need to pick which transcript/summary slices
    // are relevant without blowing the context window).
    const summary = await summarizeConversationToNote({
      video: videos[0],
      messages: data.messages,
      skillSlug: data.skillSlug ?? null,
    });
    if (!summary.success) return { status: 'error', error: summary.error };

    const created = await createNoteService({
      title: summary.data.title,
      body: summary.data.body,
      source: data.source,
      author: data.source === 'digest-chat' ? 'digest-chat' : 'chat',
      videoDocumentIds: videos.map((v) => v.documentId),
    });
    if (!created.success) return { status: 'error', error: created.error };

    return {
      status: 'ok',
      noteDocumentId: created.data.documentId,
      title: summary.data.title,
      body: summary.data.body,
    };
  });
