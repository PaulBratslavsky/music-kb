// Serves docs/lesson-authoring.md whole — the single source of truth for
// lesson authoring rules, shared with the in-app generator
// (client/src/lib/services/lesson-generation.ts, which injects excerpts of
// the same file via client/src/lib/lesson/authoring-guide.ts). This tool
// exists because Claude Desktop has no filesystem access to this repo, so
// it can't just read docs/lesson-authoring.md itself the way Claude Code
// can — it needs the content served over MCP. Claude Code CAN read the
// file directly, but calling this tool works there too and stays
// consistent with one canonical way to get the guide regardless of client.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from '../registry';

// Resolved relative to process.cwd(), same reasoning as
// client/src/lib/lesson/authoring-guide.ts: Strapi's own dev/start
// commands (`yarn server` → `yarn --cwd ./server develop`, `strapi build`
// + `strapi start`) all run with cwd = `server/`, the package root — not
// relative to this file's own location, which would need a different `..`
// depth in compiled `dist/` output than in `src/`. `docs/` sits one level
// up from `server/`, at the repo root.
const GUIDE_PATH = resolve(process.cwd(), '..', 'docs', 'lesson-authoring.md');

let cachedGuide: string | null = null;

function loadGuide(): string {
  if (cachedGuide === null) {
    cachedGuide = readFileSync(GUIDE_PATH, 'utf8');
  }
  return cachedGuide;
}

const schema = z.object({}).strict();

export const getLessonAuthoringGuideTool: ToolDef<z.infer<typeof schema>> = {
  // camelCase, not `get_lesson_authoring_guide` — see the naming comment in
  // create-lesson.ts: a snake_case name can collide with a tool
  // @strapi/content-manager derives at boot and crash the whole Strapi
  // boot, not just this tool's registration. Every domain tool in this
  // catalog is camelCase for that reason.
  name: 'getLessonAuthoringGuide',
  description:
    'Read the full lesson-authoring guide (docs/lesson-authoring.md): the block reference for every ' +
    'lesson.* component (fields, enums, constraints, and traps like the en-dash stringSet separators) and the ' +
    'judgment on what makes a generated lesson worth reading rather than generic filler. Call this BEFORE ' +
    'composing a `createLesson`/`updateLesson` body — the two write tools validate shape, not quality, and this ' +
    'guide is where the quality bar and the non-obvious schema traps live. Takes no arguments.',
  schema,
  execute: async () => {
    try {
      return { guide: loadGuide() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { error: `Could not read the lesson authoring guide: ${message}` };
    }
  },
};
