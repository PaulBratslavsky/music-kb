// Reachability guard for MCP tool PERMISSIONS — one admin action per tool.
//
// Every music-kb MCP tool is gated by its own admin action,
// `api::music-kb-mcp.tool.<toolName>`, derived from server/src/mcp/catalog.ts.
// The thing that must never happen is the list of actions and the list of
// tools drifting apart: a tool with no action is either invisible to every
// token or (worse) ungated, and an action with no tool is a checkbox that
// grants nothing. Both failures are silent — a tool just quietly stops
// appearing in `tools/list`, which is the exact pattern this branch keeps
// fighting.
//
// So this file asserts BOTH directions against the real server source, and
// asserts the derivation itself: ids keyed on the tool NAME (stable), never
// on the display title (prose, and rewording it would silently revoke the
// permission from every token holding it).
//
// It lives in the client suite for the same reason
// components/lesson/block-vocabulary.test.ts does: this is the established
// place for assertions that read server source at test time. The server has
// had its own vitest since 2026-08-26 (`server/src/mcp/tools/
// lesson-blocks.test.ts`), so converting this file to execute
// `mcpToolActionDefs()` instead of reading it is now possible — but it would
// be a different test, checking the derivation rather than the agreement
// between two files, and the agreement is what drifts. As in the sibling
// parity tests, the server files are read as TEXT, never imported —
// CLAUDE.md's rule is that `client` never imports from `server/` (separate
// installs, separate zod instances).

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// This suite runs under `yarn --cwd client test`, so process.cwd() is the
// `client/` package root, one level below the repo root `server/` lives in.
const REPO_ROOT = resolve(process.cwd(), '..');
const MCP_DIR = resolve(REPO_ROOT, 'server/src/mcp');

const catalogSource = readFileSync(resolve(MCP_DIR, 'catalog.ts'), 'utf8');
const permissionsSource = readFileSync(resolve(MCP_DIR, 'permissions.ts'), 'utf8');
const adapterSource = readFileSync(resolve(MCP_DIR, 'adapter.ts'), 'utf8');

type AccessTier = 'read' | 'write' | 'maintenance';

// ---------------------------------------------------------------------------
// Parse the real source
// ---------------------------------------------------------------------------

/** `export const listVideosTool: ToolDef<…> = { name: 'listVideos', …` */
function parseToolNames(): Map<string, string> {
  const byExport = new Map<string, string>();
  const dir = resolve(MCP_DIR, 'tools');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
    const source = readFileSync(resolve(dir, file), 'utf8');
    for (const match of source.matchAll(/export const (\w+Tool)\b/g)) {
      const rest = source.slice(match.index ?? 0);
      const name = /\bname:\s*'([A-Za-z0-9_]+)'/.exec(rest);
      if (name) byExport.set(match[1], name[1]);
    }
  }
  return byExport;
}

/** `{ tool: listVideosTool, title: 'List videos', access: 'read' },` */
function parseCatalog(): { symbol: string; title: string; access: AccessTier }[] {
  const entries = [
    ...catalogSource.matchAll(
      /\{\s*tool:\s*(\w+),\s*title:\s*'([^']*)',\s*access:\s*'(read|write|maintenance)'\s*\}/g,
    ),
  ];
  return entries.map((m) => ({ symbol: m[1], title: m[2], access: m[3] as AccessTier }));
}

const toolNamesByExport = parseToolNames();
const catalog = parseCatalog().map((entry) => {
  const name = toolNamesByExport.get(entry.symbol);
  if (!name) {
    throw new Error(
      `catalog.ts lists ${entry.symbol} but no server/src/mcp/tools/*.ts exports it with a name — ` +
        'the parser in mcp-tool-permissions.test.ts could not resolve the tool name.',
    );
  }
  return { ...entry, name };
});

// The one rule, restated independently of the implementation: an action id is
// the tool's own name under a fixed prefix, kebab-cased because Strapi's
// action registry only accepts lowercase letters, dots and hyphens in a uid
// (see ACTION_UID_PATTERN below — camelCase is rejected, and Strapi rejects
// the WHOLE batch when one uid is bad).
const ACTION_PREFIX = 'api::music-kb-mcp.tool.';
const kebab = (toolName: string) => toolName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const expectedAction = (toolName: string) => `${ACTION_PREFIX}${kebab(toolName)}`;

/** @strapi/admin's validation/action-provider — verbatim. */
const ACTION_UID_PATTERN = /^[a-z]([a-z|.|-]+)[a-z]$/;

/** The retired coarse tiers. Kept here to prove the migration covers them. */
const LEGACY_TIER_ACTIONS: Record<AccessTier, string> = {
  read: 'api::music-kb-mcp.read',
  write: 'api::music-kb-mcp.write',
  maintenance: 'api::music-kb-mcp.maintenance',
};

/**
 * What Strapi does at connect time, reduced to the part we control:
 * a tool is enabled when the token's ability satisfies one of the tool's
 * policies (`auth.policies.some(({ action }) => ability.can(action))` in
 * @strapi/core's syncMcpSessionCapabilities). Our adapter attaches exactly
 * one policy per tool — its own action.
 */
function visibleTools(grantedActions: string[]): string[] {
  const granted = new Set(grantedActions);
  return catalog.filter((t) => granted.has(expectedAction(t.name))).map((t) => t.name);
}

/** What the boot migration in permissions.ts does to a token's grants. */
function afterMigration(grantedActions: string[]): string[] {
  const out = new Set<string>();
  for (const action of grantedActions) {
    const tier = (Object.keys(LEGACY_TIER_ACTIONS) as AccessTier[]).find(
      (t) => LEGACY_TIER_ACTIONS[t] === action,
    );
    if (tier) {
      for (const tool of catalog.filter((t) => t.access === tier)) {
        out.add(expectedAction(tool.name));
      }
      continue;
    }
    out.add(action);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// 1. The parse itself (a broken parser must fail loudly, not vacuously pass)
// ---------------------------------------------------------------------------
describe('mcp permissions — source parse sanity', () => {
  it('found every catalog entry', () => {
    expect(catalog.length).toBeGreaterThan(25);
  });

  it('resolved a distinct camelCase tool name for each entry', () => {
    const names = catalog.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name, `${name} is not camelCase — snake_case collides with @strapi/content-manager's built-in tools`).toMatch(
        /^[a-z][A-Za-z0-9]*$/,
      );
    }
  });

  it('found all three access tiers', () => {
    expect(new Set(catalog.map((t) => t.access))).toEqual(
      new Set(['read', 'write', 'maintenance']),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Both directions: catalog tool <-> registered action
// ---------------------------------------------------------------------------
describe('mcp permissions — every tool has an action, every action has a tool', () => {
  it('derives the action list from the catalog instead of hand-maintaining one', () => {
    expect(
      permissionsSource.includes("from './catalog'"),
      'permissions.ts must import domainTools from ./catalog and derive the actions from it. ' +
        'A hand-written mirror of a 29-entry tool list rots the moment a tool is added.',
    ).toBe(true);
    expect(
      permissionsSource.includes('domainTools.map'),
      'permissions.ts must map over domainTools to build its action definitions.',
    ).toBe(true);
  });

  it('has no hand-written per-tool action literal anywhere in permissions.ts', () => {
    // The template `music-kb-mcp.tool.${toolName}` is the only permitted
    // occurrence. A literal like 'music-kb-mcp.tool.getVideo' means someone
    // started a second copy of the tool list.
    const literals = [...permissionsSource.matchAll(/music-kb-mcp\.tool\.(?!\$\{)([A-Za-z0-9]+)/g)].map(
      (m) => m[0],
    );
    expect(
      literals,
      `permissions.ts hardcodes ${literals.join(', ')}. Derive it from the catalog instead.`,
    ).toEqual([]);
  });

  it.each(catalog.map((t) => [t.name] as const))(
    '%s is covered by a per-tool action Strapi will accept',
    (name) => {
      const uid = expectedAction(name).replace('api::', '');
      expect(
        ACTION_UID_PATTERN.test(uid),
        `${uid} is not a legal Strapi action uid (lowercase letters, dots and hyphens only, ` +
          'starting and ending with a letter). Strapi validates the whole batch before registering ' +
          'any of it, so ONE bad uid unregisters every MCP permission and every token goes dark.',
      ).toBe(true);
      expect(visibleTools([expectedAction(name)])).toContain(name);
    },
  );

  it('every action maps back to exactly one catalog tool', () => {
    const actions = catalog.map((t) => expectedAction(t.name));
    expect(new Set(actions).size, 'two tools derive the same action id').toBe(actions.length);
    for (const action of actions) {
      const owners = catalog.filter((t) => expectedAction(t.name) === action);
      expect(owners).toHaveLength(1);
    }
  });

  it('grants nothing beyond the catalog — an unknown action lights up no tool', () => {
    expect(visibleTools([`${ACTION_PREFIX}notATool`])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Action ids come from tool names, not display titles
// ---------------------------------------------------------------------------
describe('mcp permissions — ids are keyed on the tool name', () => {
  it('permissions.ts builds the uid from the tool name', () => {
    expect(
      /music-kb-mcp\.tool\.\$\{toolNameToUidSegment\(toolName\)\}/.test(permissionsSource),
      'the action uid must be `music-kb-mcp.tool.${toolNameToUidSegment(toolName)}` — keyed on the tool name.',
    ).toBe(true);
    expect(
      permissionsSource.includes('mcpToolActionUid(tool.name)'),
      'mcpToolActionDefs must feed the TOOL NAME into the uid, not the title.',
    ).toBe(true);
  });

  it('no action id carries a trace of a display title', () => {
    for (const tool of catalog) {
      const action = expectedAction(tool.name);
      expect(action, `${action} contains a space — that only happens if it came from a title`).not.toMatch(/\s/);
      // Kebab-cased, but still one-to-one with the name and nothing else.
      expect(action.slice(ACTION_PREFIX.length)).toBe(kebab(tool.name));
      expect(kebab(tool.name).replace(/-/g, '')).toBe(tool.name.toLowerCase());
    }
  });

  it('titles really are different from names, so the previous check has teeth', () => {
    // If titles happened to equal names, "derived from the name" would be
    // untestable. They don't: titles are prose ("List videos" vs listVideos).
    const differing = catalog.filter((t) => t.title !== t.name);
    expect(differing.length).toBe(catalog.length);
  });
});

// ---------------------------------------------------------------------------
// 4. Enforcement: the adapter gates on the per-tool action, not the tier
// ---------------------------------------------------------------------------
describe('mcp permissions — the adapter enforces per-tool actions', () => {
  it('derives the policy action from the tool name', () => {
    expect(
      adapterSource.includes('mcpToolAction(tool.name)'),
      "adapter.ts must gate each tool on mcpToolAction(tool.name).",
    ).toBe(true);
    expect(
      adapterSource.includes('auth: { policies: [{ action }] }'),
      'adapter.ts must attach exactly one policy — the tool\'s own action.',
    ).toBe(true);
  });

  it('no longer consults the coarse tiers', () => {
    expect(
      adapterSource.includes('MCP_ACTIONS'),
      'adapter.ts still references the retired tier actions. Per-tool actions are the only thing ' +
        'consulted: Strapi enables a tool if ANY policy passes, so a tier policy would re-expose ' +
        'every tool in the tier no matter what the per-tool checkboxes said.',
    ).toBe(false);
    for (const legacy of Object.values(LEGACY_TIER_ACTIONS)) {
      expect(adapterSource.includes(legacy)).toBe(false);
    }
  });

  it('a token holding one tool\'s action sees exactly that tool', () => {
    expect(expectedAction('getVideo')).toBe('api::music-kb-mcp.tool.get-video');
    expect(visibleTools([expectedAction('getVideo')])).toEqual(['getVideo']);
    expect(visibleTools([expectedAction('createLesson'), expectedAction('listLessons')]).sort()).toEqual(
      ['createLesson', 'listLessons'],
    );
  });

  it('the incident this replaces: a lesson-authoring token cannot overwrite a summary', () => {
    // The harness token that wiped a real video summary held the whole write
    // tier. Per-tool, "let this client author lessons" no longer implies
    // "let it overwrite video summaries".
    const authoring = visibleTools([expectedAction('createLesson'), expectedAction('updateLesson')]);
    expect(authoring).not.toContain('saveSummary');
  });
});

// ---------------------------------------------------------------------------
// 5. Migration: a token scoped by a tier keeps working
// ---------------------------------------------------------------------------
describe('mcp permissions — the boot migration preserves tier-scoped tokens', () => {
  it('the tier actions grant nothing on their own (which is why the migration exists)', () => {
    for (const legacy of Object.values(LEGACY_TIER_ACTIONS)) {
      expect(visibleTools([legacy])).toEqual([]);
    }
  });

  it.each(['read', 'write', 'maintenance'] as const)(
    'a %s-tier token still sees exactly that tier\'s tools after migration',
    (tier) => {
      const expected = catalog.filter((t) => t.access === tier).map((t) => t.name).sort();
      expect(expected.length).toBeGreaterThan(0);
      expect(visibleTools(afterMigration([LEGACY_TIER_ACTIONS[tier]])).sort()).toEqual(expected);
    },
  );

  it('a full-power (all three tiers) token still sees every tool', () => {
    const all = visibleTools(afterMigration(Object.values(LEGACY_TIER_ACTIONS))).sort();
    expect(all).toEqual(catalog.map((t) => t.name).sort());
  });

  it('permissions.ts knows all three legacy actions and expands them from the catalog', () => {
    for (const legacy of Object.values(LEGACY_TIER_ACTIONS)) {
      expect(
        permissionsSource.includes(legacy),
        `permissions.ts must still recognise ${legacy} so the migration can find tokens holding it.`,
      ).toBe(true);
    }
    expect(
      permissionsSource.includes('def.access === access'),
      'the tier -> tools expansion must read the catalog\'s access field, not a hand-written map.',
    ).toBe(true);
  });

  it('migrating twice is a no-op (the second boot must not re-grant)', () => {
    const once = afterMigration([LEGACY_TIER_ACTIONS.write]).sort();
    const twice = afterMigration(once).sort();
    expect(twice).toEqual(once);
  });
});
