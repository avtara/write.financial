// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

/**
 * D27: every package must keep 100% unit coverage per file.
 * `coverage.include` lists all source files, so a file without tests counts as 0%.
 * Exclusions are only for code we do not write (see docs/PRD.md D27).
 */
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'tools/*'],
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
