import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  getLessonBySlugWithStatus,
  listLessonsWithStatus,
  type LessonListResult,
  type LessonResult,
} from '#/lib/services/lessons';

const SlugSchema = z.object({ slug: z.string().min(1).max(120) });

export const listLessons = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LessonListResult> => listLessonsWithStatus(),
);

export const getLessonBySlug = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof SlugSchema>) => SlugSchema.parse(data))
  .handler(async ({ data }): Promise<LessonResult> =>
    getLessonBySlugWithStatus(data.slug),
  );
