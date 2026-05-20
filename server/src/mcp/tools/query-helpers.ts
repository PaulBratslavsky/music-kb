// Query helpers shared by searchVideos / findTranscripts.
//
// The original tools did a single `$containsi` of the raw query string
// against each field — which fails the moment the agent passes a
// natural-language query like "Rethinking AI Agents Harness Engineering"
// against a title that has extra words in the middle
// ("Rethinking AI Agents: The Rise of Harness Engineering"). The
// continuous-substring match can't bridge the gap.
//
// Fix: tokenize the query and require EACH non-stopword token to appear
// in at least one of the candidate fields (AND across tokens, OR across
// fields). This matches how users intuitively search.

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'but', 'the', 'of', 'in', 'on', 'at',
  'for', 'with', 'by', 'to', 'is', 'are', 'was', 'were', 'be',
  'this', 'that', 'these', 'those', 'it', 'its',
]);

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]*/g)
    ?.filter((t) => t.length >= 2 && !STOPWORDS.has(t)) ?? [];
}

/**
 * Build a Strapi filter that requires every query token to appear
 * (case-insensitive substring) in at least one of the given fields.
 *
 * If the tokenized query is empty (query was all stopwords / too short),
 * returns an empty object — callers should treat that as "no filter"
 * rather than "match nothing", since the agent clearly intended to
 * search for something.
 */
export function buildTokenAndFilter(
  query: string,
  fields: string[],
): Record<string, unknown> {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return {};

  return {
    $and: tokens.map((tok) => ({
      $or: fields.map((f) => ({ [f]: { $containsi: tok } })),
    })),
  };
}
