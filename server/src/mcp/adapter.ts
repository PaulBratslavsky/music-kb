// Adapter: register a music-kb domain ToolDef on the OFFICIAL Strapi MCP
// server (strapi.ai.mcp.registerTool).
//
// Each domain tool (defined in ./tools/) supplies the parts that don't
// change between hosts; the adapter supplies the official-server wrapping:
//   - FROM the tool: its `execute(args, { strapi })` body and its
//     human-facing `name` + `description`. These operate on plain parsed
//     args, so they're host-agnostic.
//   - FROM the tool: its `schema` — the one declaration of its input
//     contract, built with the app's own top-level `zod` dependency (NOT
//     the `z` re-exported from @strapi/utils — see ADR 0008). It is both
//     what validates the args and what advertises parameter descriptions
//     to MCP clients; only the app's own zod instance survives the MCP
//     SDK's cross-instance schema conversion with `.describe()` text
//     intact.
//   - ADDED here, per tool: the output schema, a `title`, and an `access`
//     tier (read|write|maintenance) mapping to a custom admin permission.
import { z } from 'zod';
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

/**
 * Register one domain tool on the official MCP server.
 *
 * Returns whether registration succeeded. `strapi.ai.mcp.registerTool`
 * (called below) throws SYNCHRONOUSLY — not just from a bad handler, but
 * from the registration call itself — when the tool name collides with
 * another capability (including the `create_${slug}` / etc. tools
 * @strapi/content-manager derives per content type) or when a non-dev
 * tool is missing `auth.policies`. Content types here (video, transcript,
 * tag, note, digest, loop, composition, progression) make a future name
 * collision plausible, and an uncaught throw here propagates out of
 * `registerOfficialMcpTools` and aborts Strapi's boot. So the call itself
 * — not just the handler body inside it — is wrapped: one bad tool must
 * be skipped, logged, and not block the rest of the catalog from
 * registering.
 */
export function registerDomainTool(
  registerTool: RegisterTool,
  strapi: Core.Strapi,
  def: DomainTool,
): boolean {
  const { tool, title, access } = def;
  const input = tool.schema;
  const output = def.output ?? LOOSE_OUTPUT;
  const action =
    access === 'maintenance'
      ? MCP_ACTIONS.MAINTENANCE
      : access === 'write'
        ? MCP_ACTIONS.WRITE
        : MCP_ACTIONS.READ;

  try {
    registerTool({
      name: tool.name,
      title,
      description: tool.description,
      // `input`/`output` are ZodObjects built with the app's own `zod`
      // (^4.3.5, see catalog.ts) so `.describe()` text survives the MCP
      // SDK's schema conversion — see registry.ts. `RegisterTool`'s ambient
      // type (from @strapi/types) expects a ZodObject from @strapi/utils's
      // own bundled — and differently-versioned — zod copy: a different
      // physical package, so TS treats it as a structurally distinct
      // nominal type even though both are duck-type-compatible Zod 4 at
      // runtime (which is all the MCP SDK and Strapi's validator care
      // about). There is no way to satisfy that third-party ambient type
      // without either this cast or vendoring a second, description-losing
      // schema — so the cast is narrowly scoped to just the two schema
      // resolvers, not the whole call.
      ...(input ? { resolveInputSchema: (() => input) as any } : {}),
      resolveOutputSchema: (() => output) as any,
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
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    strapi.log.warn(`[music-kb mcp] Skipped tool "${tool.name}" — registration failed: ${message}`);
    return false;
  }
}
