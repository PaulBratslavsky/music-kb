import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  // The same choice the app makes (client/src/lib/services/frontier-model.ts):
  // Claude when an Anthropic key is set, the local Ollama chat model otherwise.
  const anthropicKey = env('ANTHROPIC_API_KEY', '').trim();
  const chatModel = anthropicKey
    ? { provider: 'anthropic', model: 'claude-sonnet-5', apiKey: anthropicKey }
    : {
        provider: 'ollama',
        model:
          env('OLLAMA_CHAT_MODEL', '').trim() ||
          env('OLLAMA_MODEL', '').trim() ||
          'gemma4-kb:latest',
        baseURL: env('OLLAMA_HOST', 'http://localhost:11434'),
      };

  return {
    // OAuth sign-in for Strapi's MCP server at /mcp, so an MCP client can
    // connect without a pasted token. Admin tokens keep working.
    'strapi-oauth-mcp-manager': {
      enabled: true,
    },

    // A chat inside the Strapi admin, plus eight cross-type content tools on
    // /mcp. An extra example: the TanStack Start app does not depend on it.
    'tanstack-ai': {
      enabled: true,
      config: {
        chat: {
          ...chatModel,
          // Music KB's own tools (src/mcp/catalog.ts), offered to the admin
          // chat by src/api/music-kb-mcp/services/chat-tools.ts.
          toolSources: ['api::music-kb-mcp.chat-tools'],
        },
      },
    },
  };
};

export default config;
