// Entry point for registering music-kb's domain tools on the OFFICIAL
// Strapi MCP server. Called from src/index.ts register() — registration
// must happen before the MCP server starts (it locks its tool set at
// start).
import type { Core } from '@strapi/strapi';
import {
  migrateLegacyTierPermissions,
  registerMcpAdminPermissions,
} from './permissions';
import { registerDomainTool } from './adapter';
import { domainTools } from './catalog';

/**
 * Queue the legacy-tier permission migration on the one hook that fires
 * early enough for it to matter.
 *
 * `strapi::content-types.afterSync` runs inside Strapi's bootstrap once the
 * database is initialised and the schema synced, and BEFORE any plugin
 * bootstrap. That ordering is the whole point: the admin plugin's bootstrap
 * calls `cleanPermissionsInDatabase()`, which deletes every admin_permissions
 * row whose action is no longer in the action registry — and the three tier
 * actions are exactly that now. Migrating from this app's own `bootstrap()`
 * (which runs after the plugins') would find the rows already gone and every
 * existing token silently stripped of its tools.
 */
function scheduleLegacyTierMigration(strapi: Core.Strapi): void {
  const hook = strapi.hook?.('strapi::content-types.afterSync');
  if (!hook || typeof hook.register !== 'function') {
    strapi.log.error(
      '[music-kb mcp] Could not hook strapi::content-types.afterSync — the legacy MCP permission ' +
        'migration will NOT run. Any token still scoped by api::music-kb-mcp.read/.write/.maintenance ' +
        'will lose every MCP tool. Re-grant it the per-tool api::music-kb-mcp.tool.* actions — see docs/mcp.md.',
    );
    return;
  }

  hook.register(async () => {
    // The hook is called with Promise.all: a rejection here aborts Strapi's
    // boot. migrateLegacyTierPermissions swallows its own errors (loudly);
    // this is the belt to that braces.
    try {
      await migrateLegacyTierPermissions(strapi);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      strapi.log.error(
        `[music-kb mcp] PERMISSION MIGRATION CRASHED: ${message}. Tokens scoped by the old tier ` +
          'actions may have lost their tools — see docs/mcp.md to re-grant per-tool actions.',
      );
    }
  });
}

export async function registerOfficialMcpTools(
  strapi: Core.Strapi,
): Promise<void> {
  // Permissions are registered even when the MCP server is DISABLED, and
  // before the enablement check on purpose. Strapi's admin bootstrap deletes
  // permission rows whose action is not in the action registry, so booting
  // once with MCP_ENABLED=false would quietly strip every MCP grant off every
  // token — and turning MCP back on would leave the tokens empty with no
  // explanation. Registering the actions unconditionally keeps the grants
  // intact across an MCP-off boot; only the tools themselves are skipped.
  // Scheduled first and separately: if permission registration blows up, the
  // migration is the only thing standing between a tier-scoped token and
  // Strapi's own cleanup pass, so it must not be skipped as a side effect of
  // an unrelated failure.
  scheduleLegacyTierMigration(strapi);
  try {
    await registerMcpAdminPermissions(strapi);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    strapi.log.error(`[music-kb mcp] Failed to register MCP admin permissions: ${message}`);
  }

  const mcp = strapi.ai?.mcp;
  if (!mcp?.isEnabled()) {
    strapi.log.info('[music-kb mcp] official MCP server disabled — skipping custom tools.');
    return;
  }

  // Outer backstop: a failure anywhere below must degrade to "MCP tools
  // unavailable", never take down Strapi's boot. `registerDomainTool` already
  // isolates per-tool registration failures; this catches everything else.
  try {
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
