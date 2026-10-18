// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { MissingRowError } from './db.ts';
import {
  createProfiles,
  InvalidProfileError,
  isTimeZone,
  MAX_NAME_LENGTH,
  type ProfilesRepository,
} from './profiles.ts';

let test: TestDatabase;
let profiles: ProfilesRepository;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await startMigrated();
  profiles = createProfiles(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

describe('isTimeZone', () => {
  it('accepts IANA zones and UTC, rejects offsets and abbreviations', () => {
    expect(isTimeZone('Asia/Jakarta')).toBe(true);
    expect(isTimeZone('Asia/Makassar')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('+07:00')).toBe(false);
    expect(isTimeZone('WIB')).toBe(false);
  });
});

describe('profiles', () => {
  it('reads the caller’s profile with the column defaults', async () => {
    expect(await asApp(() => profiles.get(alice))).toEqual({
      name: 'alice@example.test',
      nickname: null,
      locale: 'id',
      timezone: 'Asia/Jakarta',
    });
  });

  it('changes only the given fields, trims names, and stores an empty preferred name as none', async () => {
    const updated = await asApp(() =>
      profiles.update(alice, { name: '  Avtara K. ', nickname: ' Avtara ', locale: 'en', timezone: 'Asia/Makassar' }),
    );
    expect(updated).toEqual({ name: 'Avtara K.', nickname: 'Avtara', locale: 'en', timezone: 'Asia/Makassar' });
    expect(await asApp(() => profiles.update(alice, { nickname: '  ' }))).toEqual({ ...updated, nickname: null });
    expect(await asApp(() => profiles.update(alice, { nickname: 'Av' }))).toMatchObject({ nickname: 'Av' });
    expect(await asApp(() => profiles.update(alice, { nickname: null }))).toMatchObject({ nickname: null });
    expect(await asApp(() => profiles.update(alice, {}))).toEqual({ ...updated, nickname: null });
  });

  it('bumps updated_at', async () => {
    await test.query(`UPDATE users SET updated_at = now() - interval '1 day' WHERE id = $1`, [alice]);
    await asApp(() => profiles.update(alice, { locale: 'en' }));
    const [row] = await test.query<{ fresh: boolean }>(
      `SELECT updated_at > now() - interval '1 minute' AS fresh FROM users WHERE id = $1`,
      [alice],
    );
    expect(row?.fresh).toBe(true);
  });

  it('rejects empty or too long names and unknown time zones before touching the database', async () => {
    const long = 'x'.repeat(MAX_NAME_LENGTH + 1);
    for (const [patch, field] of [
      [{ name: '  ' }, 'name'],
      [{ name: long }, 'name'],
      [{ nickname: long }, 'nickname'],
      [{ timezone: 'GMT+7' }, 'timezone'],
    ] as const) {
      const error = await asApp(() => profiles.update(alice, patch)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(InvalidProfileError);
      expect(error).toMatchObject({ field, code: 'INVALID_PROFILE', message: `Invalid profile field: ${field}` });
    }
    expect(await asApp(() => profiles.get(alice))).toMatchObject({ name: 'alice@example.test' });
  });

  it('touches only the caller’s row, and finds nothing for an id without a visible row', async () => {
    await asApp(() => profiles.update(alice, { name: 'Alice' }));
    expect(await asApp(() => profiles.get(bob))).toMatchObject({ name: 'bob@example.test' });
    await expect(asApp(() => profiles.get('00000000-0000-7000-8000-000000000000'))).rejects.toBeInstanceOf(
      MissingRowError,
    );
    await expect(
      asApp(() => profiles.update('00000000-0000-7000-8000-000000000000', { name: 'Mallory' })),
    ).rejects.toBeInstanceOf(MissingRowError);
  });
});
