#!/usr/bin/env node
// Seeds a starter set of music-relevant tags so the tagging UI is useful from
// day one. Idempotent — skips any tag whose normalized name already exists.
//
// Run against a LIVE Strapi (yarn dev / yarn server). Uses the public-role
// `api::tag.tag.create` grant set up in server/src/index.ts → no token needed.
//
// Usage: node server/scripts/seed-music-tags.mjs

const STRAPI = process.env.STRAPI_URL || 'http://localhost:1350';

const TAGS = [
  // skill/concept
  'chords',
  'scales',
  'modes',
  'theory',
  'technique',
  'exercise',
  'rhythm',
  'ear training',
  'improvisation',
  'sight reading',
  // instrument
  'guitar',
  'piano',
  'bass',
  'drums',
  'vocals',
  'production',
  // content type
  'song lesson',
  'gear',
  // level
  'beginner',
  'intermediate',
  'advanced',
];

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

// Mirrors slugifyTagName in server/src/mcp/tools/tag-utils.ts so REST-seeded
// tags line up with UI- and MCP-created ones.
const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tag';

async function http(method, path, body) {
  const res = await fetch(`${STRAPI}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}

async function tagExists(name) {
  const q = `/api/tags?filters[name][$eq]=${encodeURIComponent(name)}&pagination[pageSize]=1`;
  const res = await http('GET', q);
  return Array.isArray(res?.data) && res.data.length > 0;
}

async function main() {
  // Fail fast if Strapi isn't reachable so the user gets a clear message
  // instead of N create errors.
  try {
    await http('GET', '/api/tags?pagination[pageSize]=1');
  } catch (e) {
    console.error(`✗ Cannot reach Strapi at ${STRAPI}. Is it running? (yarn dev)`);
    console.error(`  details: ${e.message}`);
    process.exit(1);
  }

  let created = 0;
  let skipped = 0;
  for (const raw of TAGS) {
    const name = norm(raw);
    if (await tagExists(name)) {
      skipped++;
      continue;
    }
    await http('POST', '/api/tags', { data: { name, slug: slugify(name) } });
    created++;
    console.log(`  + ${name}`);
  }
  console.log(`\n✓ Music tag seed: ${created} created, ${skipped} already present.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
