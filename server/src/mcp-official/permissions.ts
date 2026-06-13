// Custom admin permissions for the official Strapi MCP server's tools.
//
// The official server gates each custom tool behind an `auth.policies`
// action string; that action must exist in the admin permission registry
// before a token can be granted it (and a tool only appears in `tools/list`
// when the connecting token's ability satisfies its policy). Registering
// these is a required step the blog glosses over.
//
// App-level registration (we're an app, not a plugin) uses
// `section: 'settings'`, which yields action ids under the `api::` prefix.
// Two coarse actions — read vs. write — keep token scoping simple: grant a
// read-only token the read action to expose every retrieval tool while
// hiding the mutating ones.
import type { Core } from '@strapi/strapi';

export const MCP_ACTIONS = {
  READ: 'api::music-kb-mcp.read',
  WRITE: 'api::music-kb-mcp.write',
} as const;

const ACTION_DEFS = [
  {
    section: 'settings',
    category: 'MCP',
    displayName: 'Use read-only music-kb MCP tools',
    uid: 'music-kb-mcp.read',
  },
  {
    section: 'settings',
    category: 'MCP',
    displayName: 'Use mutating music-kb MCP tools',
    uid: 'music-kb-mcp.write',
  },
];

export async function registerMcpAdminPermissions(
  strapi: Core.Strapi,
): Promise<void> {
  await strapi
    .service('admin::permission')
    .actionProvider.registerMany(ACTION_DEFS);
  strapi.log.info(
    `[music-kb mcp] Registered ${ACTION_DEFS.length} custom admin permission(s).`,
  );
}
