// SPDX-License-Identifier: AGPL-3.0-only
import type { YearMonth } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createBudgetAlerts } from './budget-alerts.ts';
import { createBudgets } from './budgets.ts';

/** The hourly job at 15 Okt 2026, 09.00 WIB. */
const NOW = new Date('2026-10-15T02:00:00Z');

let test: TestDatabase;
let ledger: LedgerFixture;
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
  ledger = await ledgerFixture(test, 'avtara@example.test');
});

const notifications = () =>
  test.query<{
    type: string;
    title_key: string;
    body_key: string;
    params: Record<string, unknown>;
    action: unknown;
    ref: string;
  }>('SELECT type, title_key, body_key, params, action, ref FROM notifications WHERE user_id = $1 ORDER BY ref', [
    ledger.userId,
  ]);

describe('budget alerts', () => {
  it('notifies each reached threshold once per period, skipping dismissed, unlimited, and exactly paid lines', async () => {
    const { userId } = ledger;
    const food = ledger.category('system:food');
    const rent = ledger.category('system:rent');
    const shopping = ledger.category('system:shopping');
    const entertainment = ledger.category('system:entertainment');
    const transport = ledger.category('system:transport');
    const health = ledger.category('system:health');
    const hobby = ledger.category('system:hobby');
    const budgets = createBudgets(test.db, { now: () => NOW });
    await asApp(() =>
      budgets.saveVersion(userId, {
        effectiveFrom: '2026-10' as YearMonth,
        expectedIncomeMinor: 20_000_000n,
        lines: [
          { categoryId: rent, limitMinor: 2_000_000n },
          { categoryId: food, limitMinor: 1_000_000n, alertPct: 80 },
          { categoryId: shopping, limitMinor: 500_000n },
          { categoryId: entertainment, limitMinor: 100_000n, alertPct: 100 },
          { categoryId: transport, limitMinor: 0n },
          { categoryId: health, limitMinor: 100_000n },
          { categoryId: hobby, limitMinor: 1_000_000n },
        ],
      }),
    );
    await ledger.entry('expense', '2026-10-01', 2_000_000n, rent);
    await ledger.entry('expense', '2026-10-03', 850_000n, food);
    await ledger.entry('expense', '2026-10-04', 600_000n, shopping);
    await ledger.entry('expense', '2026-10-05', 100_000n, entertainment);
    await ledger.entry('expense', '2026-10-06', 70_000n, transport);
    await ledger.entry('expense', '2026-10-07', 95_000n, health);
    await ledger.entry('expense', '2026-10-08', 400_000n, hobby);
    const october = (await asApp(() => budgets.status(userId))).period.id as string;
    await asApp(() => budgets.dismissAlert(userId, october, health));

    const alerts = createBudgetAlerts(test.db);
    const ledgerBefore = await test.query('SELECT count(*) AS n FROM transactions WHERE user_id = $1', [userId]);
    expect(await asWorker(() => alerts.check(userId, NOW))).toEqual({ created: 4 });
    // The next hour, a retry, or a restart adds nothing.
    expect(await asWorker(() => alerts.check(userId, new Date('2026-10-15T03:00:00Z')))).toEqual({ created: 0 });
    expect(await test.query('SELECT count(*) AS n FROM transactions WHERE user_id = $1', [userId])).toEqual(
      ledgerBefore,
    );

    const money = (amountMinor: string) => ({ amountMinor, currency: 'IDR' });
    expect(await notifications()).toEqual(
      [
        {
          type: 'budget_threshold',
          title_key: 'notification_budget_threshold_title',
          body_key: 'notification_budget_threshold_body',
          params: {
            categoryId: food,
            category: 'system:food',
            pct: 80,
            usedPct: 85,
            spent: money('850000'),
            limit: money('1000000'),
          },
          action: { href: '/budgets' },
          ref: `bud.${october}.${food}.80`,
        },
        {
          type: 'budget_threshold',
          title_key: 'notification_budget_threshold_title',
          body_key: 'notification_budget_threshold_body',
          params: {
            categoryId: shopping,
            category: 'system:shopping',
            pct: 85,
            usedPct: 120,
            spent: money('600000'),
            limit: money('500000'),
          },
          action: { href: '/budgets' },
          ref: `bud.${october}.${shopping}.85`,
        },
        {
          type: 'budget_threshold',
          title_key: 'notification_budget_threshold_over_title',
          body_key: 'notification_budget_threshold_body',
          params: {
            categoryId: shopping,
            category: 'system:shopping',
            pct: 100,
            usedPct: 120,
            spent: money('600000'),
            limit: money('500000'),
          },
          action: { href: '/budgets' },
          ref: `bud.${october}.${shopping}.100`,
        },
        // A warning at 100% is the limit: one notification.
        {
          type: 'budget_threshold',
          title_key: 'notification_budget_threshold_over_title',
          body_key: 'notification_budget_threshold_body',
          params: {
            categoryId: entertainment,
            category: 'system:entertainment',
            pct: 100,
            usedPct: 100,
            spent: money('100000'),
            limit: money('100000'),
          },
          action: { href: '/budgets' },
          ref: `bud.${october}.${entertainment}.100`,
        },
      ].toSorted((a, b) => a.ref.localeCompare(b.ref)),
    );

    // Food then crosses its limit: only the 100% threshold is new.
    await ledger.entry('expense', '2026-10-09', 200_000n, food);
    expect(await asWorker(() => alerts.check(userId, NOW))).toEqual({ created: 1 });
    expect((await notifications()).filter((row) => row.params.categoryId === food).map((row) => row.ref)).toEqual([
      `bud.${october}.${food}.100`,
      `bud.${october}.${food}.80`,
    ]);
  });

  it('notifies nothing without a budget', async () => {
    await ledger.entry('expense', '2026-10-03', 850_000n, ledger.category('system:food'));
    expect(await asWorker(() => createBudgetAlerts(test.db).check(ledger.userId, NOW))).toEqual({ created: 0 });
    expect(await notifications()).toEqual([]);
  });
});
