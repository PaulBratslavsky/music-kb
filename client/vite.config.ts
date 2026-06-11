import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Unit-test config lives in vitest.config.ts (which vitest prefers over this
// file). Keeping the app plugins out of the test pipeline avoids the vite 8
// vs vitest-bundled vite 7 type clash and stops nitro/devtools servers from
// holding the vitest process open after the run.
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
})

export default config
