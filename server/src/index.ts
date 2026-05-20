import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { registerAllTools } from './mcp/tools';

type WithData = { data?: Record<string, unknown> };

// Normalize a user-supplied tag name so free-form input dedupes into one row.
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export default {
  register({ strapi }: { strapi: Core.Strapi }) {
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

      // Rule 2: tag.create — normalize name for consistent dedupe.
      if (
        context.uid === 'api::tag.tag' &&
        context.action === 'create'
      ) {
        const data = (context.params as WithData).data ?? {};
        const raw = data.name as string | undefined;
        if (typeof raw === 'string') {
          data.name = normalizeTagName(raw);
        }
        (context.params as WithData).data = data;
      }

      return next();
    });

    // -------------------------------------------------------------------
    // MCP (Model Context Protocol).
    //
    // Exposes the knowledge base (videos, transcripts, summaries, tags,
    // notes) as MCP tools so Claude Desktop / Claude Code / Cursor can
    // drive the app with a frontier model. The in-app chat path stays
    // local (Ollama) — this is the "bring the KB to a bigger brain"
    // surface.
    //
    // ROUTE: mounted at POST|GET|DELETE /api/mcp via the standard
    // content-API filesystem discovery at `src/api/mcp/routes/mcp.ts`.
    // Strapi wires up the corresponding handler in
    // `src/api/mcp/controllers/mcp.ts` (→ handleMcpRequest).
    //
    // Why filesystem discovery and not `strapi.server.routes()` in
    // register()? Because routes under `src/api/<name>/routes/` are the
    // only ones Strapi's Admin → Settings → API Tokens → Custom picker
    // can see — the picker walks `strapi.contentApi.routes`, which is
    // populated from the filesystem. Routes added via
    // `strapi.server.routes()` (or plugin register hooks) are invisible
    // to the token scope UI and force you to use a Full Access token
    // for anything custom. Putting the MCP route here instead lets the
    // user create a Custom token scoped to just `Mcp → handle`.
    //
    // AUTH: handled natively by Strapi's content-API auth middleware.
    // The token must exist in `admin::api-token`; if it's a Custom
    // token, its scope list must include `api::mcp.mcp.handle`. Full
    // Access tokens skip the scope check.
    //
    // All `register()` has to do here is populate the tool registry
    // before the first request arrives.
    // -------------------------------------------------------------------
    registerAllTools();
  },

  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Local-first, single-user app — no auth. Public role gets full read +
    // create + update on every content type. Delete stays admin-only so we
    // don't accidentally nuke the knowledge base via the UI.
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
