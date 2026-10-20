// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createDetectRecurring } from './detect-recurring.ts';

/** The job at 15 Okt 2026, 03.00 WIB. */
const NOW = new Date('2026-10-14T20:00:00Z');

let test: TestDatabase;
let ledger: LedgerFixture;
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);
const detect = (now = NOW) => asWorker(() => createDetectRecurring(test.db).detect(ledger.userId, now));

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  ledger = await ledgerFixture(test, 'avtara@example.test');
});

/** Expenses of `amountMinor` at `merchant` on each date, in Langganan. */
async function charges(merchant: string, amountMinor: bigint, dates: readonly string[]) {
  for (const date of dates) {
    await ledger.entry('expense', date, amountMinor, ledger.category('system:subscriptions'), { merchant });
  }
}

const candidates = () =>
  test.query(
    `SELECT merchant_key, merchant, day_of_month, amount_minor::text AS amount, currency, occurrences,
       to_char(last_seen_on, 'YYYY-MM-DD') AS last_seen_on, account_id, category_id, status
     FROM detected_recurring WHERE user_id = $1 ORDER BY merchant_key`,
    [ledger.userId],
  );

const notifications = () =>
  test.query('SELECT type, title_key, body_key, params, action, ref FROM notifications WHERE user_id = $1', [
    ledger.userId,
  ]);

describe('subscription detection', () => {
  it('suggests Vidio (3 monthly charges), not known subscriptions, dismissed candidates, or irregular spending', async () => {
    const { userId, bca } = ledger;
    const langganan = ledger.category('system:subscriptions');
    await charges('Vidio', 39_000n, ['2026-08-12', '2026-09-12', '2026-10-12']);
    await charges('Netflix', 186_000n, ['2026-07-18', '2026-08-18', '2026-09-18']);
    await charges('Spotify', 54_990n, ['2026-08-05', '2026-09-05', '2026-10-05']);
    await charges('Indomaret', 50_000n, ['2026-08-03']);
    await charges('Indomaret', 120_000n, ['2026-09-20']);
    await charges('Indomaret', 75_000n, ['2026-10-09']);
    for (const date of ['2026-07-25', '2026-08-25', '2026-09-25']) {
      await ledger.entry('income', date, 26_000_000n, ledger.category('system:salary'), { merchant: 'PT Arunika' });
    }
    await test.query(
      `INSERT INTO subscriptions (user_id, name, price_minor, currency, cycle, next_billing_date, pay_from_account_id,
         started_on)
       VALUES ($1, 'Netflix', 186000, 'IDR', 'monthly', '2026-10-18', $2, '2026-01-18')`,
      [userId, bca],
    );
    await test.query(
      `INSERT INTO detected_recurring (user_id, merchant_key, merchant, day_of_month, amount_minor, currency,
         occurrences, last_seen_on, status)
       VALUES ($1, 'spotify', 'Spotify', 5, 54990, 'IDR', 3, '2026-10-05', 'dismissed')`,
      [userId],
    );

    expect(await detect()).toEqual({ created: 1, updated: 0 });
    const vidio = {
      merchant_key: 'vidio',
      merchant: 'Vidio',
      day_of_month: 12,
      amount: '39000',
      currency: 'IDR',
      occurrences: 3,
      last_seen_on: '2026-10-12',
      account_id: bca,
      category_id: langganan,
      status: 'new',
    };
    expect((await candidates()).map((row) => row.merchant_key)).toEqual(['spotify', 'vidio']);
    expect((await candidates())[1]).toEqual(vidio);
    const notified = [
      {
        type: 'subscriptions_detected',
        title_key: 'notification_subscriptions_detected_title',
        body_key: 'notification_subscriptions_detected_body',
        params: { merchant: 'Vidio', amount: { amountMinor: '39000', currency: 'IDR' }, day: 12, count: 3 },
        action: { href: '/subscriptions' },
        ref: 'det.vidio',
      },
    ];
    expect(await notifications()).toEqual(notified);

    // A rerun refreshes the pending candidate with the latest charge; no second row or notification.
    expect(await detect()).toEqual({ created: 0, updated: 1 });
    await charges('Vidio', 45_000n, ['2026-10-13']);
    expect(await detect()).toEqual({ created: 0, updated: 1 });
    expect((await candidates())[1]).toEqual({
      ...vidio,
      day_of_month: 13,
      amount: '45000',
      last_seen_on: '2026-10-13',
    });
    expect(await notifications()).toEqual(notified);

    // Once added (or dismissed) it is never suggested again.
    await test.query(`UPDATE detected_recurring SET status = 'added' WHERE merchant_key = 'vidio'`);
    expect(await detect()).toEqual({ created: 0, updated: 0 });
    expect(await candidates()).toHaveLength(2);
    // D14: suggestions only.
    expect(await test.query('SELECT count(*)::int AS n FROM subscriptions WHERE user_id = $1', [userId])).toEqual([
      { n: 1 },
    ]);
  });

  it('waits for 2 months of data', async () => {
    await charges('Vidio', 39_000n, ['2026-08-16', '2026-09-14', '2026-10-14']);
    // 15 Okt: the data starts after 15 Agu.
    expect(await detect()).toEqual({ created: 0, updated: 0 });
    expect(await candidates()).toEqual([]);
    // 16 Okt: two months.
    expect(await detect(new Date('2026-10-15T20:00:00Z'))).toEqual({ created: 1, updated: 0 });
  });

  it('finds nothing without transactions', async () => {
    expect(await detect()).toEqual({ created: 0, updated: 0 });
    expect(await notifications()).toEqual([]);
  });
});
