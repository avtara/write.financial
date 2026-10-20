// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createBalanceChecks } from './balance-checks.ts';

/** The job at 15 Okt 2026, 07.00 WIB. */
const NOW = new Date('2026-10-15T00:00:00Z');

let test: TestDatabase;
let ledger: LedgerFixture;
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  ledger = await ledgerFixture(test, 'avtara@example.test');
  await test.query(`UPDATE accounts SET created_at = '2026-09-01T05:00:00Z' WHERE user_id = $1`, [ledger.userId]);
});

/** Another account of the user (opened 10 Okt), returning its id. */
async function account(
  name: string,
  values: {
    readonly type?: 'bank' | 'credit_card';
    readonly openingMinor?: number;
    readonly ccLimitMinor?: number;
    readonly thresholdMinor?: number;
    readonly archived?: boolean;
  },
): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date,
       color, created_at, cc_limit_minor, low_balance_threshold_minor, status, archived_at)
     VALUES ($1, $2, $3::text, $3::text, 'IDR', $4, '2026-01-01', 'blue', '2026-10-10T05:00:00Z', $5, $6,
       CASE WHEN $7::boolean THEN 'archived'::account_status ELSE 'active' END,
       CASE WHEN $7::boolean THEN '2026-10-10T05:00:00Z'::timestamptz END)
     RETURNING id`,
    [
      ledger.userId,
      values.type ?? 'bank',
      name,
      values.openingMinor ?? 0,
      values.ccLimitMinor ?? null,
      values.thresholdMinor ?? null,
      values.archived ?? false,
    ],
  );
  return row?.id as string;
}

async function subscription(name: string, accountId: string): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO subscriptions (user_id, name, price_minor, currency, cycle, next_billing_date, pay_from_account_id,
       started_on)
     VALUES ($1, $2, 1, 'IDR', 'monthly', '2026-10-16', $3, '2026-01-01') RETURNING id`,
    [ledger.userId, name, accountId],
  );
  return row?.id as string;
}

async function recurrence(type: 'expense' | 'income', accountId: string): Promise<string> {
  const template = {
    type,
    accountId,
    amountMinor: '1',
    categoryId: null,
    merchant: null,
    description: type === 'income' ? 'Gaji' : 'Kos',
    tags: [],
  };
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO recurrences (user_id, template, freq, month_day, start_on)
     VALUES ($1, $2, 'monthly', 18, '2026-01-18') RETURNING id`,
    [ledger.userId, JSON.stringify(template)],
  );
  return row?.id as string;
}

async function bill(sourceType: string, sourceId: string, dueDate: string, expected: bigint, status = 'scheduled') {
  await test.query(
    `INSERT INTO scheduled_occurrences (user_id, source_type, source_id, due_date, expected_minor, currency, status)
     VALUES ($1, $2, $3, $4, $5, 'IDR', $6)`,
    [ledger.userId, sourceType, sourceId, dueDate, expected, status],
  );
}

const notifications = () =>
  test.query<{ type: string; body_key: string; params: Record<string, unknown>; action: unknown; ref: string }>(
    'SELECT type, body_key, params, action, ref FROM notifications WHERE user_id = $1 ORDER BY type::text, ref',
    [ledger.userId],
  );

const money = (amountMinor: string) => ({ amountMinor, currency: 'IDR' });

describe('balance checks', () => {
  it('notifies low balances, unchecked accounts, and bills the paying account cannot cover; once per ref', async () => {
    const { userId, bca, jago } = ledger;
    // BCA (Rp100.000.000) is below its Rp150.000.000 threshold and was last checked 30 Sep (stale since 14 Okt);
    // Jago has never been checked since it was opened on 1 Sep (stale since 15 Sep).
    await test.query(
      `UPDATE accounts SET low_balance_threshold_minor = 150000000, last_reconciled_at = '2026-09-30T05:00:00Z'
       WHERE id = $1`,
      [bca],
    );
    await test.query('UPDATE accounts SET low_balance_threshold_minor = 50000000 WHERE id = $1', [jago]);
    const card = await account('Kartu Kredit', {
      type: 'credit_card',
      openingMinor: -4_000_000,
      ccLimitMinor: 5_000_000,
    });
    const oldCard = await account('Kartu Lama', { type: 'credit_card' });
    await account('Tutup', { thresholdMinor: 1_000_000_000, archived: true });

    // Jago pays Rp110.000.000 in the next 3 days (a subscription and a recurrence in review) with Rp100.000.000.
    await bill('subscription', await subscription('Vidio', jago), '2026-10-17', 60_000_000n);
    const kos = await recurrence('expense', jago);
    await bill('recurrence', kos, '2026-10-18', 50_000_000n, 'due_review');
    // Not counted: after the horizon, skipped, not a bill, income, or a source that no longer exists.
    await bill('recurrence', kos, '2026-10-19', 900_000_000n);
    await bill('subscription', await subscription('Spotify', jago), '2026-10-16', 900_000_000n, 'skipped');
    await bill('goal_plan', randomUUID(), '2026-10-16', 900_000_000n);
    await bill('recurrence', await recurrence('income', bca), '2026-10-16', 900_000_000n);
    await bill('subscription', randomUUID(), '2026-10-16', 900_000_000n);
    // BCA covers its bill; the card has Rp1.000.000 of credit left for Rp2.000.000; a card without a limit is
    // not checked.
    await bill('subscription', await subscription('YouTube', bca), '2026-10-16', 1_000n);
    await bill('subscription', await subscription('Netflix', card), '2026-10-16', 2_000_000n);
    await bill('subscription', await subscription('Disney', oldCard), '2026-10-16', 10_000_000n);

    const checks = createBalanceChecks(test.db);
    expect(await asWorker(() => checks.check(userId, NOW))).toEqual({ lowBalance: 1, unchecked: 2, insufficient: 2 });
    expect(await asWorker(() => checks.check(userId, NOW))).toEqual({ lowBalance: 0, unchecked: 0, insufficient: 0 });

    expect(await notifications()).toEqual(
      [
        {
          type: 'account_unchecked',
          body_key: 'notification_account_unchecked_body',
          params: { accountId: bca, account: 'BCA', checkedOn: '2026-09-30' },
          action: { href: '/accounts' },
          ref: `unchecked.${bca}.2026-10-14`,
        },
        {
          type: 'account_unchecked',
          body_key: 'notification_account_unchecked_never_body',
          params: { accountId: jago, account: 'Jago', checkedOn: '2026-09-01' },
          action: { href: '/accounts' },
          ref: `unchecked.${jago}.2026-09-15`,
        },
        {
          type: 'insufficient_balance',
          body_key: 'notification_insufficient_balance_body',
          params: {
            accountId: card,
            account: 'Kartu Kredit',
            balance: money('1000000'),
            needed: money('2000000'),
            count: 1,
            until: '2026-10-16',
          },
          action: { href: '/subscriptions' },
          ref: `insufficient.${card}.2026-10-15`,
        },
        {
          type: 'insufficient_balance',
          body_key: 'notification_insufficient_balance_body',
          params: {
            accountId: jago,
            account: 'Jago',
            balance: money('100000000'),
            needed: money('110000000'),
            count: 2,
            until: '2026-10-18',
          },
          action: { href: '/subscriptions' },
          ref: `insufficient.${jago}.2026-10-15`,
        },
        {
          type: 'low_balance',
          body_key: 'notification_low_balance_body',
          params: {
            accountId: bca,
            account: 'BCA',
            balance: money('100000000'),
            threshold: money('150000000'),
          },
          action: { href: '/accounts' },
          ref: `low.${bca}.2026-10-15`,
        },
      ].toSorted((a, b) => a.type.localeCompare(b.type) || a.ref.localeCompare(b.ref)),
    );

    // The next day: low balance and the bills again, the same stale spells not.
    expect(await asWorker(() => checks.check(userId, new Date('2026-10-16T00:00:00Z')))).toEqual({
      lowBalance: 1,
      unchecked: 0,
      insufficient: 2,
    });
    // D14: notifications only.
    expect(await test.query('SELECT count(*)::int AS n FROM transactions WHERE user_id = $1', [userId])).toEqual([
      { n: 0 },
    ]);
  });

  it('stays quiet for a healthy, recently checked ledger', async () => {
    await test.query(`UPDATE accounts SET last_reconciled_at = '2026-10-10T05:00:00Z' WHERE user_id = $1`, [
      ledger.userId,
    ]);
    expect(await asWorker(() => createBalanceChecks(test.db).check(ledger.userId, NOW))).toEqual({
      lowBalance: 0,
      unchecked: 0,
      insufficient: 0,
    });
    expect(await notifications()).toEqual([]);
  });
});
