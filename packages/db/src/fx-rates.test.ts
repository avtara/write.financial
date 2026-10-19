// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createFxRates, type FxRatesRepository } from './fx-rates.ts';

let test: TestDatabase;
let fx: FxRatesRepository;
let alice: string;
let bob: string;

const day = (value: string) => value as LocalDate;
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);

beforeAll(async () => {
  test = await startMigrated();
  fx = createFxRates(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  await test.query('DELETE FROM fx_rates');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const builtIn = (rate: string, asOf: string, provider = 'frankfurter') => ({
  base: 'USD',
  quote: 'IDR',
  rate,
  provider,
  rateType: 'bi_transaction' as const,
  asOf: day(asOf),
});

describe('built-in rates (worker)', () => {
  it('upserts by provider, pair, and day, and reads the latest without a user', async () => {
    expect(await asWorker(() => fx.upsertGlobal([]))).toBe(0);
    expect(
      await asWorker(() => fx.upsertGlobal([builtIn('16300', '2026-10-14'), builtIn('16340.5', '2026-10-15')])),
    ).toBe(2);
    expect(await asWorker(() => fx.upsertGlobal([{ ...builtIn('16350', '2026-10-15'), rateType: 'blended' }]))).toBe(1);
    expect(await test.query('SELECT count(*)::int AS n FROM fx_rates')).toEqual([{ n: 2 }]);
    expect(await asWorker(() => fx.latestGlobal('USD', 'IDR'))).toMatchObject({
      base: 'USD',
      quote: 'IDR',
      rate: '16350',
      provider: 'frankfurter',
      rateType: 'blended',
      asOf: '2026-10-15',
      manual: false,
    });
    expect(await asWorker(() => fx.latestGlobal('SGD', 'IDR'))).toBeNull();
  });

  it('rejects invalid input before touching the database', async () => {
    await expect(fx.upsertGlobal([{ ...builtIn('0', '2026-10-15') }])).rejects.toMatchObject({ code: 'INVALID_RATE' });
    await expect(fx.upsertGlobal([{ ...builtIn('1', '2026-10-15'), quote: 'USD' }])).rejects.toMatchObject({
      code: 'INVALID_RATE',
    });
    await expect(fx.upsertGlobal([{ ...builtIn('1', '2026-10-15'), base: 'usd' }])).rejects.toMatchObject({
      code: 'INVALID_RATE',
    });
  });

  it('keeps the app from writing built-in rows and the worker from writing manual rows', async () => {
    await expect(asApp(() => fx.upsertGlobal([builtIn('1', '2026-10-15')]))).rejects.toMatchObject(
      pgError(/row-level security/),
    );
    await expect(
      asWorker(() => fx.upsertManual(alice, { base: 'USD', quote: 'IDR', rate: '1', asOf: day('2026-10-15') })),
    ).rejects.toMatchObject(pgError(/row-level security/));
  });

  it('lists every currency in use for the worker only', async () => {
    await test.query(
      `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
       VALUES ($1, 'bank', 'DBS', 'DBS', 'SGD', '2026-10-01', 'blue'), ($2, 'investment', 'Gotrade', 'Gotrade', 'USD', '2026-10-01', 'green')`,
      [alice, bob],
    );
    await asApp(() => fx.upsertManual(bob, { base: 'EUR', quote: 'JPY', rate: '160', asOf: day('2026-10-01') }));
    expect(await asWorker(() => fx.currenciesInUse())).toEqual(['EUR', 'IDR', 'JPY', 'SGD', 'USD']);
    await expect(asApp(() => fx.currenciesInUse())).rejects.toMatchObject(pgError(/permission denied/));
  });
});

describe('manual rates and reference resolution', () => {
  it('creates, replaces, lists, and deletes manual rates per user', async () => {
    const created = await asApp(() =>
      fx.upsertManual(alice, { base: 'USD', quote: 'IDR', rate: '16474.00', asOf: day('2026-10-14') }),
    );
    expect(created).toMatchObject({ base: 'USD', quote: 'IDR', rate: '16474', asOf: '2026-10-14' });
    const replaced = await asApp(() =>
      fx.upsertManual(alice, { base: 'USD', quote: 'IDR', rate: '16480', asOf: day('2026-10-14') }),
    );
    expect(replaced.id).toBe(created.id);
    await asApp(() => fx.upsertManual(alice, { base: 'SGD', quote: 'IDR', rate: '12500', asOf: day('2026-10-15') }));
    expect((await asApp(() => fx.listManual(alice))).map((rate) => [rate.base, rate.rate])).toEqual([
      ['SGD', '12500'],
      ['USD', '16480'],
    ]);
    expect(await asApp(() => fx.listManual(bob))).toEqual([]);
    await expect(asApp(() => fx.deleteManual(bob, created.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asApp(() => fx.deleteManual(alice, created.id));
    expect(await asApp(() => fx.listManual(alice))).toHaveLength(1);
    await expect(
      asApp(() => fx.upsertManual(alice, { base: 'USD', quote: 'IDR', rate: '1e3', asOf: day('2026-10-14') })),
    ).rejects.toMatchObject({ code: 'INVALID_RATE' });
  });

  it('resolves manual → latest built-in → none, in either orientation and as of a date', async () => {
    expect(await asApp(() => fx.referenceRate(alice, 'USD', 'IDR'))).toBeNull();
    await asWorker(() => fx.upsertGlobal([builtIn('16300', '2026-10-01'), builtIn('16350', '2026-10-15')]));
    expect(await asApp(() => fx.referenceRate(alice, 'USD', 'IDR'))).toMatchObject({
      rate: '16350',
      provider: 'frankfurter',
      manual: false,
    });
    expect(await asApp(() => fx.referenceRate(alice, 'USD', 'IDR', day('2026-10-10')))).toMatchObject({
      rate: '16300',
    });
    // Inverse pair: 1 / 16350 at 8 fraction digits.
    expect(await asApp(() => fx.referenceRate(alice, 'IDR', 'USD'))).toMatchObject({
      base: 'IDR',
      quote: 'USD',
      rate: '0.00006116',
    });

    await asApp(() => fx.upsertManual(alice, { base: 'USD', quote: 'IDR', rate: '16474', asOf: day('2026-10-01') }));
    expect(await asApp(() => fx.referenceRate(alice, 'USD', 'IDR'))).toMatchObject({
      rate: '16474',
      provider: 'manual',
      rateType: 'manual',
      manual: true,
    });
    // Bob does not see Alice's manual rate.
    expect(await asApp(() => fx.referenceRate(bob, 'USD', 'IDR'))).toMatchObject({ rate: '16350', manual: false });
  });
});
