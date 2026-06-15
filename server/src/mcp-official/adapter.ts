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
      const result = await legacy.execute(args ?? {}, { strapi: s });
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
