// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

const SOURCES = '{apps,packages,tools}/*/src';

/**
 * Two projects:
 * - `unit`: every `*.test.ts(x)` except integration tests. D27: 100% coverage per file,
 *   and `coverage.include` lists all source files, so a file without tests counts as 0%.
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
          include: [`${SOURCES}/**/*.test.{ts,tsx}`],
          exclude: ['**/node_modules/**', '**/*.integration.test.{ts,tsx}'],
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
