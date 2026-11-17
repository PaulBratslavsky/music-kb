// The library chat's Strapi tools, loaded over MCP.
//
// Strapi defines each library tool once, on its MCP server at /mcp
// (server/src/mcp/). Claude Code and Claude Desktop call the tools there.
// This file connects the app to the same server, so chat() runs the same
// tools. The app defines no copy of them.

import {
  createMCPClient,
  type McpServerTool,
  type TransportInput,
} from '@tanstack/ai-mcp';
import { STRAPI_MCP_TOKEN, STRAPI_URL } from '#/lib/env';

/** The Strapi tools the library chat may call. All three only read. */
export const LIBRARY_CHAT_TOOLS = [
  'crossSearchTranscripts', // search inside every transcript
  'searchVideos', // find videos by title, summary or tag
  'getVideo', // one video's summary, sections and takeaways
] as const;

export type StrapiTools = {
  /** TanStack AI tools, ready for chat({ tools }). */
  tools: Array<McpServerTool>;
  /** Closes the MCP connection. Call it when the chat run is over. */
  close: () => Promise<void>;
};

const NO_TOOLS: StrapiTools = { tools: [], close: async () => {} };

/** Strapi's MCP server, with the app's admin token. */
const strapiMcpServer = (): TransportInput => ({
  type: 'http',
  url: `${STRAPI_URL.replace(/\/+$/, '')}/mcp`,
  headers: { Authorization: `Bearer ${STRAPI_MCP_TOKEN}` },
});

let warnedNoToken = false;

/**
 * Connect to Strapi's MCP server and return its library tools as TanStack AI
 * tools.
 *
 * Never throws. Without a token, or when Strapi cannot be reached, it logs one
 * warning and returns no tools, so the library chat still answers from the
 * passages it retrieved. `transport` is for tests.
 */
export async function loadStrapiTools(
  transport?: TransportInput,
): Promise<StrapiTools> {
  if (!transport && !STRAPI_MCP_TOKEN) {
    if (!warnedNoToken) {
      warnedNoToken = true;
      console.warn(
        '[strapi-mcp] STRAPI_MCP_TOKEN is not set. The library chat runs without the Strapi tools.',
      );
    }
    return NO_TOOLS;
  }

  try {
    const client = await createMCPClient({
      transport: transport ?? strapiMcpServer(),
      name: 'music-kb-library-chat',
      toolFilter: LIBRARY_CHAT_TOOLS,
    });
    try {
      return { tools: await client.tools(), close: () => client.close() };
    } catch (err) {
      await client.close().catch(() => {});
      throw err;
    }
  } catch (err) {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.warn(
      `[strapi-mcp] Could not load the Strapi tools from ${STRAPI_URL}/mcp. The library chat runs without them. Reason: ${reason}`,
    );
    return NO_TOOLS;
  }
}

/**
 * The same stream, with `close` run once when the stream ends, throws, or is
 * cancelled by the consumer — including a cancel that arrives before the first
 * chunk was read, which a generator's `finally` would miss.
 */
export function closeAfter<T>(
  stream: AsyncIterable<T>,
  close: () => Promise<void>,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const source = stream[Symbol.asyncIterator]();
      let closed = false;
      const closeOnce = async () => {
        if (closed) return;
        closed = true;
        await close().catch(() => {});
      };
      return {
        async next() {
          try {
            const result = await source.next();
            if (result.done) await closeOnce();
            return result;
          } catch (err) {
            await closeOnce();
            throw err;
          }
        },
        async return(value?: unknown) {
          try {
            return (await source.return?.(value)) ?? { done: true, value };
          } finally {
            await closeOnce();
          }
        },
      } as AsyncIterator<T>;
    },
  };
}
