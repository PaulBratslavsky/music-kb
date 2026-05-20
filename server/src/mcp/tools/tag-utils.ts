// Helpers shared by every tool that creates Tag rows. The Tag content type
// has `slug: { type: 'uid', targetField: 'name', required: true }`, but
// `strapi.documents('api::tag.tag').create()` does NOT auto-generate uid
// fields — so we compute a slug here and pass it explicitly.
//
// The admin UI auto-generates slugs via a separate service; we replicate
// the canonical `name → slug` transform (lowercase + non-alphanum → '-')
// so MCP-created tags line up with UI-created ones.

export function slugifyTagName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'tag';
}
