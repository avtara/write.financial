// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, startMigrated, PGLITE_HOOK_TIMEOUT, type TestDatabase } from '../test/pglite.ts';
import { createMaintenance, type Maintenance } from './maintenance.ts';

let test: TestDatabase;
let maintenance: Maintenance;
let admin: string;

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  test = await startMigrated();
  maintenance = createMaintenance(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM verifications');
  await test.query('DELETE FROM users');
  admin = await insertUser(test, 'admin@example.test', 'admin');
});

/** Inserts the fixture rows as the superuser; `at` are SQL expressions relative to the server's now(). */
async function seed(): Promise<void> {
  await test.query(`INSERT INTO verifications (identifier, value, expires_at) VALUES
    ('v-expired', 'x', now() - interval '1 minute'), ('v-live', 'x', now() + interval '1 hour')`);
  const session = (name: string, expiresAt: string) =>
    test.query(`INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, ${expiresAt})`, [name, admin]);
  await session('s-expired', `now() - interval '1 minute'`);
  await session('s-live', `now() + interval '1 day'`);
  const invitation = (email: string, expiresAt: string, usedAt: string) =>
    test.query(
      `INSERT INTO invitations (email, token_hash, invited_by, expires_at, used_at) VALUES ($1, $2, $3, ${expiresAt}, ${usedAt})`,
      [email, randomBytes(32).toString('hex'), admin],
    );
  await invitation('expired-31d@example.test', `now() - interval '31 days'`, 'NULL');
  await invitation('expired-1d@example.test', `now() - interval '1 day'`, 'NULL');
  await invitation('used-31d@example.test', `now() - interval '20 days'`, `now() - interval '31 days'`);
  await invitation('used-1d@example.test', `now() + interval '6 days'`, `now() - interval '1 day'`);
  await invitation('open@example.test', `now() + interval '7 days'`, 'NULL');
}

async function remaining(): Promise<Record<string, string[]>> {
  const names = async (query: string) => (await test.query<{ name: string }>(query)).map((row) => row.name);
  return {
    verifications: await names('SELECT identifier AS name FROM verifications ORDER BY identifier'),
    sessions: await names('SELECT token AS name FROM sessions ORDER BY token'),
    invitations: await names('SELECT email AS name FROM invitations ORDER BY email'),
  };
}

const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);

describe('purgeExpiredAuth', () => {
  it('deletes only expired verifications and sessions and invitations dead for over 30 days; a rerun deletes nothing', async () => {
    await seed();
    const now = new Date();
    expect(await asWorker(() => maintenance.purgeExpiredAuth(now))).toEqual({
      verifications: 1,
      sessions: 1,
      invitations: 2,
    });
    expect(await remaining()).toEqual({
      verifications: ['v-live'],
      sessions: ['s-live'],
      invitations: ['expired-1d@example.test', 'open@example.test', 'used-1d@example.test'],
    });
    expect(await asWorker(() => maintenance.purgeExpiredAuth(now))).toEqual({
      verifications: 0,
      sessions: 0,
      invitations: 0,
    });
  });

  it('purges as of the given time, so rows that expired after it stay', async () => {
    await seed();
    expect(await asWorker(() => maintenance.purgeExpiredAuth(new Date(Date.now() - 2 * DAY)))).toEqual({
      verifications: 0,
      sessions: 0,
      invitations: 0,
    });
  });

  it('caps a future time at the database clock, so live rows survive', async () => {
    await seed();
    expect(await asWorker(() => maintenance.purgeExpiredAuth(new Date(Date.now() + 365 * DAY)))).toEqual({
      verifications: 1,
      sessions: 1,
      invitations: 2,
    });
    expect((await remaining()).sessions).toEqual(['s-live']);
  });

  it.each(['wf_app', 'wf_auth', 'wf_readonly_ops'] as const)('is not executable by %s', async (role) => {
    await expect(test.as(role, () => maintenance.purgeExpiredAuth(new Date()))).rejects.toMatchObject(
      pgError(/permission denied for function wf_maintenance_purge_auth/),
    );
  });

  it('gives the worker no direct access to the auth tables', async () => {
    await expect(asWorker(() => test.query('DELETE FROM sessions'))).rejects.toThrow(/permission denied/);
  });
});
