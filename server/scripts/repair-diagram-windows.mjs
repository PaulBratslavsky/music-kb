// One-off repair of diagrams already stored in Strapi whose own fret window
// hides their dots. Applies the SAME repair the parser now applies to new
// content: widen the window to fit, rather than drop the block — the dots are
// the content, the window is only a crop hint.
import { resolveDiagramDots, resolveNeckWindow, visibleNeckDots } from './src/lib/lesson/diagram-params.ts';

const API = 'http://localhost:1350/api/lessons';
const DRY = !process.argv.includes('--apply');

const { data } = await fetch(`${API}?populate[body][populate]=*&pagination[pageSize]=100`).then((r) => r.json());
let fixed = 0, lessonsTouched = 0;

for (const l of data) {
  let dirty = false;
  const body = (l.body || []).map((b) => {
    if (b.__component !== 'lesson.diagram') return b;
    const inst = b.instrument === 'bass' ? 'bass' : 'guitar';
    let dots;
    try { dots = resolveDiagramDots(b, undefined); } catch { return b; }
    if (!dots?.length) return b;
    const vis = visibleNeckDots(dots, inst, b.fromFret ?? undefined, b.toFret ?? undefined);
    if (vis.length === dots.length) return b;
    const fit = resolveNeckWindow(dots, inst);           // auto-fit, ignoring the bad window
    console.log(`  #${b.id} ${l.slug.slice(0,34)}  [${b.fromFret},${b.toFret}] -> [${fit.lo},${fit.hi}]  (${vis.length}/${dots.length} visible)`);
    dirty = true; fixed++;
    return { ...b, fromFret: fit.lo, toFret: fit.hi };
  });
  if (!dirty) continue;
  lessonsTouched++;
  if (DRY) continue;
  // Strapi returns component fields it will not accept back: every block
  // carries `id`s that belong to the entity, and empty component arrays come
  // back as `null` where the schema demands an array (`dots must be a array
  // type, but the final value was: null`). Strip both — absent is how Strapi
  // spells empty on the way in.
  // Strapi requires `__component` to be the FIRST key of each dynamic-zone
  // entry. Its own GET response serialises it LAST, so a straight round-trip
  // is rejected with "Invalid key __component at body" — an error that names
  // the key while saying nothing about ordering. Reorder on the way back in.
  const componentFirst = (b) => ({ __component: b.__component, ...b });
  const clean = (o) =>
    Array.isArray(o) ? o.map(clean)
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
  if (!res.ok) console.log(`    !! PUT ${l.slug}: ${res.status} ${(await res.text()).slice(0,200)}`);
}
console.log(`\n${DRY ? 'DRY RUN — ' : 'APPLIED — '}${fixed} diagrams across ${lessonsTouched} lessons`);
