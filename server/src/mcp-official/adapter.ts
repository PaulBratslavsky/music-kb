// Adapter: register a legacy hand-rolled MCP ToolDef on the OFFICIAL Strapi
// MCP server (strapi.ai.mcp.registerTool).
//
// What's reused vs. rewritten in the migration:
//   - REUSED: the legacy tool's `execute(args, { strapi })` body and its
//     human-facing `name` + `description`. These are battle-tested and
//     operate on plain parsed args, so they port verbatim.
//   - REWRITTEN per tool: the input/output schemas, declared with
//     @strapi/utils z (zod 3) because the legacy schemas use the app's
//     zod 4 and the two are not interchangeable across the MCP SDK's
//     schema conversion (see migration plan). Plus a `title` and an
//     `access` tier (read|write) mapping to a custom admin permission.
import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import type { ToolDef } from '../mcp/registry';
import { MCP_ACTIONS } from './permissions';

type RegisterTool = Core.Strapi['ai']['mcp']['registerTool'];

export type PortedTool = {
  /** The legacy tool — supplies name, description, and the execute body. */
  legacy: ToolDef<any, any>;
  /** Short human title (official API requires it; legacy had only name). */
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
// instead — and can re-issue the call with pagination. ~120 KB of headroom
// covers the JSON-RPC envelope + the duplicated structuredContent.
const MAX_RESULT_BYTES = 900_000;

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

export function registerPortedTool(
  registerTool: RegisterTool,
  strapi: Core.Strapi,
  ported: PortedTool,
): void {
  const { legacy, title, access, input } = ported;
  const output = ported.output ?? LOOSE_OUTPUT;
  const action =
    access === 'maintenance'
      ? MCP_ACTIONS.MAINTENANCE
      : access === 'write'
        ? MCP_ACTIONS.WRITE
        : MCP_ACTIONS.READ;

  registerTool({
    name: legacy.name,
    title,
    description: legacy.description,
    ...(input ? { resolveInputSchema: () => input } : {}),
    resolveOutputSchema: () => output,
    auth: { policies: [{ action }] },
    createHandler: (s: Core.Strapi) => async ({ args }: { args?: unknown }) => {
      const rawResult = await legacy.execute(args ?? {}, { strapi: s });

      // Backstop: an MCP client rejects any result over ~1 MB with an opaque
      // "Tool result is too large" the agent can't recover from. If a tool
      // (e.g. a whole-transcript getTranscript) blows the budget, swap in a
      // small, structured notice telling the agent how to page — surfaced as
      // a normal `{ error }` result, the same convention these tools already
      // use for "no transcript found" etc.
      const bytes = Buffer.byteLength(JSON.stringify(rawResult), 'utf8');
      const result =
        bytes > MAX_RESULT_BYTES
          ? {
              error: 'RESULT_TOO_LARGE',
              tool: legacy.name,
              bytes,
              limitBytes: MAX_RESULT_BYTES,
              message: `This ${legacy.name} result is ${(bytes / 1_000_000).toFixed(2)} MB, over the ~1 MB MCP response limit. ${shrinkHint(legacy.name)}`,
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
