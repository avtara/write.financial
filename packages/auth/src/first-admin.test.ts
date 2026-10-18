// SPDX-License-Identifier: AGPL-3.0-only
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AdminExistsError,
  createFirstAdmin,
  hasAdmin,
  InvalidCredentialsInputError,
  type FirstAdminDeps,
  type FirstAdminInput,
} from './first-admin.ts';
import { hashPassword, verifyPassword } from './password.ts';

const PASSWORD = ['admin', 'pass', 'phrase', '2026'].join('-');
const INPUT: FirstAdminInput = { email: ' Admin@Example.TEST ', password: PASSWORD, name: ' Sari ', locale: 'en' };

let test: TestDatabase;
let deps: FirstAdminDeps;
let breached: boolean;

beforeAll(async () => {
  test = await startMigrated();
  await test.pg.exec('SET ROLE wf_auth');
  deps = {
    db: test.db,
    // A fast stand-in: these tests are about the transaction, not the hash (see password.test.ts).
    hashPassword: (password) => Promise.resolve(`plain:${password}`),
    isBreached: () => Promise.resolve(breached),
  };
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  breached = false;
  await test.query('DELETE FROM users');
});

describe('createFirstAdmin', () => {
  it('creates an admin with a credential account like Better Auth email sign-up', async () => {
    expect(await hasAdmin(test.db)).toBe(false);
    const { userId } = await createFirstAdmin(deps, INPUT);
    expect(await hasAdmin(test.db)).toBe(true);
    expect(
      await test.query('SELECT email, name, role, locale, email_verified FROM users WHERE id = $1', [userId]),
    ).toEqual([{ email: 'admin@example.test', name: 'Sari', role: 'admin', locale: 'en', email_verified: false }]);
    expect(
      await test.query('SELECT account_id, provider_id, password FROM accounts_auth WHERE user_id = $1', [userId]),
    ).toEqual([{ account_id: userId, provider_id: 'credential', password: `plain:${PASSWORD}` }]);
  });

  it('refuses once an admin exists', async () => {
    await createFirstAdmin(deps, INPUT);
    await expect(createFirstAdmin(deps, { ...INPUT, email: 'other@example.test' })).rejects.toBeInstanceOf(
      AdminExistsError,
    );
    expect(await test.query('SELECT count(*)::int AS n FROM users')).toEqual([{ n: 1 }]);
  });

  it('lets exactly one of two concurrent wizards win', async () => {
    const results = await Promise.allSettled([
      createFirstAdmin(deps, INPUT),
      createFirstAdmin(deps, { ...INPUT, email: 'second@example.test' }),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: new AdminExistsError() });
    expect(await test.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin'")).toEqual([{ n: 1 }]);
  });

  it('refuses an email that already belongs to an account', async () => {
    await insertUser(test, 'admin@example.test');
    await expect(createFirstAdmin(deps, INPUT)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it.each([
    [{ email: 'not-an-email' }, 'INVALID_EMAIL'],
    [{ name: '   ' }, 'INVALID_NAME'],
    [{ password: 'short1234' }, 'PASSWORD_TOO_SHORT'],
    [{ password: 'x'.repeat(129) }, 'PASSWORD_TOO_LONG'],
  ] as const)('rejects %o with %s', async (patch, code) => {
    const error = await createFirstAdmin(deps, { ...INPUT, ...patch }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidCredentialsInputError);
    expect(error).toMatchObject({ code, message: `Invalid first admin input: ${code}` });
    expect(String(error)).not.toContain(PASSWORD);
  });

  it('rejects a breached password', async () => {
    breached = true;
    await expect(createFirstAdmin(deps, INPUT)).rejects.toMatchObject({ code: 'PASSWORD_COMPROMISED' });
    expect(await hasAdmin(test.db)).toBe(false);
  });

  it('stores a hash the sign-in verifies when wired with Argon2id', async () => {
    const { userId } = await createFirstAdmin({ ...deps, hashPassword }, INPUT);
    const [row] = await test.query<{ password: string }>('SELECT password FROM accounts_auth WHERE user_id = $1', [
      userId,
    ]);
    expect(await verifyPassword({ hash: row?.password ?? '', password: PASSWORD })).toBe(true);
  });
});

describe('AdminExistsError', () => {
  it('has a stable code', () => {
    expect(new AdminExistsError()).toMatchObject({
      code: 'ADMIN_EXISTS',
      message: 'This instance already has an admin',
    });
  });
});
