// Server function for in-app AI lesson generation. Composes the two
// pieces that already exist and stay unchanged here:
//   - generateLesson() (lesson-generation.ts) — retrieval, digest,
//     staged model calls, BM25-grounded citations, assembly
//   - saveLessonService() (lessons.ts) — slug-deduped Strapi persistence
//
// This file owns none of that logic — it only validates input, calls the
// two services in sequence, and shapes a browser-safe result. In
// particular, `resolveLessonModel()` (lesson-model.ts) reads
// ANTHROPIC_API_KEY server-side and closes over it inside the constructed
// adapter; that key is never part of `GenerateLessonResult`,
// `SaveLessonResult`, or this function's return type, so there is nothing
// here that could leak it to the browser.

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { generateLesson, type SourceVideo } from '#/lib/services/lesson-generation';
import { saveLessonService } from '#/lib/services/lessons';
import type { ModelTier } from '#/lib/services/lesson-model';

export const GenerateLessonSchema = z.object({
  topic: z.string().trim().min(1, 'Topic is required.').max(200),
});

export type GenerateLessonUiResult =
  | {
      ok: true;
      slug: string;
      title: string;
      tier: ModelTier;
      model: string;
      blockCount: number;
      sources: SourceVideo[];
    }
  | { ok: false; error: string };

// The actual business logic, factored out of the createServerFn handler so
// it's callable directly in tests — `createServerFn`'s wrapper requires a
// live Start request context (AsyncLocalStorage) that only exists inside
// the real server runtime, so this is also the shape every other server
// function in this directory follows: thin handler, logic in a plain
// function/service.
export async function generateAndSaveLessonLogic(
  topic: string,
): Promise<GenerateLessonUiResult> {
  const generated = await generateLesson({ topic });
  if (!generated.ok) {
    // Covers both real failures and the legitimate "nothing above the
    // relevance floor" outcome — the caller (UI) is responsible for
    // presenting the latter as information, not an error state; this
    // function does not distinguish the two, since generateLesson()
    // already returns a friendly, ready-to-show message either way.
    return { ok: false, error: generated.error };
  }

  const saved = await saveLessonService(generated.lesson);
  if (!saved.ok) {
    // A half-generated-but-unsaved lesson must surface loudly, not
    // vanish — never swallow this.
    return { ok: false, error: saved.error };
  }

  // Built field-by-field, never a spread of `generated`/`saved` — so a
  // stray property either object might carry (there is none today, but
  // nothing here depends on that staying true) can't leak into the
  // browser-bound payload by accident.
  return {
    ok: true,
    slug: saved.slug,
    title: generated.lesson.title,
    tier: generated.tier,
    model: generated.model,
    blockCount: generated.lesson.body.length,
    sources: generated.sources,
  };
}

export const generateAndSaveLesson = createServerFn({ method: 'POST' })
  .validator((data: z.input<typeof GenerateLessonSchema>) =>
    GenerateLessonSchema.parse(data),
  )
  .handler(async ({ data }): Promise<GenerateLessonUiResult> =>
    generateAndSaveLessonLogic(data.topic),
  );
