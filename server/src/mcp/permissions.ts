// Custom admin permissions for the official Strapi MCP server's tools.
//
// ONE ACTION PER TOOL — `api::music-kb-mcp.tool.<toolName>` — DERIVED from
// ./catalog.ts, which already pairs every tool with a human title and an
// access tier. Nothing in this file is a hand-maintained list of tools: add
// an entry to the catalog and its permission appears; delete it and the
// permission goes. A hand-written mirror of a 29-entry tool list is the
// failure mode this branch has hit repeatedly (five schema fields declared
// and never read; an MCP block union that needed its own test to police), so
// the action list is generated and `client/src/lib/mcp-tool-permissions.test.ts`
// asserts both directions — every catalog tool has an action, every action
// maps back to a catalog tool.
//
// The official server gates each custom tool behind an `auth.policies`
// action string; that action must exist in the admin permission registry
// before a token can be granted it, and a tool only appears in `tools/list`
// when the connecting token's ability satisfies its policy (see
// syncMcpSessionCapabilities in @strapi/core: `auth.policies.some(({action})
// => ability.can(action))`).
//
// App-level registration (we're an app, not a plugin) uses
// `section: 'settings'`, which yields action ids under the `api::` prefix —
// see computeActionId in @strapi/admin's domain/action. `category` +
// `subCategory` are what the admin Roles UI groups checkboxes by, so the
// three former permission TIERS survive here as the heading each tool's
// checkbox sits under (Strapi renders a per-sub-category "Select all" for
// free). They are grouping only.
//
// The tiers no longer exist AS PERMISSIONS. They cannot coexist with
// per-tool actions: Strapi enables a tool when ANY of its policies passes,
// so a token holding `…mcp.write` would keep all six write tools however the
// per-tool boxes were set, and the fine control would be decorative. Tokens
// minted against the old tiers are carried over by
// migrateLegacyTierPermissions() below — see ADR 0008's 2026-08-25 note.
import type { Core } from '@strapi/strapi';
import { domainTools } from './catalog';
import type { DomainTool } from './adapter';

type AccessTier = DomainTool['access'];

/**
 * Strapi's action registry validates every uid against this — lowercase
 * letters, dots and hyphens, nothing else, and it must start and end with a
 * letter (@strapi/admin's validation/action-provider). No uppercase, no
 * digits. And it validates the WHOLE BATCH before registering any of it, so
 * a single bad uid drops all 29 permissions at once and every token goes
 * dark. Hence the guard in registerMcpAdminPermissions below, and the
 * kebab-casing here.
 */
export const ACTION_UID_PATTERN = /^[a-z]([a-z|.|-]+)[a-z]$/;

/**
 * `getVideo` -> `get-video`. Tool names are camelCase (they have to be:
 * snake_case collides with @strapi/content-manager's built-in per-content-
 * type tools and crashes Strapi's boot), and camelCase is not a legal action
 * uid. Kebab-casing is the closest legal derivation and stays one-to-one
 * with the name.
 */
export function toolNameToUidSegment(toolName: string): string {
  return toolName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * The uid half of a tool's action. Strapi prepends `api::` for app-level
 * actions, so the registered id is `api::music-kb-mcp.tool.<kebab-name>`.
 *
 * Keyed on the TOOL NAME (the identifier MCP clients call), never on the
 * display title — a title is prose and will be reworded, and rewording a
 * permission id silently revokes it from every token that holds it.
 */
export function mcpToolActionUid(toolName: string): string {
  return `music-kb-mcp.tool.${toolNameToUidSegment(toolName)}`;
}

/** Full admin action id gating one tool — what adapter.ts puts in auth.policies. */
export function mcpToolAction(toolName: string): string {
  return `api::${mcpToolActionUid(toolName)}`;
}

/** Sub-category heading a tier's tools are grouped under in the admin UI. */
const TIER_SUBCATEGORY: Record<AccessTier, string> = {
  read: 'read tools',
  write: 'write tools',
  maintenance: 'maintenance tools',
};

/**
 * The three coarse actions this replaced. NOT registered any more — they
 * exist here only so the boot migration can find tokens and roles that still
 * hold one and hand them the equivalent per-tool grants. Strapi's admin
 * bootstrap deletes permission rows whose action is no longer registered
 * (`cleanPermissionsInDatabase`), so these rows are on their way out either
 * way; the migration's job is to make sure the access survives them.
 */
export const LEGACY_TIER_ACTIONS: Record<AccessTier, string> = {
  read: 'api::music-kb-mcp.read',
  write: 'api::music-kb-mcp.write',
  maintenance: 'api::music-kb-mcp.maintenance',
};

/** The per-tool actions a given legacy tier used to cover. */
export function actionsForTier(access: AccessTier): string[] {
  return domainTools
    .filter((def) => def.access === access)
    .map(({ tool }) => mcpToolAction(tool.name));
}

/** Admin action definitions, one per catalog tool. */
export function mcpToolActionDefs() {
  return domainTools.map(({ tool, title, access }) => ({
    section: 'settings',
    category: 'MCP',
    subCategory: TIER_SUBCATEGORY[access],
    displayName: title,
    uid: mcpToolActionUid(tool.name),
  }));
}

export async function registerMcpAdminPermissions(
  strapi: Core.Strapi,
): Promise<void> {
  const all = mcpToolActionDefs();

  // Strapi validates the whole array and refuses the lot if ONE uid is
  // malformed — 29 tools silently ungated because someone named a tool
  // `getVideo2`. Screen them here so a bad apple costs one tool, loudly,
  // instead of all of them, quietly.
  const defs = all.filter((def) => ACTION_UID_PATTERN.test(def.uid));
  const rejected = all.filter((def) => !ACTION_UID_PATTERN.test(def.uid));
  if (rejected.length > 0) {
    strapi.log.error(
      `[music-kb mcp] ${rejected.length} tool(s) produced an ILLEGAL admin action uid and will be ` +
        'invisible to every token (Strapi uids allow lowercase letters, dots and hyphens only, ' +
        `starting and ending with a letter): ${rejected.map((d) => d.uid).join(', ')}. ` +
        'Rename the tool to plain camelCase letters.',
    );
  }

  const duplicates = defs
    .map((d) => d.uid)
    .filter((uid, i, list) => list.indexOf(uid) !== i);
  if (duplicates.length > 0) {
    strapi.log.error(
      `[music-kb mcp] Two tools derive the SAME admin action uid (${[...new Set(duplicates)].join(', ')}) — ` +
        'granting one grants the other. Rename one of the tools.',
    );
  }

  try {
    await strapi.service('admin::permission').actionProvider.registerMany(defs);
  } catch (error) {
    // registerMany validates the batch up front, so this means NOTHING was
    // registered and every MCP token is about to see zero tools. Surface the
    // per-item detail Strapi hides behind "N errors occurred".
    const details = (error as { details?: { errors?: { message?: string }[] } })?.details?.errors;
    const message = error instanceof Error ? error.message : String(error);
    strapi.log.error(
      `[music-kb mcp] NO MCP admin permissions were registered (${message}) — every token will see ` +
        'ZERO custom tools until this is fixed.' +
        (details?.length ? `\n${details.map((e) => `  - ${e.message}`).join('\n')}` : ''),
    );
    throw error;
  }

  strapi.log.info(
    `[music-kb mcp] Registered ${defs.length} per-tool admin permission(s) (api::music-kb-mcp.tool.*).`,
  );
}

// ---------------------------------------------------------------------------
// Migration: legacy tier grants -> per-tool grants
// ---------------------------------------------------------------------------

type PermissionHolder = {
  /** Which relation on admin::permission points at the holder. */
  kind: 'apiToken' | 'role';
  id: number;
  label: string;
};

type LegacyRow = {
  id: number;
  action: string;
  conditions?: unknown;
  apiToken?: { id: number; name?: string } | null;
  role?: { id: number; name?: string } | null;
};

function tierForLegacyAction(action: string): AccessTier | null {
  const hit = (Object.keys(LEGACY_TIER_ACTIONS) as AccessTier[]).find(
    (tier) => LEGACY_TIER_ACTIONS[tier] === action,
  );
  return hit ?? null;
}

function holderOf(row: LegacyRow): PermissionHolder | null {
  if (row.apiToken?.id) {
    return { kind: 'apiToken', id: row.apiToken.id, label: row.apiToken.name ?? `#${row.apiToken.id}` };
  }
  if (row.role?.id) {
    return { kind: 'role', id: row.role.id, label: row.role.name ?? `#${row.role.id}` };
  }
  return null;
}

/**
 * Give every token / role that still holds one of the three retired tier
 * actions the per-tool actions that tier used to cover, then drop the dead
 * tier row.
 *
 * A token that worked before this change must work after it. Every tool the
 * tier exposed is granted — this migration is not the place to tighten
 * anything; fine-grained control is now possible, and narrowing a token is a
 * deliberate act in the admin UI afterwards.
 *
 * Idempotent by construction: it only acts on legacy rows, and it deletes
 * each one once its replacements are in place. That deletion is what stops
 * the migration from UNDOING later fine-tuning — if the tier row survived,
 * every boot would re-grant the tools an operator had just unchecked.
 *
 * WHERE THIS RUNS MATTERS. It is registered on the `strapi::content-types
 * .afterSync` hook (see ./index.ts), which fires inside Strapi's bootstrap
 * after the database is initialised but BEFORE plugin bootstraps. The admin
 * plugin's bootstrap calls `cleanPermissionsInDatabase()`, which deletes
 * every admin_permissions row whose action is not in the action registry —
 * and the tier actions are no longer registered. Running this from the app's
 * own `bootstrap()` (which comes after the plugins') would find the legacy
 * rows already swept and silently strip every token of its tools: exactly
 * the "a tool vanished from tools/list with no explanation" failure this
 * codebase keeps fighting.
 *
 * Never throws — the hook is called with Promise.all, so a rejection here
 * would abort Strapi's boot.
 */
export async function migrateLegacyTierPermissions(
  strapi: Core.Strapi,
): Promise<void> {
  const legacyActions = Object.values(LEGACY_TIER_ACTIONS);

  let rows: LegacyRow[];
  try {
    rows = (await strapi.db.query('admin::permission').findMany({
      where: { action: { $in: legacyActions } },
      populate: ['role', 'apiToken'],
    })) as LegacyRow[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    strapi.log.error(
      `[music-kb mcp] PERMISSION MIGRATION FAILED to read legacy tier grants: ${message}. ` +
        'Any token still scoped by api::music-kb-mcp.read/.write/.maintenance will lose every MCP tool ' +
        'this boot. Re-grant it per-tool actions (api::music-kb-mcp.tool.*) — see docs/mcp.md.',
    );
    return;
  }

  if (rows.length === 0) {
    strapi.log.debug('[music-kb mcp] No legacy tier permissions to migrate.');
    return;
  }

  const failures: string[] = [];
  let granted = 0;
  let removed = 0;

  for (const row of rows) {
    const tier = tierForLegacyAction(row.action);
    const holder = holderOf(row);

    if (!holder) {
      // No role and no token: Strapi treats these as orphans and deletes them
      // anyway. Nothing to carry over.
      strapi.log.debug(`[music-kb mcp] Skipping orphaned legacy permission #${row.id} (${row.action}).`);
      continue;
    }
    if (!tier) {
      failures.push(`${holder.kind} "${holder.label}": unrecognised legacy action ${row.action}`);
      continue;
    }

    const wanted = actionsForTier(tier);
    let held: { action: string }[] = [];
    try {
      held = (await strapi.db.query('admin::permission').findMany({
        where: { action: { $in: wanted }, [holder.kind]: { id: holder.id } },
        select: ['action'],
      })) as { action: string }[];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${holder.kind} "${holder.label}" (${tier}): could not read existing grants — ${message}`);
      continue;
    }

    const alreadyHeld = new Set(held.map((p) => p.action));
    const missing = wanted.filter((action) => !alreadyHeld.has(action));
    const rowFailures: string[] = [];

    for (const action of missing) {
      try {
        await strapi.db.query('admin::permission').create({
          data: {
            action,
            subject: null,
            properties: {},
            // Carry the tier grant's conditions across so a clamped token
            // stays clamped.
            conditions: Array.isArray(row.conditions) ? row.conditions : [],
            [holder.kind]: holder.id,
          },
        });
        granted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rowFailures.push(`${action} (${message})`);
      }
    }

    if (rowFailures.length > 0) {
      failures.push(
        `${holder.kind} "${holder.label}" (${tier} tier): could not grant ${rowFailures.length}/${wanted.length} tool action(s) — ${rowFailures.join('; ')}`,
      );
      // Leave the legacy row alone so the loss is visible in the DB. Strapi's
      // own cleanup will still remove it later this boot; the error below is
      // the durable record.
      continue;
    }

    try {
      await strapi.db.query('admin::permission').delete({ where: { id: row.id } });
      removed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Not fatal: the grants landed, and the dead tier row is inert (its
      // action is unregistered, so the permission engine ignores it).
      strapi.log.warn(
        `[music-kb mcp] Migrated ${holder.kind} "${holder.label}" but could not delete its legacy ${row.action} row: ${message}`,
      );
    }

    strapi.log.info(
      `[music-kb mcp] Migrated ${holder.kind} "${holder.label}": ${row.action} -> ${wanted.length} per-tool action(s) (${missing.length} newly granted).`,
    );
  }

  strapi.log.info(
    `[music-kb mcp] Permission migration: ${rows.length} legacy tier grant(s) processed, ${granted} per-tool action(s) granted, ${removed} tier row(s) retired.`,
  );

  if (failures.length > 0) {
    strapi.log.error(
      `[music-kb mcp] PERMISSION MIGRATION INCOMPLETE — ${failures.length} holder(s) did NOT get every tool they had:\n` +
        failures.map((f) => `  - ${f}`).join('\n') +
        '\nThose tools will be MISSING from tools/list for the affected token(s). ' +
        'Re-grant them by hand: in the admin, Settings > Roles / API Tokens > MCP, or via `strapi console` ' +
        "grant the api::music-kb-mcp.tool.* actions listed above. See docs/mcp.md.",
    );
  }
}
