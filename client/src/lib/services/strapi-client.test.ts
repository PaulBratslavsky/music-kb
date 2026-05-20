import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildQueryParams,
  strapiFetch,
  type StrapiQuery,
} from './strapi-client';

// Helper: decode a URLSearchParams-built string into a sorted, decoded
// list of `key=value` lines so test assertions can match the actual
// Strapi-syntax output without caring about insertion order.
function decode(params: URLSearchParams): string[] {
  return Array.from(params.entries())
    .map(([k, v]) => `${k}=${v}`)
    .sort();
}

describe('buildQueryParams', () => {
  it('returns empty params for undefined or empty input', () => {
    expect(buildQueryParams(undefined).toString()).toBe('');
    expect(buildQueryParams({}).toString()).toBe('');
  });

  describe('populate', () => {
    it("'*' becomes populate=*", () => {
      // URLSearchParams treats '*' as URL-safe — no percent-encoding.
      expect(buildQueryParams({ populate: '*' }).toString()).toBe('populate=*');
    });

    it('string array becomes populate[name]=true per entry', () => {
      const out = decode(buildQueryParams({ populate: ['tags', 'sections'] }));
      expect(out).toEqual([
        'populate[sections]=true',
        'populate[tags]=true',
      ]);
    });

    it('object form: shallow', () => {
      const out = decode(
        buildQueryParams({ populate: { tags: true, sections: true } }),
      );
      expect(out).toEqual([
        'populate[sections]=true',
        'populate[tags]=true',
      ]);
    });

    it('object form: deeply nested (digest pattern)', () => {
      const out = decode(
        buildQueryParams({
          populate: {
            contradictions: { populate: { positions: true } },
            sharedThemes: { populate: { videoTitles: true } },
          },
        }),
      );
      expect(out).toEqual([
        'populate[contradictions][populate][positions]=true',
        'populate[sharedThemes][populate][videoTitles]=true',
      ]);
    });
  });

  describe('filters', () => {
    it('simple eq filter', () => {
      expect(
        buildQueryParams({
          filters: { youtubeVideoId: { $eq: 'abc123' } },
        }).toString(),
      ).toBe('filters%5ByoutubeVideoId%5D%5B%24eq%5D=abc123');
    });

    it('relation filter (filters[tags][slug][$eq])', () => {
      const out = decode(
        buildQueryParams({
          filters: { tags: { slug: { $eq: 'productivity' } } },
        }),
      );
      expect(out).toEqual([
        'filters[tags][slug][$eq]=productivity',
      ]);
    });

    it('$or filter with array index', () => {
      const out = decode(
        buildQueryParams({
          filters: {
            $or: [
              { videoTitle: { $containsi: 'rust' } },
              { videoAuthor: { $containsi: 'rust' } },
            ],
          },
        }),
      );
      expect(out).toEqual([
        'filters[$or][0][videoTitle][$containsi]=rust',
        'filters[$or][1][videoAuthor][$containsi]=rust',
      ]);
    });

    it('boolean / number primitives stringify', () => {
      const out = decode(
        buildQueryParams({
          filters: { published: { $eq: true }, retries: { $gt: 3 } },
        }),
      );
      expect(out).toEqual([
        'filters[published][$eq]=true',
        'filters[retries][$gt]=3',
      ]);
    });
  });

  describe('pagination, fields, sort', () => {
    it('pagination shape', () => {
      const out = decode(
        buildQueryParams({
          pagination: { page: 2, pageSize: 25, withCount: true },
        }),
      );
      // Alphabetical sort: 'pageS' (0x53) < 'page]' (0x5D).
      expect(out).toEqual([
        'pagination[pageSize]=25',
        'pagination[page]=2',
        'pagination[withCount]=true',
      ]);
    });

    it('partial pagination — only set keys that are provided', () => {
      const params = buildQueryParams({ pagination: { pageSize: 1 } });
      expect(params.toString()).toBe('pagination%5BpageSize%5D=1');
    });

    it('fields as indexed array', () => {
      const out = decode(
        buildQueryParams({ fields: ['title', 'author', 'createdAt'] }),
      );
      expect(out).toEqual([
        'fields[0]=title',
        'fields[1]=author',
        'fields[2]=createdAt',
      ]);
    });

    it('sort string vs array', () => {
      expect(buildQueryParams({ sort: 'name:asc' }).toString()).toBe('sort=name%3Aasc');
      const arr = decode(buildQueryParams({ sort: ['name:asc', 'createdAt:desc'] }));
      expect(arr).toEqual(['sort[0]=name:asc', 'sort[1]=createdAt:desc']);
    });
  });

  it('combines multiple top-level keys', () => {
    const out = decode(
      buildQueryParams({
        populate: ['tags'],
        filters: { summaryStatus: { $eq: 'generated' } },
        pagination: { pageSize: 100 },
        sort: 'createdAt:desc',
      }),
    );
    expect(out).toEqual([
      'filters[summaryStatus][$eq]=generated',
      'pagination[pageSize]=100',
      'populate[tags]=true',
      'sort=createdAt:desc',
    ]);
  });
});

// ---------------------------------------------------------------------------
// strapiFetch
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // Silence the failure logs the Module emits — tests assert on
  // returned values, not console output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response('', { status });
}

describe('strapiFetch', () => {
  it('GET resolves with parsed data + meta', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        data: [{ id: 1 }, { id: 2 }],
        meta: { pagination: { page: 1, pageCount: 3, total: 50 } },
      }),
    );
    const result = await strapiFetch<Array<{ id: number }>>('GET', '/api/videos');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.meta?.pagination?.total).toBe(50);
    }
  });

  it('GET appends query params to the URL', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    const query: StrapiQuery = {
      populate: ['tags'],
      filters: { summaryStatus: { $eq: 'generated' } },
      pagination: { page: 1, pageSize: 10 },
    };
    await strapiFetch('GET', '/api/videos', { query });
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('/api/videos?');
    const url = new URL(calledUrl);
    expect(decode(url.searchParams)).toEqual([
      'filters[summaryStatus][$eq]=generated',
      'pagination[pageSize]=10',
      'pagination[page]=1',
      'populate[tags]=true',
    ]);
  });

  it('POST stringifies the body and sets Content-Type', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: { id: 7 } }));
    await strapiFetch('POST', '/api/videos', {
      body: { data: { videoTitle: 'Hello' } },
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ data: { videoTitle: 'Hello' } }));
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('does NOT set Content-Type when there is no body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    await strapiFetch('GET', '/api/videos');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('returns ok:false with parsed Strapi error message on 4xx', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, {
        error: { status: 400, name: 'ValidationError', message: 'Title is required' },
      }),
    );
    const result = await strapiFetch('POST', '/api/videos', { body: {} });
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Title is required',
    });
  });

  it('returns ok:false with status fallback when error envelope missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { unexpected: 'shape' }));
    const result = await strapiFetch('GET', '/api/videos');
    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'Strapi error 500',
    });
  });

  it('returns ok:false with status fallback when body is non-JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>500 Internal</html>', { status: 502 }),
    );
    const result = await strapiFetch('GET', '/api/videos');
    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'Strapi error 502',
    });
  });

  it('returns ok:false when fetch itself throws (network error)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await strapiFetch('GET', '/api/videos');
    expect(result).toEqual({
      ok: false,
      status: 0,
      error: 'ECONNREFUSED',
    });
  });

  it('returns ok:true with undefined data when response body is empty', async () => {
    fetchMock.mockResolvedValueOnce(emptyResponse(200));
    const result = await strapiFetch('PUT', '/api/videos/abc', {
      body: { data: { summaryStatus: 'failed' } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBeUndefined();
  });
});
