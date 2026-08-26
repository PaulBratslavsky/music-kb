import { createFileRoute } from '@tanstack/react-router';
import {
  planLesson,
  type LessonOutline,
  type LessonProgressEvent,
  type SourceVideo,
} from '#/lib/services/lesson-generation';
import type { Digest } from '#/lib/services/digest';
import type { ModelTier } from '#/lib/services/model-policy';

// Phase 1 of streamed lesson generation — POST /api/lesson-plan.
//
// Runs planLesson() (resolve tier → retrieve → coverage → digest →
// outline), streaming every LessonProgressEvent it emits as an SSE frame
// `data: <json>\n\n`, same wire shape as /api/chat and /api/ask. The final
// frame — `{ type: 'plan', outline, sources, digest, tier, model }` — is
// this route's own addition on top of planLesson's progress events: it's
// everything phase 2 (`/api/lesson-write`) needs to resume, round-tripped
// through the browser so the user can review/edit the outline first. No
// server-side job store — the client just POSTs this payload (possibly
// edited) back to /api/lesson-write.
//
// A `covered: false` coverage verdict or any other `ok: false` outcome is
// NOT re-signaled here — planLesson already emitted a terminal `coverage`
// or `error` event via onProgress for every failure path; this route only
// adds the success-only `plan` frame.

type PlanRequestBody = { topic?: unknown; maxVideos?: unknown };

// This route's own terminal frame — not part of LessonProgressEvent (which
// is planLesson's internal progress vocabulary) because it carries the
// FULL round-trippable payload phase 2 needs, not a progress summary.
export type LessonPlanFrame =
  | LessonProgressEvent
  | {
      type: 'plan';
      outline: LessonOutline;
      sources: SourceVideo[];
      digest: Digest;
      tier: ModelTier;
      model: string;
    };

function sseFrame(event: LessonPlanFrame): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function lessonPlanHandler(request: Request): Promise<Response> {
  let body: PlanRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (!topic || topic.length > 200) {
    return new Response('topic required (1–200 chars)', { status: 400 });
  }
  const maxVideos =
    typeof body.maxVideos === 'number' && body.maxVideos > 0 ? body.maxVideos : undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: LessonPlanFrame) => controller.enqueue(sseFrame(event));
      try {
        const result = await planLesson({ topic, maxVideos }, send);
        if (result.ok) {
          send({
            type: 'plan',
            outline: result.outline,
            sources: result.sources,
            digest: result.digest,
            tier: result.tier,
            model: result.model,
          });
        }
        // ok: false — planLesson already emitted a terminal `coverage` or
        // `error` event via onProgress. Nothing further to send.
      } catch (err) {
        // Defensive: planLesson is designed to never throw (every failure
        // path returns { ok: false }), but a truly unexpected exception
        // must still reach the client as a visible frame, not a silently
        // truncated stream.
        send({
          type: 'error',
          step: 'unknown',
          message: err instanceof Error ? err.message : 'Lesson planning failed unexpectedly.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export const Route = createFileRoute('/api/lesson-plan')({
  server: {
    handlers: {
      POST: ({ request }) => lessonPlanHandler(request),
    },
  },
});
