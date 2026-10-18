// SPDX-License-Identifier: AGPL-3.0-only
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tailwindcss(),
    tanstackStart({
      router: {
        // Relative to `src/`. `src/generated/` is excluded from the coverage gate, the test-file check, and the SPDX check.
        generatedRouteTree: './generated/routeTree.gen.ts',
        quoteStyle: 'single',
        semicolons: true,
        addExtensions: true,
        // Co-located unit tests (D27) live next to the route files.
        routeFileIgnorePattern: '\\.test\\.tsx?$',
      },
    }),
    // Node server output: `node .output/server/index.mjs` (Start's documented Node/Docker target).
    nitro(),
    viteReact(),
  ],
});
