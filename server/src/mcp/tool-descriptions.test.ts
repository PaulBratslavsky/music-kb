// Tool descriptions are part of every tool's interface: they are what an MCP
// client's model reads to decide what to call next. A description that names
// a tool which doesn't exist sends the model off a cliff.
//
// It happened with the lesson tools. Their descriptions said `list_lessons`,
// `get_lesson`, `create_lesson` and `update_lesson`. Ours are camelCase
// (`getLesson`, …) precisely because Strapi's content-manager derives those
// snake_case names as built-ins, and ours would otherwise collide at boot. So
// a model following the hint either called a tool that doesn't exist, or —
// with a content-manager-scoped token, which docs/mcp.md documents — Strapi's
// built-in, which skips lessonBodySchema, correctPitchLabels and the
// slug-collision guard. (Issue #9.)
//
// Scanned: each tool's `description`, AND every `.describe()` string in its
// input schema — those reach the client too, inside the JSON Schema.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { domainTools } from './catalog';

const TOOL_NAMES = new Set(domainTools.map((d) => d.tool.name));

/** Every piece of text a client sees for one tool. */
function textsOf(tool: (typeof domainTools)[number]['tool']): string[] {
  const out = [tool.description];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'description' && typeof v === 'string') out.push(v);
      else walk(v);
    }
  };
  walk(z.toJSONSchema(tool.schema as z.ZodType, { unrepresentable: 'any' }));
  return out;
}

// The names Strapi's content-manager derives for a content type:
// `${verb}_${slug}`. Naming one of these is the specific failure above.
const CONTENT_MANAGER_BUILTIN = /\b(?:list|get|create|update|delete|publish|unpublish|discard)_[a-z][a-z_]*\b/g;

// A camelCase token shaped like one of our tool names — a verb our tools use,
// then a capital. `createdAt` does not match (lower-case after the verb).
const TOOL_VERBS = [
  'get', 'list', 'create', 'update', 'search', 'find', 'save', 'add', 'tag', 'untag',
  'fetch', 'generate', 'verify', 'aggregate', 'reindex', 'cross', 'library', 'related',
];
const TOOL_SHAPED = new RegExp(`\\b(?:${TOOL_VERBS.join('|')})[A-Z][A-Za-z]*\\b`, 'g');

describe('tool descriptions only name tools that exist', () => {
  it.each(domainTools.map((d) => [d.tool.name, d.tool] as const))(
    '%s never points at a content-manager built-in',
    (_name, tool) => {
      const hits = textsOf(tool).flatMap((t) => t.match(CONTENT_MANAGER_BUILTIN) ?? []);
      expect(hits).toEqual([]);
    },
  );

  it.each(domainTools.map((d) => [d.tool.name, d.tool] as const))(
    '%s only references tools in the catalog',
    (_name, tool) => {
      const unknown = textsOf(tool)
        .flatMap((t) => t.match(TOOL_SHAPED) ?? [])
        .filter((n) => !TOOL_NAMES.has(n));
      expect(unknown).toEqual([]);
    },
  );

  it('the scan actually sees schema field descriptions', () => {
    // Guards the guard: if textsOf stopped reaching into the input schema,
    // both tests above would pass vacuously for every field description.
    const getLesson = domainTools.find((d) => d.tool.name === 'getLesson')!.tool;
    expect(textsOf(getLesson).length).toBeGreaterThan(1);
  });
});
