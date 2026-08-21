#!/usr/bin/env node
// Seeds lessons from server/seed-data/lessons/*.json.
//
// Idempotent: upserts by `slug`, so re-running after editing a lesson JSON
// updates in place rather than creating duplicates. Same identity-by-natural-
// key stance digests take with videoSetKey.
//
// Run against a LIVE Strapi (yarn server / yarn start). Uses the public-role
// create/update grants from server/src/index.ts, so no token is needed.
//
// Usage: node server/scripts/seed-lessons.mjs

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STRAPI = process.env.STRAPI_URL || 'http://localhost:1350';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed-data', 'lessons');

async function findBySlug(slug) {
  const url = `${STRAPI}/api/lessons?filters[slug][$eq]=${encodeURIComponent(slug)}&pagination[pageSize]=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`lookup ${slug}: ${res.status}`);
  const body = await res.json();
  return body.data?.[0] ?? null;
}

async function upsert(lesson) {
  const existing = await findBySlug(lesson.slug);
  const target = existing
    ? `${STRAPI}/api/lessons/${existing.documentId}`
    : `${STRAPI}/api/lessons`;
  const res = await fetch(target, {
    method: existing ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: lesson }),
  });
  if (!res.ok) {
    throw new Error(`${existing ? 'update' : 'create'} ${lesson.slug}: ${res.status} ${await res.text()}`);
  }
  return existing ? 'updated' : 'created';
}

const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
if (files.length === 0) {
  console.log('No lesson JSON files yet — nothing to seed.');
  process.exit(0);
}

let created = 0;
let updated = 0;
for (const file of files) {
  const lesson = JSON.parse(await readFile(join(DIR, file), 'utf8'));
  const action = await upsert(lesson);
  action === 'created' ? created++ : updated++;
  console.log(`  ${action}: ${lesson.slug}`);
}
console.log(`\nSeeded ${files.length} lesson(s) — ${created} created, ${updated} updated.`);
