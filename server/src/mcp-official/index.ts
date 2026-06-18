// Entry point for registering music-kb's domain tools on the OFFICIAL
// Strapi MCP server. Called from src/index.ts register() — registration
// must happen before the MCP server starts (it locks its tool set at
// start). No-op when MCP is disabled.
import type { Core } from '@strapi/strapi';
import { registerMcpAdminPermissions } from './permissions';
import { registerPortedTool } from './adapter';
import { portedTools } from './tools';

export async function registerOfficialMcpTools(
  strapi: Core.Strapi,
): Promise<void> {
  // strapi.ai.mcp is only present on 5.47+; guard so older cores / a
  // disabled server are a clean skip.
  const mcp = strapi.ai?.mcp;
  if (!mcp || !mcp.isEnabled()) {
    strapi.log.info('[music-kb mcp] official MCP server disabled — skipping custom tools.');
    return;
  }

  await registerMcpAdminPermissions(strapi);

  for (const ported of portedTools) {
    registerPortedTool(mcp.registerTool, strapi, ported);
  }
  strapi.log.info(
    `[music-kb mcp] Registered ${portedTools.length} custom tool(s) on the official MCP server.`,
  );
}
