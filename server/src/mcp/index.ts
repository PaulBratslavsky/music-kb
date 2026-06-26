// Entry point for registering music-kb's domain tools on the OFFICIAL
// Strapi MCP server. Called from src/index.ts register() — registration
// must happen before the MCP server starts (it locks its tool set at
// start). No-op when MCP is disabled.
import type { Core } from '@strapi/strapi';
import { registerMcpAdminPermissions } from './permissions';
import { registerDomainTool } from './adapter';
import { domainTools } from './catalog';

export async function registerOfficialMcpTools(
  strapi: Core.Strapi,
): Promise<void> {
  const mcp = strapi.ai?.mcp;
  if (!mcp?.isEnabled()) {
    strapi.log.info('[music-kb mcp] official MCP server disabled — skipping custom tools.');
    return;
  }

  await registerMcpAdminPermissions(strapi);

  for (const def of domainTools) {
    registerDomainTool(mcp.registerTool, strapi, def);
  }
  strapi.log.info(
    `[music-kb mcp] Registered ${domainTools.length} custom tool(s) on the official MCP server.`,
  );
}
