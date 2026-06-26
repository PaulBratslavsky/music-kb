// Adapter: register a music-kb domain ToolDef on the OFFICIAL Strapi MCP
// server (strapi.ai.mcp.registerTool).
//
// Each domain tool (defined in ./tools/) supplies the parts that don't
// change between hosts; the adapter supplies the official-server wrapping:
//   - FROM the tool: its `execute(args, { strapi })` body and its
//     human-facing `name` + `description`. These operate on plain parsed
//     args, so they're host-agnostic.
//   - ADDED here, per tool: the input/output schemas, declared with
//     @strapi/utils z (zod 3) because the tool's own schemas use the app's
//     zod 4 and the two are not interchangeable across the MCP SDK's
//     schema conversion (see ADR 0008). Plus a `title` and an `access`
//     tier (read|write|maintenance) mapping to a custom admin permission.
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { ToolDef } from './registry';
import { MCP_ACTIONS } from './permissions';

type RegisterTool = Core.Strapi['ai']['mcp']['registerTool'];

export type DomainTool = {
  /** The domain tool — supplies name, description, and the execute body. */
  tool: ToolDef<any, any>;
  /** Short human title (the official API requires it; ToolDef has only name). */
  title: string;
  /** Permission tier → which custom admin action gates the tool.
   * read = no mutation; write = ordinary data mutation; maintenance =
   * expensive / external-side-effect / hard-to-undo (reindex, YouTube
   * fetch, digest). */
  access: 'read' | 'write' | 'maintenance';
  /** Input schema re-declared in zod 3 (@strapi/utils). Omit for no input. */
  input?: z.ZodObject<z.ZodRawShape>;
  /**
   * Output schema in zod 3. Defaults to a permissive object (any shape) —
   * the migration starts loose and tightens per tool later. structuredContent
   * is always normalized to an object so this validates.
   */
  output?: z.ZodObject<z.ZodRawShape>;
};

const LOOSE_OUTPUT = z.object({}).catchall(z.any());

// MCP clients (Claude Desktop/Code) reject a tool result over 1 MB with an
// opaque "Tool result is too large" error the agent can't act on. We guard
// just under that so the agent gets a structured, actionable message
// instead — and can re-issue the call with pagination.
//
// CRUCIAL: the result rides the wire TWICE — once as JSON text in `content`
// and once as `structuredContent` — so the payload is ~2x the serialized
// result. Measure the DOUBLED size, not one copy. (Measuring one copy at a
// 900 KB threshold let ~475–900 KB results — e.g. a getVideo with embeddings,
// or findTranscripts with full content — slip through and blow the 1 MB
// limit.) MAX_WIRE_BYTES is the ceiling for the full duplicated payload.
const MAX_WIRE_BYTES = 950_000;

/** Hints, by tool, for how to make an oversized result smaller. */
function shrinkHint(toolName: string): string {
  switch (toolName) {
    case 'getTranscript':
      return 'Use mode:"chunked" with page/pageSize to page segments, mode:"timeRange" for a specific window, or mode:"full" with offset/maxChars.';
    case 'findTranscripts':
      return 'Set includeFullContent:false (the default) or lower `limit`.';
    case 'crossSearchTranscripts':
      return 'Lower `perVideo` and/or `maxVideos`.';
    case 'searchTranscript':
      return 'Lower `k`.';
    default:
      return 'Re-issue with pagination / a smaller page size, or request fewer fields.';
  }
}

export function registerDomainTool(
  registerTool: RegisterTool,
  strapi: Core.Strapi,
  def: DomainTool,
): void {
  const { tool, title, access, input } = def;
  const output = def.output ?? LOOSE_OUTPUT;
  const action =
    access === 'maintenance'
      ? MCP_ACTIONS.MAINTENANCE
      : access === 'write'
        ? MCP_ACTIONS.WRITE
        : MCP_ACTIONS.READ;

  registerTool({
    name: tool.name,
    title,
    description: tool.description,
    ...(input ? { resolveInputSchema: () => input } : {}),
    resolveOutputSchema: () => output,
    auth: { policies: [{ action }] },
    createHandler: (s: Core.Strapi) => async ({ args }: { args?: unknown }) => {
      const rawResult = await tool.execute(args ?? {}, { strapi: s });

      // Backstop: an MCP client rejects any result over ~1 MB with an opaque
      // "Tool result is too large" the agent can't recover from. If a tool
      // (e.g. a whole-transcript getTranscript) blows the budget, swap in a
      // small, structured notice telling the agent how to page — surfaced as
      // a normal `{ error }` result, the same convention these tools already
      // use for "no transcript found" etc.
      const bytes = Buffer.byteLength(JSON.stringify(rawResult), 'utf8');
      // The result rides the wire twice (content text + structuredContent),
      // plus a small JSON-RPC envelope. Measure that, not the single copy.
      const wireBytes = bytes * 2 + 2048;
      const result =
        wireBytes > MAX_WIRE_BYTES
          ? {
              error: 'RESULT_TOO_LARGE',
              tool: tool.name,
              bytes: wireBytes,
              limitBytes: MAX_WIRE_BYTES,
              message: `This ${tool.name} result is ~${(wireBytes / 1_000_000).toFixed(2)} MB on the wire (sent twice), over the ~1 MB MCP response limit. ${shrinkHint(tool.name)}`,
            }
          : rawResult;

      // structuredContent must be an object (the schema is a ZodObject).
      // Wrap arrays/scalars so every tool satisfies the contract.
      const structuredContent =
        result && typeof result === 'object' && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : { result };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent,
      };
    },
  });
}
