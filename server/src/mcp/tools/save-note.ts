// Attach a markdown note to a video. Append-only — use the Strapi admin
// panel or a future MCP tool to edit/delete. Notes live on api::note.note
// with a many-to-many relation to Video (so a note can span multiple
// videos if written against a cross-video conversation).

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  videoId: z
    .string()
    .min(1)
    .describe('youtubeVideoId or Video documentId.'),
  body: z
    .string()
    .min(1)
    .describe('The note body. Markdown — rendered as rich text in the app.'),
  title: z
    .string()
    .max(200)
    .optional()
    .describe('Optional short heading for the note.'),
  author: z
    .string()
    .max(120)
    .optional()
    .describe('Optional author label — typically the MCP client name. Defaults to "mcp".'),
});

export const saveNoteTool: ToolDef<z.infer<typeof schema>> = {
  name: 'saveNote',
  description:
    "Attach a markdown note to a video. Use this to capture frontier-model observations so they're visible later from the app. Append-only — one tool call = one new note.",
  schema,
  execute: async ({ videoId, body, title, author }, { strapi }) => {
    let video = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: videoId } },
    })) as { documentId: string } | null;
    if (!video) {
      video = (await strapi.documents('api::video.video').findOne({
        documentId: videoId,
      })) as { documentId: string } | null;
    }
    if (!video) return { error: `No video found for "${videoId}".` };

    // `api::note.note` isn't in the generated ContentType union until the
    // first `strapi build` regenerates types — cast the UID here.
    const noteDocuments = strapi.documents('api::note.note' as never);
    const note = (await noteDocuments.create({
      data: {
        title: title ?? null,
        body,
        source: 'mcp',
        author: author ?? 'mcp',
        videos: [video.documentId],
      } as never,
    })) as { documentId: string };

    return {
      noteDocumentId: note.documentId,
      videoDocumentId: video.documentId,
      characters: body.length,
    };
  },
};
