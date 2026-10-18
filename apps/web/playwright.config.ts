// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';
import { exampleEnv } from './test/env.ts';

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E smoke against the production build (`pnpm --filter @wf/web build` first). The web process validates
 * its whole environment at startup (`@wf/config`); this milestone's pages touch no service, so the
 * dev-only values from `.env.example` serve.
 */
const serverEnv = exampleEnv({ NODE_ENV: 'production', PORT: String(PORT), PUBLIC_URL: BASE_URL, LOG_LEVEL: 'warn' });

export default defineConfig({
  testDir: './e2e',
  // Under the repository's git-ignored `reports/`, next to the coverage and mutation reports.
  outputDir: '../../reports/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    // Indonesian is the instance default; pin the browser language so tests do not depend on the machine.
    locale: 'id-ID',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], locale: 'id-ID' } }],
  webServer: {
    command: 'node .output/server/index.mjs',
    url: `${BASE_URL}/healthz`,
    env: serverEnv,
    reuseExistingServer: !process.env.CI,
  },
});
