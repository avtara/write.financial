// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, e2eEnv } from './e2e/env.ts';

/**
 * End-to-end tests against the production build (`pnpm --filter @wf/web build` first) and the dev services
 * (`pnpm dev:up`; CI runs them as service containers). `e2e/prepare.ts` gives every run a fresh instance, so the
 * projects run in order:
 * - `m0`: the M0 exit flow at 1440 px (setup wizard, 2FA, lockout, backup codes, devices, Bull Board, invitations),
 * - `tablet`: the same screens at 1024 px, signed in as the admin and the invited user from `m0`,
 * - `app`: the app shell (layout, language, theme, privacy mode, security headers) as the invited user.
 */
export default defineConfig({
  testDir: './e2e',
  // Under the repository's git-ignored `reports/`, next to the coverage and mutation reports.
  outputDir: '../../reports/e2e',
  // The projects share one instance and depend on each other's accounts.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    // Indonesian is the instance default; pin the browser language so tests do not depend on the machine.
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'm0', testMatch: 'm0-exit.spec.ts', use: { ...devices['Desktop Chrome'], locale: 'id-ID' } },
    {
      name: 'tablet',
      testMatch: 'tablet.spec.ts',
      dependencies: ['m0'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID', viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'app',
      testMatch: 'smoke.spec.ts',
      dependencies: ['tablet'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID' },
    },
  ],
  webServer: {
    command: 'node e2e/prepare.ts && node .output/server/index.mjs',
    url: `${BASE_URL}/healthz`,
    env: e2eEnv(),
    // Never reuse a server: the run needs the fresh instance `prepare.ts` creates.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
