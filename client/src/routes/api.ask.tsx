import { createFileRoute } from '@tanstack/react-router';
import {
  chat,
  chatParamsFromRequestBody,
  toServerSentEventsResponse,
} from '@tanstack/ai';
import {
  ASK_LIBRARY_SYSTEM,
  formatSeedForPrompt,
  retrievePassagesForQuery,
  type RetrievedPassage,
} from '#/lib/services/ask-library';
import { buildLibraryTools } from '#/lib/services/library-tools';
import { resolveRequestModel, withSystem } from '#/lib/services/chat-model-request';
import { withFriendlyErrors } from '#/lib/services/stream-errors';
import { condenseQuestion, sanitizeHistory } from '#/lib/services/condense-question';
import type { Citation } from '#/lib/services/citations';
// Prior turns are flattened to role+text here, as they always were — this
// surface seeds its own final user turn from retrieved passages, so no tool
// calls survive into the model messages and no orphan guard is needed.
import { latestUserText, messageText } from '#/lib/services/ui-message';

// Streaming library-QA endpoint. Parallels /api/chat in shape:
//   - AG-UI style SSE (TEXT_MESSAGE_CONTENT + [DONE])
//   - Custom `data: {"type":"CITATIONS",...}` pre-stream event carrying
//     the retrieved passage metadata so the client can render clickable
//     citation chips as soon as [N] markers appear in the streamed text.
//
// The client reads the CITATIONS frame first, then accumulates text
// deltas. Chips resolve to { video, startSec, text } by passage index.


function toCitation(p: RetrievedPassage, i: number): Citation {
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

/**
 * POST /api/ask — retrieval-augmented answer over the library.
 *
 * Exported separately from the route so it can be exercised directly in
 * tests, matching `lessonPlanHandler`. The route below is a one-line
 * delegation.
 */
export async function askHandler(request: Request): Promise<Response> {
  // AG-UI RunAgentInput, like the other two chat routes — which is what lets
  // this surface use the shared <Chat> component. The multi-turn history that
  // used to arrive in a bespoke `history` field, and be re-validated by a
  // hand-written sanitiser, is now just the message array the SDK validates.
  let params: Awaited<ReturnType<typeof chatParamsFromRequestBody>>;
  try {
    params = await chatParamsFromRequestBody(await request.json());
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'invalid body';
    return new Response(`Invalid AG-UI request body: ${detail}`, { status: 400 });
  }

  const forwarded = params.forwardedProps as { modelChoice?: unknown };
  const modelChoice =
    typeof forwarded.modelChoice === 'string' ? forwarded.modelChoice : undefined;

  const question = latestUserText(params.messages);
  if (!question || question.length > 1000) {
    return new Response('question required (1–1000 chars)', {
      status: 400,
    });
  }

  // Prior turns: everything before the question being asked, flattened to
  // role+text. The condenser wants topic, not structure, and this surface
  // seeds its own final user turn from retrieved passages.
  //
  // Still routed through sanitizeHistory even though the SDK has already
  // validated the message SHAPE. Shape is not the same as size: these turns
  // are replayed to the answering model, and sanitizeHistory is what bounds
  // them — newest four, 2000 characters each. Inlining a `.slice(-4)` here
  // silently dropped the per-turn cap.
  const history = sanitizeHistory(
    params.messages.map((m) => ({
      role: (m as { role?: string }).role,
      content: messageText(m).trim(),
    })).slice(0, -1),
  );

  // Retrieve against a STANDALONE query, not the raw follow-up.
  // "tell me more about the second one" contains none of the words that
  // would find the passages it refers to. Condensation resolves the
  // reference using history; it fails open to `question`, so a broken or
  // slow condenser degrades to the pre-multi-turn behaviour.
  //
  // The catch is deliberate belt-and-braces across a module boundary:
  // condenseQuestion already fails open internally, but this is an OPTIONAL
  // enhancement to the ask, and no future change to it should be able to turn
  // a working question into a 500.
  const { query: retrievalQuery, condensed } = await condenseQuestion(
    question,
    history,
  ).catch(() => ({ query: question, condensed: false }));
  if (condensed) {
    console.log(
      `[${new Date().toISOString().slice(11, 23)}] [ask] condensed "${question}" → "${retrievalQuery}"`,
    );
  }

  // Retrieve up to 25 passages across top 5 videos. Seed shows
  // the top 3 per video; the extra 2 stay available via
  // load_passages so progressive expansion still has unseen
  // material to reveal on demand.
  let passages: RetrievedPassage[];
  try {
    passages = await retrievePassagesForQuery(retrievalQuery, {
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
  // Resolved once, above the log line, so the `[ask/<model>]` tag, the
  // CITATIONS frame's `model:` field (which the eval harness records)
  // and the adapter are all one read of the policy. There used to be
  // three independent reads of OLLAMA_SYNTHESIS_MODEL here.
  const { model, notice } = await resolveRequestModel(
    'library-ask',
    modelChoice,
  );
  if (notice) console.warn(`[ask] ${notice}`);
  console.log(
    `[${new Date().toISOString().slice(11, 23)}] [ask/${model.model}] "${question}" → pool: ${uniqueVideoCount} videos / ${passages.length} passages · seed: ${seedAnchors} anchors → synthesizing`,
  );

  const userPrompt = [
    `Question: ${question}`,
    '',
    formatSeedForPrompt(passages),
  ].join('\n');

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
    adapter: model.adapter,
    // History first, then the seeded turn. The model answers the
    // ORIGINAL question (userPrompt), not the condensed query — the
    // rewrite exists to find passages, not to replace what was asked.
    ...withSystem(model, ASK_LIBRARY_SYSTEM, [
      ...history,
      { role: 'user', content: userPrompt },
    ]),
    tools,
    modelOptions: model.modelOptions(0.4),
  });

  // Build a combined stream: one CITATIONS frame up front, then
  // the normal chat SSE stream. Both follow the AG-UI-ish shape
  // the client already knows from /api/chat. The `model` field is
  // informational — the client UI ignores it, but the eval
  // harness captures it so reports record which model answered.
  const citationsFrame = `data: ${JSON.stringify({
    type: 'CITATIONS',
    citations: passages.map(toCitation),
    model: model.model,
  })}\n\n`;

  // See api.chat.tsx — tier-correct error translation, server-side.
  const baseResponse = toServerSentEventsResponse(
    withFriendlyErrors(model, stream, 'ask'),
  );
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
        controller.close();
      } catch (err) {
        // NOT `finally { close() }`. A closed stream cannot then transition to
        // errored, so closing on the way out of a rejected read swallows the
        // failure: the client sees a truncated body with no error frame and no
        // [DONE], and the message withFriendlyErrors just produced is lost —
        // the exact silent failure this route's error translation exists to
        // prevent.
        controller.error(err);
      }
    },
    async cancel(reason) {
      // The browser aborted the ask. Without this the upstream model run keeps
      // generating to completion, holding a connection nobody is reading.
      await baseReader.cancel(reason);
    },
  });

  return new Response(combined, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export const Route = createFileRoute('/api/ask')({
  server: {
    handlers: {
      POST: ({ request }) => askHandler(request),
    },
  },
});