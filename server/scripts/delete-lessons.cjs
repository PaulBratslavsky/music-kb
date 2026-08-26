#!/usr/bin/env node
// Deletes lessons by slug using Strapi's own document service.
//
// Deliberately NOT over the REST API: the public role has no `delete` grant on
// api::lesson.lesson and should not get one — a knowledge base whose lessons
// anyone can delete is a worse problem than manual cleanup. Booting Strapi
// in-process gets full document-service access without weakening the
// permission model.
//
// CommonJS, not ESM: Strapi's runtime reaches lodash/fp by directory import,
// which Node's ESM loader rejects (ERR_UNSUPPORTED_DIR_IMPORT).
//
// Strapi must be STOPPED first — SQLite needs exclusive write, same rule as
// `yarn seed`.
//
//   node server/scripts/delete-lessons.cjs slug-a slug-b          # dry run
//   node server/scripts/delete-lessons.cjs --apply slug-a slug-b
const { createStrapi, compileStrapi } = require('@strapi/strapi');

(async () => {
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const slugs = args.filter((a) => a !== '--apply');
  if (!slugs.length) { console.error('Pass at least one slug.'); process.exit(2); }

  const ctx = await compileStrapi();
  const app = await createStrapi(ctx).load();
  app.log.level = 'error';

  let gone = 0;
  for (const slug of slugs) {
    const [row] = await app.documents('api::lesson.lesson').findMany({ filters: { slug: { $eq: slug } } });
    if (!row) { console.log(`  skip     ${slug} (not found)`); continue; }
    if (!APPLY) { console.log(`  would delete  ${slug}`); continue; }
    await app.documents('api::lesson.lesson').delete({ documentId: row.documentId });
    console.log(`  deleted  ${slug}`);
    gone += 1;
  }
  console.log(`\n${APPLY ? `${gone} deleted` : `${slugs.length} matched (dry run)`}`);
  await app.destroy();
  process.exit(0);
})();
