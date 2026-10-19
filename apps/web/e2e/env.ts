// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The end-to-end environment: the production build on port 3100 against the dev services (`pnpm dev:up`, or the CI
 * service containers with the same credentials), in a database of its own (`wf_e2e`) that `prepare.ts` recreates
 * before every run, so the setup wizard always starts from a fresh instance.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { exampleEnv } from '../test/env.ts';

export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;
export const E2E_DATABASE = 'wf_e2e';
/** Mailpit's HTTP API (dev stack / CI service). */
export const MAILPIT_URL = process.env['WF_E2E_MAILPIT_URL'] ?? 'http://127.0.0.1:8025';
/** Files the specs share (TOTP secret, backup codes, the invited user's session); under the git-ignored reports. */
export const STATE_DIR = path.resolve(import.meta.dirname, '../../../reports/e2e-state');

/** The suite's "now" at the start of a run: the design persona's day (the seed's goldens assume 15 Okt 2026). */
export const E2E_NOW = '2026-10-15T09:42:00+07:00';

/**
 * The one clock offset of a run, `Date.parse(E2E_NOW)` minus the real time, fixed once by `playwright.config.ts`
 * (`process.env` is set in the runner before the web server and the test workers start, and inherited by both; the
 * workers re-evaluate the config but keep the inherited value). The server (`clock.ts`), Postgres (`prepare.ts`), the
 * TOTP codes, and the browser (`context.clock.setSystemTime`) all add it to the real time, so they agree while time
 * passes. 0 outside that config: the self-host proof runs against a real clock.
 *
 * Cookie lifetimes are `Max-Age` (relative), so the browser's real cookie clock does not matter; Valkey windows are
 * TTLs.
 */
export function clockOffsetMs(): number {
  return Number(process.env['WF_E2E_CLOCK_OFFSET_MS'] ?? 0);
}

/** The run's current time in epoch milliseconds, as the E2E server sees it. */
export function e2eNow(): number {
  return Date.now() + clockOffsetMs();
}

const DATABASE_KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_WORKER',
  'DATABASE_URL_AUTH',
  'DATABASE_URL_MIGRATE',
  'DATABASE_URL_SUPERUSER',
  'DATABASE_URL_READONLY_OPS',
] as const;

/** `.env.example` with every database URL pointing at {@link E2E_DATABASE}, and the production server settings. */
export function e2eEnv(): Record<string, string> {
  const env = exampleEnv({
    NODE_ENV: 'production',
    PORT: String(PORT),
    PUBLIC_URL: BASE_URL,
    LOG_LEVEL: 'warn',
    KEK_FILE: path.join(tmpdir(), 'wf-e2e-kek'),
  });
  for (const key of DATABASE_KEYS) {
    const url = new URL(env[key] ?? '');
    url.pathname = `/${E2E_DATABASE}`;
    env[key] = url.href;
  }
  return env;
}
