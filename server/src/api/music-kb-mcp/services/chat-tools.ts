// Music KB's own tools, offered to the chat inside the Strapi admin
// (strapi-plugin-tanstack-ai). config/plugins.ts lists this service under
// `chat.toolSources`.
//
// This file defines no tool. The tools are the ones in src/mcp/catalog.ts, the
// same definitions Strapi's MCP server serves at /mcp. Here each read tool is
// handed to the admin chat, which calls it inside Strapi, without MCP.

import type { Core } from '@strapi/strapi';
import { domainTools } from '../../../mcp/catalog';
import { mcpToolAction } from '../../../mcp/permissions';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  getTools() {
    // The 19 read tools. The 10 write and maintenance tools stay on /mcp only:
    // the chat sends every tool's schema with every message, and createLesson
    // and updateLesson carry about 29,000 characters of schema each.
    return domainTools
      .filter(({ access }) => access === 'read')
      .map(({ tool }) => ({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        // The same admin permission that gates the tool on /mcp.
        action: mcpToolAction(tool.name),
        // parse() applies the schema's defaults, as the MCP server does.
        execute: (args: unknown) => tool.execute(tool.schema.parse(args ?? {}), { strapi }),
      }));
  },

  getMeta() {
    return {
      label: 'Music KB',
      description: 'Videos, transcripts, tags, notes and lessons in this library',
    };
  },
});
