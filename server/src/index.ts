import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { registerOfficialMcpTools } from './mcp-official';

type WithData = { data?: Record<string, unknown> };

// Normalize a user-supplied tag name so free-form input dedupes into one row.
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Derive the required `slug` uid from a normalized name. Strapi's content
// API does NOT auto-generate uid fields (only the admin UI does), so a
// REST create that sends just `name` would 400 with "slug must be defined".
function slugifyTagName(name: string): string {
  return name
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

export default {
  async register({ strapi }: { strapi: Core.Strapi }) {
    strapi.documents.use(async (context, next) => {
      // Rule 1: video.create — require youtubeVideoId and enforce dedupe.
      // The client also pre-checks, but this is the authoritative gate.
      if (
        context.uid === 'api::video.video' &&
        context.action === 'create'
      ) {
        const data = (context.params as WithData).data ?? {};
        const videoId = data.youtubeVideoId as string | undefined;
        if (!videoId) {
          throw new errors.ApplicationError('youtubeVideoId is required');
        }

        const existing: any = await strapi
          .documents('api::video.video')
          .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } });
        if (existing) {
          throw new errors.ApplicationError(
            `A video for this id already exists. documentId=${existing.documentId}`,
          );
        }
      }

      // Rule 1b: transcript.create — same dedupe on youtubeVideoId. The
      // schema has `unique: true` at the DB level, but this returns a
      // cleaner error and handles races in-flight.
      if (
        context.uid === 'api::transcript.transcript' &&
        context.action === 'create'
      ) {
        const data = (context.params as WithData).data ?? {};
        const videoId = data.youtubeVideoId as string | undefined;
        if (!videoId) {
          throw new errors.ApplicationError('youtubeVideoId is required on transcript');
        }
        const existing: any = await strapi
          .documents('api::transcript.transcript')
          .findFirst({ filters: { youtubeVideoId: { $eq: videoId } } });
        if (existing) {
          throw new errors.ApplicationError(
            `A transcript for this id already exists. documentId=${existing.documentId}`,
          );
        }
      }

      // Rule 2: tag.create — normalize name for consistent dedupe, and
      // derive the required slug when the client didn't send one (REST
      // clients send only `name`; without this, on-the-fly tag creation
      // from the share flow 400s — see videos.smoke.test.ts).
      if (
        context.uid === 'api::tag.tag' &&
        context.action === 'create'
      ) {
        const data = (context.params as WithData).data ?? {};
        const raw = data.name as string | undefined;
        if (typeof raw === 'string') {
          data.name = normalizeTagName(raw);
          if (!data.slug) {
            data.slug = slugifyTagName(data.name as string);
          }
        }
        (context.params as WithData).data = data;
      }

      return next();
    });

    // -------------------------------------------------------------------
    // MCP (Model Context Protocol).
    //
    // Exposes the knowledge base (videos, transcripts, summaries, tags,
    // notes, music data) as MCP tools so Claude Desktop / Claude Code /
    // Cursor can drive the app with a frontier model. The in-app chat path
    // stays local (Ollama) — this is the "bring the KB to a bigger brain"
    // surface.
    //
    // Served by the OFFICIAL Strapi MCP server (5.47+) at /mcp, gated by
    // admin API tokens. We register our 24 domain tools on it here, behind
    // custom admin permissions, via the adapter in `src/mcp-official/`
    // (which reuses the tool bodies in `src/mcp/tools/`). The hand-rolled
    // server that used to serve /api/mcp was retired — see ADR 0008. Must
    // run in register(), before the MCP server starts.
    // -------------------------------------------------------------------
    await registerOfficialMcpTools(strapi);
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Local-first, single-user app — no auth. Public role gets full read +
    // create + update on every content type. Delete is also public for the
    // user-authored types (note, digest, loop, composition) so the UI can
    // remove them; the core knowledge-base types (video/transcript/tag)
    // grant no delete.
    //
    // `await`ed so Strapi logs the result during startup and so the grants
    // are in place before the server accepts requests. The previous fire-
    // and-forget pattern had a startup race: the web server could answer
    // "403" for a brief window after the app was "ready".
    const actions = [
      'api::video.video.find',
      'api::video.video.findOne',
      'api::video.video.create',
      'api::video.video.update',
      'api::tag.tag.find',
      'api::tag.tag.findOne',
      'api::tag.tag.create',
      'api::transcript.transcript.find',
      'api::transcript.transcript.findOne',
      'api::transcript.transcript.create',
      'api::transcript.transcript.update',
      // Note: MCP-authored (save-note.ts) + in-app chat summaries and
      // user scratchpad from the Notes tab. Client writes directly via
      // the Strapi REST API now — the old "reads-only" stance was from
      // when only Claude Desktop could write notes.
      'api::note.note.find',
      'api::note.note.findOne',
      'api::note.note.create',
      'api::note.note.update',
      'api::note.note.delete',
      // Digest is a saved cross-video synthesis. Client creates, reads,
      // and deletes from the /digest page; no MCP write path (yet).
      'api::digest.digest.find',
      'api::digest.digest.findOne',
      'api::digest.digest.create',
      'api::digest.digest.update',
      'api::digest.digest.delete',
      // Loop is a saved play-along discovery: A/B video region + key +
      // ordered chord progression. Created from the Theory tab's
      // "Find chords" panel; reopened via the right-column loops list.
      'api::loop.loop.find',
      'api::loop.loop.findOne',
      'api::loop.loop.create',
      'api::loop.loop.update',
      'api::loop.loop.delete',
      // Composition is a saved 8-bar progression sketch from the
      // Theory → Compose tool; the whole thing lives in a JSON field.
      'api::composition.composition.find',
      'api::composition.composition.findOne',
      'api::composition.composition.create',
      'api::composition.composition.update',
      'api::composition.composition.delete',
    ];

    try {
      const publicRole: any = await strapi
        .db.query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } });

      if (!publicRole) {
        strapi.log.warn('[bootstrap] public role not found — skipping grants');
        return;
      }

      let granted = 0;
      let existing = 0;
      for (const action of actions) {
        const hit = await strapi
          .db.query('plugin::users-permissions.permission')
          .findOne({ where: { action, role: publicRole.id } });
        if (hit) {
          existing += 1;
          continue;
        }
        await strapi
          .db.query('plugin::users-permissions.permission')
          .create({ data: { action, role: publicRole.id } });
        granted += 1;
      }

      strapi.log.info(
        `[bootstrap] public permissions: granted=${granted}, already-present=${existing}, total=${actions.length}`,
      );
    } catch (err) {
      strapi.log.error('[bootstrap] public permission grant failed:', err);
    }
  },
};
