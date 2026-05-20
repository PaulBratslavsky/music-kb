export default {
  routes: [
    {
      method: 'POST',
      path: '/mcp',
      handler: 'mcp.handle',
      config: { policies: [] },
    },
    {
      method: 'GET',
      path: '/mcp',
      handler: 'mcp.handle',
      config: { policies: [] },
    },
    {
      method: 'DELETE',
      path: '/mcp',
      handler: 'mcp.handle',
      config: { policies: [] },
    },
  ],
};
