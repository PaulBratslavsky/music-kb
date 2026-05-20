import type { Core } from '@strapi/strapi';
import type { Context } from 'koa';
import { handleMcpRequest } from '../../../mcp/transport';

export default {
  async handle(ctx: Context) {
    await handleMcpRequest(ctx, strapi as unknown as Core.Strapi);
  },
};
