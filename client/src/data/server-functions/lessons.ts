import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  getLessonBySlugWithStatus,
  listLessonsService,
  type LessonResult,
  type LessonSummary,
} from '#/lib/services/lessons';

const SlugSchema = z.object({ slug: z.string().min(1).max(120) });

export const listLessons = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LessonSummary[]> => listLessonsService(),
);

export const getLessonBySlug = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof SlugSchema>) => SlugSchema.parse(data))
  .handler(async ({ data }): Promise<LessonResult> =>
    getLessonBySlugWithStatus(data.slug),
  );
