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

  // Outer backstop: a failure anywhere below — permission registration, or
  // anything else in this pass — must degrade to "MCP tools unavailable",
  // never take down Strapi's boot. `registerDomainTool` already isolates
  // per-tool registration failures; this catches everything else.
  try {
    await registerMcpAdminPermissions(strapi);

    let registered = 0;
    for (const def of domainTools) {
      if (registerDomainTool(mcp.registerTool, strapi, def)) {
        registered += 1;
      }
    }
    strapi.log.info(
      `[music-kb mcp] Registered ${registered}/${domainTools.length} custom tool(s) on the official MCP server.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    strapi.log.error(`[music-kb mcp] Failed to register MCP capabilities: ${message}`);
  }
}
