// In-memory skill registry. Each skill module imports this and calls
// `registerSkill(MY_SKILL)`. Consumers (chat routes, picker UI) look up
// by slug or list-by-context. No DB calls, no async — skills are code.

import type { Skill, SkillContext } from './types';

const registry = new Map<string, Skill>();

export function registerSkill(skill: Skill): void {
  if (registry.has(skill.slug)) {
    // Duplicate slug — prefer the later registration so HMR / test
    // re-imports don't silently fall back to stale data. Surface via
    // warn so accidental collisions are visible.
    // eslint-disable-next-line no-console
    console.warn(
      `[skills] slug "${skill.slug}" registered more than once — overriding`,
    );
  }
  registry.set(skill.slug, skill);
}

/** All registered skills, sorted by `sortOrder` ascending then `name`. */
export function listAllSkills(): Skill[] {
  return Array.from(registry.values()).sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name);
  });
}

/** Skills applicable to a given chat surface, sorted like `listAllSkills`. */
export function listSkills(context: SkillContext): Skill[] {
  return listAllSkills().filter((s) => s.applicableContexts.includes(context));
}

/** Look up a skill by slug. Returns null (not undefined) for missing — the
 * server handler wants a nullable union, not an optional. */
export function getSkill(slug: string): Skill | null {
  return registry.get(slug) ?? null;
}
