// Shared helpers for the lesson MCP write tools (create_lesson, update_lesson).

import { strings } from '@strapi/utils';
import type { Core } from '@strapi/strapi';

// Guards against a pathological loop, not a realistic collision count — a
// personal KB regenerating the same topic dozens of times is not a case
// this needs to serve gracefully, just safely. Mirrors the client-side
// generator's MAX_SLUG_ATTEMPTS in client/src/lib/services/lessons.ts.
const MAX_SLUG_ATTEMPTS = 50;

/** Normalize a title/slug candidate into Strapi's own uid slug format. */
export function slugifyLessonTitle(input: string): string {
  return strings.nameToSlug(input, { separator: '-' });
}

// Discriminated on a string literal (`status`), not a boolean (`ok`) —
// TypeScript 5.9.3 (pinned by this package's `typescript: "^5"`) has a
// narrowing bug where truthy/falsy checks on a `true`/`false`-literal
// discriminant fail to narrow the `else`/negated branch (confirmed against
// a byte-identical fresh install of 5.9.3, not a local corruption). A
// string-literal discriminant narrows correctly, so that's what these use.
export type SlugResolution = { status: 'ok'; slug: string } | { status: 'error'; error: string };

/**
 * Find a free slug starting at `baseSlug`: try `baseSlug`, then
 * `baseSlug-2`, `baseSlug-3`, … until one doesn't collide with an existing
 * lesson. This is what makes "never overwrite on create" true — the model
 * cannot clobber someone's lesson just because a title collided.
 *
 * `excludeDocumentId` lets update_lesson re-check a *changed* slug without
 * tripping over the lesson's own current row.
 *
 * Check-then-create, not atomic — a genuine race would still be caught by
 * Strapi's own uniqueness constraint on the `uid` column, which the caller
 * should translate into a friendly retry message rather than a raw 500.
 */
export async function resolveFreeLessonSlug(
  strapi: Core.Strapi,
  baseSlug: string,
  excludeDocumentId?: string,
): Promise<SlugResolution> {
  if (!baseSlug) {
    return {
      status: 'error',
      error: 'Could not derive a slug — the title (or explicit slug) normalized to an empty string.',
    };
  }
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    // eslint-disable-next-line no-await-in-loop -- sequential by design: each probe depends on the previous one having failed.
    const existing = (await strapi.documents('api::lesson.lesson').findFirst({
      filters: { slug: { $eq: candidate } },
      fields: ['documentId'],
    })) as { documentId: string } | null;
    if (!existing || existing.documentId === excludeDocumentId) {
      return { status: 'ok', slug: candidate };
    }
  }
  return {
    status: 'error',
    error: `Could not find a free slug for "${baseSlug}" after ${MAX_SLUG_ATTEMPTS} attempts — pass an explicit, more specific "slug".`,
  };
}

export type VideoResolution =
  | { status: 'ok'; documentIds: string[] }
  | { status: 'error'; error: string };

/**
 * Resolve each entry of `videoIds` (youtubeVideoId or Strapi documentId) to
 * a Video documentId. Fails the whole call with an index-labeled message
 * rather than silently dropping an unresolved reference — a lesson whose
 * `videos` relation quietly loses an entry is exactly the "accepted
 * without complaint" failure mode this task exists to avoid.
 */
export async function resolveLessonVideoDocumentIds(
  strapi: Core.Strapi,
  videoIds: string[],
): Promise<VideoResolution> {
  const documentIds: string[] = [];
  for (let i = 0; i < videoIds.length; i += 1) {
    const raw = videoIds[i];
    // eslint-disable-next-line no-await-in-loop -- small, bounded lists (a lesson references a handful of videos); sequential keeps the error message attributable to a single index.
    let video = (await strapi.documents('api::video.video').findFirst({
      filters: { youtubeVideoId: { $eq: raw } },
      fields: ['documentId'],
    })) as { documentId: string } | null;
    if (!video) {
      // eslint-disable-next-line no-await-in-loop
      video = (await strapi.documents('api::video.video').findOne({
        documentId: raw,
        fields: ['documentId'],
      })) as { documentId: string } | null;
    }
    if (!video) {
      return {
        status: 'error',
        error: `videos[${i}]: no video found for "${raw}" (tried as youtubeVideoId, then as documentId).`,
      };
    }
    documentIds.push(video.documentId);
  }
  return { status: 'ok', documentIds };
}
