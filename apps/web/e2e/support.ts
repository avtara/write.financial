// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared E2E helpers: the console-error guard, the run's clock in the browser, TOTP codes, the accounts `m0` creates,
 * each feature project's own user, the design persona's ledger, and the services.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';
import { expect, test as base } from '@playwright/test';
import { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import postgres from 'postgres';
import { BASE_URL, e2eEnv, e2eNow, MAILPIT_URL, STATE_DIR } from './env.ts';

/**
 * Puts `context`'s pages on the run's clock (`e2eNow` in `env.ts`, the server's "now"). `setSystemTime` without
 * `install` only moves `Date`: timers stay real and time keeps passing. Playwright's `Date` makes its instances with the
 * native constructor, so `new Date().constructor !== Date` and TanStack Start's serializer (seroval, which matches
 * `value.constructor === Date`) refuses every date a server function sends; the second init script, which runs after
 * the clock's, restores the native invariant. Before the context's first page: init scripts skip open pages.
 */
async function useRunClock(context: BrowserContext): Promise<void> {
  await context.clock.setSystemTime(e2eNow());
  await context.addInitScript(() => {
    Date.prototype.constructor = Date;
  });
}

/**
 * A browser context besides the test's own, on the run's clock like the test's pages (`runClock`), and with the
 * project's client address (`x-forwarded-for` in `playwright.config.ts`). Use it instead of `browser.newContext`.
 */
export async function newContext(browser: Browser, options: BrowserContextOptions): Promise<BrowserContext> {
  const { extraHTTPHeaders = {} } = test.info().project.use;
  const context = await browser.newContext({ extraHTTPHeaders, ...options });
  await useRunClock(context);
  return context;
}

/**
 * Every test's pages see the run's clock (`useRunClock`; declared before `failOnConsoleErrors`, so it runs before the
 * page opens), and every test fails on console errors; Chromium reports CSP violations ("Refused to …") there.
 */
export const test = base.extend<{ runClock: undefined; failOnConsoleErrors: undefined }>({
  runClock: [
    async ({ context }, use) => {
      await useRunClock(context);
      await use(undefined);
    },
    { auto: true },
  ],
  failOnConsoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        // Expected answers to wrong codes and refused pages are logged by Chromium as failed resources.
        if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
          errors.push(message.text());
        }
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await use(undefined);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export const SETUP_TOKEN = e2eEnv()['SETUP_TOKEN'] ?? '';

/** The current 6-digit code of a base32 TOTP secret (6 digits, 30 seconds, SHA-1, as Better Auth issues them). */
export function totp(secret: string, at = e2eNow()): string {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({ timestamp: at });
}

export interface Account {
  readonly name: string;
  readonly email: string;
  readonly password: string;
  /** Base32 TOTP secret (accounts with 2FA). */
  totpSecret?: string;
  /** Backup codes not used yet. */
  backupCodes?: string[];
}

export function saveAccount(key: 'admin' | 'user', account: Account): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(path.join(STATE_DIR, `${key}.json`), JSON.stringify(account));
}

export function loadAccount(key: 'admin' | 'user'): Account {
  return JSON.parse(readFileSync(path.join(STATE_DIR, `${key}.json`), 'utf8')) as Account;
}

/** Playwright storage state of the user `m0` invites (no 2FA), for `tablet`. */
export const USER_STATE = path.join(STATE_DIR, 'user-storage.json');

/**
 * "Time travel": deletes the auth counters in Valkey, as if their windows had passed: the 15-minute lockout and the
 * per-IP rate limits (every request of a project comes from the project's one address, so a long spec would exceed
 * one minute's budget). Clears every project's counters, which only ever lets a request through.
 */
export async function clearAuthCounters(): Promise<void> {
  const redis = new Redis(e2eEnv()['REDIS_URL'] ?? '');
  try {
    const keys = await redis.keys('wf:auth:*');
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}

/** Subjects of the emails Mailpit received for `to`. */
export async function mailSubjects(to: string): Promise<string[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  const { messages } = (await response.json()) as { messages: { Subject: string }[] };
  return messages.map((message) => message.Subject);
}

/** Types a 6-digit code into the `<CodeInput>` labelled `label` (each box selects its digit on focus). */
export async function enterCode(page: Page, label: string | RegExp, code: string): Promise<void> {
  const group = page.getByRole('group', { name: label });
  await group.getByRole('textbox').first().click();
  await page.keyboard.type(code);
}

export async function openUserMenu(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Menu pengguna|User menu)$/ }).click();
}

/** Signs out through the user menu and its confirmation dialog. */
export async function signOut(page: Page): Promise<void> {
  await openUserMenu(page);
  await page.getByRole('menuitem', { name: 'Keluar' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Keluar dari write.financial?' });
  await dialog.getByRole('button', { name: 'Keluar' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/** Submits the sign-in form with `account`'s email and password (2FA accounts continue on `/2fa`). */
export async function signInWithPassword(page: Page, account: Account): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
}

export async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `/tmp/wf-auth-${name}.png`, fullPage: true });
}

/** A password no breach list knows, different every run. */
export function freshPassword(): string {
  return `Wf-e2e-${crypto.randomUUID()}`;
}

/**
 * Loads the design persona (`DESIGN_SEED`: 11 accounts, 128 transactions 1–15 Oct 2026, 6 goals) for `email` with the
 * seed CLI (`pnpm db:seed`), once: a user who already has accounts is left as they are, so a retried setup step
 * (`setUpProjectUser`) can call it again.
 */
export async function seedDesignPersona(email: string): Promise<void> {
  const env = e2eEnv();
  const sql = postgres(env['DATABASE_URL_SUPERUSER'] ?? '', { max: 1, onnotice: () => undefined });
  try {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM accounts JOIN users ON users.id = accounts.user_id WHERE users.email = ${email}`;
    if ((row?.n ?? 0) > 0) return;
  } finally {
    await sql.end();
  }
  // On the run's clock, like the server (`clock.ts`): the seed's open period is the one of E2E_NOW.
  execFileSync(
    'node',
    ['--import', path.resolve(import.meta.dirname, 'clock.ts'), 'src/cli.ts', 'seed', '--email', email],
    {
      cwd: path.resolve(import.meta.dirname, '../../../packages/db'),
      env: { ...process.env, ...env },
      stdio: 'pipe',
    },
  );
}

/**
 * "Time travel" for the scheduled jobs: runs, as the worker, what the `occurrences` and `reminders` jobs would have
 * done for `email` by `at` (an ISO instant after the run's clock), e.g. Netflix's bill due 18 Okt moving to the
 * Review queue and its H-1 reminder (`schedule-jobs.ts`). Returns the job results.
 */
export function runScheduleJobs(email: string, at: string): Record<string, number> {
  const output = execFileSync('node', [path.resolve(import.meta.dirname, 'schedule-jobs.ts'), email, at], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, ...e2eEnv() },
    encoding: 'utf8',
  });
  return JSON.parse(output) as Record<string, number>;
}

/** The balance on an account card of the Transactions page, as a number ("Rp42.810.000" → 42810000). */
export async function cardBalance(page: Page, account: string): Promise<number> {
  const card = page.getByRole('list', { name: 'Kartu rekening' }).getByRole('button', { name: new RegExp(account) });
  const text = (await card.innerText()).match(/Rp([\d.]+)/)?.[1] ?? '';
  return Number(text.replaceAll('.', ''));
}

/**
 * FR-A4: walks the onboarding the quickest way, through the real UI and keyboard-free of data: the profile as
 * prefilled, the period start (tanggal 1) without an income, no accounts, "Lewati" for the goal, and "Ke Ringkasan".
 * For the specs whose users only need to get past it (the design persona's ledger comes from `seedDesignPersona`).
 */
export async function skipOnboarding(page: Page): Promise<void> {
  // Each step's heading has the focus once the step is rendered and hydrated (the URL changes earlier, and a click
  // before hydration would submit the form natively).
  const steps = [
    ['profile', /^Halo, .+! Lengkapi profilmu$/, 'Lanjut'],
    ['period', 'Kapan bulanmu dimulai?', 'Lanjut'],
    ['accounts', 'Rekening yang kamu pakai', 'Lanjut'],
    ['goal', 'Mulai satu tujuan tabungan', 'Lewati'],
    ['done', 'Siap! write.financial sudah diatur', 'Ke Ringkasan'],
  ] as const;
  for (const [step, heading, action] of steps) {
    await expect(page).toHaveURL(new RegExp(`/onboarding/${step}$`));
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeFocused();
    await page.getByRole('button', { name: action }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
}

/** The admin invites `email` (registration "Dengan undangan", m0) and the invitee signs up at `width` px. */
export async function signUpInvited(browser: Browser, email: string, name: string, width: number): Promise<Page> {
  const admin = loadAccount('admin');
  // Signed out, whatever the calling spec's `storageState`.
  const signedOut = { cookies: [], origins: [] };
  const adminContext = await newContext(browser, { locale: 'id-ID', baseURL: BASE_URL, storageState: signedOut });
  const adminPage = await adminContext.newPage();
  await signInWithPassword(adminPage, admin);
  await enterCode(adminPage, 'Kode verifikasi', totp(admin.totpSecret ?? ''));
  await expect(adminPage.getByRole('heading', { level: 1, name: 'Selamat datang' })).toBeVisible();
  await adminPage.goto('/settings/instance');
  const invite = adminPage
    .getByRole('region')
    .filter({ has: adminPage.getByRole('heading', { name: 'Undang pengguna' }) });
  await invite.getByRole('textbox', { name: 'Email' }).fill(email);
  await invite.getByRole('button', { name: 'Buat undangan' }).click();
  const link = adminPage.getByRole('textbox', { name: 'Tautan undangan', exact: true });
  await expect(link).toBeVisible();
  const url = (await link.inputValue()).trim();
  await adminContext.close();

  const context = await newContext(browser, {
    locale: 'id-ID',
    baseURL: BASE_URL,
    timezoneId: 'Asia/Jakarta',
    storageState: signedOut,
  });
  const page = await context.newPage();
  await page.setViewportSize({ width, height: 1024 });
  await page.goto(url);
  await page.getByLabel('Nama').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Kata sandi', { exact: true }).fill(freshPassword());
  await page.getByRole('button', { name: 'Buat akun' }).click();
  return page;
}

/** A feature project's own invited user. */
export interface ProjectUser {
  readonly email: string;
  /** Its Playwright storage state, for `test.use({ storageState })`. */
  readonly state: string;
}

/** The own invited user of the project named `project` in `playwright.config.ts`. */
export function projectUser(project: string): ProjectUser {
  return { email: `${project}@e2e.test`, state: path.join(STATE_DIR, `${project}-storage.json`) };
}

/**
 * A feature project's setup step (its `beforeAll`, on the run's clock): the admin invites the project's own user, who
 * signs up at 1440 px and walks the onboarding's quick path or, with `persona`, gets the design persona
 * (`seedDesignPersona`, which completes the onboarding). No two projects share a user, so the projects run in
 * parallel and change their data freely. Once per run: a retry (in a new worker) finds the storage state and goes on
 * with the user as the first attempt left it.
 */
export async function setUpProjectUser(
  browser: Browser,
  user: ProjectUser,
  { persona }: { persona: boolean },
): Promise<void> {
  // Signing up and seeding while the other workers keep the server busy.
  test.setTimeout(120_000);
  if (!existsSync(user.state)) {
    const page = await signUpInvited(browser, user.email, 'Pengguna E2E', 1440);
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
    if (!persona) await skipOnboarding(page);
    await page.context().storageState({ path: user.state });
    await page.context().close();
  }
  if (persona) await seedDesignPersona(user.email);
}
