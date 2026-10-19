// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';

/**
 * The install proof on the production self-host stack (`deploy/compose`: Caddy in front of the built image), started
 * by the caller on clean volumes; there is no webServer. `WF_SELFHOST_URL` is the instance's PUBLIC_URL (default
 * `https://localhost`, Caddy's local CA, hence `ignoreHTTPSErrors`), and `WF_SELFHOST_SETUP_TOKEN` the setup token
 * from `docker compose logs init`. CI's "Docker image (build + boot)" job runs it right after `docker compose up`.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'selfhost.spec.ts',
  // Under the repository's git-ignored `reports/`, next to the dev-build E2E output.
  outputDir: '../../reports/e2e-selfhost',
  // One fresh instance, set up once: the tests depend on each other.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env['WF_SELFHOST_URL'] ?? 'https://localhost',
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'retain-on-failure',
  },
});
