// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import type { YearMonth } from '@wf/domain/period';
import { DESIGN_SEED, type DesignSeed } from '@wf/domain/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ledgerFixture } from '../test/ledger-fixture.ts';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createBudgets } from './budgets.ts';
import { createPeriodClose } from './period-close.ts';
import { createPeriods } from './periods.ts';
import { createReview } from './review.ts';
import { seedLedger } from './seed.ts';

/** The `period-close` job: 1 Okt 2026, 00.05 WIB. */
const JOB = new Date('2026-10-01T00:05:00+07:00');
/** "Diperbarui 15 Okt 2026, 16.42": the budget page compared before and after. */
const PAGE = new Date('2026-10-15T09:42:00Z');
const dek = generateDek();
const getDek = () => Promise.resolve(dek);
/** The design persona with September still open. */
const OPEN_SEPTEMBER: DesignSeed = { ...DESIGN_SEED, closedPeriods: [] };
/** …and Hiburan rolling over (700.000 left in September). */
const ROLLOVER_SEED: DesignSeed = {
  ...OPEN_SEPTEMBER,
  budgets: DESIGN_SEED.budgets.map((version) => ({
    ...version,
    lines: version.lines.map((line) =>
      line.categoryKey === 'system:entertainment' ? { ...line, rollover: true } : line,
    ),
  })),
};

let test: TestDatabase;
let design: string;
let rollover: string;
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const asWorker = <T>(fn: () => Promise<T>) => test.as('wf_worker', fn);
const close = () => createPeriodClose(test.db, { getDek });

beforeAll(async () => {
  test = await startMigrated();
  design = await insertUser(test, 'design@example.test');
  rollover = await insertUser(test, 'rollover@example.test');
  // The app was used during September, so its period row exists before October.
  const september = () => new Date('2026-09-30T12:00:00+07:00');
  for (const [userId, seed] of [
    [design, OPEN_SEPTEMBER],
    [rollover, ROLLOVER_SEED],
  ] as const) {
    await asApp(() => createPeriods(test.db, { now: september }).list(userId));
    await asApp(() => seedLedger(test.db, userId, { getDek, seed }));
  }
}, PGLITE_HOOK_TIMEOUT * 6);

afterAll(async () => {
  await test.close();
});

/** A digest of every ledger and budget row of `userId` (D14: the worker changes none of them). */
async function ledgerDigest(userId: string): Promise<Record<string, string | null>> {
  const tables = [
    'transactions',
    'postings',
    'transaction_tags',
    'budget_versions',
    'budget_lines',
    'budget_period_overrides',
    'goals',
  ];
  const digest: Record<string, string | null> = {};
  for (const table of tables) {
    const [row] = await test.query<{ digest: string | null }>(
      `SELECT md5(string_agg(t::text, ',' ORDER BY t::text)) AS digest FROM ${table} t WHERE user_id = $1`,
      [userId],
    );
    digest[table] = row?.digest ?? null;
  }
  return digest;
}

const octoberStatus = (userId: string) => asApp(() => createBudgets(test.db, { now: () => PAGE }).status(userId));

async function idOf(sql: string, params: unknown[]): Promise<string> {
  const [row] = await test.query<{ id: string }>(sql, params);
  return row?.id as string;
}

const notificationsOf = (userId: string) =>
  test.query<{ type: string; title_key: string; params: Record<string, unknown>; ref: string }>(
    'SELECT type, title_key, params, ref FROM notifications WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );

describe('period close on the design seed (September still open)', () => {
  it('proposes "pindah sisa Rp1.150.000 ke Dana Darurat", locks September, and changes nothing else', async () => {
    const before = await ledgerDigest(design);
    const statusBefore = await octoberStatus(design);

    const ended = await asWorker(() => close().endedPeriods(design, JOB));
    expect(ended).toEqual([
      { id: expect.any(String) as string, label: '2026-09', start: '2026-09-01', end: '2026-09-30' },
    ]);
    const september = ended[0]?.id as string;

    expect(await asWorker(() => close().propose(design, september, JOB))).toEqual({
      rollovers: 0,
      leftover: true,
      created: 1,
    });
    // A retry (or a restart before the lock) adds nothing.
    expect(await asWorker(() => close().propose(design, september, JOB))).toEqual({
      rollovers: 0,
      leftover: true,
      created: 0,
    });
    expect(await asWorker(() => createPeriods(test.db, { now: () => JOB }).lock(design, september))).toEqual({
      locked: true,
    });
    expect(await asWorker(() => close().endedPeriods(design, JOB))).toEqual([]);
    const [period] = await test.query<{ status: string }>('SELECT status FROM periods WHERE id = $1', [september]);
    expect(period?.status).toBe('closed');

    const { items } = await asApp(() => createReview(test.db, { getDek }).list(design));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      reason: 'period_close_proposal',
      source: 'period_close',
      status: 'pending',
      periodId: september,
      periodLabel: '2026-09',
      dueDate: '2026-09-30',
      label: 'Dana Darurat',
      payload: {
        kind: 'leftover',
        periodId: september,
        amountMinor: 1_150_000n,
        goalId: await idOf('SELECT id FROM goals WHERE user_id = $1 AND name = $2', [design, 'Dana Darurat']),
        fromAccountId: await idOf('SELECT id FROM accounts WHERE user_id = $1 AND display_name = $2', [
          design,
          'BCA Tahapan',
        ]),
        // The latest transfer tagged #dana-darurat: "Setor dana darurat · Bibit RDPU", 14 Okt.
        toAccountId: await idOf('SELECT id FROM accounts WHERE user_id = $1 AND display_name = $2', [design, 'Bibit']),
      },
    });

    expect(await notificationsOf(design)).toEqual([
      {
        type: 'period_closed',
        title_key: 'notification_period_closed_title',
        params: {
          start: '2026-09-01',
          end: '2026-09-30',
          proposals: 1,
          leftover: { amountMinor: '1150000', currency: 'IDR' },
        },
        ref: `close.${september}`,
      },
    ]);

    expect(await ledgerDigest(design)).toEqual(before);
    expect(await octoberStatus(design)).toEqual(statusBefore);
  });
});

describe('period close with a rollover line', () => {
  it('proposes Hiburan rolling 700.000 into Oktober and 450.000 to move; only confirming applies it', async () => {
    const before = await ledgerDigest(rollover);
    const statusBefore = await octoberStatus(rollover);
    const [ended] = await asWorker(() => close().endedPeriods(rollover, JOB));
    const september = ended?.id as string;

    expect(await asWorker(() => close().propose(rollover, september, JOB))).toEqual({
      rollovers: 1,
      leftover: true,
      created: 2,
    });
    expect(await asWorker(() => close().propose(rollover, september, JOB))).toMatchObject({ created: 0 });
    await asWorker(() => createPeriods(test.db, { now: () => JOB }).lock(rollover, september));
    expect(await ledgerDigest(rollover)).toEqual(before);
    expect(await octoberStatus(rollover)).toEqual(statusBefore);
    expect(await notificationsOf(rollover)).toMatchObject([
      { type: 'period_closed', params: { proposals: 2, leftover: { amountMinor: '450000' } } },
    ]);

    const review = createReview(test.db, { getDek, now: () => PAGE });
    const { items } = await asApp(() => review.list(rollover));
    const entertainment = await idOf(`SELECT id FROM categories WHERE user_id = $1 AND name = 'system:entertainment'`, [
      rollover,
    ]);
    const october = statusBefore.period.id as string;
    const rolloverItem = items.find((item) => item.payload.kind === 'rollover');
    expect(rolloverItem?.payload).toEqual({
      kind: 'rollover',
      periodId: september,
      nextPeriodId: october,
      categoryId: entertainment,
      deltaMinor: 700_000n,
    });
    expect(items.find((item) => item.payload.kind === 'leftover')?.payload).toMatchObject({
      amountMinor: 450_000n,
    });

    const { overrideIds } = await asApp(() => review.confirm(rollover, rolloverItem?.id as string));
    expect(overrideIds).toHaveLength(1);
    expect(
      await test.query(
        'SELECT period_id, category_id, delta_minor, reason, review_item_id FROM budget_period_overrides WHERE id = $1',
        [overrideIds[0]],
      ),
    ).toEqual([
      {
        period_id: october,
        category_id: entertainment,
        delta_minor: 700_000,
        reason: 'rollover',
        review_item_id: rolloverItem?.id,
      },
    ]);
    const line = (await octoberStatus(rollover)).lines.find((row) => row.categoryId === entertainment);
    const lineBefore = statusBefore.lines.find((row) => row.categoryId === entertainment);
    expect(line?.limitMinor).toBe((lineBefore?.limitMinor ?? 0n) + 700_000n);
  });
});

describe('period close edge cases', () => {
  it('refuses unknown and unfinished periods; proposes nothing to move from an overspent period', async () => {
    const ledger = await ledgerFixture(test, 'fixture@example.test');
    const { userId } = ledger;
    const food = ledger.category('system:food');
    const at = (date: string) => () => new Date(`${date}T12:00:00+07:00`);
    // First used in August: rows from August on.
    await asApp(() => createPeriods(test.db, { now: at('2026-08-15') }).list(userId));
    await asApp(() =>
      createBudgets(test.db, { now: at('2026-08-15') }).saveVersion(userId, {
        effectiveFrom: '2026-08' as YearMonth,
        expectedIncomeMinor: 0n,
        lines: [{ categoryId: food, limitMinor: 100_000n }],
      }),
    );
    await ledger.entry('expense', '2026-08-10', 200_000n, food);
    await ledger.entry('expense', '2026-09-10', 40_000n, food);
    await asApp(() => createPeriods(test.db, { now: () => JOB }).list(userId));

    const ended = await asWorker(() => close().endedPeriods(userId, JOB));
    expect(ended.map((period) => period.label)).toEqual(['2026-08', '2026-09']);
    const [august, september] = ended.map((period) => period.id);
    const october = await idOf(`SELECT id FROM periods WHERE user_id = $1 AND label = '2026-10'`, [userId]);

    await expect(asWorker(() => close().propose(userId, randomUUID(), JOB))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asWorker(() => close().propose(userId, october, JOB))).rejects.toMatchObject({
      code: 'INVALID_PERIOD',
    });

    // August: Rp100.000 over, nothing left.
    expect(await asWorker(() => close().propose(userId, august as string, JOB))).toEqual({
      rollovers: 0,
      leftover: false,
      created: 0,
    });
    // September: Rp60.000 left from the first account (BCA), but no goal yet; the user picks it on the card.
    expect(await asWorker(() => close().propose(userId, september as string, JOB))).toEqual({
      rollovers: 0,
      leftover: true,
      created: 1,
    });
    const { items } = await asApp(() => createReview(test.db, { getDek }).list(userId));
    expect(items.map((item) => item.payload)).toEqual([
      {
        kind: 'leftover',
        periodId: september,
        amountMinor: 60_000n,
        goalId: null,
        fromAccountId: ledger.bca,
        toAccountId: null,
      },
    ]);
    expect((await notificationsOf(userId)).map((row) => [row.ref, row.params.proposals])).toEqual([
      [`close.${august as string}`, 0],
      [`close.${september as string}`, 1],
    ]);
  });
});
