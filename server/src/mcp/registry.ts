import { z } from '@strapi/utils';
import type { Core } from '@strapi/strapi';

// Shape of a music-kb domain tool. Originally the interface of the
// hand-rolled MCP server (retired — see ADR 0008); now just the input
// contract that the `./adapter.ts` adapter wraps onto the official
// Strapi MCP server. The tool bodies in `./tools/*` are authored against
// this type; the adapter supplies the official title/auth/output-schema
// around each `execute`.

export type ToolContext = {
  strapi: Core.Strapi;
};

export type ToolDef<Input = unknown, Output = unknown> = {
  /** camelCase identifier — the tool name exposed to MCP clients. */
  name: string;
  /** User-facing description. Includes when to use vs. not use. */
  description: string;
  /** Zod schema for the tool input — the SINGLE declaration of this tool's
   * contract. Built with the `z` re-exported from @strapi/utils, which is
   * the same zod instance Strapi uses internally (see ADR 0008): the
   * official server validates against this object AND advertises its
   * `.describe()` text to MCP clients, and `Input` is `z.infer` of it.
   * Do NOT re-declare an equivalent schema anywhere else. */
  schema: z.ZodObject<z.ZodRawShape>;
  /** The handler. Returns a string or JSON-serializable object. */
  execute: (args: Input, ctx: ToolContext) => Promise<Output>;
};
