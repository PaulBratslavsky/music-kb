// Tag tools: list, apply, remove. Tag names are normalized by the
// middleware in server/src/index.ts (lowercase + trimmed) so we don't
// repeat that here — pass whatever and it'll dedupe cleanly.

import { z } from 'zod';
import type { ToolDef } from '../registry';
import { slugifyTagName } from './tag-utils';

const listSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
});

export const listTagsTool: ToolDef<z.infer<typeof listSchema>> = {
  name: 'listTags',
  description: 'List every tag in the knowledge base with the count of videos that use it.',
  schema: listSchema,
  execute: async ({ limit }, { strapi }) => {
    const tags = (await strapi.documents('api::tag.tag').findMany({
      pagination: { start: 0, limit },
      sort: 'name:asc',
      populate: { videos: { fields: ['documentId'] } },
    })) as Array<{ name: string; slug: string; videos?: Array<{ documentId: string }> }>;

    return {
      tags: tags.map((t) => ({
        name: t.name,
        slug: t.slug,
        videoCount: (t.videos ?? []).length,
      })),
    };
  },
};

const tagVideoSchema = z.object({
  videoId: z.string().min(1).describe('youtubeVideoId or Video documentId.'),
  tags: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(20)
    .describe('Tag names to apply. Created on-the-fly if they don\'t exist.'),
});

async function resolveVideo(strapi: any, id: string) {
  let video = (await strapi.documents('api::video.video').findFirst({
    filters: { youtubeVideoId: { $eq: id } },
    populate: { tags: { fields: ['documentId', 'name'] } },
  })) as { documentId: string; tags?: Array<{ documentId: string; name: string }> } | null;
  if (video) return video;
  video = (await strapi.documents('api::video.video').findOne({
    documentId: id,
    populate: { tags: { fields: ['documentId', 'name'] } },
  })) as { documentId: string; tags?: Array<{ documentId: string; name: string }> } | null;
  return video;
}

export const tagVideoTool: ToolDef<z.infer<typeof tagVideoSchema>> = {
  name: 'tagVideo',
  description: 'Apply one or more tags to a video. Unknown tags are created. Existing tags on the video are preserved — this only adds.',
  schema: tagVideoSchema,
  execute: async ({ videoId, tags }, { strapi }) => {
    const video = await resolveVideo(strapi, videoId);
    if (!video) return { error: `No video found for "${videoId}".` };

    const resolvedIds = new Set<string>((video.tags ?? []).map((t) => t.documentId));
    const added: string[] = [];

    for (const raw of tags) {
      const name = raw.trim().toLowerCase();
      if (!name) continue;
      let tag = (await strapi.documents('api::tag.tag').findFirst({
        filters: { name: { $eq: name } },
      })) as { documentId: string } | null;
      if (!tag) {
        // Tag schema has `slug: uid(targetField: name)` required. The
        // documents API does NOT auto-generate uid fields, so compute the
        // slug explicitly to match what the admin UI would produce.
        tag = (await strapi.documents('api::tag.tag').create({
          data: { name, slug: slugifyTagName(name) } as never,
        })) as { documentId: string };
      }
      if (!resolvedIds.has(tag.documentId)) {
        resolvedIds.add(tag.documentId);
        added.push(name);
      }
    }

    await strapi.documents('api::video.video').update({
      documentId: video.documentId,
      data: { tags: Array.from(resolvedIds) } as Record<string, unknown>,
    });

    return {
      videoDocumentId: video.documentId,
      tagsAdded: added,
      totalTags: resolvedIds.size,
    };
  },
};

const untagSchema = z.object({
  videoId: z.string().min(1),
  tags: z.array(z.string().min(1).max(40)).min(1).max(20),
});

export const untagVideoTool: ToolDef<z.infer<typeof untagSchema>> = {
  name: 'untagVideo',
  description: 'Remove one or more tags from a video. Missing tags are silently ignored. Does not delete the Tag row itself.',
  schema: untagSchema,
  execute: async ({ videoId, tags }, { strapi }) => {
    const video = await resolveVideo(strapi, videoId);
    if (!video) return { error: `No video found for "${videoId}".` };

    const drop = new Set(tags.map((t) => t.trim().toLowerCase()));
    const remaining = (video.tags ?? [])
      .filter((t) => !drop.has(t.name))
      .map((t) => t.documentId);

    await strapi.documents('api::video.video').update({
      documentId: video.documentId,
      data: { tags: remaining } as Record<string, unknown>,
    });

    return {
      videoDocumentId: video.documentId,
      removed: Array.from(drop),
      remainingTagCount: remaining.length,
    };
  },
};
