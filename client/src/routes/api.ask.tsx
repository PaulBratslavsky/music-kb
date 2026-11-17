import { createFileRoute } from '@tanstack/react-router';
import {
  chat,
  chatParamsFromRequest,
  toServerSentEventsResponse,
  type ChatMiddleware,
} from '@tanstack/ai';
import {
  ASK_LIBRARY_SYSTEM,
  formatSeedForPrompt,
  retrievePassagesForQuery,
  type RetrievedPassage,
} from '#/lib/services/ask-library';
import { buildLoadPassagesTool } from '#/lib/services/library-tools';
import { closeAfter, loadStrapiTools } from '#/lib/services/strapi-mcp-tools';
import { resolveRequestModel } from '#/lib/services/chat-model-request';
import { withFriendlyErrors } from '#/lib/services/stream-errors';
import { emptyAnswerResponse } from '#/lib/services/ask-empty-answer';
import { condenseQuestion, sanitizeHistory } from '#/lib/services/condense-question';
import {
  CITATIONS_EVENT,
  type Citation,
  type CitationsEventValue,
} from '#/lib/services/citations';
// Prior turns are flattened to role+text here, as they always were — this
// surface seeds its own final user turn from retrieved passages, so no tool
// calls survive into the model messages and no orphan guard is needed.
import { latestUserText, messageText } from '#/lib/services/ui-message';

// Streaming library-QA endpoint. Same AG-UI SSE stream as /api/chat, plus one
// CUSTOM event per assistant message:
//
//   data: {"type":"CUSTOM","name":"library-ask:citations",
//          "value":{"messageId":"msg-…","citations":[…],"model":"…"}}
//
// The route retrieves passages before the model writes, so the citations are
// known before the answer starts. A chat middleware emits them right after the
// TEXT_MESSAGE_START of each assistant message, with that message's id, and
// LibraryChat reads them with `onCustomEvent`.
// Chips resolve to { video, startSec, text } by passage index.

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
  // chatParamsFromRequest throws a 400 Response on a bad body; TanStack Start
  // returns that Response as-is.
  const params = await chatParamsFromRequest(request);

  const forwarded = params.forwardedProps;
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
    // Nothing to synthesize from. Answered as an ordinary one-message run, so
    // it gets a fresh message id — see ask-empty-answer.ts for why a fixed id
    // merged consecutive no-match answers into one bubble (issue #8).
    return emptyAnswerResponse(params);
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
  // citations event's `model:` field (which the eval harness records)
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
  // remaining candidates. It is the one tool this app defines itself.
  //
  // The other tools are Strapi's library tools. Strapi defines each one
  // once, on its MCP server, and this route loads them over MCP: the same
  // tools Claude Code and Claude Desktop call. They are escape hatches for
  // work off the candidate list. Without a token, or with Strapi's MCP
  // server down, `strapi.tools` is empty and the chat still answers.
  //
  // Reliability caveat: small local models call tools probabilistically.
  // The #1-candidate passages are the safety net — even if the
  // model never calls a tool, the answer is grounded in
  // the single best source.
  const strapi = await loadStrapiTools();
  const tools = [buildLoadPassagesTool(passages), ...strapi.tools];
  const citations = passages.map(toCitation);

  // Sends the citations to the client as an AG-UI CUSTOM event (TanStack AI
  // docs: Custom Events, "Emit from chat middleware"). The event names the
  // assistant message the citations ground, so the client can store them under
  // that message's id.
  //
  // The id comes from the TEXT_MESSAGE_START chunk, because that chunk's
  // `messageId` is the id the client gives the message. The `messageId` that
  // `onIteration` receives is NOT that id with the Ollama adapter: measured
  // live, the adapter opens its text message under an id of its own. A turn
  // where the model calls `load_passages` and then answers writes its text in
  // a later message, and that message gets its own event.
  const sendCitations: ChatMiddleware = {
    name: 'send-citations',
    onChunk: (ctx, chunk) => {
      if (chunk.type !== 'TEXT_MESSAGE_START') return;
      const value: CitationsEventValue = {
        messageId: chunk.messageId,
        citations,
        model: model.model,
      };
      ctx.emitCustomEvent(CITATIONS_EVENT, value);
    },
  };

  const stream = chat({
    adapter: model.adapter,
    // History first, then the seeded turn. The model answers the
    // ORIGINAL question (userPrompt), not the condensed query — the
    // rewrite exists to find passages, not to replace what was asked.
    messages: [...history, { role: 'user', content: userPrompt }],
    threadId: params.threadId,
    runId: params.runId,
    systemPrompts: [ASK_LIBRARY_SYSTEM],
    tools,
    modelOptions: model.modelOptions(0.4),
    middleware: [sendCitations],
  });

  // See api.chat.tsx — tier-correct error translation, server-side.
  // closeAfter closes the MCP connection when the run ends, fails or is
  // cancelled.
  return toServerSentEventsResponse(
    closeAfter(withFriendlyErrors(model, stream, 'ask'), strapi.close),
  );
}

export const Route = createFileRoute('/api/ask')({
  server: {
    handlers: {
      POST: ({ request }) => askHandler(request),
    },
  },
});