// One-call overview of the knowledge base: total videos, counts by
// summary status, most-used tags, top authors, ingestion-per-month
// buckets. Helps the agent answer "what do I have in here?" without
// pulling the entire library.

import { z } from 'zod';
import type { ToolDef } from '../registry';

const schema = z.object({
  topTags: z.number().int().min(1).max(50).default(15),
  topAuthors: z.number().int().min(1).max(50).default(10),
  recentMonths: z.number().int().min(1).max(24).default(12),
});

export const libraryStatsTool: ToolDef<z.infer<typeof schema>> = {
  name: 'libraryStats',
  description:
    'High-level stats about the knowledge base: total video count, breakdown by summary status, most-used tags with video counts, top channels/authors, and monthly ingestion buckets. Cheap to call (a handful of aggregation queries) — use this to orient before deep-diving.',
  schema,
  execute: async ({ topTags, topAuthors, recentMonths }, { strapi }) => {
    const total = await strapi.db.query('api::video.video').count({});
    const generated = await strapi.db
      .query('api::video.video')
      .count({ where: { summaryStatus: 'generated' } });
    const pending = await strapi.db
      .query('api::video.video')
      .count({ where: { summaryStatus: 'pending' } });
    const failed = await strapi.db
      .query('api::video.video')
      .count({ where: { summaryStatus: 'failed' } });

    // Tag usage — count distinct videos per tag.
    const tags = (await strapi.documents('api::tag.tag').findMany({
      pagination: { start: 0, limit: 500 },
      populate: { videos: { fields: ['documentId'] } },
    })) as Array<{ name: string; videos?: Array<{ documentId: string }> }>;

    const topTagList = tags
      .map((t) => ({ name: t.name, videoCount: (t.videos ?? []).length }))
      .filter((t) => t.videoCount > 0)
      .sort((a, b) => b.videoCount - a.videoCount)
      .slice(0, topTags);

    // Top authors — small library so fetch all non-null authors and
    // tally in memory rather than issuing per-author queries.
    const authored = (await strapi.documents('api::video.video').findMany({
      pagination: { start: 0, limit: 1000 },
      fields: ['videoAuthor'],
      filters: { videoAuthor: { $notNull: true } },
    })) as Array<{ videoAuthor: string | null }>;

    const authorCounts = new Map<string, number>();
    for (const v of authored) {
      if (!v.videoAuthor) continue;
      authorCounts.set(v.videoAuthor, (authorCounts.get(v.videoAuthor) ?? 0) + 1);
    }
    const topAuthorList = Array.from(authorCounts.entries())
      .map(([name, videoCount]) => ({ name, videoCount }))
      .sort((a, b) => b.videoCount - a.videoCount)
      .slice(0, topAuthors);

    // Monthly ingestion buckets — last N months.
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - recentMonths);
    cutoff.setDate(1);
    cutoff.setHours(0, 0, 0, 0);

    const recent = (await strapi.documents('api::video.video').findMany({
      filters: { createdAt: { $gte: cutoff.toISOString() } },
      pagination: { start: 0, limit: 1000 },
      fields: ['createdAt'],
    })) as Array<{ createdAt: string }>;

    const monthBuckets = new Map<string, number>();
    for (const v of recent) {
      const d = new Date(v.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthBuckets.set(key, (monthBuckets.get(key) ?? 0) + 1);
    }
    const monthly = Array.from(monthBuckets.entries())
      .map(([period, count]) => ({ period, count }))
      .sort((a, b) => a.period.localeCompare(b.period));

    return {
      totals: {
        videos: total,
        summaryGenerated: generated,
        summaryPending: pending,
        summaryFailed: failed,
      },
      topTags: topTagList,
      topAuthors: topAuthorList,
      monthlyIngestion: monthly,
    };
  },
};
