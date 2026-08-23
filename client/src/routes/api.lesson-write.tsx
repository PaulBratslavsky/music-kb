import { createFileRoute } from '@tanstack/react-router';
import { writeLesson, type LessonProgressEvent, type WriteLessonInput } from '#/lib/services/lesson-generation';
import { saveLessonService } from '#/lib/services/lessons';

// Phase 2 of streamed lesson generation — POST /api/lesson-write.
//
// Body: `{ topic, outline, sources, digest }` — whatever /api/lesson-plan
// returned, possibly with the outline's title/section headings edited by
// the user in the browser. Stateless: writeLesson() re-validates this
// payload rather than trusting it (see LessonOutlineInputSchema in
// lesson-generation.ts) — it has been through the browser.
//
// Runs per-section generation → BM25 grounding → assembly (writeLesson),
// then persists via saveLessonService — persistence is deliberately NOT
// writeLesson's job (see that module's header comment), so this route is
// the one place phase 2 both generates AND saves. The final frame is
// `{ type: 'saved', slug, title, blockCount, tier, model }`.
//
// Every failure path in writeLesson (malformed input, model failure, every
// section failing) already emits a terminal `error` progress event via
// onProgress — this route only adds an `error` frame of its own for a save
// failure, which is outside writeLesson's remit.

function sseFrame(event: LessonProgressEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function lessonWriteHandler(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return new Response('JSON object body required', { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: LessonProgressEvent) => controller.enqueue(sseFrame(event));
      try {
        // writeLesson treats this as fully untrusted content, not just an
        // untrusted shape — see LessonOutlineInputSchema/WriteLessonRequestSchema
        // in lesson-generation.ts. The cast here is only a TS hint; runtime
        // safety comes from that schema's `.safeParse`.
        const result = await writeLesson(body as WriteLessonInput, send);
        if (!result.ok) {
          // writeLesson already emitted a terminal `error` event for every
          // failure path. Nothing further to send.
          return;
        }

        const saved = await saveLessonService(result.lesson);
        if (!saved.ok) {
          // A half-generated-but-unsaved lesson must surface loudly, not
          // vanish — never swallow this.
          send({ type: 'error', step: 'saved', message: saved.error });
          return;
        }

        send({
          type: 'saved',
          slug: saved.slug,
          title: result.lesson.title,
          blockCount: result.lesson.body.length,
          tier: result.tier,
          model: result.model,
        });
      } catch (err) {
        // Defensive: writeLesson is designed to never throw. See the same
        // comment in api.lesson-plan.tsx.
        send({
          type: 'error',
          step: 'unknown',
          message: err instanceof Error ? err.message : 'Lesson writing failed unexpectedly.',
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

export const Route = createFileRoute('/api/lesson-write')({
  server: {
    handlers: {
      POST: ({ request }) => lessonWriteHandler(request),
    },
  },
});
