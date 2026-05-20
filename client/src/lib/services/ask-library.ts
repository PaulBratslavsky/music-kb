// Library-wide retrieval + synthesis helpers.
//
// `retrievePassagesForQuery` is the shared core that both /search (listing)
// and /api/ask (synthesis) use. Extracting it out of the server function
// keeps the two paths aligned — any retrieval tuning that helps moment
// search also helps the ask-library answer quality.
//
// The synthesis prompt lives here too so the API route and any future
// MCP tool share the same grounding rules.

import {
  buildBM25Index,
  searchBM25,
  tokenize,
  type TranscriptChunk,
} from './transcript';
import {
  cosineSimilarity,
  embedText,
  passageStatus,
} from './embeddings';
import {
  listAllVideosForEmbeddingService,
  type StrapiVideo,
} from './videos';

// Keep in sync with the constants used in server-functions/videos.ts —
// these control the hybrid retrieval behavior. Duplicated here because
// the server function module has other server-only imports we don't
// want to pull into code paths that might run in different contexts.
const RRF_K = 60;
const BM25_WEIGHT = 2.5;

// Parent-document retrieval config. Instead of letting 15 scattered
// passages across 8+ videos compete for Gemma's attention, we pick the
// top N most-relevant videos by aggregated passage score and pass each
// one's full summary + top-K passages. Gemma then has deep context on
// a focused set of sources — much more accurate synthesis than shallow
// breadth across many.
const MAX_VIDEOS = 5;
const PASSAGES_PER_VIDEO = 3;

export type RetrievedPassage = {
  id: number;
  video: {
    documentId: string;
    youtubeVideoId: string;
    videoTitle: string | null;
    videoAuthor: string | null;
    videoThumbnailUrl: string | null;
    summaryDescription: string | null;
    summaryOverview: string | null;
    keyTakeaways: Array<{ text: string }>;
    tags: Array<{ name: string }>;
  };
  text: string;
  startSec: number;
  endSec: number;
  cosineScore: number;
  rrfScore: number;
};

export async function retrievePassagesForQuery(
  query: string,
  opts: {
    maxVideos?: number;
    passagesPerVideo?: number;
    minScore?: number;
  } = {},
): Promise<RetrievedPassage[]> {
  const maxVideos = opts.maxVideos ?? MAX_VIDEOS;
  const passagesPerVideo = opts.passagesPerVideo ?? PASSAGES_PER_VIDEO;
  const minScore = opts.minScore ?? 0.35;

  const qVec = await embedText(query, 'query');
  const all = await listAllVideosForEmbeddingService();

  // Flatten every current passage into one corpus.
  type Flat = {
    video: StrapiVideo;
    text: string;
    startSec: number;
    endSec: number;
    embedding: number[];
  };
  const flat: Flat[] = [];
  for (const v of all) {
    const index = v.passageEmbeddings;
    if (passageStatus(index) !== 'current' || !index) continue;
    for (const p of index.chunks) {
      flat.push({
        video: v,
        text: p.text,
        startSec: p.startSec,
        endSec: p.endSec,
        embedding: p.embedding,
      });
    }
  }
  if (flat.length === 0) return [];

  // Dense cosine.
  const cosineScores = flat.map((p) => cosineSimilarity(qVec, p.embedding));
  const denseOrder = cosineScores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);

  // BM25 over passage text with parent-video metadata prepended.
  const bm25Chunks: TranscriptChunk[] = flat.map((p, i) => {
    const titleLine = [p.video.videoTitle, p.video.videoAuthor]
      .filter(Boolean)
      .join(' ');
    return {
      id: i,
      text: titleLine ? `${titleLine}\n${p.text}` : p.text,
      startWord: 0,
      timeSec: p.startSec,
    };
  });
  const bm25Index = buildBM25Index(bm25Chunks);
  const bm25Hits = searchBM25(bm25Index, query, flat.length);
  const bm25Order = bm25Hits.map((c) => c.id);

  // RRF merge with BM25 weight.
  const rrf = new Map<number, number>();
  denseOrder.forEach((id, rank) => {
    rrf.set(id, (rrf.get(id) ?? 0) + 1 / (rank + 1 + RRF_K));
  });
  bm25Order.forEach((id, rank) => {
    rrf.set(id, (rrf.get(id) ?? 0) + BM25_WEIGHT / (rank + 1 + RRF_K));
  });

  // Step 1: rank passages by RRF (descending) and filter by cosine floor.
  const rankedPassages = Array.from(rrf.entries())
    .map(([i, rrfScore]) => ({
      i,
      rrfScore,
      cosineScore: cosineScores[i],
    }))
    .filter((x) => x.cosineScore >= minScore)
    .sort((a, b) => b.rrfScore - a.rrfScore);

  // Step 2: group by video. Each video's score = its BEST passage's RRF
  // score. This correctly identifies the most topically-relevant videos —
  // a video with one strong match outranks one with several weak matches.
  const perVideo = new Map<
    string,
    {
      video: StrapiVideo;
      bestRrf: number;
      passages: Array<{ i: number; rrfScore: number; cosineScore: number }>;
    }
  >();
  for (const r of rankedPassages) {
    const doc = flat[r.i].video.documentId;
    const entry = perVideo.get(doc);
    if (entry) {
      entry.passages.push(r);
    } else {
      perVideo.set(doc, {
        video: flat[r.i].video,
        bestRrf: r.rrfScore,
        passages: [r],
      });
    }
  }

  // Step 3: pick top-N videos by best-passage RRF. For each, keep their
  // top-M passages. Emit passages in the order videos are ranked, with
  // passages within a video ordered by RRF — the resulting [0], [1], [2]
  // assignment clusters by source, which Gemma reads naturally.
  const topVideos = Array.from(perVideo.values())
    .sort((a, b) => b.bestRrf - a.bestRrf)
    .slice(0, maxVideos);

  const result: RetrievedPassage[] = [];
  let idCounter = 0;
  for (const v of topVideos) {
    const chosen = v.passages.slice(0, passagesPerVideo);
    for (const p of chosen) {
      result.push({
        id: idCounter++,
        video: {
          documentId: flat[p.i].video.documentId,
          youtubeVideoId: flat[p.i].video.youtubeVideoId,
          videoTitle: flat[p.i].video.videoTitle,
          videoAuthor: flat[p.i].video.videoAuthor,
          videoThumbnailUrl: flat[p.i].video.videoThumbnailUrl,
          summaryDescription: flat[p.i].video.summaryDescription,
          summaryOverview: flat[p.i].video.summaryOverview,
          keyTakeaways: (flat[p.i].video.keyTakeaways ?? []).map((t) => ({
            text: t.text,
          })),
          tags: (flat[p.i].video.tags ?? []).map((t) => ({ name: t.name })),
        },
        text: flat[p.i].text,
        startSec: flat[p.i].startSec,
        endSec: flat[p.i].endSec,
        cosineScore: p.cosineScore,
        rrfScore: p.rrfScore,
      });
    }
  }

  return result;
}

// =============================================================================
// Prompts
// =============================================================================

export const ASK_LIBRARY_SYSTEM = [
  'You are answering questions from the user\'s personal YouTube knowledge base, using SUMMARY-FIRST retrieval.',
  '',
  'HOW CONTEXT IS DELIVERED:',
  '  Your initial context is a CANDIDATE VIDEOS block listing up to 5 videos ranked by relevance. Each card contains:',
  '   - The video\'s LLM-authored summary: description, overview paragraph, key takeaways, tags. This is the canonical "what this video covers" ground truth, written by a prior synthesis pass. PREFER it over raw transcript content.',
  '   - One anchor passage — the single most relevant transcript chunk for the query — with a numeric `[N]` citation index.',
  '  Additional passages from a video are available via `load_passages(youtubeVideoId)` — call it only when a claim genuinely needs a specific quote, number, or timestamp beyond the anchor.',
  '',
  'CITATION FORMATS (use both — pick the right one per claim):',
  ' • `[Video N]` — cite the whole candidate when the claim spans its overall content. N is the candidate rank (1 through 5).',
  '     Example: "The MCP spec defines tools, prompts, and resources as primitives [Video 1]."',
  ' • `[N]` — cite a specific transcript passage for quotes, numbers, or fine-grained detail.',
  '     Example: "The speaker calls sampling \'the hardest part\' [3]."',
  '',
  'CITATION FLOOR (REQUIRED — do not skip):',
  ' • EVERY answer MUST cite at least once per source video it draws on. An answer that describes video content with ZERO citations is a FAILURE — the citations are what make the chips clickable, and they\'re what the user scans the answer for.',
  ' • Specific factual claims — product names, model names, version numbers, quantitative figures, named procedures, speaker claims — MUST be cited. Even if the prose is casual, the facts need anchors.',
  ' • A good 2–3 paragraph answer typically carries 2–5 citations. Zero citations = broken answer.',
  '',
  'CITATION CEILING (don\'t overdo it):',
  ' • Do NOT append a bracket to every sentence. That\'s mechanical. A paragraph can carry one `[Video N]` at the end if it\'s describing one video\'s overall content, or place `[N]` after a specific quote/number. Don\'t re-cite the same source within the same paragraph unless the claim genuinely changes.',
  '',
  'TOOLS:',
  ' • `load_passages(youtubeVideoId)` — expand one candidate\'s additional transcript passages beyond its anchor. Use when a claim needs quote/timestamp-level evidence.',
  ' • `search_library(query)` — fresh retrieval for a subtopic the candidates don\'t cover, or the second side of a comparison.',
  ' • `get_video_details(youtubeVideoId)` — structured sections with timestamps. Rarely needed.',
  ' • `list_videos_by_topic(topic)` — topic listing when the user asks "what videos do I have about X".',
  '',
  'TOOL PROTOCOL:',
  ' 1. Read the candidate summaries. If they answer the question, ANSWER — do not call tools.',
  ' 2. Call `load_passages` ONCE for a specific candidate only when evidence at the passage level is genuinely needed.',
  ' 3. For comparison questions, you may call load_passages up to twice — once per side.',
  ' 4. Never call load_passages for all candidates. That defeats the purpose.',
  '',
  'DEFINITION RULE (read twice):',
  '  Prefer wording the summaries use — they were authored deliberately. If a summary calls Strapi a "headless CMS", say that, not "a system".',
  '  DO NOT invent acronym expansions. Use an expansion only if a summary or passage literally spells it out.',
  '  If no source defines an entity explicitly, describe what the sources show it DOING — do not assert what it "is".',
  '  NEVER write "X is a [system / framework / platform / tool]" unless a source uses that exact category word.',
  '',
  'SCOPE RULE:',
  '  BEFORE declaring "the library doesn\'t cover this", re-read the anchor passages on every candidate — answers often sit in the transcript even when a summary doesn\'t spell them out (e.g. biographical detail in a tutorial video). If an anchor contains the answer, CITE it with `[N]` and answer. Only declare "not covered" when neither the summaries nor the anchor passages address the question. If passages hint at the answer but stop short of detail, call load_passages once to confirm before giving up.',
  '',
  'STYLE — NATURAL, MEASURED, CLEAR:',
  '  You\'re a thoughtful person explaining what these videos said to someone who asked. Write the way an articulate professional would explain something to a colleague — clear, direct, a little warm, but NOT slangy, NOT gushing, NOT YouTube-bro voice.',
  '',
  '  DO:',
  '   • Write in natural prose with varied sentence length.',
  '   • Contractions are fine ("it\'s", "they\'re", "doesn\'t").',
  '   • Light connectives are fine: "In practice,", "One framing…, another…", "The catch is…", "What stands out is…".',
  '   • Quote a speaker\'s memorable short phrase when a passage offers one — it grounds the answer in real source voice.',
  '   • Weave videos together into one thread rather than summarizing each in turn.',
  '   • 2–3 paragraphs is ideal. One short paragraph is fine for a simple question.',
  '',
  '  DO NOT:',
  '   • Use slang: "dude", "bro", "gotta", "gonna", "kinda", "sorta", "literally" (as filler), "seriously", "insanely", "crazy".',
  '   • Use hype words: "game-changer", "mind-blowing", "next-level", "incredibly", "really impressive", "super powerful", "wild", "cool".',
  '   • Gush or exclaim: no "!", no "that\'s great", no "you\'re in luck", no "spoiler:", no "good news is".',
  '   • Open with filler: NEVER start with "The sources indicate", "Based on the available context", "According to the library", "The videos show that", "The library explains that", "Dude,", "Oh yeah,", "Yeah,". Just state the idea.',
  '   • Write bulleted lists or section headings. Prose only.',
  '   • Pad with "however, these related topics are discussed…" filler when the library doesn\'t cover the question. Say "the library doesn\'t cover this" in one short sentence and stop.',
  '   • Hedge or over-qualify. If sources disagree, name the disagreement directly.',
  '   • Repeat yourself across paragraphs.',
].join('\n');

// Group candidates by video in the same rank order they appear in the
// pool. Each entry's `indices` are the pre-assigned citation indices
// ([N]) for that video's passages. Used by the seed formatter and by
// the load_passages tool to return the right slice of the pool.
export type CandidateGroup = {
  rank: number; // 1-based
  video: RetrievedPassage['video'];
  passages: Array<{
    index: number;
    text: string;
    startSec: number;
    endSec: number;
  }>;
};

export function groupPassagesByVideo(
  passages: RetrievedPassage[],
): CandidateGroup[] {
  const order: string[] = [];
  const byDoc = new Map<string, CandidateGroup>();
  passages.forEach((p, i) => {
    const docId = p.video.documentId;
    let entry = byDoc.get(docId);
    if (!entry) {
      order.push(docId);
      entry = {
        rank: order.length,
        video: p.video,
        passages: [],
      };
      byDoc.set(docId, entry);
    }
    entry.passages.push({
      index: i,
      text: p.text,
      startSec: p.startSec,
      endSec: p.endSec,
    });
  });
  return order.map((d) => byDoc.get(d)!);
}

// Summary-first seed: emits one card per candidate video containing the
// LLM-authored summary (description + overview + takeaways + tags) plus
// the single best-RRF transcript passage as an anchor. The summary is
// the canonical "what this video covers" ground truth; the anchor is a
// topic-aligned quote the model can cite when a summary-level claim
// needs direct evidence. Additional passages are available via
// load_passages(youtubeVideoId) on demand.
//
// This parallels how the digest feature synthesizes over summary cards
// rather than transcript chunks — cleaner grounding, less hallucination
// footholds, more predictable output from Gemma.
export function formatSeedForPrompt(passages: RetrievedPassage[]): string {
  const groups = groupPassagesByVideo(passages);
  if (groups.length === 0) return '';

  const ANCHOR_COUNT = 3;
  const cards = groups.map((g) => {
    const title = g.video.videoTitle ?? g.video.youtubeVideoId;
    const authorPart = g.video.videoAuthor ? ` — ${g.video.videoAuthor}` : '';
    const anchors = g.passages.slice(0, ANCHOR_COUNT);
    const remaining = g.passages.length - anchors.length;

    const lines: string[] = [];
    lines.push(`### Video ${g.rank}: "${title}"${authorPart}`);
    lines.push(`youtubeVideoId: ${g.video.youtubeVideoId}`);
    if (g.video.summaryDescription) {
      lines.push(`Description: ${g.video.summaryDescription.trim()}`);
    }
    if (g.video.summaryOverview) {
      lines.push('');
      lines.push('Overview:');
      lines.push(g.video.summaryOverview.trim());
    }
    if (g.video.keyTakeaways.length > 0) {
      lines.push('');
      lines.push('Key takeaways:');
      for (const t of g.video.keyTakeaways.slice(0, 6)) {
        lines.push(`- ${t.text.trim()}`);
      }
    }
    if (g.video.tags.length > 0) {
      lines.push(`Tags: ${g.video.tags.map((t) => t.name).join(', ')}`);
    }
    if (anchors.length > 0) {
      lines.push('');
      lines.push(`Anchor passages (most-relevant transcript excerpts):`);
      for (const a of anchors) {
        lines.push('');
        lines.push(`[${a.index}] @ ${formatMmss(a.startSec)}: ${a.text.trim()}`);
      }
    }
    if (remaining > 0) {
      lines.push('');
      lines.push(
        `(${remaining} more passage${remaining === 1 ? '' : 's'} available via load_passages("${g.video.youtubeVideoId}"))`,
      );
    }
    return lines.join('\n');
  });

  return [
    `===== CANDIDATE VIDEOS (${groups.length}) =====`,
    '',
    'Each card shows a video\'s LLM-authored summary plus one anchor transcript passage. Answer from the summaries when you can; call load_passages(youtubeVideoId) only when a claim needs a specific quote, number, or timestamp beyond the anchor.',
    '',
    cards.join('\n\n'),
  ].join('\n');
}

function formatMmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}:${String(rest).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

// `tokenize` re-export — used by clients that want to extract tokens
// without pulling transcript.ts directly.
export { tokenize };
