// What a tag is called, and what its slug is — one rule each, for every path
// that creates or finds a tag (issue #14).
//
// A tag reaches Strapi three ways: the REST share flow (through the
// document-service middleware in src/index.ts), the MCP tools, and
// scripts/seed-music-tags.mjs. Each used to carry its own copy of these rules,
// and they drifted two ways:
//
//   - Names. The middleware STORES a name with whitespace runs collapsed, but
//     every MCP tool LOOKED one up with trim + lower-case only. "jazz  blues"
//     missed the existing "jazz blues": tagVideo and addVideo then created it,
//     the middleware renamed the create to the existing name, and the unique
//     constraint threw; untagVideo removed nothing; the read tools filtered on
//     a name nothing is stored under.
//   - Slugs. The middleware stripped `_` and `&` before turning separators
//     into dashes, so "hip_hop" became "hiphop" over REST and "hip-hop"
//     everywhere else.
//
// The client mirrors normalizeTagName in `findTagByNameService`
// (client/src/lib/services/videos.ts) and leaves slugs to the server.

/**
 * The canonical stored form of a tag name: trimmed, lower-cased, with every
 * run of whitespace collapsed to one space. Normalize a name BEFORE looking it
 * up, not only before storing it — the lookup is where the drift bit.
 */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The slug for a tag name. Strapi's document service does not generate `uid`
 * fields (only the admin UI does), so every create path has to supply one.
 * Lower-case, apostrophes dropped, every other run of non-alphanumerics
 * becomes one dash — the admin UI's own `name -> slug` shape, so tags line up
 * however they were made.
 */
export function slugifyTagName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      // Straight apostrophes only, exactly as every previous copy did. A
      // curly one becomes a dash like any other punctuation, which keeps
      // "don't" and "don’t" — two different names — on two different slugs.
      .replace(/'/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'tag'
  );
}
