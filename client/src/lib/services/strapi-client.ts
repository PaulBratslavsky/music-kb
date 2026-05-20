// Strapi REST client — one Module owning the URL composition, auth
// header, query-param syntax, JSON envelope, and error normalization
// for every Strapi call across the codebase. Replaces ~17 inline
// `fetch(${STRAPI_URL}/api/...)` sites that each rebuilt the same
// boilerplate with subtle variations.
//
// Used by `videos.ts`, `notes.ts`, `digests.ts`. Server-only — pulls
// `STRAPI_URL` and `STRAPI_API_TOKEN` from the env layer.
//
// Exposes a discriminated-union return type (`StrapiResult<T>`). The
// helper never throws on HTTP errors — callers handle the `ok: false`
// branch explicitly. This matches the existing `ServiceResult` pattern
// across the services layer.

import { STRAPI_URL, STRAPI_API_TOKEN } from '#/lib/env';

// -----------------------------------------------------------------------------
// Query types
// -----------------------------------------------------------------------------

// Recursive value type covering everything Strapi's query syntax accepts
// inside a `filters[]` or `populate[]` chain — primitives, arrays
// (which become indexed keys: `[0]`, `[1]`…), and nested objects.
type QueryValue = string | number | boolean | QueryValue[] | { [key: string]: QueryValue };

// `populate` has three idiomatic shapes in Strapi:
//   - '*'                              → populate=*
//   - ['tags', 'sections']             → populate[tags]=true&populate[sections]=true
//   - { contradictions: { populate: ['positions'] } }
//                                      → populate[contradictions][populate][positions]=true
type Populate = '*' | string[] | { [key: string]: QueryValue };

export type StrapiQuery = {
  populate?: Populate;
  filters?: { [key: string]: QueryValue };
  fields?: string[];
  sort?: string | string[];
  pagination?: {
    page?: number;
    pageSize?: number;
    withCount?: boolean;
  };
};

// -----------------------------------------------------------------------------
// Result types
// -----------------------------------------------------------------------------

export type StrapiResult<T> =
  | { ok: true; data: T; meta?: StrapiMeta }
  | { ok: false; status: number; error: string };

export type StrapiMeta = {
  pagination?: {
    page?: number;
    pageCount?: number;
    pageSize?: number;
    total?: number;
  };
};

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

type FetchOpts = {
  query?: StrapiQuery;
  body?: unknown;
};

// -----------------------------------------------------------------------------
// Query → URLSearchParams
// -----------------------------------------------------------------------------

// Recursive flattener: turns a nested value into Strapi's
// `key[a][b][c]=value` URL-param syntax. Arrays use numeric indices
// (`[0]`, `[1]`…); objects use bracketed keys; primitives terminate.
function appendQueryValue(
  params: URLSearchParams,
  key: string,
  value: QueryValue,
): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => appendQueryValue(params, `${key}[${i}]`, v));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      appendQueryValue(params, `${key}[${k}]`, v);
    }
    return;
  }
  // primitive (string | number | boolean)
  params.set(key, String(value));
}

export function buildQueryParams(query: StrapiQuery | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (!query) return params;

  // populate has special-cased shapes; everything else flattens
  // through the same recursive path.
  if (query.populate !== undefined) {
    if (query.populate === '*') {
      params.set('populate', '*');
    } else if (Array.isArray(query.populate)) {
      for (const name of query.populate) {
        params.set(`populate[${name}]`, 'true');
      }
    } else {
      for (const [k, v] of Object.entries(query.populate)) {
        appendQueryValue(params, `populate[${k}]`, v);
      }
    }
  }

  if (query.filters !== undefined) {
    for (const [k, v] of Object.entries(query.filters)) {
      appendQueryValue(params, `filters[${k}]`, v);
    }
  }

  if (query.fields !== undefined) {
    query.fields.forEach((f, i) => params.set(`fields[${i}]`, f));
  }

  if (query.sort !== undefined) {
    if (typeof query.sort === 'string') {
      params.set('sort', query.sort);
    } else {
      query.sort.forEach((s, i) => params.set(`sort[${i}]`, s));
    }
  }

  if (query.pagination) {
    const { page, pageSize, withCount } = query.pagination;
    if (page !== undefined) params.set('pagination[page]', String(page));
    if (pageSize !== undefined) params.set('pagination[pageSize]', String(pageSize));
    if (withCount !== undefined) params.set('pagination[withCount]', String(withCount));
  }

  return params;
}

// -----------------------------------------------------------------------------
// Fetch
// -----------------------------------------------------------------------------

function buildHeaders(hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (STRAPI_API_TOKEN) headers.Authorization = `Bearer ${STRAPI_API_TOKEN}`;
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}

function buildUrl(path: string, query: StrapiQuery | undefined): string {
  const params = buildQueryParams(query);
  const qs = params.toString();
  const sep = qs ? (path.includes('?') ? '&' : '?') : '';
  return `${STRAPI_URL}${path}${sep}${qs}`;
}

function logFailure(method: Method, url: string, status: number, body: string): void {
  // eslint-disable-next-line no-console
  console.error('[strapi]', { method, status, url, body: body.slice(0, 500) });
}

export async function strapiFetch<T>(
  method: Method,
  path: string,
  opts?: FetchOpts,
): Promise<StrapiResult<T>> {
  const url = buildUrl(path, opts?.query);
  const hasBody = opts?.body !== undefined;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: buildHeaders(hasBody),
      body: hasBody ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    logFailure(method, url, 0, message);
    return { ok: false, status: 0, error: message };
  }

  if (!res.ok) {
    // Read the body once for both error parsing and logging — calling
    // res.text()/json() twice would throw on a consumed body.
    const raw = await res.text().catch(() => '');
    let error = `Strapi error ${res.status}`;
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed.error?.message) error = parsed.error.message;
    } catch {
      /* not JSON */
    }
    logFailure(method, url, res.status, raw);
    return { ok: false, status: res.status, error };
  }

  // Some endpoints (DELETE, no-content writes) return nothing. We treat
  // an empty body as `{ data: undefined as T }` — callers using the
  // helper for fire-and-forget writes can ignore the data field.
  const text = await res.text();
  if (!text) {
    return { ok: true, data: undefined as T };
  }
  let json: { data?: T; meta?: StrapiMeta };
  try {
    json = JSON.parse(text) as { data?: T; meta?: StrapiMeta };
  } catch {
    logFailure(method, url, res.status, text);
    return { ok: false, status: res.status, error: 'Invalid JSON in Strapi response' };
  }
  return { ok: true, data: json.data as T, meta: json.meta };
}
