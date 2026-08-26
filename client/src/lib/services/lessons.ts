// Read-side service for Strapi-backed lessons.
//
// Dynamic zones are NOT populated by default in Strapi 5 — without an
// explicit populate the `body` array comes back empty, which looks exactly
// like an unauthored lesson. That is the single most likely bug in this
// file, so the populate is spelled out rather than relying on a default.

import { strapiFetch } from './strapi-client';
// Type-only — erased at compile time (verbatimModuleSyntax), so this does
// not create a runtime circular import even though lesson-generation.ts
// imports `LessonBlock` from this file below.
import type { GeneratedLesson, SourceVideo } from './lesson-generation';

// Recursive JSON type for a dynamic-zone component's extra, component-
// specific fields. `unknown` would be semantically accurate too, but
// TanStack Start's server-fn return type is checked at compile time for
// serializability and rejects a bare `unknown` index signature — this
// type is what those fields actually are (JSON straight off Strapi), so
// it satisfies that check without loosening the read-side contract.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type LessonBlock = {
  __component: string;
  id: number;
  [key: string]: JsonValue;
};

export type LessonParameter = {
  name: string;
  label: string;
  default: string;
};

// The video a lesson (or a citation inside it) draws on — deliberately
// thin. `stripVideoForClient` exists because full video rows (transcript,
// scores, etc.) are heavy; this type never grows those fields, it only
// ever carries what "Built from" / inline citations need to render a link
// with a real title and thumbnail instead of a raw video id.
export type LessonSourceVideo = {
  documentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoThumbnailUrl: string | null;
};

export type Lesson = {
  documentId: string;
  title: string;
  slug: string;
  summary: string | null;
  level: string;
  instrument: string;
  order: number;
  duration: string | null;
  status: string;
  parameter: LessonParameter | null;
  body: LessonBlock[];
  /** Resolved by `getLessonBySlugWithStatus`: the populated `videos`
   * relation when present, otherwise derived from the distinct
   * `source.videoId` values on `body` (older lessons predate the
   * relation being populated on save). Empty for hand-written lessons,
   * which have neither. */
  videos: LessonSourceVideo[];
};

export type LessonSummary = Omit<Lesson, 'body' | 'parameter' | 'videos'>;

export type LessonResult =
  | { ok: true; lesson: Lesson }
  | { ok: false; status: number; error: string };

export type LessonListResult =
  | { ok: true; lessons: LessonSummary[] }
  | { ok: false; status: number; error: string };

/**
 * Index listing that distinguishes "Strapi has zero lessons" from "Strapi
 * is unreachable", so the route can render `BackendErrorPanel` instead of
 * a false empty state — the same convention `getLessonBySlugWithStatus`
 * uses on the detail route.
 */
export async function listLessonsWithStatus(): Promise<LessonListResult> {
  const res = await strapiFetch<LessonSummary[]>('GET', '/api/lessons', {
    query: {
      sort: ['order:asc'],
      pagination: { pageSize: 100 },
      fields: ['title', 'slug', 'summary', 'level', 'instrument', 'order', 'duration', 'status'],
    },
  });
  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error };
  }
  return { ok: true, lessons: res.data ?? [] };
}

// Fields kept small on purpose — see LessonSourceVideo. Applied both to the
// `videos` relation populate below and to the fallback video lookup.
const SOURCE_VIDEO_FIELDS = ['youtubeVideoId', 'videoTitle', 'videoThumbnailUrl'];

function dedupeSourceVideos(videos: LessonSourceVideo[]): LessonSourceVideo[] {
  const seen = new Set<string>();
  const out: LessonSourceVideo[] = [];
  for (const v of videos) {
    if (seen.has(v.documentId)) continue;
    seen.add(v.documentId);
    out.push(v);
  }
  return out;
}

// Older lessons (saved before the `videos` relation was threaded through
// on save, or hand-migrated) have an empty relation but still carry
// `source.videoId` on individual blocks. Walk the body once, in order, and
// return the distinct video ids referenced — this is what lets those
// lessons still show a "Built from" section instead of an empty one.
function deriveSourceVideoIds(body: LessonBlock[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const block of body) {
    const source = block.source;
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const videoId = (source as Record<string, JsonValue>).videoId;
    if (typeof videoId !== 'string' || videoId.length === 0) continue;
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    ids.push(videoId);
  }
  return ids;
}

async function fetchLessonSourceVideos(
  videoIds: string[],
): Promise<LessonSourceVideo[]> {
  if (videoIds.length === 0) return [];
  const res = await strapiFetch<LessonSourceVideo[]>('GET', '/api/videos', {
    query: {
      filters: { youtubeVideoId: { $in: videoIds } },
      fields: SOURCE_VIDEO_FIELDS,
      pagination: { pageSize: videoIds.length },
    },
  });
  if (!res.ok) return [];
  const byId = new Map((res.data ?? []).map((v) => [v.youtubeVideoId, v]));
  // Preserve first-appearance order from the body; silently drop any id
  // Strapi couldn't resolve (deleted video) rather than rendering a broken
  // link for it.
  return videoIds
    .map((id) => byId.get(id))
    .filter((v): v is LessonSourceVideo => v !== undefined);
}

/**
 * Detail fetch that distinguishes "no such lesson" (404) from "Strapi is
 * unreachable" (status 0), so the route can render the right thing.
 */
export async function getLessonBySlugWithStatus(
  slug: string,
): Promise<LessonResult> {
  const res = await strapiFetch<Lesson[]>('GET', '/api/lessons', {
    query: {
      filters: { slug: { $eq: slug } },
      pagination: { pageSize: 1 },
      populate: {
        parameter: true,
        body: { populate: '*' },
        videos: { fields: SOURCE_VIDEO_FIELDS },
      },
    },
  });

  if (!res.ok) {
    return { ok: false, status: res.status, error: res.error };
  }
  const lesson = (res.data ?? [])[0];
  if (!lesson) {
    return { ok: false, status: 404, error: `No lesson with slug "${slug}"` };
  }

  let videos = dedupeSourceVideos(lesson.videos ?? []);
  if (videos.length === 0) {
    videos = await fetchLessonSourceVideos(deriveSourceVideoIds(lesson.body ?? []));
  }

  return { ok: true, lesson: { ...lesson, videos } };
}

// -----------------------------------------------------------------------------
// Single-video lookup — does a lesson already exist FOR this one video?
// -----------------------------------------------------------------------------
//
// Used by the learn page's Lesson tab: if a single-video lesson already
// exists for the video being viewed, show it instead of the generate form.
// Deliberately narrower than "any lesson that cites this video" — a library
// lesson that happens to draw on this video as one of five sources is not
// what that tab means by "a lesson for this video", so both lookups below
// only match a lesson whose ENTIRE resolved source set is this one video.
export type LessonForVideo = {
  documentId: string;
  title: string;
  slug: string;
  summary: string | null;
};

function toLessonForVideo(l: { documentId: string; title: string; slug: string; summary: string | null }): LessonForVideo {
  return { documentId: l.documentId, title: l.title, slug: l.slug, summary: l.summary };
}

/**
 * Looks up a single-video lesson for `documentId`/`youtubeVideoId` two ways,
 * same fallback order `getLessonBySlugWithStatus` already uses for a single
 * lesson's own `videos` list: the populated `videos` relation first (the
 * common case for anything saved by `saveLessonService`), then a scan of
 * `body` blocks' `source.videoId` for lessons saved before that relation
 * was threaded through. Either way, only returns a match when the lesson's
 * resolved source set has exactly one video — this one.
 */
export async function findLessonForVideoService(
  documentId: string,
  youtubeVideoId: string,
): Promise<LessonForVideo | null> {
  const byRelation = await strapiFetch<
    Array<{ documentId: string; title: string; slug: string; summary: string | null; videos: { documentId: string }[] }>
  >('GET', '/api/lessons', {
    query: {
      filters: { videos: { documentId: { $eq: documentId } } },
      fields: ['title', 'slug', 'summary'],
      populate: { videos: { fields: ['documentId'] } },
      pagination: { pageSize: 10 },
    },
  });
  if (byRelation.ok) {
    const match = (byRelation.data ?? []).find((l) => (l.videos ?? []).length === 1);
    if (match) return toLessonForVideo(match);
  }

  // Fallback: pre-relation lessons. Bounded to a personal-KB-scale library
  // (CLAUDE.md: <1000 videos, lessons are a small fraction of that), so a
  // full scan is cheap enough not to warrant a dedicated Strapi query.
  const all = await strapiFetch<
    Array<{ documentId: string; title: string; slug: string; summary: string | null; body: LessonBlock[] }>
  >('GET', '/api/lessons', {
    query: {
      fields: ['title', 'slug', 'summary'],
      populate: { body: { populate: '*' } },
      pagination: { pageSize: 200 },
    },
  });
  if (!all.ok) return null;
  const match = (all.data ?? []).find((l) => {
    const ids = deriveSourceVideoIds(l.body ?? []);
    return ids.length === 1 && ids[0] === youtubeVideoId;
  });
  return match ? toLessonForVideo(match) : null;
}

// -----------------------------------------------------------------------------
// Duration — computed, not modelled.
// -----------------------------------------------------------------------------
//
// (lesson-ux brief #4) The model's `duration` guess was noise, not signal:
// two lessons of near-identical length (1,769 and 1,682 words) came back
// "7 min" and "20 min" from the same generator run. It is also the first
// number a reader sees, on the /lessons index cards, before they've read a
// word — worth getting right more than most fields in this schema.
//
// Chose to keep the `duration` column (removing it would touch the Strapi
// schema in server/, out of scope here) and overwrite the model's value at
// SAVE time with a real word count, discarding whatever the model wrote in
// `lesson.duration`. The alternative the brief allowed — stop asking the
// model for it — would leave the field silently null for every future
// lesson for no benefit, since the prompt cost is the same either way and
// this way the field still means something.
const READING_WORDS_PER_MINUTE = 200;
// The commonly cited average adult silent-reading speed, and the same
// ballpark most blogging platforms' own read-time estimators use. Not
// slowed down further for "technical" content — lesson prose here runs
// short, plain sentences (see docs/lesson-authoring.md's own guidance to
// the model), not dense reference text.
const SECONDS_PER_VISUAL_BLOCK = 12;
// Fixed allowance for the time it takes to actually look at a labeled
// diagram or scan a small table — deliberately NOT proportional to row/dot
// count, which would mean walking each block's nested json shape
// (headers/rows, patterns[].dots, …) just to shave a few seconds off a
// number that doesn't need that precision.
const VISUAL_BLOCK_COMPONENTS = new Set([
  'lesson.diagram',
  'lesson.keyboard-diagram',
  'lesson.chord-diagram',
  'lesson.neck-pattern',
  'lesson.natural-notes',
  'lesson.table',
  'lesson.degree-chips',
]);

function wordCount(text: JsonValue | undefined): number {
  return typeof text === 'string' && text.trim().length > 0
    ? text.trim().split(/\s+/).length
    : 0;
}

/**
 * Reading duration for a lesson body: word count across its text-bearing
 * blocks at READING_WORDS_PER_MINUTE, plus SECONDS_PER_VISUAL_BLOCK for
 * every diagram/table-shaped block (those take time to look at, not
 * read). Rounded to the nearest minute, floored at 1 for any lesson that
 * has content at all. `null` for an empty body — nothing to estimate.
 */
export function computeLessonDuration(body: LessonBlock[]): string | null {
  if (body.length === 0) return null;
  let words = 0;
  for (const block of body) {
    switch (block.__component) {
      case 'lesson.prose':
      case 'lesson.callout':
        words += wordCount(block.body);
        break;
      case 'lesson.step':
        words += wordCount(block.lede) + wordCount(block.body);
        break;
      case 'lesson.heading':
        words += wordCount(block.text);
        break;
      default:
        break;
    }
  }
  const visualBlocks = body.filter((b) => VISUAL_BLOCK_COMPONENTS.has(b.__component)).length;
  const totalSeconds = (words / READING_WORDS_PER_MINUTE) * 60 + visualBlocks * SECONDS_PER_VISUAL_BLOCK;
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return `${minutes} min`;
}

// -----------------------------------------------------------------------------
// Write side — persisting a generated lesson.
// -----------------------------------------------------------------------------

export type SaveLessonResult =
  | { ok: true; slug: string; documentId: string }
  | { ok: false; error: string };

// Guards against a pathological loop, not a realistic collision count — a
// personal KB regenerating the same topic dozens of times is not a case
// this needs to serve gracefully, just safely (fail loudly, don't spin).
const MAX_SLUG_ATTEMPTS = 50;

type SlugCheck = { ok: true; exists: boolean } | { ok: false; error: string };

async function slugExists(slug: string): Promise<SlugCheck> {
  const res = await strapiFetch<{ slug: string }[]>('GET', '/api/lessons', {
    query: {
      filters: { slug: { $eq: slug } },
      fields: ['slug'],
      pagination: { pageSize: 1 },
    },
  });
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  return { ok: true, exists: (res.data ?? []).length > 0 };
}

// `generateLesson` derives a slug from the title with no DB access of its
// own (see lesson-generation.ts) — the same topic generated twice produces
// the same slug. Never overwrite an existing lesson: probe for a free
// `slug`, `slug-2`, `slug-3`, … and use the first one that doesn't exist.
// This is a check-then-create, not atomic — a genuine race would still be
// caught by Strapi's own uniqueness constraint on the `uid` field, which
// surfaces as an `ok: false` create failure below rather than a silent
// overwrite.
async function resolveFreeSlug(
  baseSlug: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    const check = await slugExists(candidate);
    if (!check.ok) return check;
    if (!check.exists) return { ok: true, slug: candidate };
  }
  return {
    ok: false,
    error: `Could not find a free slug for "${baseSlug}" after ${MAX_SLUG_ATTEMPTS} attempts.`,
  };
}

/**
 * Persists a `generateLesson()` result. Never overwrites an existing
 * lesson (see `resolveFreeSlug`) and never upgrades `status` past
 * `ai-generated` — a generated lesson stays clearly marked as such until a
 * human reviews and republishes it through the CMS.
 *
 * `sources` is the generator's retrieved `SourceVideo[]` (see
 * lesson-generation.ts) — connected onto the `videos` many-to-many
 * relation by documentId. Strapi 5 accepts a bare array of documentIds to
 * set a relation on create, same idiom as `tags`/`videos` elsewhere in
 * this service layer (see videos.ts createVideoService, notes.ts).
 */
export async function saveLessonService(
  lesson: GeneratedLesson,
  sources: SourceVideo[] = [],
): Promise<SaveLessonResult> {
  const resolved = await resolveFreeSlug(lesson.slug);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  const res = await strapiFetch<{ documentId: string; slug: string }>(
    'POST',
    '/api/lessons',
    {
      body: {
        data: {
          title: lesson.title,
          slug: resolved.slug,
          summary: lesson.summary,
          level: lesson.level,
          instrument: lesson.instrument,
          // The model's guess, discarded — see computeLessonDuration above.
          duration: computeLessonDuration(lesson.body),
          status: lesson.status,
          // Sent even when null. Without it a `lesson.param-picker` block
          // in `body` renders as literally nothing (LessonBody returns
          // null when `parameter` is unset) — the silent-hole failure this
          // codebase keeps hitting, so the picker and the parameter that
          // makes it work are written in the same call, never separately.
          parameter: lesson.parameter,
          body: lesson.body,
          videos: sources.map((s) => s.documentId),
        },
      },
    },
  );

  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  if (!res.data?.documentId) {
    return {
      ok: false,
      error: 'Strapi accepted the lesson but returned no documentId.',
    };
  }

  return {
    ok: true,
    slug: res.data.slug ?? resolved.slug,
    documentId: res.data.documentId,
  };
}
