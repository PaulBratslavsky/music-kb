import { createFileRoute } from '@tanstack/react-router';
import { NO_DIGEST, planSingleVideoLesson } from '#/lib/services/lesson-generation';
import type { LessonPlanFrame } from '#/routes/api.lesson-plan';

// Phase 1 of streamed lesson generation, for ONE video — POST
// /api/lesson-plan-video. The single-video sibling of /api/lesson-plan:
// same SSE wire shape (LessonProgressEvent frames, then a terminal `plan`
// frame), same LessonPlanFrame type, so the browser's existing
// streamLessonPlanSSE parser and the EXISTING /api/lesson-write route both
// work unchanged — only what plans the outline differs (see
// planSingleVideoLesson's header comment in lesson-generation.ts).
//
// `sources` is always a one-element array and `digest` is always
// NO_DIGEST — the write phase does not need to know this was a
// single-video generation; it only sees a lesson plan with one source and
// an empty digest, which it already handles correctly (no cross-video
// contradiction callouts get appended, since NO_DIGEST.contradictions is
// empty).

type PlanVideoRequestBody = { videoId?: unknown };

function sseFrame(event: LessonPlanFrame): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function lessonPlanVideoHandler(request: Request): Promise<Response> {
  let body: PlanVideoRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : '';
  if (!videoId || videoId.length > 64) {
    return new Response('videoId required (1–64 chars)', { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: LessonPlanFrame) => controller.enqueue(sseFrame(event));
      try {
        const result = await planSingleVideoLesson({ videoId }, send);
        if (result.ok) {
          send({
            type: 'plan',
            outline: result.outline,
            sources: [result.source],
            digest: NO_DIGEST,
            tier: result.tier,
            model: result.model,
          });
        }
        // ok: false — planSingleVideoLesson already emitted a terminal
        // `error` event via onProgress. Nothing further to send.
      } catch (err) {
        // Defensive: planSingleVideoLesson is designed to never throw
        // (every failure path returns { ok: false }), but a truly
        // unexpected exception must still reach the client as a visible
        // frame, not a silently truncated stream.
        send({
          type: 'error',
          step: 'unknown',
          message:
            err instanceof Error ? err.message : 'Lesson planning failed unexpectedly.',
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

export const Route = createFileRoute('/api/lesson-plan-video')({
  server: {
    handlers: {
      POST: ({ request }) => lessonPlanVideoHandler(request),
    },
  },
});
