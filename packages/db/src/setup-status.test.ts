// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { MissingRowError } from './db.ts';
import { isSetupPending } from './setup-status.ts';

let test: TestDatabase;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

it('is pending on a fresh database and no longer once setup was completed, as wf_migrate', async () => {
  expect(await test.as('wf_migrate', () => isSetupPending(test.url))).toBe(true);
  await test.query('UPDATE instance_settings SET setup_completed_at = now()');
  expect(await test.as('wf_migrate', () => isSetupPending(test.url))).toBe(false);
});

it('fails when the settings row is missing', async () => {
  await test.query('DELETE FROM instance_settings');
  await expect(isSetupPending(test.url)).rejects.toThrow(MissingRowError);
});
