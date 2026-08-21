// Read-side service for Strapi-backed lessons.
//
// Dynamic zones are NOT populated by default in Strapi 5 — without an
// explicit populate the `body` array comes back empty, which looks exactly
// like an unauthored lesson. That is the single most likely bug in this
// file, so the populate is spelled out rather than relying on a default.

import { strapiFetch } from './strapi-client';

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

/** Index listing. Never throws — an empty list renders an empty page. */
export async function listLessonsService(): Promise<LessonSummary[]> {
  const res = await strapiFetch<LessonSummary[]>('GET', '/api/lessons', {
    query: {
      sort: ['order:asc'],
      pagination: { pageSize: 100 },
      fields: ['title', 'slug', 'summary', 'level', 'instrument', 'order', 'duration', 'status'],
    },
  });
  return res.ok ? (res.data ?? []) : [];
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
