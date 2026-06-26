import { z } from 'zod';
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
  /** Zod (v4) schema for the tool input. The adapter re-declares the
   * equivalent in @strapi/utils zod-3 for the official server; this stays
   * for the execute body's parsed-arg typing. */
  schema: z.ZodType<Input>;
  /** The handler. Returns a string or JSON-serializable object. */
  execute: (args: Input, ctx: ToolContext) => Promise<Output>;
};
