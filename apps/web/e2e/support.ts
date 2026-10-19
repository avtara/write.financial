// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared E2E helpers: the console-error guard, TOTP codes, the accounts the specs share, the design persona's ledger,
 * and the services.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test as base, type Page } from '@playwright/test';
import { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import postgres from 'postgres';
import { e2eEnv, MAILPIT_URL, STATE_DIR } from './env.ts';

/** Every test fails on console errors; Chromium reports CSP violations ("Refused to …") there. */
export const test = base.extend<{ failOnConsoleErrors: undefined }>({
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
export function totp(secret: string, at = Date.now()): string {
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

/** Playwright storage state of the invited user (no 2FA), for the app shell specs. */
export const USER_STATE = path.join(STATE_DIR, 'user-storage.json');

/**
 * "Time travel": deletes the auth counters in Valkey, as if their windows had passed: the 15-minute lockout and the
 * per-IP rate limits (every test request comes from the same address, so a whole run would exceed one minute's budget).
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
 * seed CLI (`pnpm db:seed`), once: a user who already has accounts is left as they are, so every spec that needs the
 * ledger can call it. Specs change the data (recording transactions moves balances), so assert relative values.
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
  execFileSync('node', ['src/cli.ts', 'seed', '--email', email], {
    cwd: path.resolve(import.meta.dirname, '../../../packages/db'),
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
}
