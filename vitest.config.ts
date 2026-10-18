// SPDX-License-Identifier: AGPL-3.0-only
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const SOURCES = '{apps,packages,tools}/*/src';

/**
 * Three projects:
 * - `unit`: every `*.test.ts` except integration tests, in Node.
 * - `unit-browser`: every `*.test.tsx` (React components) in headless Chromium via Playwright, with
 *   Tailwind and the design tokens loaded so components render as in the app.
 *   Both unit projects form the D27 gate: 100% coverage per file, and `coverage.include` lists all
 *   source files (`.ts` and `.tsx`), so a file without tests counts as 0%.
 * - `integration`: `*.integration.test.ts`, real Postgres/Valkey/SeaweedFS via Testcontainers.
 *   Not part of the coverage gate; it proves the parts unit tests fake (RLS, S3, queues).
 * Coverage exclusions are only for code we do not write (see docs/PRD.md D27).
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [`${SOURCES}/**/*.test.ts`],
          exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [tailwindcss()],
        test: {
          name: 'unit-browser',
          include: [`${SOURCES}/**/*.test.tsx`],
          exclude: ['**/node_modules/**', '**/*.integration.test.tsx'],
          setupFiles: ['./vitest.browser.css'],
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [`${SOURCES}/**/*.integration.test.{ts,tsx}`],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['{apps,packages,tools}/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', '**/src/paraglide/**', '**/src/**/generated/**'],
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        100: true,
        perFile: true,
      },
    },
  },
});
