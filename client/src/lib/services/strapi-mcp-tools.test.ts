// The library chat loads its library tools from Strapi's MCP server. These
// tests run the real @tanstack/ai-mcp client against an in-process MCP server
// that stands in for Strapi, so what is checked is the wire behaviour: which
// URL and header the app sends, which tools it keeps, and that a kept tool's
// call reaches the server.

import { toolDefinition } from '@tanstack/ai';
import type { TransportInput } from '@tanstack/ai-mcp';
import { createMCPServer } from '@tanstack/ai-mcp/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const env = vi.hoisted(() => ({
  STRAPI_URL: 'http://strapi.test',
  STRAPI_MCP_TOKEN: 'test-admin-token' as string | undefined,
}));
vi.mock('#/lib/env', () => env);

const { LIBRARY_CHAT_TOOLS, closeAfter, loadStrapiTools } = await import(
  './strapi-mcp-tools'
);

/** A stand-in for Strapi's MCP server. `calls` keeps each tool call in order. */
function fakeStrapi(toolNames: string[]) {
  const calls: Array<{ name: string; input: unknown }> = [];
  const server = createMCPServer({
    name: 'fake-strapi',
    version: '1.0.0',
    tools: toolNames.map((name) =>
      toolDefinition({
        name,
        description: `Strapi's ${name} tool.`,
        inputSchema: z.object({ query: z.string().optional() }),
      }).server(async (input) => {
        calls.push({ name, input });
        return { tool: name, matchCount: 1 };
      }),
    ),
  });
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      authorization: request.headers.get('authorization'),
    });
    return server.fetch(request);
  }) as typeof fetch;
  const transport = (): TransportInput => ({
    type: 'http',
    url: 'http://strapi.test/mcp',
    fetch: fetchFake,
  });
  return { calls, requests, fetchFake, transport };
}

const ALL_STRAPI_TOOLS = [
  'libraryStats',
  'searchVideos',
  'getVideo',
  'crossSearchTranscripts',
  'saveSummary',
  'addVideo',
];

let warn: ReturnType<typeof vi.spyOn>;
const open: Array<{ close: () => Promise<void> }> = [];

beforeEach(() => {
  env.STRAPI_MCP_TOKEN = 'test-admin-token';
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(open.splice(0).map((o) => o.close()));
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe('loadStrapiTools', () => {
  it('keeps only the library chat tools, whatever else Strapi offers', async () => {
    const strapi = fakeStrapi(ALL_STRAPI_TOOLS);
    const loaded = await loadStrapiTools(strapi.transport());
    open.push(loaded);

    expect(loaded.tools.map((t) => t.name).sort()).toEqual(
      [...LIBRARY_CHAT_TOOLS].sort(),
    );
    expect(LIBRARY_CHAT_TOOLS).toEqual([
      'crossSearchTranscripts',
      'searchVideos',
      'getVideo',
    ]);
    // No write or maintenance tool reaches the model.
    expect(loaded.tools.map((t) => t.name)).not.toContain('saveSummary');
    expect(loaded.tools.map((t) => t.name)).not.toContain('addVideo');
  });

  it("gives each tool Strapi's own description", async () => {
    const strapi = fakeStrapi(ALL_STRAPI_TOOLS);
    const loaded = await loadStrapiTools(strapi.transport());
    open.push(loaded);

    const searchVideos = loaded.tools.find((t) => t.name === 'searchVideos');
    expect(searchVideos?.description).toBe("Strapi's searchVideos tool.");
  });

  it('runs a tool call on Strapi and returns what Strapi answered', async () => {
    const strapi = fakeStrapi(ALL_STRAPI_TOOLS);
    const loaded = await loadStrapiTools(strapi.transport());
    open.push(loaded);

    const tool = loaded.tools.find((t) => t.name === 'crossSearchTranscripts');
    const result = await tool!.execute!(
      { query: 'travis picking' },
      { toolCallId: 'call-1', emitCustomEvent: () => {} } as never,
    );

    expect(strapi.calls).toEqual([
      { name: 'crossSearchTranscripts', input: { query: 'travis picking' } },
    ]);
    expect(JSON.stringify(result)).toContain('crossSearchTranscripts');
  });

  it('by default calls <STRAPI_URL>/mcp with the admin token as a Bearer header', async () => {
    const strapi = fakeStrapi(ALL_STRAPI_TOOLS);
    vi.stubGlobal('fetch', strapi.fetchFake);

    const loaded = await loadStrapiTools();
    open.push(loaded);

    expect(loaded.tools).toHaveLength(3);
    expect(strapi.requests.length).toBeGreaterThan(0);
    for (const request of strapi.requests) {
      expect(request.url).toBe('http://strapi.test/mcp');
      expect(request.authorization).toBe('Bearer test-admin-token');
    }
  });

  it('returns no tools, and does not call Strapi, when the token is not set', async () => {
    env.STRAPI_MCP_TOKEN = undefined;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const loaded = await loadStrapiTools();

    expect(loaded.tools).toEqual([]);
    await expect(loaded.close()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns no tools and logs the reason when Strapi cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:1350');
      }),
    );

    const loaded = await loadStrapiTools();

    expect(loaded.tools).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('http://strapi.test/mcp');
    expect(message).toContain('runs without them');
    // The token never reaches a log line.
    expect(message).not.toContain('test-admin-token');
  });
});

describe('closeAfter', () => {
  async function* numbers(upTo: number, failAt?: number) {
    for (let i = 1; i <= upTo; i++) {
      if (i === failAt) throw new Error('stream failed');
      yield i;
    }
  }

  it('closes once, after the last chunk', async () => {
    const close = vi.fn(async () => {});
    const seen: number[] = [];
    for await (const n of closeAfter(numbers(3), close)) {
      expect(close).not.toHaveBeenCalled();
      seen.push(n);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes when the stream throws, and rethrows the error', async () => {
    const close = vi.fn(async () => {});
    const run = async () => {
      for await (const _ of closeAfter(numbers(3, 2), close)) void _;
    };
    await expect(run()).rejects.toThrow('stream failed');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes when the consumer stops early', async () => {
    const close = vi.fn(async () => {});
    for await (const n of closeAfter(numbers(3), close)) {
      if (n === 1) break;
    }
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes when the consumer cancels before reading anything', async () => {
    const close = vi.fn(async () => {});
    const iterator = closeAfter(numbers(3), close)[Symbol.asyncIterator]();
    await iterator.return?.();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('a failing close does not break the stream', async () => {
    const close = vi.fn(async () => {
      throw new Error('already closed');
    });
    const seen: number[] = [];
    for await (const n of closeAfter(numbers(2), close)) seen.push(n);
    expect(seen).toEqual([1, 2]);
  });
});
