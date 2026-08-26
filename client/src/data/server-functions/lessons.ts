import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  findLessonForVideoService,
  getLessonBySlugWithStatus,
  listLessonsWithStatus,
  type LessonForVideo,
  type LessonListResult,
  type LessonResult,
} from '#/lib/services/lessons';

const SlugSchema = z.object({ slug: z.string().min(1).max(120) });

const VideoIdsSchema = z.object({
  documentId: z.string().min(1).max(64),
  youtubeVideoId: z.string().min(1).max(64),
});

export const listLessons = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LessonListResult> => listLessonsWithStatus(),
);

export const getLessonBySlug = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof SlugSchema>) => SlugSchema.parse(data))
  .handler(async ({ data }): Promise<LessonResult> =>
    getLessonBySlugWithStatus(data.slug),
  );

// Backs the learn page's Lesson tab: does a single-video lesson already
// exist for the video being viewed? See findLessonForVideoService's own
// comment for why this only matches a lesson whose whole source set is
// this one video, not any lesson that merely cites it.
export const findLessonForVideo = createServerFn({ method: 'GET' })
  .validator((data: z.input<typeof VideoIdsSchema>) => VideoIdsSchema.parse(data))
  .handler(async ({ data }): Promise<LessonForVideo | null> =>
    findLessonForVideoService(data.documentId, data.youtubeVideoId),
  );
