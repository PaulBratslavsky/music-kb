import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the Ollama-facing surfaces at module level. `chat` is the only
// network-touching call inside the module under test; mocking it lets us
// drive rewrite scenarios deterministically. `createOllamaChat` is mocked
// because it's invoked at module load — without the stub the test would
// either need a live Ollama or import-time failure handling.
vi.mock('@tanstack/ai', () => ({
  chat: vi.fn(),
}));
vi.mock('@tanstack/ai-ollama', () => ({
  createOllamaChat: vi.fn(() => ({})),
}));

import { chat } from '@tanstack/ai';
import {
  buildBM25Index,
  type BM25Index,
  type TranscriptChunk,
} from './transcript';
import {
  getChatEvidence,
  getChatEvidenceForVideo,
  rewriteQuery,
} from './chat-retrieval';
import type { StrapiVideo } from './videos';

const mockedChat = vi.mocked(chat);

beforeEach(() => {
  mockedChat.mockReset();
});

// BM25 has a `BM25_MIN_QUERY_IDF = 1.5` query-term floor (transcript.ts).
// With a tiny corpus every term scores below the floor and the filter
// strips them all → empty results. To exercise real ranking we need a
// big-enough corpus that the target terms (MCP, workflow, OAuth) clear
// the floor while still appearing in only one chunk each.
function makeIndex(): BM25Index {
  const targetChunks: TranscriptChunk[] = [
    { id: 0, text: 'introduction to the new MCP server we are building today', startWord: 0, timeSec: 0 },
    { id: 1, text: 'workflow automation with drag and drop nodes for editorial flow', startWord: 10, timeSec: 60 },
    { id: 2, text: 'OAuth authentication and two-factor support replace users plugin', startWord: 20, timeSec: 120 },
  ];
  // Filler chunks raise the corpus size so target terms get high IDF.
  // They share generic vocabulary among themselves so common words stay
  // common; none of them mention MCP, workflow, or OAuth.
  const filler: TranscriptChunk[] = Array.from({ length: 12 }, (_, i) => ({
    id: 3 + i,
    text: `generic content chunk number ${i} with assorted prose unrelated to any specific topic`,
    startWord: 30 + i * 10,
    timeSec: 180 + i * 30,
  }));
  return buildBM25Index([...targetChunks, ...filler]);
}

describe('rewriteQuery', () => {
  it('returns [] for empty input without calling the model', async () => {
    const result = await rewriteQuery('vid', '');
    expect(result).toEqual([]);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('skips rewriting for very short queries (< 4 chars)', async () => {
    const result = await rewriteQuery('vid', 'hi');
    expect(result).toEqual(['hi']);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('skips rewriting for very long queries (> 400 chars)', async () => {
    const long = 'a'.repeat(401);
    const result = await rewriteQuery('vid', long);
    expect(result).toEqual([long]);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('returns original + parsed rewrites on success', async () => {
    mockedChat.mockResolvedValueOnce(
      'how does the MCP server work\nMCP server functionality\nwhat does MCP do',
    );
    const result = await rewriteQuery('vid', 'what is the MCP server');
    expect(result[0]).toBe('what is the MCP server');
    expect(result.slice(1)).toEqual([
      'how does the MCP server work',
      'MCP server functionality',
      'what does MCP do',
    ]);
  });

  it('strips bullet/quote noise from the model output', async () => {
    mockedChat.mockResolvedValueOnce(
      '1. "how does the MCP server work"\n- MCP server functionality\n• what does MCP do',
    );
    const result = await rewriteQuery('vid', 'what is the MCP server');
    expect(result.slice(1)).toEqual([
      'how does the MCP server work',
      'MCP server functionality',
      'what does MCP do',
    ]);
  });

  it('falls back to original query alone on rewrite failure', async () => {
    mockedChat.mockRejectedValue(new Error('Ollama unreachable'));
    const result = await rewriteQuery('vid', 'what is the MCP server');
    expect(result).toEqual(['what is the MCP server']);
  });
});

describe('getChatEvidence', () => {
  it('returns [] for empty query without calling the model', async () => {
    const index = makeIndex();
    const result = await getChatEvidence(index, '');
    expect(result).toEqual([]);
    expect(mockedChat).not.toHaveBeenCalled();
  });

  it('uses single-query BM25 when query is too short to rewrite', async () => {
    const index = makeIndex();
    const result = await getChatEvidence(index, 'MCP');
    expect(mockedChat).not.toHaveBeenCalled();
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe(0); // chunk mentioning MCP server
  });

  it('uses multi-query fusion when rewrites are returned', async () => {
    mockedChat.mockResolvedValueOnce(
      'workflow automation tools\nautomation drag drop nodes\neditorial flow nodes',
    );
    const index = makeIndex();
    const result = await getChatEvidence(index, 'tell me about workflows');
    expect(mockedChat).toHaveBeenCalledTimes(1);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe(1); // workflow/automation chunk
  });

  it('falls back to single-query retrieval when rewrite throws', async () => {
    mockedChat.mockRejectedValue(new Error('Ollama down'));
    const index = makeIndex();
    const result = await getChatEvidence(index, 'tell me about OAuth');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe(2); // OAuth chunk
  });
});

describe('getChatEvidenceForVideo', () => {
  function makeVideo(transcriptSegments: unknown): StrapiVideo {
    return {
      youtubeVideoId: 'abc',
      transcriptSegments,
    } as unknown as StrapiVideo;
  }

  it('returns [] when transcriptSegments is missing', async () => {
    const result = await getChatEvidenceForVideo(makeVideo(null), 'query');
    expect(result).toEqual([]);
  });

  it('returns [] when transcriptSegments is not a stored index', async () => {
    const result = await getChatEvidenceForVideo(
      makeVideo({ legacyShape: true }),
      'query',
    );
    expect(result).toEqual([]);
  });

  it('delegates to the deep primitive when index is valid', async () => {
    const index = makeIndex();
    const result = await getChatEvidenceForVideo(
      makeVideo({ version: 1, bm25: index }),
      'MCP',
    );
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe(0);
  });
});
