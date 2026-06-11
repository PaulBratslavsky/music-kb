import { defineConfig } from 'vitest/config'

// Vitest picks this file over vite.config.ts and does NOT merge the two.
// That's deliberate: the unit suite is pure node — it needs none of the app
// plugins (tanstackStart, nitro, devtools, react, tailwind), and loading them
// under vitest both fights the vite-version type mismatch and leaves servers
// running that block process exit. The `#/*` alias resolves via the package
// `imports` field, no plugin required.
export default defineConfig({
  // Vitest (unit) owns src/**. Playwright (e2e) owns e2e/** and uses
  // *.spec.ts — exclude it here so vitest's default glob doesn't try to
  // run browser specs in node.
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
})
