// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, E2E_NOW, e2eEnv } from './e2e/env.ts';

// The run's clock (`clockOffsetMs` in `e2e/env.ts`): fixed once here in the runner, which evaluates the config before
// it starts the web server and the workers; both inherit `process.env`, and the workers' own evaluation of this file
// keeps the inherited value. Every "now" of the run is E2E_NOW plus the real time elapsed since.
const clockOffset = (process.env['WF_E2E_CLOCK_OFFSET_MS'] ??= String(Date.parse(E2E_NOW) - Date.now()));

/**
 * End-to-end tests against the production build (`pnpm --filter @wf/web build` first) and the dev services
 * (`pnpm dev:up`; CI runs them as service containers). `e2e/prepare.ts` gives every run a fresh instance, so the
 * projects run in order:
 * - `m0`: the M0 exit flow at 1440 px (setup wizard, 2FA, lockout, backup codes, devices, Bull Board, invitations),
 * - `tablet`: the same screens at 1024 px, signed in as the admin and the invited user from `m0`,
 * - `app`: the app shell (layout, language, theme, privacy mode, security headers) as the invited user,
 * - `settings-ledger`: Settings › Kategori and Tag (create, rename, merge, delete; keyboard only) as the invited user,
 * - `accounts`: "Rekening & dompet" with the design persona seeded for the invited user (M1),
 * - `budget`: Anggaran, Settings › Periode bulanan, and the Record sheet's budget impact (FR-B1–B5, P1–P3, T3) on the
 *   seed's untouched October (it restores what it changes),
 * - `record`: Record Transaction and the Quick Add bar (FR-T1–T4, T8, T9) as the invited user with the design seed,
 * - `cmdk`: the ⌘K palette, keyboard only, as the invited user with the design persona's ledger (`seedDesignPersona`),
 * - `transactions`: the Transactions page (FR-L1–L6: filters, views, bulk, detail edit, split, delete + Urungkan,
 *   keyboard, 1440/1024/768) as the invited user,
 * - `onboarding`: the 5-step onboarding (FR-A4) for new users the admin invites (keyboard-only at 1440, skipping the
 *   goal at 1024, the quick path at 768). Last, so its extra users and admin sessions touch no other spec. (`m0`
 *   itself takes the admin and the invited user through the onboarding's quick path.)
 *
 * The server, Postgres, the browsers, and the TOTP codes run on one clock that starts at E2E_NOW (the design persona's
 * day), so the seed's goldens hold whatever the real date is.
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
    {
      name: 'settings-ledger',
      testMatch: 'settings-ledger.spec.ts',
      dependencies: ['app'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID' },
    },
    {
      name: 'accounts',
      testMatch: 'accounts.spec.ts',
      dependencies: ['settings-ledger'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID' },
    },
    {
      // Before `record`, whose Quick Add expense moves the seed's October totals that this spec asserts.
      name: 'budget',
      testMatch: 'budget.spec.ts',
      dependencies: ['accounts'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID' },
    },
    {
      // After `accounts` (through `budget`), which asserts the seed's exact balances; recording moves them.
      name: 'record',
      testMatch: 'record-transaction.spec.ts',
      dependencies: ['budget'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID' },
    },
    {
      name: 'cmdk',
      testMatch: 'command-palette.spec.ts',
      dependencies: ['app'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID' },
    },
    {
      name: 'transactions',
      testMatch: 'transactions.spec.ts',
      dependencies: ['record'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID' },
    },
    {
      name: 'onboarding',
      testMatch: 'onboarding.spec.ts',
      dependencies: ['transactions', 'cmdk'],
      use: { ...devices['Desktop Chrome'], locale: 'id-ID' },
    },
  ],
  webServer: {
    command: 'node e2e/prepare.ts && node --import ./e2e/clock.ts .output/server/index.mjs',
    url: `${BASE_URL}/healthz`,
    env: { ...e2eEnv(), WF_E2E_CLOCK_OFFSET_MS: clockOffset },
    // Never reuse a server: the run needs the fresh instance `prepare.ts` creates.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
