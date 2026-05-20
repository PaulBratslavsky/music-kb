import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Core } from "@strapi/strapi";
import { getTools } from "./registry";

export function createMcpServer(strapi: Core.Strapi): McpServer {
  const server = new McpServer(
    { name: "yt-knowledge-base", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: [
        "This MCP server exposes a local YouTube knowledge base (videos,",
        "transcripts, summaries, tags, notes). Follow this decision tree on",
        "every user request:",
        "",
        '1. SEARCH BEFORE YOU WRITE. Any phrasing that reads as "find",',
        '"look up", "summarize", "tell me about", "do I have", "what does',
        'X say about Y" → call `searchVideos` first (catalog-level match on',
        "title / URL / videoId / summary fields), and/or `findTranscripts`",
        "(transcript content). Both tokenize the query; titles with filler",
        "words in the middle still match.",
        "",
        "2. DRILL IN. If a candidate row is found, call `getVideo(videoId)`",
        "for summary + sections, `searchTranscript(videoId, query)` for",
        "grounded passages, or `getTranscript(videoId, mode)` for full",
        "content.",
        "",
        "3. NEVER ingest to find. `addVideo` and `fetchTranscript` are",
        "WRITE operations that hit YouTube and create DB rows. Only call",
        'them when the user has EXPLICITLY asked to "add", "ingest",',
        '"save", or "import" a new video AND searchVideos has confirmed',
        "the video is not already in the KB. If searchVideos returns zero",
        'results and the user only said "find" or "summarize", ASK before',
        "ingesting — do not assume.",
        "",
        "4. Prefer strict over loose. searchVideos returns `matchMode:",
        '"strict"` when every query token matched; fall back to manual',
        "reformulation before resorting to any-token matches.",
      ].join(" "),
    },
  );

  const register = server.registerTool.bind(server) as (
    name: string,
    config: {
      description?: string;
      inputSchema?: Record<string, unknown>;
    },
    cb: (args: unknown) => Promise<unknown>,
  ) => unknown;

  for (const tool of getTools()) {
    const inputShape = (
      tool.schema as unknown as { shape: Record<string, unknown> }
    ).shape;
    register(
      tool.name,
      {
        description: tool.description,
        inputSchema: inputShape,
      },
      async (args: unknown) => {
        try {
          const result = await tool.execute(args, { strapi });
          const text =
            typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2);
          return { content: [{ type: "text", text }] };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "tool execution failed";
          strapi.log.error(`[mcp] tool ${tool.name} failed: ${message}`);
          return {
            isError: true,
            content: [
              { type: "text", text: `Tool ${tool.name} failed: ${message}` },
            ],
          };
        }
      },
    );
  }

  return server;
}
