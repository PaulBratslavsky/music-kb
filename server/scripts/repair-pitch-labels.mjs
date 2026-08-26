// One-off repair of pitch-labelled neck dots already stored in Strapi whose
// LABEL disagrees with the note that string/fret actually sounds. A live
// audit found 8 of 60-ish pitch-labelled dots wrong (13%), all in one
// lesson.neck-pattern block, clustered on the inner strings where the model
// miscounts. The position is always right — only the name is wrong — so
// this corrects the label rather than dropping the dot, the same trade
// markdown-blocks.ts and the MCP write tools now make going forward.
//
// Reuses `correctPitchLabels` from the MCP validator itself (../src/mcp/
// tools/lesson-blocks.ts) rather than a fourth copy of the tuning
// arithmetic: that file has no relative imports of its own (only the bare
// `zod` package), so Node's native TS type-stripping can load it directly
// here, exactly like it does for markdown-blocks.ts. `correctPitchLabels`
// only reads `__component`/`instrument`/`mode`/`dots`/`patterns` off each
// block, so it works unmodified on Strapi's raw GET response — the extra
// fields Strapi adds (`id`, `caption`, `source`, …) are just ignored.
import { correctPitchLabels } from '../src/mcp/tools/lesson-blocks.ts';

const API = 'http://localhost:1350/api/lessons';
const DRY = !process.argv.includes('--apply');

const { data } = await fetch(`${API}?populate[body][populate]=*&pagination[pageSize]=100`).then((r) => r.json());
let fixed = 0;
let lessonsTouched = 0;

for (const l of data) {
  const body = l.body || [];
  const corrections = correctPitchLabels(body); // mutates `body`'s dot labels in place
  if (corrections.length === 0) continue;

  lessonsTouched++;
  fixed += corrections.length;
  for (const c of corrections) {
    const where = c.patternLabel ? `${c.component} "${c.patternLabel}"` : c.component;
    console.log(
      `  ${l.slug.slice(0, 40).padEnd(40)} block#${c.blockIndex} ${where}  s${c.string}f${c.fret}  "${c.from}" -> "${c.to}"`,
    );
  }
  if (DRY) continue;

  // Same three Strapi REST quirks repair-diagram-windows.mjs documents:
  //   1. component `id`s belong to the entity and are rejected on the way
  //      back in — strip every `id` key recursively.
  //   2. an empty component array round-trips as `null` from Strapi's own
  //      GET, which the schema then rejects on PUT ("must be a array type,
  //      but the final value was: null") — drop `null` values, absent is
  //      how Strapi spells empty on the way in.
  //   3. `__component` must be the FIRST key of each dynamic-zone entry;
  //      Strapi's own GET serialises it LAST, so a straight round-trip is
  //      rejected with "Invalid key __component at body" — reorder it.
  const componentFirst = (b) => ({ __component: b.__component, ...b });
  const clean = (o) =>
    Array.isArray(o)
      ? o.map(clean)
      : o && typeof o === 'object'
        ? Object.fromEntries(
            Object.entries(o).filter(([k, v]) => k !== 'id' && v !== null).map(([k, v]) => [k, clean(v)]),
          )
        : o;
  const res = await fetch(`${API}/${l.documentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { body: clean(body).map(componentFirst) } }),
  });
  if (!res.ok) console.log(`    !! PUT ${l.slug}: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

console.log(`\n${DRY ? 'DRY RUN — ' : 'APPLIED — '}${fixed} pitch label(s) corrected across ${lessonsTouched} lesson(s)`);
