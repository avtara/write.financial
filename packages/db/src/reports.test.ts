// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createPeriods } from './periods.ts';
import { createReports } from './reports.ts';
import { seedLedger } from './seed.ts';

let test: TestDatabase;
let userId: string;
const dek = generateDek();
const options = { getDek: () => Promise.resolve(dek), now: () => new Date('2026-10-15T10:00:00Z') };
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const reports = () => createReports(test.db, options);

/** Seeded once: the September report is the milestone's golden. */
beforeAll(async () => {
  test = await startMigrated();
  userId = await insertUser(test, 'avtara@example.test');
  await asApp(() => seedLedger(test.db, userId, { getDek: options.getDek }));
}, PGLITE_HOOK_TIMEOUT * 3);

afterAll(async () => {
  await test.close();
});

async function closedPeriodId(): Promise<string> {
  return asApp(async () => {
    const [period] = await createPeriods(test.db, options).covering(userId, {
      from: '2026-09-15' as LocalDate,
      to: '2026-09-15' as LocalDate,
    });
    return period?.id as string;
  });
}

describe('the September report (M6 golden)', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('snapshots the design figures and is final', async () => {
    const report = await asApp(() =>
      reports().generate(userId, { kind: 'monthly', periodId: '' }, new Date('2026-10-15T10:00:00Z')),
    ).catch((error: unknown) => error);
    // The empty id is refused by the database helper like any unknown period.
    expect(String(report)).toMatch(/period/i);

    const periodId = await closedPeriodId();
    const september = await asApp(() =>
      reports().generate(userId, { kind: 'monthly', periodId }, new Date('2026-10-15T10:00:00Z')),
    );
    expect(september.kind).toBe('monthly');
    expect(september.status).toBe('final');
    expect(september.label).toBe('2026-09');
    expect(september.range).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(september.totals.incomeMinor).toBe(25_800_000n);
    expect(september.totals.expenseMinor).toBe(18_300_000n);
    expect(september.totals.savedMinor).toBe(7_500_000n);
    expect(september.totals.savingRateBps).toBe(2907);
    // The design rounds the report to "Rp112.200.000"; the balances at 30 Sep are 54.523.000 cash + 57.700.000
    // invested, and the Gotrade balance in USD has no reference rate on or before that date (named, not guessed).
    expect(september.totals.netWorthMinor).toBe(112_223_000n);
    expect(september.sections.netWorth).toEqual({
      valueMinor: 112_223_000n,
      cashMinor: 54_523_000n,
      investmentsMinor: 57_700_000n,
      unvaluedCurrencies: ['USD'],
      asOf: '2026-09-30',
    });
  });

  it('has the spending lines, the largest transactions, and the month average', async () => {
    const periodId = await closedPeriodId();
    const september = await asApp(() => reports().generate(userId, { kind: 'monthly', periodId }, new Date()));
    expect(september.totals.txCount).toBeGreaterThan(100);
    // Sewa Kos 4.500.000 is the largest expense and its category is the largest line.
    expect(september.sections.largest[0]?.amountMinor).toBe(4_500_000n);
    expect(september.sections.largest[0]?.shareBps).toBe(2459);
    expect(september.sections.largestShareBps).not.toBeNull();
    expect(september.sections.categories[0]?.spentMinor).toBe(4_500_000n);
    expect(september.sections.categories.some((line) => line.overMinor > 0n)).toBe(true);
    expect(september.sections.merchants.length).toBeGreaterThan(0);
    expect(september.sections.accounts.length).toBeGreaterThan(0);
    expect(september.sections.goals.map((goal) => goal.name)).toContain('Dana Darurat');
    expect(september.sections.averageDailyMinor).toBe(610_000n);
    expect(september.sections.busiestWeek).not.toBeNull();
    expect(september.sections.days.length).toBe(30);
    expect(september.sections.subscriptions.active).toBeGreaterThan(0);
  });

  it('keeps a stored report unchanged (immutable)', async () => {
    const periodId = await closedPeriodId();
    const first = await asApp(() => reports().generate(userId, { kind: 'monthly', periodId }, new Date()));
    const again = await asApp(() => reports().generate(userId, { kind: 'monthly', periodId }, new Date()));
    expect(again.id).toBe(first.id);
    // Not regenerated: same stored row and timestamp.
    expect(again.generatedAt).toEqual(first.generatedAt);
    expect(again.totals).toEqual(first.totals);
  });

  it('refuses a period that is still open', async () => {
    const open = await asApp(async () => {
      const [period] = await createPeriods(test.db, options).covering(userId, {
        from: '2026-10-15' as LocalDate,
        to: '2026-10-15' as LocalDate,
      });
      return period?.id as string;
    });
    await expect(asApp(() => reports().generate(userId, { kind: 'monthly', periodId: open }, new Date()))).rejects.toThrow(
      'The period is still open',
    );
  });
});

describe('ranges and listings', { timeout: PGLITE_HOOK_TIMEOUT }, () => {
  it('builds a provisional custom range from the ledger and validates it', async () => {
    const range = await asApp(() =>
      reports().generate(
        userId,
        { kind: 'custom', from: '2026-10-01' as LocalDate, to: '2026-10-15' as LocalDate },
        new Date('2026-10-15T10:00:00Z'),
      ),
    );
    expect(range.kind).toBe('custom');
    expect(range.status).toBe('provisional');
    expect(range.label).toBe('2026-10-01/2026-10-15');
    expect(range.totals.expenseMinor).toBeGreaterThan(0n);
    await expect(
      asApp(() =>
        reports().generate(
          userId,
          { kind: 'custom', from: '2026-10-15' as LocalDate, to: '2026-10-01' as LocalDate },
          new Date(),
        ),
      ),
    ).rejects.toThrow('starts after');
    await expect(
      asApp(() =>
        reports().generate(
          userId,
          { kind: 'custom', from: '2025-01-01' as LocalDate, to: '2026-10-01' as LocalDate },
          new Date(),
        ),
      ),
    ).rejects.toThrow('longer than a year');
  });

  it('aggregates a quarter that ended before today as final, and lists reports newest first', async () => {
    const quarter = await asApp(() =>
      reports().generate(userId, { kind: 'quarterly', year: 2026, quarter: 3 }, new Date('2026-10-15T10:00:00Z')),
    );
    expect(quarter.status).toBe('final');
    expect(quarter.label).toBe('2026-Q3');
    expect(quarter.range).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    // July and August have no transactions in the seed; the quarter equals September's flows.
    expect(quarter.totals.incomeMinor).toBe(25_800_000n);
    expect(quarter.totals.expenseMinor).toBe(18_300_000n);

    const year = await asApp(() => reports().generate(userId, { kind: 'yearly', year: 2026 }, new Date()));
    expect(year.kind).toBe('yearly');
    expect(year.status).toBe('provisional');

    const list = await asApp(() => reports().list(userId));
    // Newest range end first; the monthly report was generated last, so it precedes the quarter of the same end.
    expect(list.map((entry) => entry.label)).toEqual(['2026', '2026-10-01/2026-10-15', '2026-09', '2026-Q3']);
    expect(list[0]?.totals.incomeMinor).toBe(year.totals.incomeMinor);

    const latest = await asApp(() => reports().latestFinal(userId));
    expect(latest?.label).toBe('2026-09');
    const one = await asApp(() => reports().get(userId, quarter.id));
    expect(one.sections.categories.length).toBe(quarter.sections.categories.length);
    await expect(asApp(() => reports().get(userId, '00000000-0000-7000-8000-000000000000'))).rejects.toThrow(
      'No such report',
    );
  });

  it("never shows another user's reports", async () => {
    const other = await insertUser(test, 'other@example.test');
    // The superuser reads the id; the app role never sees the row (RLS).
    const [row] = await test.query<{ id: string }>(`SELECT id FROM reports LIMIT 1`);
    const foreign = row?.id as string;
    await expect(asApp(() => reports().get(other, foreign))).rejects.toThrow('No such report');
    expect(await asApp(() => reports().list(other))).toEqual([]);
  });
});
