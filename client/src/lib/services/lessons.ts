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
import type { GeneratedLesson } from './lesson-generation';

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
};

export type LessonSummary = Omit<Lesson, 'body' | 'parameter'>;

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
  return { ok: true, lesson };
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
 */
export async function saveLessonService(
  lesson: GeneratedLesson,
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
          duration: lesson.duration,
          status: lesson.status,
          body: lesson.body,
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
