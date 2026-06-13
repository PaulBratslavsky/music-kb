import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1350),
  app: {
    keys: env.array('APP_KEYS'),
  },
  // Official Strapi MCP server (5.47+), served at /mcp over streamable-http,
  // gated by admin API tokens. Runs ALONGSIDE the hand-rolled server at
  // /api/mcp during the migration (docs/mcp-official-plugin-migration-plan.md);
  // the custom one is retired in phase 4. Defaults: connect 5s, request 60s.
  mcp: { enabled: env.bool('MCP_ENABLED', true) },
});

export default config;
