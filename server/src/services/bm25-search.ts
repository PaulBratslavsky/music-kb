// BM25 search against a persisted index — read-only complement to the
// client-side indexer at client/src/lib/services/transcript.ts. The MCP
// `searchTranscript` tool reuses the index already stored on
// `Video.transcriptSegments` (built during summary generation) rather than
// rebuilding one per query.
//
// Mirrors the scoring math of `searchBM25` in transcript.ts so results are
// identical to what the in-app chat sees. Kept small on purpose — the
// full module there also handles indexing, chunking, and cleaning, which
// the MCP surface doesn't need.

const BM25_K1 = 1.2;
const BM25_B = 0.75;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'to', 'of', 'in', 'on', 'at', 'for', 'with',
  'by', 'as', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'we', 'they', 'them', 'his', 'her', 'their', 'our', 'my',
  'your', 'so', 'if', 'then', 'than', 'there', 'here', 'do', 'does', 'did',
  'have', 'has', 'had', 'not', 'no', 'yes', 'too', 'very', 'just', 'about',
  'from', 'up', 'down', 'out', 'off', 'over', 'again', 'further', 'once',
]);

function tokenize(input: string): string[] {
  return input
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, ' ')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]*/g)
    ?.filter((t) => t.length > 1 && !STOPWORDS.has(t)) ?? [];
}

export type TranscriptChunk = {
  id: number;
  text: string;
  startWord: number;
  timeSec: number;
};

export type BM25Index = {
  tf: Array<Record<string, number>>;
  idf: Record<string, number>;
  lengths: number[];
  avgLength: number;
  chunks: TranscriptChunk[];
};

export type StoredTranscriptIndex = {
  version: 1;
  bm25: BM25Index;
  rawSegments?: unknown[];
  durationSec?: number | null;
};

export function isStoredIndex(value: unknown): value is StoredTranscriptIndex {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StoredTranscriptIndex>;
  return v.version === 1 && !!v.bm25 && Array.isArray(v.bm25.chunks);
}

export type RankedChunk = {
  chunk: TranscriptChunk;
  score: number;
};

export function searchBM25(
  index: BM25Index,
  query: string,
  topK: number,
): RankedChunk[] {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0) return [];

  const scores: number[] = new Array(index.chunks.length).fill(0);
  for (const term of queryTerms) {
    const idf = index.idf[term];
    if (!idf) continue;
    for (let i = 0; i < index.chunks.length; i++) {
      const f = index.tf[i][term];
      if (!f) continue;
      const dl = index.lengths[i];
      const norm = 1 - BM25_B + (BM25_B * dl) / (index.avgLength || 1);
      scores[i] += idf * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * norm));
    }
  }

  return scores
    .map((score, i) => ({ score, chunk: index.chunks[i] }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function formatTimecode(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// Citation verification — server-side duplicate of `verifyTimecodesInText`
// in client/src/lib/services/transcript.ts (option A of
// docs/mcp-citation-rewrite-plan.md: duplicate, same precedent as the BM25
// primitive above). Powers the `verifyCitations` MCP tool. Scoring math
// must stay in lockstep with the client copy.
// -----------------------------------------------------------------------------

export type TranscriptEvidence = {
  /** Real caption-segment start time in seconds. */
  timeSec: number;
  /** The transcript chunk's raw text — shows WHY we landed there. */
  snippet: string;
  /** BM25 relevance score. Higher = stronger match. */
  score: number;
};

// BM25 top-1 lookup for a claim/quote. Returns null when nothing clears
// `minScore` — the caller should then trust the model's original value.
export function findEvidenceForQuote(
  quote: string,
  index: BM25Index,
  minScore = 1.0,
): TranscriptEvidence | null {
  const [hit] = searchBM25(index, quote, 1);
  if (!hit || hit.score < minScore) return null;
  return {
    timeSec: hit.chunk.timeSec,
    snippet: hit.chunk.text,
    score: hit.score,
  };
}

// Parse a `mm:ss` or `h:mm:ss` string into seconds.
function parseTcStringToSeconds(tc: string): number {
  const parts = tc.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

export type CitationOverride = {
  /** Original timecode the model emitted. */
  from: string;
  /** Corrected timecode (transcript-grounded). */
  to: string;
  /** First 80 chars of the surrounding claim. */
  context: string;
};

export type UngroundedCitation = {
  /** The timecode as the model wrote it. */
  timecode: string;
  /** First 80 chars of the surrounding claim. */
  context: string;
};

// Scan a text for model-emitted `[mm:ss]` / `(mm:ss)` / bare mm:ss citations.
// For each, extract the surrounding context (~±200 chars) and verify the
// cited timecode matches where that content actually lives in the transcript.
// If the best chunk is >`toleranceSec` from the cited value AND the match
// confidence clears `minScore`, swap the citation for the correct one.
// Preserves wrapper style (brackets / parens / bare). Citations with no
// confident transcript anchor are left untouched and reported in
// `ungrounded` so the caller can decide what to do with them.
export function verifyTimecodesInText(
  text: string,
  index: BM25Index,
  opts: { toleranceSec?: number; minScore?: number } = {},
): {
  text: string;
  overrides: CitationOverride[];
  ungrounded: UngroundedCitation[];
} {
  const tolerance = opts.toleranceSec ?? 30;
  const minScore = opts.minScore ?? 1.5;
  const overrides: CitationOverride[] = [];
  const ungrounded: UngroundedCitation[] = [];

  // Three-alternative pattern — matches preserved so we can swap only the
  // number while keeping punctuation intact.
  const pattern = new RegExp(
    [
      '\\[(\\d{1,2}:\\d{2}(?::\\d{2})?)\\]',
      '\\((\\d{1,2}:\\d{2}(?::\\d{2})?)\\)',
      '\\b(\\d{1,2}:\\d{2}(?::\\d{2})?)\\b',
    ].join('|'),
    'g',
  );

  const corrected = text.replace(pattern, (match, bracketed, parens, bare, offset: number) => {
    const tc: string | undefined = bracketed ?? parens ?? bare;
    if (!tc) return match;
    const cited = parseTcStringToSeconds(tc);

    // Context window: ~200 chars before and after the citation, enough to
    // BM25-score reliably without running over neighboring sections.
    const before = text.slice(Math.max(0, offset - 200), offset);
    const after = text.slice(offset + match.length, offset + match.length + 200);
    const context = `${before} ${after}`.replace(/\s+/g, ' ').trim();
    if (context.length < 20) {
      // Not enough content to verify — surface it rather than guessing.
      ungrounded.push({ timecode: tc, context: context.slice(0, 80) });
      return match;
    }

    const hit = findEvidenceForQuote(context, index, minScore);
    if (!hit) {
      ungrounded.push({ timecode: tc, context: context.slice(0, 80) });
      return match;
    }

    if (Math.abs(hit.timeSec - cited) <= tolerance) return match;

    const newTc = formatTimecode(hit.timeSec);
    overrides.push({ from: tc, to: newTc, context: context.slice(0, 80) });

    if (bracketed) return `[${newTc}]`;
    if (parens) return `(${newTc})`;
    return newTc;
  });

  return { text: corrected, overrides, ungrounded };
}
