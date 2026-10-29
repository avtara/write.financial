// SPDX-License-Identifier: AGPL-3.0-only
/**
 * M2 exit goldens (plan §8) on the design seed, through the repositories on PGlite with every migration applied:
 * 88,00% / 48,39% / Rp140.000 / 86,67% / 90,37% / 36,54%, the transition 1–24 Nov = Rp15.000.000, September read-only, and
 * 14 Sep – 13 Okt = "30 hari · melintasi 2 periode".
 */
import { generateDek } from '@wf/crypto/envelope';
import { formatPercent } from '@wf/i18n/format';
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createBudgets } from './budgets.ts';
import { createCategories } from './categories.ts';
import { createDashboard } from './dashboard.ts';
import { LedgerError } from './ledger-errors.ts';
import { createPeriods } from './periods.ts';
import { seedLedger } from './seed.ts';
import { createTransactions } from './transactions.ts';

/** 15 Okt 2026, 16.42 WIB ("Diperbarui 15 Okt 2026, 16.42"). */
const NOW = new Date('2026-10-15T09:42:00Z');
const now = () => NOW;
const dek = generateDek();
const getDek = () => Promise.resolve(dek);
const d = (value: string) => value as LocalDate;
const pct = (bps: number | null) => formatPercent((bps as number) / 10_000, 'id');

let test: TestDatabase;
let userId: string;
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

beforeAll(async () => {
  test = await startMigrated();
  userId = await insertUser(test, 'avtara@example.test');
  await asApp(() => seedLedger(test.db, userId, { getDek }));
}, PGLITE_HOOK_TIMEOUT * 3);

afterAll(async () => {
  await test.close();
});

describe('M2 exit on the design seed', () => {
  it('budget page Oktober: 88,00% used, ideal 48,39%, safe daily Rp140.000, Needs 86,67%, Wants 90,37%', async () => {
    const status = await asApp(() => createBudgets(test.db, { now }).status(userId));
    expect(status.period).toMatchObject({ label: '2026-10', start: '2026-10-01', end: '2026-10-31', days: 31 });
    expect(status.totals).toMatchObject({
      limitMinor: 18_750_000n,
      spentMinor: 16_500_000n,
      remainingMinor: 2_250_000n,
      day: 15,
      daysLeft: 16,
      pace: 'ahead',
      safeDailyMinor: 140_000n,
      overCount: 1,
      unbudgetedSpentMinor: 0n,
    });
    expect(pct(status.totals.usedBps)).toBe('88,00%');
    expect(pct(status.totals.idealBps)).toBe('48,39%');
    const groups = Object.fromEntries(status.groups.map((group) => [group.group, group]));
    expect(groups.needs).toMatchObject({ limitMinor: 12_000_000n, spentMinor: 10_400_000n });
    expect(groups.wants).toMatchObject({ limitMinor: 6_750_000n, spentMinor: 6_100_000n });
    expect(pct(groups.needs?.usedBps ?? null)).toBe('86,67%');
    expect(pct(groups.wants?.usedBps ?? null)).toBe('90,37%');
    expect(status.readOnly).toBe(false);
    const byKey = new Map(status.lines.map((line) => [line.builtInKey, line]));
    expect(byKey.get('system:shopping')).toMatchObject({ state: 'over', remainingMinor: -400_000n });
    expect(byKey.get('system:rent')).toMatchObject({ state: 'paid', safeDailyMinor: null });
    expect(byKey.get('system:food')).toMatchObject({ state: 'warning', safeDailyMinor: 18_000n, count: 18 });
  });

  it('dashboard Oktober: saving rate 36,54% vs Sep 29,07%', async () => {
    const dashboard = await asApp(() => createDashboard(test.db, { now }).get(userId, { scope: 'month' }));
    expect(dashboard.kpis.current).toEqual({
      incomeMinor: 26_000_000n,
      expenseMinor: 16_500_000n,
      savedMinor: 9_500_000n,
      savingRateBps: 3654,
    });
    expect(pct(dashboard.kpis.current.savingRateBps)).toBe('36,54%');
    expect(dashboard.kpis.previous).toEqual({
      incomeMinor: 25_800_000n,
      expenseMinor: 18_300_000n,
      savedMinor: 7_500_000n,
      savingRateBps: 2907,
    });
    expect(pct(dashboard.kpis.previous.savingRateBps)).toBe('29,07%');
    expect(pct(dashboard.kpis.change.expenseBps)).toBe('−9,84%');
    expect(dashboard.ranges.current).toEqual({ from: '2026-10-01', to: '2026-10-15' });
  });

  it('September is closed and read-only, with its results', async () => {
    const periods = await asApp(() => createPeriods(test.db, { now }).list(userId));
    const september = periods.periods.find((period) => period.label === '2026-09');
    expect(september).toMatchObject({ status: 'closed', start: '2026-09-01', end: '2026-09-30' });
    const status = await asApp(() =>
      createBudgets(test.db, { now }).status(userId, { periodId: september?.id as string }),
    );
    expect(status.readOnly).toBe(true);
    expect(status.totals).toMatchObject({ spentMinor: 17_600_000n, unbudgetedSpentMinor: 700_000n });
    expect(pct(status.totals.usedBps)).toBe('93,87%');
    expect(status.close.leftoverMinor).toBe(1_150_000n);

    const categories = await asApp(() => createCategories(test.db, { getDek }).list(userId));
    const food = categories.find((category) => category.builtInKey === 'system:food')?.id as string;
    const [account] = (await test.query<{ id: string }>(`SELECT id FROM accounts ORDER BY sort_order LIMIT 1`)) as [
      { id: string },
    ];
    const transactions = createTransactions(test.db, { getDek, now });
    await expect(
      asApp(() =>
        transactions.create(userId, {
          type: 'expense',
          clientId: crypto.randomUUID(),
          occurredAt: new Date('2026-09-20T05:00:00Z'),
          accountId: account.id,
          amountMinor: 10_000n,
          categoryId: food,
        }),
      ),
    ).rejects.toThrow(new LedgerError('PERIOD_CLOSED', 'The date is inside a closed period'));
  });

  it('transition 1–24 Nov = Rp15.000.000 when the start day becomes the 25th', async () => {
    const preview = await asApp(() =>
      createPeriods(test.db, { now }).previewStartDay(userId, { day: 25, apply: 'next_period' }),
    );
    expect(preview.paydayDay).toBe(1);
    expect(preview.transition).toEqual({
      period: { kind: 'transition', start: '2026-11-01', end: '2026-11-24', days: 24, label: '2026-11' },
      limitMinor: 18_750_000n,
      proratedMinor: 15_000_000n,
    });
    const recalc = await asApp(() =>
      createPeriods(test.db, { now }).previewStartDay(userId, { day: 25, apply: 'recalculate' }),
    );
    expect(recalc.periods[0]).toMatchObject({ start: '2026-09-25', end: '2026-10-24', label: '2026-10' });
    expect(recalc.moved.largest[0]).toMatchObject({ merchant: 'Tokopedia', amountMinor: 449_000n });
  });

  it('range 14 Sep – 13 Okt: 30 hari · melintasi 2 periode', async () => {
    const dashboard = await asApp(() =>
      createDashboard(test.db, { now }).get(userId, { scope: 'range', from: d('2026-09-14'), to: d('2026-10-13') }),
    );
    expect(dashboard.summary).toEqual({ days: 30, periodCount: 2 });
  });
});
