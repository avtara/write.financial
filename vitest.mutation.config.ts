// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

/**
 * Flat config used only by Stryker's command runner (D27 mutation gate).
 * Stryker sets `__STRYKER_ACTIVE_MUTANT__` and runs this once per mutant.
 * (`@stryker-mutator/vitest-runner` 10.0.0 never activates runtime mutants under Vitest 5.)
 */
export default defineConfig({
  test: {
    include: ['packages/{domain,crypto}/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
});
