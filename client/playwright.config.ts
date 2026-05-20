import { defineConfig, devices } from '@playwright/test';

// Smoke-only Playwright config. Assumes the full stack is already running
// (`yarn dev` or `yarn start` from the repo root → Strapi :1350 + client
// :3015). It does NOT start the stack itself — cold Strapi boot + seed
// juggling in this monorepo is slower and more fragile than just running
// against a live dev server. If :3015 is down the specs fail fast with a
// clear message.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3015',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
