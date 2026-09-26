// The MCP lesson schema agrees with the Strapi component JSON it writes to.
//
// A lesson block is declared in several places, and the MCP↔Strapi parity
// tests used to check only that the `lesson.x` component NAMES line up. Field
// names, enum values and string lengths for most components were unguarded —
// and `f8c7ac5` records a field added in four places and missed in the fifth.
// This walks every block in `lessonBlockSchema` against
// server/src/components/lesson/<name>.json. (Issue #10.)
//
// Both files live in server/, so this is an ordinary in-package test — no
// cross-package question arises.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STRING_SETS, lessonBlockSchema } from './lesson-blocks';

type Attr = { type: string; enum?: string[]; maxLength?: number };

/** Peel optional/default/nullable wrappers off a zod field. */
function unwrap(field: any): any {
  let cur = field;
  for (let i = 0; i < 10; i++) {
    const t = cur?._zod?.def?.type;
    if (t === 'optional' || t === 'default' || t === 'nullable' || t === 'prefault') cur = cur._zod.def.innerType;
    else if (t === 'pipe') cur = cur._zod.def.in;
    else break;
  }
  return cur;
}

/**
 * Enumerations the schema validates WITHOUT a z.enum — a refine that can say
 * something more useful than "invalid enum value". Their allowed values come
 * from the constant the refine checks against.
 */
const REFINED_ENUMS: Record<string, readonly string[]> = {
  'lesson.diagram.stringSet': STRING_SETS,
};

const blocks = ((lessonBlockSchema as any).options as any[]).map((opt) => {
  const shape = opt.shape ?? opt._zod.def.shape;
  const component: string = unwrap(shape.__component)._zod.def.values[0];
  const file = new URL(`../../components/lesson/${component.replace('lesson.', '')}.json`, import.meta.url);
  const attrs = JSON.parse(readFileSync(file, 'utf8')).attributes as Record<string, Attr>;
  return { component, shape, attrs };
});

describe('lessonBlockSchema matches the Strapi component JSON', () => {
  it('covers every block — the walk found them all', () => {
    expect(blocks.length).toBe((lessonBlockSchema as any).options.length);
    expect(blocks.length).toBeGreaterThan(10);
  });

  it.each(blocks.map((b) => [b.component, b] as const))('%s: same fields, both ways', (_c, b) => {
    const zod = Object.keys(b.shape).filter((k) => k !== '__component').sort();
    expect(zod).toEqual(Object.keys(b.attrs).sort());
  });

  it.each(blocks.map((b) => [b.component, b] as const))('%s: same enum values', (_c, b) => {
    for (const [key, attr] of Object.entries(b.attrs)) {
      if (attr.type !== 'enumeration') continue;
      const field = unwrap(b.shape[key]);
      const refined = REFINED_ENUMS[`${b.component}.${key}`];
      const values: string[] = refined
        ? [...refined]
        : (field.options ?? Object.values(field._zod?.def?.entries ?? {})).map(String);
      expect(values.length, `${b.component}.${key}: no enum values found in the schema`).toBeGreaterThan(0);
      expect([...values].sort(), `${b.component}.${key}`).toEqual([...(attr.enum ?? [])].sort());
    }
  });

  it.each(blocks.map((b) => [b.component, b] as const))('%s: same string max lengths', (_c, b) => {
    for (const [key, attr] of Object.entries(b.attrs)) {
      if (attr.maxLength === undefined) continue;
      expect(unwrap(b.shape[key]).maxLength, `${b.component}.${key}`).toBe(attr.maxLength);
    }
  });
});
