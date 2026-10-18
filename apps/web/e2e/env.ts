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
