// SPDX-License-Identifier: AGPL-3.0-only
import type { PlaywrightTestOptions, PlaywrightWorkerOptions } from '@playwright/test';
import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, E2E_NOW, e2eEnv } from './e2e/env.ts';

// The run's clock (`clockOffsetMs` in `e2e/env.ts`): fixed once here in the runner, which evaluates the config before
// it starts the web server and the workers; both inherit `process.env`, and the workers' own evaluation of this file
// keeps the inherited value. Every "now" of the run is E2E_NOW plus the real time elapsed since.
const clockOffset = (process.env['WF_E2E_CLOCK_OFFSET_MS'] ??= String(Date.parse(E2E_NOW) - Date.now()));

type ProjectUse = Partial<PlaywrightTestOptions & PlaywrightWorkerOptions>;

/**
 * The feature projects. Each runs after `m0` only and signs up its own invited user in its `beforeAll`
 * (`setUpProjectUser` in `e2e/support.ts`), with the design persona where it needs the ledger, so no project sees
 * another's changes and they run in parallel; within a spec the tests run in order (one worker per file):
 * - `tablet`: the M0 screens at 1024 px, signed in as the admin and the invited user from `m0` (no other spec uses it),
 * - `app`: the app shell (layout, language, theme, privacy mode, security headers), without the persona,
 * - `settings-ledger`: Settings › Kategori and Tag (create, rename, merge, delete; keyboard only), without the persona,
 * - `accounts`: "Rekening & dompet" (M1),
 * - `budget`: Anggaran, Settings › Periode bulanan, and the Record sheet's budget impact (FR-B1–B5, P1–P3, T3),
 * - `dashboard`: Ringkasan (FR-D1/D2/D4, FR-S7): October's KPIs, Week/Year, the custom range, 1440/1024/768, keyboard
 *   only, offline,
 * - `record`: Record Transaction and the Quick Add bar (FR-T1–T4, T8, T9),
 * - `cmdk`: the ⌘K palette, keyboard only,
 * - `transactions`: the Transactions page (FR-L1–L6: filters, views, bulk, detail edit, split, delete + Urungkan,
 *   keyboard, 1440/1024/768),
 * - `calendar`: Kalender (FR-C1–C3): Netflix on the 18th scheduled, a day's panel and "Catat di tanggal ini" at
 *   12.00, the legend, week and year, November's projection, keyboard, 1440/1024/768,
 * - `subscriptions`: Langganan (FR-SUB1–SUB6): the seed's goldens, "Ya, catat" through the Review queue, detected
 *   candidates, a new subscription (keyboard only), pausing, ⌘K, 1440/1024/768,
 * - `review`: the Review queue (FR-L7) after the scheduled jobs ran to 18 Okt for its user (`runScheduleJobs`):
 *   Netflix "Sudah dibayar" and September's leftover "Terapkan" change balances only once confirmed; keyboard only;
 *   1440/1024/768; "Ulangi" and stopping it (FR-T6, FR-L8),
 * - `notifications`: the bell's popover with the reminder the jobs sent to its user, the notifications page, and
 *   Settings › Notifikasi (FR-S5, FR-ST3),
 * - `onboarding`: the 5-step onboarding (FR-A4) for new users the admin invites (keyboard-only at 1440, skipping the
 *   goal at 1024, the quick path at 768),
 * - `debts`: Utang & cicilan (FR-R7, FR-U1–U5): the debt-free page, the impact simulation of a draft, and the Section 18
 *   scenario through the Record sheet (card expense split 3×, a Rp2jt payment allocated to the installment first →
 *   333.334/333.333/333.333, Rp13.000.000 of the limit left), 1440/1024/768,
 * - `goals`: Tabungan (FR-G1, G3, G4, FR-B6): the seed's goldens, Bibit RDPU as a source, "Setor manual" Rp1.000.000
 *   (21% → 22%, Okt 2027), "Tarik dana", a sinking fund joining the payday set-aside ("Sisihkan tiap gajian"), whose
 *   25 Okt transfer waits in the Review queue until confirmed, a new goal (keyboard only), STNK reached, completed and
 *   undone, paid from in the Record sheet (Terpakai), its remainder moved, 1440/1024/768.
 * - `market-api`: Settings › API kurs & pasar (FR-ST4): prices in use with source and time and no key at all, an
 *   EODHD key refused without 2FA, saved after turning 2FA on, tested against the fake provider (`e2e/market-fetch.ts`)
 *   with per-symbol results, then deleted with its prices; the API log; 1440/1024/768.
 */
const FEATURES: Record<string, { testMatch: string; use?: ProjectUse; dependencies?: string[] }> = {
  tablet: { testMatch: 'tablet.spec.ts', use: { viewport: { width: 1024, height: 768 } } },
  app: { testMatch: 'smoke.spec.ts' },
  'settings-ledger': { testMatch: 'settings-ledger.spec.ts' },
  accounts: { testMatch: 'accounts.spec.ts' },
  budget: { testMatch: 'budget.spec.ts' },
  dashboard: { testMatch: 'dashboard.spec.ts' },
  record: { testMatch: 'record-transaction.spec.ts' },
  cmdk: { testMatch: 'command-palette.spec.ts' },
  transactions: { testMatch: 'transactions.spec.ts' },
  calendar: { testMatch: 'calendar.spec.ts' },
  subscriptions: { testMatch: 'subscriptions.spec.ts' },
  review: { testMatch: 'review.spec.ts' },
  notifications: { testMatch: 'notifications.spec.ts' },
  onboarding: { testMatch: 'onboarding.spec.ts' },
  debts: { testMatch: 'debts.spec.ts' },
  goals: { testMatch: 'goals.spec.ts', use: { viewport: { width: 1440, height: 1198 } } },
  receivables: { testMatch: 'receivables.spec.ts' },
  'market-api': { testMatch: 'market-api.spec.ts' },
  reports: { testMatch: 'reports.spec.ts' },
  // After `market-api`: its sync writes the global built-in quotes and pauses the shared provider, so this page's
  // goldens (Rp61.420.000 / +Rp7.489.000) must not be read while those land.
  investments: {
    testMatch: 'investments.spec.ts',
    dependencies: ['m0', 'market-api'],
    use: { viewport: { width: 1440, height: 1024 } },
  },
};

/**
 * A project's browsers: Desktop Chrome in Indonesian (its 1280 × 720 viewport unless the project or the spec sets one),
 * from a client address of the project's own. The server takes `x-forwarded-for` as it takes Caddy's in production, so
 * the per-IP auth rate limits (`RATE_LIMITS` in `@wf/auth`) count each project apart and parallel projects never share
 * a budget.
 */
const projectUse = (index: number, use: ProjectUse = {}): ProjectUse => ({
  ...devices['Desktop Chrome'],
  locale: 'id-ID',
  ...use,
  extraHTTPHeaders: { 'x-forwarded-for': `198.51.100.${String(index + 1)}` },
});

/**
 * End-to-end tests against the production build (`pnpm --filter @wf/web build` first) and the dev services
 * (`pnpm dev:up`; CI runs them as service containers). `e2e/prepare.ts` gives every run a fresh instance: `m0` runs
 * the M0 exit flow at 1440 px first (setup wizard, 2FA, lockout, backup codes, devices, Bull Board, invitations), then
 * the {@link FEATURES} run in parallel on `WF_E2E_WORKERS` workers (default 3). CI retries a failed test once, and the
 * job summary lists every test that passed only on its retry (`e2e/summary-reporter.ts`), so flakes stay visible.
 *
 * The server, Postgres, the browsers, and the TOTP codes run on one clock that starts at E2E_NOW (the design persona's
 * day), so the seed's goldens hold whatever the real date is.
 */
export default defineConfig({
  testDir: './e2e',
  // Under the repository's git-ignored `reports/`, next to the coverage and mutation reports.
  outputDir: '../../reports/e2e',
  // One worker per spec file: a spec's tests share its user and run in order.
  fullyParallel: false,
  workers: Number(process.env['WF_E2E_WORKERS'] ?? 3),
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['list'], ['./e2e/summary-reporter.ts']] : 'list',
  timeout: 60_000,
  use: {
    baseURL: BASE_URL,
    // Indonesian is the instance default; pin the browser language so tests do not depend on the machine.
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    trace: 'retain-on-failure',
  },
  projects: [
    // No retry: the setup wizard it starts with is closed for good once it has run.
    { name: 'm0', testMatch: 'm0-exit.spec.ts', retries: 0, use: projectUse(0) },
    ...Object.entries(FEATURES).map(([name, { testMatch, use, dependencies }], index) => ({
      name,
      testMatch,
      dependencies: dependencies ?? ['m0'],
      use: projectUse(index + 1, use),
    })),
  ],
  webServer: {
    // The fake market data providers (`e2e/market-fetch.ts`) keep every run off the real APIs.
    command:
      'node e2e/prepare.ts && node --import ./e2e/clock.ts --import ./e2e/market-fetch.ts .output/server/index.mjs',
    url: `${BASE_URL}/healthz`,
    env: { ...e2eEnv(), WF_E2E_CLOCK_OFFSET_MS: clockOffset },
    // Never reuse a server: the run needs the fresh instance `prepare.ts` creates.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
