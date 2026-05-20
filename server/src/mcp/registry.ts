import { z } from 'zod';
import type { Core } from '@strapi/strapi';

export type ToolContext = {
  strapi: Core.Strapi;
};

export type ToolDef<Input = unknown, Output = unknown> = {
  /** camelCase identifier — what Claude Desktop / Claude Code will call. */
  name: string;
  /** User-facing description. Include when to use vs. not use. */
  description: string;
  /** Zod schema for the tool input. Converted to JSON Schema for MCP. */
  schema: z.ZodType<Input>;
  /** The handler. Return a string or JSON-serializable object. */
  execute: (args: Input, ctx: ToolContext) => Promise<Output>;
};

const registry = new Map<string, ToolDef<any, any>>();

export function registerTool<I, O>(tool: ToolDef<I, O>): void {
  if (registry.has(tool.name)) {
    throw new Error(`MCP tool "${tool.name}" already registered`);
  }
  registry.set(tool.name, tool);
}

export function getTools(): ToolDef<any, any>[] {
  return Array.from(registry.values());
}

export function getTool(name: string): ToolDef<any, any> | undefined {
  return registry.get(name);
}
