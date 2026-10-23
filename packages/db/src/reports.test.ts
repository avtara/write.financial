// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import type { LocalDate } from '@wf/domain/period';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { createFxRates } from './fx-rates.ts';
import { recordTransactionIn } from './ledger-core.ts';
import { balanceAdjustments, postings, reports as reportRows } from './schema.ts';
import { createPeriods } from './periods.ts';
import { createReports } from './reports.ts';
import { seedLedger } from './seed.ts';

let test: TestDatabase;
let userId: string;
const dek = generateDek();
const options = { getDek: () => Promise.resolve(dek), now: () => new Date('2026-10-15T10:00:00Z') };
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const reports = () => createReports(test.db);

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
  it('snapshots the actual ledger figures and is final', async () => {
    await expect(
      asApp(() =>
        reports().generate(
          userId,
          { kind: 'monthly', periodId: '00000000-0000-7000-8000-000000000000' },
          options.now(),
        ),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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
    // Exact ledger values, not the rounded illustration: non-platform cash + the portfolio (platform cash included).
    expect(september.totals.netWorthMinor).toBe(112_223_000n);
    expect(september.sections.netWorth).toEqual({
      valueMinor: 112_223_000n,
      cashMinor: 54_523_000n,
      investmentsMinor: 57_700_000n,
      debtMinor: 0n,
      missingPortfolio: false,
      unvaluedCurrencies: [],
      asOf: '2026-09-30',
    });
    expect(september.sections.goalsAsOf).toBe('2026-09-30');
    expect(september.sections.goals.find((goal) => goal.name === 'Dana Darurat')).toMatchObject({
      currency: 'IDR',
      valuation: 'cash',
      openingMinor: 5_125_000n,
      savedMinor: 7_625_000n,
      targetMinor: 54_000_000n,
      progressBps: 1412,
    });
  });

  it('has the spending lines, the largest transactions, and the month average', async () => {
    const periodId = await closedPeriodId();
    const september = await asApp(() => reports().generate(userId, { kind: 'monthly', periodId }, new Date()));
    // Sewa Kos 4.500.000 is the largest expense and its category is the largest line.
    expect(september.sections.largest[0]?.amountMinor).toBe(4_500_000n);
    expect(september.sections.largest[0]?.shareBps).toBe(2459);
    expect(september.sections.categories[0]?.spentMinor).toBe(4_500_000n);
    expect(september.sections.categories.some((line) => line.overMinor > 0n)).toBe(true);
    expect(september.sections.goals.map((goal) => goal.name)).toContain('Dana Darurat');
    expect(september.sections.averageDailyMinor).toBe(610_000n);
    expect(september.sections.days.length).toBe(30);
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
    await expect(
      asApp(() => reports().generate(userId, { kind: 'monthly', periodId: open }, options.now())),
    ).rejects.toMatchObject({
      code: 'INVALID_PERIOD',
    });
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
    expect(range.totals.expenseMinor).toBe(16_500_000n);
    await expect(
      asApp(() =>
        reports().generate(
          userId,
          { kind: 'custom', from: '2026-10-15' as LocalDate, to: '2026-10-01' as LocalDate },
          new Date(),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
    await expect(
      asApp(() =>
        reports().generate(
          userId,
          { kind: 'custom', from: '2025-01-01' as LocalDate, to: '2026-10-01' as LocalDate },
          new Date(),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_PERIOD' });
  });

  it('keeps historical aggregates provisional and preserves final monthly snapshots', async () => {
    const quarter = await asApp(() =>
      reports().generate(userId, { kind: 'quarterly', year: 2026, quarter: 3 }, new Date('2026-10-15T10:00:00Z')),
    );
    expect(quarter.status).toBe('provisional');
    expect(quarter.label).toBe('2026-Q3');
    expect(quarter.range).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    // July and August have no transactions in the seed; the quarter equals September's flows.
    expect(quarter.totals.incomeMinor).toBe(25_800_000n);
    expect(quarter.totals.expenseMinor).toBe(18_300_000n);

    const year = await asApp(() => reports().generate(userId, { kind: 'yearly', year: 2026 }, new Date()));
    expect(year.kind).toBe('yearly');
    expect(year.status).toBe('provisional');

    const list = await asApp(() => reports().list(userId));
    expect(list[0]?.totals.incomeMinor).toBe(year.totals.incomeMinor);

    const latest = await asApp(() => reports().latestFinal(userId));
    expect(latest?.label).toBe('2026-09');
    const one = await asApp(() => reports().get(userId, quarter.id));
    expect(one).toEqual(quarter);
    await expect(asApp(() => reports().get(userId, '00000000-0000-7000-8000-000000000000'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it("never shows another user's reports", async () => {
    const other = await insertUser(test, 'other@example.test');
    // The superuser reads the id; the app role never sees the row (RLS).
    const [row] = await test.query<{ id: string }>(`SELECT id FROM reports LIMIT 1`);
    const foreign = row?.id as string;
    await expect(asApp(() => reports().get(other, foreign))).rejects.toThrow('No such report');
    expect(await asApp(() => reports().list(other))).toEqual([]);
  });

  it('refreshes provisional reports using local dates, exact historical FX, and grouped transaction spending', async () => {
    const owner = await insertUser(test, 'report-boundaries@example.test');
    await test.query(`UPDATE users SET base_currency = 'EUR', timezone = 'America/Los_Angeles' WHERE id = $1`, [owner]);
    const addAccount = async (name: string, currency: string, opening: bigint, date: string) => {
      const [row] = await test.query<{ id: string }>(
        `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color)
         VALUES ($1, 'bank', $2, $2::text, $3, $4, $5, 'blue') RETURNING id`,
        [owner, name, currency, opening.toString(), date],
      );
      return row?.id as string;
    };
    const bank = await addAccount('Main', 'EUR', 5_000n, '2026-10-01');
    await addAccount('USD', 'USD', 1_234n, '2026-10-01');
    await addAccount('Future', 'EUR', 999_999n, '2026-10-16');
    for (const [asOf, rate] of [
      ['2026-10-01', '0.92345678'],
      ['2026-10-15', '0.5'],
    ] as const) {
      await asApp(() =>
        createFxRates(test.db).upsertManual(owner, { base: 'USD', quote: 'EUR', rate, asOf: asOf as LocalDate }),
      );
    }
    const record = (amountMinor: bigint, occurredAt: string) =>
      asApp(() =>
        withUser(test.db, owner, (tx) =>
          recordTransactionIn(
            tx,
            owner,
            {
              type: 'expense',
              clientId: randomUUID(),
              occurredAt: new Date(occurredAt),
              accountId: bank,
              amountMinor,
              categoryId: null,
              merchant: 'Night shop',
              tags: ['night'],
            },
            dek,
            options.now(),
          ),
        ),
      );
    const first = await record(200n, '2026-10-15T06:30:00Z'); // 14 Oct in the user's zone, 15 Oct in UTC.
    await record(9_999n, '2026-10-15T07:30:00Z'); // 15 Oct locally: outside the report.
    await asApp(() =>
      withUser(test.db, owner, async (tx) => {
        await tx.insert(postings).values({
          userId: owner,
          transactionId: first.id,
          accountId: bank,
          currency: 'EUR',
          amountMinor: -100n,
          amountBaseMinor: -100n,
          role: 'fee',
        });
        await tx.insert(balanceAdjustments).values([
          {
            userId: owner,
            accountId: bank,
            amountMinor: 10n,
            actualBalanceMinor: 4_710n,
            createdAt: new Date('2026-10-15T06:00:00Z'),
          },
          {
            userId: owner,
            accountId: bank,
            amountMinor: 9_999n,
            actualBalanceMinor: 14_709n,
            createdAt: new Date('2026-10-15T07:00:00Z'),
          },
        ]);
      }),
    );
    const request = { kind: 'custom' as const, from: '2026-10-14' as LocalDate, to: '2026-10-14' as LocalDate };
    const before = await asApp(() => reports().generate(owner, request, new Date('2026-10-15T06:40:00Z')));
    expect(before.totals).toMatchObject({ expenseMinor: 300n, txCount: 1, netWorthMinor: 5_850n });
    expect(before.sections.merchants).toEqual([
      { merchant: 'Night shop', totalMinor: 300n, count: 1, shareBps: 10_000 },
    ]);
    expect(before.sections.tags).toEqual([expect.objectContaining({ totalMinor: 300n, count: 1 })]);
    expect(before.sections.accounts).toEqual([
      { accountId: bank, name: 'Main', type: 'bank', inMinor: 0n, outMinor: 300n },
    ]);
    expect(before.sections.largest).toEqual([
      expect.objectContaining({ transactionId: first.id, date: '2026-10-14', amountMinor: 300n }),
    ]);
    await record(150n, '2026-10-15T06:35:00Z');
    const after = await asApp(() => reports().generate(owner, request, new Date('2026-10-15T06:41:00Z')));
    expect(after.id).toBe(before.id);
    expect(after.totals).toMatchObject({ expenseMinor: 450n, txCount: 2, netWorthMinor: 5_700n });
    expect(after.generatedAt).toEqual(new Date('2026-10-15T06:41:00Z'));
    expect(after.sections.netWorthHistory.map((point) => point.valuation?.valueMinor ?? null)).toEqual([
      null,
      null,
      null,
      null,
      null,
      5_700n,
    ]);
  });

  it('uses frozen monthly names in aggregates even after source metadata changes', async () => {
    const periodId = await closedPeriodId();
    const frozen = await asApp(() => reports().generate(userId, { kind: 'monthly', periodId }, options.now()));
    const category = frozen.sections.categories.find((row) => row.categoryId !== null);
    const id = category?.categoryId as string;
    await test.query(`UPDATE categories SET name = 'Renamed after close' WHERE id = $1`, [id]);
    try {
      const aggregate = await asApp(() =>
        reports().generate(userId, { kind: 'quarterly', year: 2026, quarter: 3 }, options.now()),
      );
      expect(aggregate.sections.categories.find((row) => row.categoryId === id)?.name).toBe(category?.name);
      expect(aggregate.totals.expenseMinor).toBe(frozen.totals.expenseMinor);
    } finally {
      await test.query(`UPDATE categories SET name = $2 WHERE id = $1`, [id, category?.name]);
    }
  });

  it('lets the worker create a final report without UPDATE privileges and prevents app rewrites', async () => {
    const owner = await insertUser(test, 'report-worker@example.test');
    await asApp(() => seedLedger(test.db, owner, { getDek: options.getDek }));
    const [period] = await asApp(() =>
      createPeriods(test.db, options).covering(owner, {
        from: '2026-09-01' as LocalDate,
        to: '2026-09-30' as LocalDate,
      }),
    );
    const report = await test.as('wf_worker', () =>
      reports().generate(owner, { kind: 'monthly', periodId: period?.id as string }, options.now()),
    );
    expect(report.totals).toMatchObject({ incomeMinor: 25_800_000n, expenseMinor: 18_300_000n });
    const updated = await asApp(() =>
      withUser(test.db, owner, (tx) =>
        tx
          .update(reportRows)
          .set({ expenseMinor: report.totals.expenseMinor + 1n, savedMinor: report.totals.savedMinor - 1n })
          .where(eq(reportRows.id, report.id))
          .returning(),
      ),
    );
    expect(updated).toEqual([]);
    expect(await asApp(() => reports().get(owner, report.id))).toEqual(report);
  });
});
