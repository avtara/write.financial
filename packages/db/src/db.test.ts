// SPDX-License-Identifier: AGPL-3.0-only
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPglite, PGLITE_HOOK_TIMEOUT, type PgliteServer } from '../test/pglite.ts';
import { createDb, firstRow, InvalidUserIdError, isUuid, MissingRowError, withUser, type Database } from './db.ts';

const USER = '0199f0a1-0000-7000-8000-000000000001';

let pglite: PgliteServer;
let db: Database;

beforeAll(async () => {
  pglite = await startPglite();
  db = createDb(pglite.url, { max: 1, statementTimeoutMs: 0 });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await db.$client.end();
  await pglite.close();
});

const currentUserSetting = async (tx: Pick<Database, 'execute'>) =>
  firstRow(await tx.execute<{ v: string | null }>(sql`select current_setting('app.user_id', true) as v`), 'setting').v;

describe('createDb', () => {
  it('connects lazily and queries through postgres.js and Drizzle', async () => {
    const pool = createDb(pglite.url);
    try {
      expect(await pool.execute(sql`select 1 + 1 as two`)).toEqual([{ two: 2 }]);
    } finally {
      await pool.$client.end();
    }
  });
});

describe('isUuid', () => {
  it.each([USER, USER.toUpperCase(), '00000000-0000-0000-0000-000000000000'])('accepts %s', (value) => {
    expect(isUuid(value)).toBe(true);
  });

  it.each(['', 'not-a-uuid', `${USER} `, `{${USER}}`, USER.replaceAll('-', ''), `${USER}'; drop table users; --`])(
    'rejects %j',
    (value) => {
      expect(isUuid(value)).toBe(false);
    },
  );
});

describe('withUser', () => {
  it('sets app.user_id for the transaction only', async () => {
    expect(await withUser(db, USER, currentUserSetting)).toBe(USER);
    // Placeholder settings read back as '' once the transaction that set them has ended.
    expect(await currentUserSetting(db)).toBe('');
  });

  it('commits what fn wrote and returns its result', async () => {
    await db.execute(sql`create table t_commit (v text)`);
    const result = await withUser(db, USER, async (tx) => {
      await tx.execute(sql`insert into t_commit values ('kept')`);
      return 'done';
    });
    expect(result).toBe('done');
    expect(await db.execute(sql`select v from t_commit`)).toEqual([{ v: 'kept' }]);
  });

  it('rolls back and rethrows when fn fails', async () => {
    await db.execute(sql`create table t_rollback (v text)`);
    const failure = new Error('boom');
    await expect(
      withUser(db, USER, async (tx) => {
        await tx.execute(sql`insert into t_rollback values ('lost')`);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await db.execute(sql`select v from t_rollback`)).toEqual([]);
    expect(await currentUserSetting(db)).toBe('');
  });

  it.each(['', 'admin', `${USER}' or true --`])('rejects the user id %j before touching the database', async (id) => {
    let called = false;
    const result = withUser(db, id, () => {
      called = true;
      return Promise.resolve();
    });
    await expect(result).rejects.toThrow(new InvalidUserIdError());
    await expect(result).rejects.toBeInstanceOf(TypeError);
    expect(new InvalidUserIdError().message).toBe('userId must be a UUID');
    expect(called).toBe(false);
  });
});

describe('firstRow', () => {
  it('returns the first row', () => {
    expect(firstRow([{ a: 1 }, { a: 2 }], 'thing')).toEqual({ a: 1 });
  });

  it('throws MissingRowError naming what was expected', () => {
    expect(() => firstRow([], 'user_keys')).toThrow(new MissingRowError('No user_keys row is visible'));
  });
});
