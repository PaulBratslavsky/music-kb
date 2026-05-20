// Streamable HTTP transport session manager for /api/mcp.
//
// Each MCP client (Claude Desktop, Claude Code, Cursor, Inspector, etc.)
// gets one session. The session is created on the initial POST (the
// `initialize` JSON-RPC call) and identified thereafter by the
// `mcp-session-id` response header, which the client echoes back on every
// subsequent request.
//
// We keep sessions in a single in-process Map keyed by sessionId. A TTL
// sweep removes idle sessions so reconnects don't pile up. Cap at
// MAX_SESSIONS to bound memory — new sessions past the cap are rejected
// until idle ones expire.

import { randomUUID } from 'node:crypto';
import type { Context } from 'koa';
import type { Core } from '@strapi/strapi';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServer } from './server';

const SESSION_HEADER = 'mcp-session-id';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_SESSIONS = 100;

type SessionRecord = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  lastSeen: number;
};

const sessions = new Map<string, SessionRecord>();

function touch(sessionId: string): SessionRecord | undefined {
  const record = sessions.get(sessionId);
  if (record) record.lastSeen = Date.now();
  return record;
}

function sweep(): void {
  const now = Date.now();
  for (const [id, record] of sessions) {
    if (now - record.lastSeen > SESSION_TTL_MS) {
      record.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}

async function createSession(strapi: Core.Strapi): Promise<SessionRecord> {
  sweep();
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`MCP session cap reached (${MAX_SESSIONS})`);
  }

  let sessionId = '';
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => {
      sessionId = randomUUID();
      return sessionId;
    },
    onsessionclosed: (id) => {
      sessions.delete(id);
    },
  });

  const server = createMcpServer(strapi);
  await server.connect(transport);

  // `sessionId` is populated lazily by `sessionIdGenerator` during the first
  // handleRequest call — don't store in the map until we actually have one.
  // Return the record; the caller stores it post-handleRequest.
  return {
    transport,
    server,
    lastSeen: Date.now(),
  };
}

/**
 * Koa handler for the MCP route. Handles POST (client → server messages),
 * GET (server-initiated SSE stream), and DELETE (session close).
 */
export async function handleMcpRequest(
  ctx: Context,
  strapi: Core.Strapi,
): Promise<void> {
  const incomingSessionId = ctx.request.header[SESSION_HEADER];
  const sessionId = typeof incomingSessionId === 'string' ? incomingSessionId : undefined;

  let record: SessionRecord | undefined = sessionId ? touch(sessionId) : undefined;

  if (!record) {
    // No session yet — must be an initialize POST. The SDK rejects any
    // other request kind without a session ID with 400.
    try {
      record = await createSession(strapi);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'session create failed';
      ctx.status = 503;
      ctx.body = { error: message };
      return;
    }
  }

  // Let Koa know we're streaming — the SDK writes directly to the Node
  // response, so we must bypass Koa's own body-write machinery by setting
  // ctx.respond = false.
  ctx.respond = false;
  const req = ctx.req as IncomingMessage;
  const res = ctx.res as ServerResponse;

  // The Strapi/Koa body parser has already consumed the POST body by the
  // time we get here — ctx.request.body holds the parsed JSON. Pass it as
  // the pre-parsed body so the SDK doesn't try (and fail) to re-read the
  // stream.
  const parsedBody = ctx.request.body;

  try {
    await record.transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'mcp transport error';
    strapi.log.error(`[mcp] transport error: ${message}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: message }));
    } else {
      res.end();
    }
    return;
  }

  // If this was an initialize POST, the transport assigned a sessionId
  // during handleRequest. Store it in the map now.
  const assignedId = record.transport.sessionId;
  if (assignedId && !sessions.has(assignedId)) {
    sessions.set(assignedId, record);
  }
  record.lastSeen = Date.now();
}
