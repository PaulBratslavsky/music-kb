import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1350),
  app: {
    keys: env.array('APP_KEYS'),
  },
  // Official Strapi MCP server (5.47+), served at /mcp over streamable-http,
  // gated by admin API tokens. The 24 domain tools register onto it from
  // src/index.ts via src/mcp-official/. This replaced the hand-rolled
  // /api/mcp server (retired — see ADR 0008). Defaults: connect 5s,
  // request 60s.
  mcp: { enabled: env.bool('MCP_ENABLED', true) },
});

export default config;
