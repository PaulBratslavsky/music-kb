import { createFileRoute } from '@tanstack/react-router';
import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import {
  ASK_LIBRARY_SYSTEM,
  formatSeedForPrompt,
  retrievePassagesForQuery,
  type RetrievedPassage,
} from '#/lib/services/ask-library';
import { buildLibraryTools } from '#/lib/services/library-tools';
import { OLLAMA_HOST, OLLAMA_SYNTHESIS_MODEL as CHAT_MODEL } from '#/lib/env';

// Streaming library-QA endpoint. Parallels /api/chat in shape:
//   - AG-UI style SSE (TEXT_MESSAGE_CONTENT + [DONE])
//   - Custom `data: {"type":"CITATIONS",...}` pre-stream event carrying
//     the retrieved passage metadata so the client can render clickable
//     citation chips as soon as [N] markers appear in the streamed text.
//
// The client reads the CITATIONS frame first, then accumulates text
// deltas. Chips resolve to { video, startSec, text } by passage index.

type CitationPayload = {
  index: number;
  videoDocumentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
  startSec: number;
  endSec: number;
  text: string;
};

function toCitationPayload(p: RetrievedPassage, i: number): CitationPayload {
  return {
    index: i,
    videoDocumentId: p.video.documentId,
    youtubeVideoId: p.video.youtubeVideoId,
    videoTitle: p.video.videoTitle,
    videoAuthor: p.video.videoAuthor,
    videoThumbnailUrl: p.video.videoThumbnailUrl,
    startSec: p.startSec,
    endSec: p.endSec,
    text: p.text,
  };
}

export const Route = createFileRoute('/api/ask')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { question?: string };
        try {
          body = await request.json();
        } catch {
          return new Response('Invalid JSON body', { status: 400 });
        }
        const question = body.question?.trim();
        if (!question || question.length > 1000) {
          return new Response('question required (1–1000 chars)', {
            status: 400,
          });
        }

        // Retrieve up to 25 passages across top 5 videos. Seed shows
        // the top 3 per video; the extra 2 stay available via
        // load_passages so progressive expansion still has unseen
        // material to reveal on demand.
        let passages: RetrievedPassage[];
        try {
          passages = await retrievePassagesForQuery(question, {
            maxVideos: 5,
            passagesPerVideo: 5,
            minScore: 0.35,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'retrieval failed';
          return new Response(`retrieval failed: ${msg}`, { status: 500 });
        }

        if (passages.length === 0) {
          // Short-circuit: no passages means nothing to synthesize from.
          // Send a single response saying so. Still via SSE so the
          // client code path is uniform.
          const body = [
            `data: ${JSON.stringify({ type: 'CITATIONS', citations: [] })}\n\n`,
            `data: ${JSON.stringify({
              type: 'TEXT_MESSAGE_CONTENT',
              messageId: 'ask-empty',
              delta:
                "I couldn't find anything in your library that matches this question. Try rephrasing, or add more videos that cover the topic.",
            })}\n\n`,
            'data: [DONE]\n\n',
          ].join('');
          return new Response(body, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          });
        }

        const uniqueVideoCount = new Set(
          passages.map((p) => p.video.documentId),
        ).size;
        // Pool = retrieval output (all candidates available for load_passages).
        // Seed = what actually lands in the initial prompt. formatSeedForPrompt
        // shows up to SEED_ANCHORS_PER_VIDEO top passages per video; videos
        // with fewer candidate passages contribute fewer anchors.
        const SEED_ANCHORS_PER_VIDEO = 3;
        const perVideoCount = new Map<string, number>();
        let seedAnchors = 0;
        for (const p of passages) {
          const seen = perVideoCount.get(p.video.documentId) ?? 0;
          if (seen < SEED_ANCHORS_PER_VIDEO) seedAnchors++;
          perVideoCount.set(p.video.documentId, seen + 1);
        }
        console.log(
          `[${new Date().toISOString().slice(11, 23)}] [ask/${CHAT_MODEL}] "${question}" → pool: ${uniqueVideoCount} videos / ${passages.length} passages · seed: ${seedAnchors} anchors → synthesizing`,
        );

        const userPrompt = [
          `Question: ${question}`,
          '',
          formatSeedForPrompt(passages),
        ].join('\n');

        const adapter = createOllamaChat(CHAT_MODEL, OLLAMA_HOST);
        // Progressive retrieval: the model only sees #1 candidate's
        // passages up-front. The `load_passages` tool (built per-request
        // with the pool closed over) lets it expand to any of the 4
        // remaining candidates. `search_library`, `get_video_details`,
        // `list_videos_by_topic` stay as escape hatches.
        //
        // Reliability caveat: Gemma 4B tool-calling is probabilistic.
        // The #1-candidate passages are the safety net — even if the
        // model never calls load_passages, the answer is grounded in
        // the single best source.
        const tools = buildLibraryTools({ pool: passages });
        const stream = chat({
          adapter,
          messages: [
            { role: 'system', content: ASK_LIBRARY_SYSTEM },
            { role: 'user', content: userPrompt },
          ] as never,
          tools,
          temperature: 0.4,
        });

        // Build a combined stream: one CITATIONS frame up front, then
        // the normal chat SSE stream. Both follow the AG-UI-ish shape
        // the client already knows from /api/chat. The `model` field is
        // informational — the client UI ignores it, but the eval
        // harness captures it so reports record which model answered.
        const citationsFrame = `data: ${JSON.stringify({
          type: 'CITATIONS',
          citations: passages.map(toCitationPayload),
          model: CHAT_MODEL,
        })}\n\n`;

        const baseResponse = toServerSentEventsResponse(stream);
        const baseReader = baseResponse.body!.getReader();
        const encoder = new TextEncoder();

        const combined = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode(citationsFrame));
            try {
              while (true) {
                const { value, done } = await baseReader.read();
                if (done) break;
                controller.enqueue(value);
              }
            } finally {
              controller.close();
            }
          },
        });

        return new Response(combined, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      },
    },
  },
});
