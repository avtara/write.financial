// SPDX-License-Identifier: AGPL-3.0-only
import { periodStartDay, type PeriodStartDay } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { InvalidUserIdError } from './db.ts';
import {
  createPreferences,
  DEFAULT_PREFERENCES,
  type PreferencesPatch,
  type PreferencesRepository,
} from './preferences.ts';

let test: TestDatabase;
let preferences: PreferencesRepository;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await startMigrated();
  preferences = createPreferences(test.db);
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

describe('preferences', () => {
  it('returns the defaults before the first update, without creating a row', async () => {
    expect(await asApp(() => preferences.get(alice))).toEqual(DEFAULT_PREFERENCES);
    expect(await test.query('SELECT 1 FROM user_preferences')).toEqual([]);
  });

  it('keeps DEFAULT_PREFERENCES equal to the column defaults', async () => {
    await test.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [alice]);
    expect(await asApp(() => preferences.get(alice))).toEqual(DEFAULT_PREFERENCES);
  });

  it('creates the row on the first update and changes only the given fields afterwards', async () => {
    const created = await asApp(() =>
      preferences.update(alice, { theme: 'light', periodStartDay: periodStartDay(25), notif: { weeklySummary: true } }),
    );
    expect(created).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: 'light',
      periodStartDay: 25,
      notif: { weeklySummary: true },
    });

    const updated = await asApp(() =>
      preferences.update(alice, { hideBalances: true, ccPaymentPriority: ['a', 'b'], extraCurrencies: ['USD', 'SGD'] }),
    );
    expect(updated).toEqual({
      ...created,
      hideBalances: true,
      ccPaymentPriority: ['a', 'b'],
      extraCurrencies: ['USD', 'SGD'],
    });
    expect(await asApp(() => preferences.get(alice))).toEqual(updated);
    // FR-ST1: ISO codes only, at most 20.
    await expect(asApp(() => preferences.update(alice, { extraCurrencies: ['usd'] }))).rejects.toMatchObject(
      pgError(/user_preferences_extra_currencies_check/),
    );
  });

  it('keeps users apart', async () => {
    await asApp(() => preferences.update(alice, { theme: 'system' }));
    expect(await asApp(() => preferences.get(bob))).toEqual(DEFAULT_PREFERENCES);
    const rows = await test.query<{ user_id: string; theme: string }>('SELECT user_id, theme FROM user_preferences');
    expect(rows).toEqual([{ user_id: alice, theme: 'system' }]);
  });

  it('cannot be redirected to another user by a smuggled userId', async () => {
    // A caller bypassing the type system with an extra key.
    const patch = { theme: 'light', userId: bob } as PreferencesPatch;
    await asApp(() => preferences.update(alice, patch));
    expect(await test.query('SELECT user_id FROM user_preferences')).toEqual([{ user_id: alice }]);
  });

  it('lets the worker read but not write', async () => {
    await asApp(() => preferences.update(alice, { weekStart: 'sunday' }));
    expect(await test.as('wf_worker', () => preferences.get(alice))).toMatchObject({ weekStart: 'sunday' });
    await expect(test.as('wf_worker', () => preferences.update(alice, { weekStart: 'monday' }))).rejects.toMatchObject(
      pgError(/permission denied/),
    );
  });

  it('rejects a period start day outside 1–28 in the database too', async () => {
    // Bypasses `periodStartDay()` validation on purpose: the check constraint is the last line of defence.
    const day = 29 as PeriodStartDay;
    await expect(asApp(() => preferences.update(alice, { periodStartDay: day }))).rejects.toMatchObject(
      pgError(/user_preferences_period_start_day_check/),
    );
  });

  it('rejects a user id that is not a UUID', async () => {
    await expect(preferences.get('me')).rejects.toBeInstanceOf(InvalidUserIdError);
  });
});
