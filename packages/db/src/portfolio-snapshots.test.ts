// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createPortfolioSnapshots } from './portfolio-snapshots.ts';
import { seedLedger } from './seed.ts';

let test: TestDatabase;
let userId: string;
const dek = generateDek();
const options = { getDek: () => Promise.resolve(dek), now: () => new Date('2026-10-15T10:00:00Z') };
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  userId = await insertUser(test, 'avtara@example.test');
});

// Seeding the design persona on PGlite takes several seconds on a loaded CI runner.
describe('record (plan §6 `snapshots`)', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('stores the day’s value, cost, per-class values, and the month’s net buys, once per local date', async () => {
    await asApp(() => seedLedger(test.db, userId, options));
    const snapshots = createPortfolioSnapshots(test.db);
    // 23.55 WIB on 15 Oct.
    const at = new Date('2026-10-15T16:55:00Z');
    const snapshot = await asWorker(() => snapshots.record(userId, at));
    const [flows] = await test.query<{ total: string }>(
      `SELECT sum(cost_base_delta_minor)::text AS total FROM investment_trades
       WHERE kind IN ('buy', 'sell') AND status = 'settled' AND local_date BETWEEN '2026-10-01' AND '2026-10-15'`,
    );
    expect(snapshot).toMatchObject({
      date: '2026-10-15',
      valueBaseMinor: 61_420_000n,
      costBaseMinor: 53_931_000n,
      contributionsBaseMinor: BigInt(flows?.total ?? '0'),
    });
    expect(snapshot?.contributionsBaseMinor).toBeGreaterThan(0n);
    const classes = Object.values(snapshot?.breakdown ?? {}).reduce((total, value) => total + BigInt(value), 0n);
    expect(classes).toBe(61_420_000n);
    // Run again (a retry, a restart): the same row is replaced, not added.
    await asWorker(() => snapshots.record(userId, at));
    const rows = await test.query<{ snapshot_date: string; value_base_minor: string }>(
      `SELECT snapshot_date::text, value_base_minor::text FROM portfolio_snapshots WHERE snapshot_date = '2026-10-15'`,
    );
    expect(rows).toEqual([{ snapshot_date: '2026-10-15', value_base_minor: '61420000' }]);
  });

  it('records an empty platform with no money put in this month', async () => {
    await test.query(
      `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
       VALUES ($1, 'investment', 'Bibit', 'Bibit', 'IDR', '2026-10-01', 'cyan')`,
      [userId],
    );
    expect(await asWorker(() => createPortfolioSnapshots(test.db).record(userId, options.now()))).toEqual({
      date: '2026-10-15',
      valueBaseMinor: 0n,
      costBaseMinor: 0n,
      contributionsBaseMinor: 0n,
      breakdown: {},
    });
  });

  it('writes nothing for a user without investments', async () => {
    expect(await asWorker(() => createPortfolioSnapshots(test.db).record(userId, options.now()))).toBeNull();
    expect(await test.query('SELECT * FROM portfolio_snapshots')).toEqual([]);
  });
});
