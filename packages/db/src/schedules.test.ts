// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { convert } from '@wf/domain/fx';
import type { LocalDate } from '@wf/domain/period';
import { cancelledSavings, detectionImpact, subscriptionTotals } from '@wf/domain/subscriptions';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { firstRow, withUser } from './db.ts';
import { encodeTemplate, recordPastChargeIn, type RecurrenceTemplate } from './occurrences.ts';
import {
  createSchedules,
  type RecurrenceInput,
  type ScheduleTemplate,
  type SchedulesRepository,
  type SubscriptionInput,
} from './schedules.ts';

let test: TestDatabase;
let fx: LedgerFixture;
let repo: SchedulesRepository;

/** 15 Okt 2026, 10.00 WIB. */
const NOW = new Date('2026-10-15T03:00:00Z');
const d = (value: string) => value as LocalDate;

beforeAll(async () => {
  test = await startMigrated();
  repo = createSchedules(test.db, { now: () => NOW });
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  await test.query('DELETE FROM fx_rates');
  fx = await ledgerFixture(test, 'schedules@example.test');
});

const app = <T>(fn: (schedules: SchedulesRepository) => Promise<T>) => test.as('wf_app', () => fn(repo));

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

async function account(
  type: string,
  currency: string,
  openingMinor: bigint,
  status: 'active' | 'archived' = 'active',
): Promise<string> {
  const rows = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date, color, status, archived_at)
     VALUES ($1, $2::account_type, $3, $3::text, $4, $5, '2026-01-01', 'blue', $6::account_status,
             CASE WHEN $6::text = 'archived' THEN now() END) RETURNING id`,
    [fx.userId, type, `${type}-${currency}-${randomUUID().slice(0, 8)}`, currency, openingMinor.toString(), status],
  );
  return firstRow(rows, 'accounts').id;
}

async function goal(): Promise<string> {
  const rows = await test.query<{ id: string }>(
    `INSERT INTO goals (user_id, name, icon, color, target_minor, currency)
     VALUES ($1, 'Dana Darurat', 'shield', 'green', 54000000, 'IDR') RETURNING id`,
    [fx.userId],
  );
  return firstRow(rows, 'goals').id;
}

const occurrences = (sourceId: string) =>
  test.query<{ id: string; due: string; status: string; expected: string; currency: string; remind_at: Date | null }>(
    `SELECT id, to_char(due_date, 'YYYY-MM-DD') AS due, status, expected_minor::text AS expected, currency, remind_at
     FROM scheduled_occurrences WHERE source_id = $1 ORDER BY due_date`,
    [sourceId],
  );
const dues = async (sourceId: string) => (await occurrences(sourceId)).map((row) => `${row.due} ${row.status}`);
const setStatus = (sourceId: string, due: string, status: string) =>
  test.query(`UPDATE scheduled_occurrences SET status = $3::occurrence_status WHERE source_id = $1 AND due_date = $2`, [
    sourceId,
    due,
    status,
  ]);

async function pastCharge(sourceType: 'recurrence' | 'subscription', sourceId: string, date: string, amount: bigint) {
  const transactionId = await fx.entry('expense', date, amount, fx.category('system:subscriptions'));
  await test.as('wf_app', () =>
    withUser(test.db, fx.userId, (tx) =>
      recordPastChargeIn(tx, fx.userId, {
        sourceType,
        sourceId,
        dueDate: d(date),
        transactionId,
        amountMinor: amount,
        currency: 'IDR',
      }),
    ),
  );
  return transactionId;
}

const rent = (): RecurrenceInput => ({
  template: {
    type: 'expense',
    accountId: fx.bca,
    amountMinor: 3_500_000n,
    categoryId: fx.category('system:rent'),
    description: '  Sewa kos ',
    merchant: ' ',
    tags: ['kos'],
  },
  freq: 'monthly',
  startOn: d('2026-10-14'),
  end: { type: 'never' },
  remindOffsetDays: 1,
});

const netflix = (overrides: Partial<SubscriptionInput> = {}): SubscriptionInput => ({
  name: 'Netflix',
  plan: 'Premium 4K',
  icon: 'tv',
  priceMinor: 186_000n,
  currency: 'IDR',
  cycle: 'monthly',
  nextBillingDate: d('2026-10-18'),
  payFromAccountId: fx.bca,
  categoryId: fx.category('system:subscriptions'),
  remindDaysBefore: 1,
  startedOn: d('2024-01-18'),
  ...overrides,
});

describe('recurrences', () => {
  it('creates a monthly recurrence with a three-date preview and H-1 reminders', async () => {
    await expect(test.as('wf_app', () => createSchedules(test.db).listRecurrences(fx.userId))).resolves.toEqual([]);
    const view = await app((s) => s.createRecurrence(fx.userId, rent()));
    expect(view).toMatchObject({
      template: { description: 'Sewa kos', merchant: null, tags: ['kos'], amountMinor: 3_500_000n },
      currency: 'IDR',
      freq: 'monthly',
      interval: 1,
      monthDay: 14,
      weekday: null,
      end: { type: 'never' },
      remindOffsetDays: 1,
      status: 'active',
      stoppedAt: null,
      preview: ['2026-11-14', '2026-12-14', '2027-01-14'],
      nextDue: { occurrenceId: expect.any(String) as string, dueDate: '2026-11-14', status: 'scheduled' },
      occurrences: { confirmed: 0, skipped: 0, open: 2 },
    });
    const [first] = await occurrences(view.id);
    expect(first).toMatchObject({ expected: '3500000', remind_at: new Date('2026-11-13T02:00:00Z') });
    await expect(app((s) => s.listRecurrences(fx.userId))).resolves.toEqual([view]);
  });

  it('derives the weekday and day of month, and honors intervals, years, and end counts', async () => {
    const base = rent();
    const weekly = await app((s) =>
      s.createRecurrence(fx.userId, { ...base, freq: 'weekly', interval: 2, startOn: d('2026-10-16') }),
    );
    expect(weekly).toMatchObject({ weekday: 5, monthDay: null, preview: ['2026-10-16', '2026-10-30', '2026-11-13'] });
    const monday = await app((s) =>
      s.createRecurrence(fx.userId, { ...base, freq: 'weekly', weekday: 1, startOn: d('2026-10-16') }),
    );
    expect(monday.preview).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
    const monthEnd = await app((s) =>
      s.createRecurrence(fx.userId, { ...base, monthDay: 31, startOn: d('2026-10-01'), remindOffsetDays: null }),
    );
    expect(monthEnd.preview).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);
    const yearly = await app((s) =>
      s.createRecurrence(fx.userId, {
        ...base,
        template: {
          type: 'income',
          accountId: fx.bca,
          amountMinor: 1_000_000n,
          categoryId: fx.category('system:bonus'),
        },
        freq: 'yearly',
        startOn: d('2027-03-01'),
        end: { type: 'after', count: 2 },
      }),
    );
    expect(yearly).toMatchObject({
      weekday: null,
      monthDay: null,
      end: { type: 'after', count: 2 },
      preview: ['2027-03-01', '2028-03-01'],
      nextDue: { occurrenceId: null, dueDate: '2027-03-01', status: 'scheduled' },
      occurrences: { confirmed: 0, skipped: 0, open: 0 },
    });
  });

  it('stores transfers with a fee and a goal split kept as plans', async () => {
    const goalId = await goal();
    const other = await goal();
    const unsplit = {
      type: 'transfer',
      fromAccountId: fx.bca,
      toAccountId: fx.jago,
      sentMinor: 2_000_000n,
      receivedMinor: 2_000_000n,
      fee: { minor: 2_500n, categoryId: fx.category('system:bank_fee') },
      description: 'Sisihkan dana',
    } as const;
    const sisihkan: ScheduleTemplate = { ...unsplit, allocations: [{ goalId, amountMinor: 500_000n }] };
    const view = await app((s) => s.createRecurrence(fx.userId, { ...rent(), template: sisihkan }));
    expect(view.template).toEqual({
      type: 'transfer',
      fromAccountId: fx.bca,
      toAccountId: fx.jago,
      sentMinor: 2_000_000n,
      receivedMinor: 2_000_000n,
      fee: { minor: 2_500n, categoryId: fx.category('system:bank_fee') },
      description: 'Sisihkan dana',
      tags: [],
      allocations: [{ goalId, amountMinor: 500_000n }],
    });
    // The split lives in plan rows, not in the stored template.
    const plans = () =>
      test.query<{ goal_id: string; amount: string; active: boolean }>(
        `SELECT goal_id, amount_minor::text AS amount, active FROM goal_contribution_plans WHERE recurrence_id = $1
         ORDER BY created_at, id`,
        [view.id],
      );
    expect(await plans()).toEqual([{ goal_id: goalId, amount: '500000', active: true }]);
    expect(
      await test.query(`SELECT template ? 'allocations' AS stored FROM recurrences WHERE id = $1`, [view.id]),
    ).toEqual([{ stored: false }]);
    // Inactive plans are not shown.
    await test.query('UPDATE goal_contribution_plans SET active = false WHERE recurrence_id = $1', [view.id]);
    expect((await app((s) => s.listRecurrences(fx.userId)))[0]?.template).toMatchObject({ allocations: [] });
    await test.query('UPDATE goal_contribution_plans SET active = true WHERE recurrence_id = $1', [view.id]);

    // An update without the split keeps the plans (as long as they fit); one with it replaces them.
    const kept = await app((s) => s.updateRecurrence(fx.userId, view.id, { ...rent(), template: unsplit }));
    expect(kept.template).toMatchObject({ allocations: [{ goalId, amountMinor: 500_000n }] });
    await rejects(
      app((s) =>
        s.updateRecurrence(fx.userId, view.id, {
          ...rent(),
          template: { ...unsplit, sentMinor: 400_000n, receivedMinor: 400_000n },
        }),
      ),
      'INVALID_RECURRENCE',
    );
    const replaced = await app((s) =>
      s.updateRecurrence(fx.userId, view.id, {
        ...rent(),
        template: {
          ...unsplit,
          allocations: [
            { goalId: other, amountMinor: 700_000n },
            { goalId, amountMinor: 300_000n },
          ],
        },
      }),
    );
    expect(replaced.template).toMatchObject({
      allocations: [
        { goalId: other, amountMinor: 700_000n },
        { goalId, amountMinor: 300_000n },
      ],
    });
    expect(await plans()).toHaveLength(2);
    // An entry has no split: its plans go.
    await app((s) => s.updateRecurrence(fx.userId, view.id, rent()));
    expect(await plans()).toEqual([]);

    const plain = await app((s) =>
      s.createRecurrence(fx.userId, {
        ...rent(),
        template: { type: 'transfer', fromAccountId: fx.bca, toAccountId: fx.jago, sentMinor: 1n, receivedMinor: 1n },
      }),
    );
    expect(plain.template).toMatchObject({ fee: null, allocations: [], description: null });
    const emptied = await app((s) =>
      s.updateRecurrence(fx.userId, plain.id, { ...rent(), template: { ...unsplit, allocations: [] } }),
    );
    expect(emptied.template).toMatchObject({ allocations: [] });
  });

  it('refuses invalid rules and templates', async () => {
    const archived = await account('bank', 'IDR', 0n, 'archived');
    const usd = await account('bank', 'USD', 0n);
    const goalId = await goal();
    const base = rent();
    const entry: RecurrenceTemplate = {
      type: 'expense',
      accountId: fx.bca,
      amountMinor: 3_500_000n,
      categoryId: fx.category('system:rent'),
    };
    const transfer: ScheduleTemplate = {
      type: 'transfer',
      fromAccountId: fx.bca,
      toAccountId: fx.jago,
      sentMinor: 1_000n,
      receivedMinor: 1_000n,
    };
    const invalid: RecurrenceInput[] = [
      { ...base, freq: 'daily' as RecurrenceInput['freq'] },
      { ...base, interval: 0 },
      { ...base, remindOffsetDays: 31 },
      { ...base, remindOffsetDays: 1.5 },
      { ...base, remindOffsetDays: -1 },
      { ...base, template: { ...entry, tags: ['a', 'b', 'c', 'd', 'e', 'f'] } },
      { ...base, template: { ...entry, amountMinor: 0n } },
      { ...base, template: { ...entry, accountId: randomUUID() } },
      { ...base, template: { ...entry, accountId: archived } },
      { ...base, template: { ...entry, categoryId: fx.category('system:salary') } },
      { ...base, template: { ...transfer, sentMinor: 0n } },
      { ...base, template: { ...transfer, receivedMinor: 0n } },
      { ...base, template: { ...transfer, toAccountId: fx.bca } },
      { ...base, template: { ...transfer, receivedMinor: 999n } },
      { ...base, template: { ...transfer, toAccountId: randomUUID() } },
      { ...base, template: { ...transfer, fee: { minor: 0n, categoryId: fx.category('system:bank_fee') } } },
      { ...base, template: { ...transfer, fee: { minor: 1n, categoryId: randomUUID() } } },
      { ...base, template: { ...transfer, allocations: [{ goalId, amountMinor: 0n }] } },
      { ...base, template: { ...transfer, allocations: [{ goalId, amountMinor: 1_001n }] } },
      { ...base, template: { ...transfer, allocations: [{ goalId: randomUUID(), amountMinor: 1n }] } },
      {
        ...base,
        template: {
          ...transfer,
          allocations: [
            { goalId, amountMinor: 1n },
            { goalId, amountMinor: 1n },
          ],
        },
      },
    ];
    for (const input of invalid)
      await rejects(
        app((s) => s.createRecurrence(fx.userId, input)),
        'INVALID_RECURRENCE',
      );
    // Across currencies the received amount is free.
    await expect(
      app((s) =>
        s.createRecurrence(fx.userId, { ...base, template: { ...transfer, toAccountId: usd, receivedMinor: 6n } }),
      ),
    ).resolves.toMatchObject({ status: 'active' });
  });

  it('rebuilds future scheduled occurrences on update and keeps those in review', async () => {
    const { id } = await app((s) => s.createRecurrence(fx.userId, rent()));
    await setStatus(id, '2026-11-14', 'due_review');
    const base = rent();
    const updated = await app((s) =>
      s.updateRecurrence(fx.userId, id, {
        ...base,
        template: { ...base.template, amountMinor: 4_000_000n } as RecurrenceTemplate,
        monthDay: 20,
      }),
    );
    expect(updated).toMatchObject({ monthDay: 20, preview: ['2026-10-20', '2026-11-20', '2026-12-20'] });
    expect(await dues(id)).toEqual([
      '2026-10-20 scheduled',
      '2026-11-14 due_review',
      '2026-11-20 scheduled',
      '2026-12-20 scheduled',
    ]);
    expect((await occurrences(id)).map((row) => row.expected)).toEqual(['4000000', '3500000', '4000000', '4000000']);
    await rejects(
      app((s) => s.updateRecurrence(fx.userId, randomUUID(), rent())),
      'NOT_FOUND',
    );
  });

  it('stops (deleting future occurrences, keeping past transactions) and undoes', async () => {
    const { id } = await app((s) => s.createRecurrence(fx.userId, rent()));
    const transactionId = await pastCharge('recurrence', id, '2026-10-14', 3_500_000n);
    await expect(app((s) => s.stopRecurrence(fx.userId, id))).resolves.toEqual({ deletedOccurrences: 2 });
    await expect(app((s) => s.stopRecurrence(fx.userId, id))).resolves.toEqual({ deletedOccurrences: 0 });
    expect(await dues(id)).toEqual(['2026-10-14 confirmed']);
    const live = await test.query(`SELECT id FROM transactions WHERE id = $1 AND deleted_at IS NULL`, [transactionId]);
    expect(live).toHaveLength(1);
    const [stopped] = await app((s) => s.listRecurrences(fx.userId, { status: 'stopped' }));
    expect(stopped).toMatchObject({
      id,
      status: 'stopped',
      stoppedAt: NOW,
      preview: [],
      nextDue: null,
      occurrences: { confirmed: 1, skipped: 0, open: 0 },
    });
    await expect(app((s) => s.listRecurrences(fx.userId, { status: 'active' }))).resolves.toEqual([]);

    const undone = await app((s) => s.undoStopRecurrence(fx.userId, id));
    expect(undone).toMatchObject({ status: 'active', stoppedAt: null, occurrences: { confirmed: 1, open: 2 } });
    await expect(app((s) => s.undoStopRecurrence(fx.userId, id))).resolves.toEqual(undone);
    // The paying transaction's history tells both, once each.
    expect(
      await test.query(
        `SELECT action, meta FROM activity_log WHERE entity_id = $1 AND action::text LIKE 'recurrence%' ORDER BY at, id`,
        [transactionId],
      ),
    ).toEqual([
      { action: 'recurrence_stopped', meta: { recurrenceId: id, deleted: 2 } },
      { action: 'recurrence_resumed', meta: { recurrenceId: id } },
    ]);
    await rejects(
      app((s) => s.stopRecurrence(fx.userId, randomUUID())),
      'NOT_FOUND',
    );
    await rejects(
      app((s) => s.undoStopRecurrence(fx.userId, randomUUID())),
      'NOT_FOUND',
    );
  });

  it('links the transaction recorded with "Ulangi" as the first occurrence and finds it again', async () => {
    const today = await fx.entry('expense', '2026-10-15', 150_000n, fx.category('system:rent'));
    const weekly = await app((s) =>
      s.createRecurrence(fx.userId, { ...rent(), freq: 'weekly', startOn: d('2026-10-15') }, { transactionId: today }),
    );
    // Today's occurrence is the recorded transaction, so the daily job never proposes it.
    expect((await dues(weekly.id)).slice(0, 2)).toEqual(['2026-10-15 confirmed', '2026-10-22 scheduled']);
    expect(weekly).toMatchObject({ weekday: 4, preview: ['2026-10-15', '2026-10-22', '2026-10-29'] });
    expect(
      await test.query(
        `SELECT action, meta FROM activity_log WHERE entity_id = $1 AND action::text LIKE 'recurrence%'`,
        [today],
      ),
    ).toEqual([
      { action: 'recurrence_set', meta: { recurrenceId: weekly.id, freq: 'weekly', weekday: 4, monthDay: null } },
    ]);
    await expect(app((s) => s.recurrenceOfTransaction(fx.userId, today))).resolves.toMatchObject({ id: weekly.id });
    // Already repeating, deleted, or unknown transactions are refused.
    await rejects(
      app((s) => s.createRecurrence(fx.userId, rent(), { transactionId: today })),
      'NOT_FOUND',
    );
    await rejects(
      app((s) => s.createRecurrence(fx.userId, rent(), { transactionId: randomUUID() })),
      'NOT_FOUND',
    );

    // Recorded on a day that is not a rule date (Monday rule, Wednesday payment): linked only.
    const past = await fx.entry('expense', '2026-10-14', 150_000n, fx.category('system:rent'));
    const monday = await app((s) =>
      s.createRecurrence(
        fx.userId,
        { ...rent(), freq: 'weekly', weekday: 1, startOn: d('2026-10-14') },
        { transactionId: past },
      ),
    );
    expect((await dues(monday.id))[0]).toBe('2026-10-19 scheduled');
    await expect(app((s) => s.recurrenceOfTransaction(fx.userId, past))).resolves.toMatchObject({ id: monday.id });

    // A transaction that confirmed an occurrence belongs to its recurrence too; others to none.
    const { id } = await app((s) => s.createRecurrence(fx.userId, rent()));
    const paid = await pastCharge('recurrence', id, '2026-10-14', 3_500_000n);
    await expect(app((s) => s.recurrenceOfTransaction(fx.userId, paid))).resolves.toMatchObject({ id });
    const plain = await fx.entry('expense', '2026-10-13', 1_000n, fx.category('system:rent'));
    await expect(app((s) => s.recurrenceOfTransaction(fx.userId, plain))).resolves.toBeNull();
    await expect(app((s) => s.recurrenceOfTransaction(fx.userId, randomUUID()))).resolves.toBeNull();
  });
});

describe('subscriptions', () => {
  it('creates Netflix with its next bill and the H-1 09.00 reminder', async () => {
    const view = await app((s) => s.createSubscription(fx.userId, netflix({ description: ' ', logoKey: 'netflix' })));
    expect(view).toMatchObject({
      name: 'Netflix',
      plan: 'Premium 4K',
      icon: 'tv',
      logoKey: 'netflix',
      description: null,
      status: 'active',
      effectiveStatus: 'active',
      monthlyMinor: 186_000n,
      yearlyMinor: 2_232_000n,
      nextBill: { occurrenceId: expect.any(String) as string, dueDate: '2026-10-18', status: 'scheduled' },
      priceIncrease: null,
      paidCount: 0,
      totalPaidMinor: 0n,
      trialEndsOn: null,
    });
    const [first] = await occurrences(view.id);
    expect(first?.remind_at).toEqual(new Date('2026-10-17T02:00:00Z'));
    await expect(app((s) => s.getSubscription(fx.userId, view.id))).resolves.toEqual(view);
    await rejects(
      app((s) => s.getSubscription(fx.userId, randomUUID())),
      'NOT_FOUND',
    );
    const { remindDaysBefore, ...rest } = netflix();
    expect(remindDaysBefore).toBe(1);
    await expect(app((s) => s.createSubscription(fx.userId, rest))).resolves.toMatchObject({ remindDaysBefore: 3 });
  });

  it('starts billing after a free trial', async () => {
    const view = await app((s) =>
      s.createSubscription(fx.userId, netflix({ startedOn: d('2026-10-15'), trial: { days: 14 } })),
    );
    expect(view).toMatchObject({ trialEndsOn: '2026-10-28', nextBillingDate: '2026-10-29' });
    expect(await dues(view.id)).toEqual(['2026-10-29 scheduled', '2026-11-29 scheduled', '2026-12-29 scheduled']);
  });

  it('refuses invalid input', async () => {
    const invalid: SubscriptionInput[] = [
      netflix({ name: '  ' }),
      netflix({ name: 'x'.repeat(41) }),
      netflix({ plan: 'x'.repeat(41) }),
      netflix({ priceMinor: 0n }),
      netflix({ currency: 'idr' }),
      netflix({ cycle: 'daily' as SubscriptionInput['cycle'] }),
      netflix({ remindDaysBefore: 31 }),
      netflix({ payFromAccountId: randomUUID() }),
      netflix({ categoryId: fx.category('system:salary') }),
      netflix({ trial: { days: 0 } }),
      netflix({ nextBillingDate: d('2024-01-01') }),
    ];
    for (const input of invalid) {
      await rejects(
        app((s) => s.createSubscription(fx.userId, input)),
        'INVALID_SUBSCRIPTION',
      );
    }
    await expect(app((s) => s.createSubscription(fx.userId, netflix({ categoryId: null })))).resolves.toMatchObject({
      categoryId: null,
    });
  });

  it('updates prices in place and rebuilds the schedule when dates change', async () => {
    const { id } = await app((s) => s.createSubscription(fx.userId, netflix()));
    await setStatus(id, '2026-10-18', 'due_review');
    await app((s) => s.updateSubscription(fx.userId, id, { priceMinor: 199_000n }));
    expect((await occurrences(id)).map((row) => row.expected)).toEqual(['186000', '199000', '199000']);
    await app((s) => s.updateSubscription(fx.userId, id, { currency: 'USD', priceMinor: 199_000n }));
    expect((await occurrences(id)).map((row) => row.currency)).toEqual(['IDR', 'USD', 'USD']);
    await app((s) => s.updateSubscription(fx.userId, id, { name: 'Netflix Premium' }));
    expect((await occurrences(id)).map((row) => row.currency)).toEqual(['IDR', 'USD', 'USD']);
    const moved = await app((s) => s.updateSubscription(fx.userId, id, { nextBillingDate: d('2026-10-25') }));
    expect(moved).toMatchObject({ name: 'Netflix Premium', nextBillingDate: '2026-10-25' });
    expect(await dues(id)).toEqual([
      '2026-10-18 due_review',
      '2026-10-25 scheduled',
      '2026-11-25 scheduled',
      '2026-12-25 scheduled',
    ]);
    await app((s) => s.updateSubscription(fx.userId, id, { remindDaysBefore: null }));
    expect((await occurrences(id)).filter((row) => row.status === 'scheduled').map((row) => row.remind_at)).toEqual([
      null,
      null,
      null,
    ]);
    await rejects(
      app((s) => s.updateSubscription(fx.userId, randomUUID(), {})),
      'NOT_FOUND',
    );
  });

  it('keeps a trial across updates unless cleared', async () => {
    const { id } = await app((s) =>
      s.createSubscription(fx.userId, netflix({ startedOn: d('2026-10-15'), trial: { months: 1 } })),
    );
    await expect(app((s) => s.updateSubscription(fx.userId, id, { plan: 'Basic' }))).resolves.toMatchObject({
      trialEndsOn: '2026-11-14',
      nextBillingDate: '2026-11-15',
    });
    const cleared = await app((s) =>
      s.updateSubscription(fx.userId, id, { trial: null, nextBillingDate: d('2026-11-01') }),
    );
    expect(cleared).toMatchObject({ trialEndsOn: null, nextBillingDate: '2026-11-01' });
    expect(await dues(id)).toEqual(['2026-11-01 scheduled', '2026-12-01 scheduled', '2027-01-01 scheduled']);
  });

  it('deletes a subscription with its open bills and keeps paid history', async () => {
    const { id } = await app((s) => s.createSubscription(fx.userId, netflix()));
    await pastCharge('subscription', id, '2026-09-18', 186_000n);
    await setStatus(id, '2026-10-18', 'due_review');
    await expect(app((s) => s.deleteSubscription(fx.userId, id))).resolves.toEqual({ deletedOccurrences: 3 });
    expect(await dues(id)).toEqual(['2026-09-18 confirmed']);
    await rejects(
      app((s) => s.deleteSubscription(fx.userId, id)),
      'NOT_FOUND',
    );
  });

  it('changes the paying account from the next bill and warns about an insufficient balance', async () => {
    const { id } = await app((s) => s.createSubscription(fx.userId, netflix()));
    const wallet = await account('ewallet', 'IDR', 100_000n);
    await expect(app((s) => s.changeAccount(fx.userId, id, wallet))).resolves.toEqual({
      effectiveFrom: '2026-10-18',
      insufficient: { balanceMinor: 100_000n, shortMinor: 86_000n },
    });
    await expect(app((s) => s.getSubscription(fx.userId, id))).resolves.toMatchObject({ payFromAccountId: wallet });
    await expect(app((s) => s.changeAccount(fx.userId, id, fx.jago))).resolves.toEqual({
      effectiveFrom: '2026-10-18',
      insufficient: null,
    });
    const card = await account('credit_card', 'IDR', 0n);
    await expect(app((s) => s.changeAccount(fx.userId, id, card))).resolves.toEqual({
      effectiveFrom: '2026-10-18',
      insufficient: null,
    });
    const sgd = await account('bank', 'SGD', 0n);
    await expect(app((s) => s.changeAccount(fx.userId, id, sgd))).resolves.toEqual({
      effectiveFrom: '2026-10-18',
      insufficient: null,
    });
    await test.query(
      `INSERT INTO fx_rates (base, quote, rate, provider, rate_type, as_of) VALUES ('USD', 'IDR', '16350', 'test', 'blended', '2026-10-15')`,
    );
    const usd = await account('bank', 'USD', 1_000n);
    const billUsd = convert({ minor: 186_000n, currency: 'IDR' }, 'USD', {
      base: 'USD',
      quote: 'IDR',
      rate: '16350',
    });
    await expect(app((s) => s.changeAccount(fx.userId, id, usd))).resolves.toEqual({
      effectiveFrom: '2026-10-18',
      insufficient: { balanceMinor: 1_000n, shortMinor: billUsd - 1_000n },
    });
    await test.query(`UPDATE scheduled_occurrences SET status = 'due_review' WHERE source_id = $1`, [id]);
    await expect(app((s) => s.changeAccount(fx.userId, id, fx.bca))).resolves.toEqual({
      effectiveFrom: null,
      insufficient: null,
    });
    await rejects(
      app((s) => s.changeAccount(fx.userId, id, randomUUID())),
      'INVALID_SUBSCRIPTION',
    );
    await rejects(
      app((s) => s.changeAccount(fx.userId, randomUUID(), fx.bca)),
      'NOT_FOUND',
    );
  });

  it('pauses from the next bill', async () => {
    const { id } = await app((s) => s.createSubscription(fx.userId, netflix()));
    const paused = await app((s) => s.pause(fx.userId, id, { months: 1 }, { remindDaysBefore: 3 }));
    expect(paused).toMatchObject({
      status: 'paused',
      effectiveStatus: 'paused',
      pausedOn: '2026-10-15',
      pausedUntil: '2026-11-18',
      pauseRemindDays: 3,
      nextBillingDate: '2026-11-18',
      nextBill: { dueDate: '2026-11-18' },
    });
    expect(await dues(id)).toEqual(['2026-11-18 scheduled', '2026-12-18 scheduled']);
    await rejects(
      app((s) => s.pause(fx.userId, id, { until: d('2026-10-10') }, { remindDaysBefore: null })),
      'INVALID_SUBSCRIPTION',
    );
    await rejects(
      app((s) => s.pause(fx.userId, id, { months: 2 }, { remindDaysBefore: 31 })),
      'INVALID_SUBSCRIPTION',
    );
    const other = await app((s) => s.createSubscription(fx.userId, netflix({ name: 'Spotify' })));
    await app((s) => s.cancel(fx.userId, other.id, 'now'));
    await rejects(
      app((s) => s.pause(fx.userId, other.id, { months: 1 }, { remindDaysBefore: 3 })),
      'INVALID_SUBSCRIPTION',
    );
    await rejects(
      app((s) => s.pause(fx.userId, randomUUID(), { months: 1 }, { remindDaysBefore: 3 })),
      'NOT_FOUND',
    );
  });

  it('cancels after the next bill or now', async () => {
    const { id } = await app((s) => s.createSubscription(fx.userId, netflix()));
    await app((s) => s.pause(fx.userId, id, { months: 1 }, { remindDaysBefore: 3 }));
    const later = await app((s) => s.cancel(fx.userId, id, 'after_next_bill'));
    expect(later).toMatchObject({
      status: 'cancelled',
      effectiveStatus: 'active',
      cancelMode: 'after_next_bill',
      endsOn: '2026-11-18',
      cancelledAt: NOW,
      pausedOn: null,
      pausedUntil: null,
    });
    expect(await dues(id)).toEqual(['2026-11-18 scheduled']);
    await rejects(
      app((s) => s.cancel(fx.userId, id, 'now')),
      'INVALID_SUBSCRIPTION',
    );
    const other = await app((s) => s.createSubscription(fx.userId, netflix({ name: 'Spotify' })));
    await expect(app((s) => s.cancel(fx.userId, other.id, 'now'))).resolves.toMatchObject({
      endsOn: '2026-10-15',
      effectiveStatus: 'cancelled',
      nextBill: null,
    });
    expect(await dues(other.id)).toEqual([]);
  });

  it('reactivates paused and cancelled subscriptions', async () => {
    const active = await app((s) => s.createSubscription(fx.userId, netflix()));
    await expect(app((s) => s.reactivate(fx.userId, active.id))).resolves.toEqual(active);

    await app((s) => s.pause(fx.userId, active.id, { months: 1 }, { remindDaysBefore: 3 }));
    const resumed = await app((s) => s.reactivate(fx.userId, active.id));
    expect(resumed).toMatchObject({ status: 'active', pausedUntil: null, nextBillingDate: '2026-10-18' });
    expect(await dues(active.id)).toEqual(['2026-10-18 scheduled', '2026-11-18 scheduled', '2026-12-18 scheduled']);

    await app((s) => s.cancel(fx.userId, active.id, 'now'));
    await expect(app((s) => s.reactivate(fx.userId, active.id))).resolves.toMatchObject({
      status: 'active',
      endsOn: null,
      cancelMode: null,
      nextBillingDate: '2026-10-18',
    });
    expect(await dues(active.id)).toHaveLength(3);

    // An overdue next bill that was skipped: billing resumes with the next cycle date.
    const skipped = await app((s) =>
      s.createSubscription(fx.userId, netflix({ name: 'iCloud+', nextBillingDate: d('2026-10-09') })),
    );
    await setStatus(skipped.id, '2026-10-09', 'skipped');
    await app((s) => s.cancel(fx.userId, skipped.id, 'now'));
    await expect(app((s) => s.reactivate(fx.userId, skipped.id))).resolves.toMatchObject({
      nextBillingDate: '2026-11-09',
    });
    // An overdue next bill still waiting for confirmation stays the next bill.
    const overdue = await app((s) =>
      s.createSubscription(fx.userId, netflix({ name: 'Canva', nextBillingDate: d('2026-10-09') })),
    );
    await setStatus(overdue.id, '2026-10-09', 'unconfirmed');
    await app((s) => s.cancel(fx.userId, overdue.id, 'now'));
    await expect(app((s) => s.reactivate(fx.userId, overdue.id))).resolves.toMatchObject({
      nextBillingDate: '2026-10-09',
      nextBill: { dueDate: '2026-10-09', status: 'unconfirmed' },
    });

    // A pause that already ended.
    const ended = await app((s) =>
      s.createSubscription(fx.userId, netflix({ name: 'Headspace', nextBillingDate: d('2026-09-01') })),
    );
    await test.query(
      `UPDATE subscriptions SET status = 'paused', paused_on = '2026-08-01', paused_until = '2026-09-01' WHERE id = $1`,
      [ended.id],
    );
    await test.query(`UPDATE scheduled_occurrences SET status = 'skipped' WHERE source_id = $1`, [ended.id]);
    await expect(app((s) => s.reactivate(fx.userId, ended.id))).resolves.toMatchObject({
      nextBillingDate: '2026-11-01',
    });
    await rejects(
      app((s) => s.reactivate(fx.userId, randomUUID())),
      'NOT_FOUND',
    );
  });

  it('resumes yearly subscriptions on their date, also from 29 Feb', async () => {
    const yearly = await app((s) =>
      s.createSubscription(
        fx.userId,
        netflix({ name: 'Niagahoster', cycle: 'yearly', nextBillingDate: d('2027-02-20') }),
      ),
    );
    await app((s) => s.pause(fx.userId, yearly.id, { months: 1 }, { remindDaysBefore: null }));
    await expect(app((s) => s.reactivate(fx.userId, yearly.id))).resolves.toMatchObject({
      nextBillingDate: '2027-03-20',
    });
    const leap = await app((s) =>
      s.createSubscription(fx.userId, netflix({ name: 'Domain', cycle: 'yearly', nextBillingDate: d('2027-03-01') })),
    );
    await app((s) => s.pause(fx.userId, leap.id, { until: d('2028-02-29') }, { remindDaysBefore: 3 }));
    await expect(app((s) => s.reactivate(fx.userId, leap.id))).resolves.toMatchObject({
      nextBillingDate: '2027-02-28',
    });
  });

  it('records a usage rating and asks again a month later', async () => {
    const { id } = await app((s) => s.createSubscription(fx.userId, netflix()));
    await expect(app((s) => s.rateUsage(fx.userId, id, 'rarely'))).resolves.toMatchObject({
      usageRating: 'rarely',
      ratedAt: NOW,
      nextReviewOn: '2026-11-15',
    });
    await rejects(
      app((s) => s.rateUsage(fx.userId, id, 'never' as 'rarely')),
      'INVALID_SUBSCRIPTION',
    );
    await rejects(
      app((s) => s.rateUsage(fx.userId, randomUUID(), 'often')),
      'NOT_FOUND',
    );
  });

  it('lists the billing history with the price increase', async () => {
    const { id } = await app((s) => s.createSubscription(fx.userId, netflix({ priceMinor: 329_000n })));
    const august = await pastCharge('subscription', id, '2026-08-18', 299_000n);
    const september = await pastCharge('subscription', id, '2026-09-18', 329_000n);
    const deleted = await pastCharge('subscription', id, '2026-07-18', 299_000n);
    await test.query(`UPDATE transactions SET deleted_at = now() WHERE id = $1`, [deleted]);
    const history = await app((s) => s.billingHistory(fx.userId, id));
    expect(history).toEqual({
      charges: [
        {
          occurrenceId: expect.any(String) as string,
          dueDate: '2026-09-18',
          transactionId: september,
          localDate: '2026-09-18',
          amountMinor: 329_000n,
          accountId: fx.bca,
          confirmedAt: expect.any(Date) as Date,
        },
        expect.objectContaining({ dueDate: '2026-08-18', transactionId: august, amountMinor: 299_000n }),
      ],
      count: 2,
      totalPaidMinor: 628_000n,
      priceIncrease: {
        previousMinor: 299_000n,
        currentMinor: 329_000n,
        increaseMinor: 30_000n,
        increaseBps: 1003,
        since: '2026-09-18',
      },
    });
    await expect(app((s) => s.getSubscription(fx.userId, id))).resolves.toMatchObject({
      paidCount: 2,
      totalPaidMinor: 628_000n,
      priceIncrease: history.priceIncrease,
    });
    await rejects(
      app((s) => s.billingHistory(fx.userId, randomUUID())),
      'NOT_FOUND',
    );
  });

  it('summarizes the subscriptions page', async () => {
    const empty = await app((s) => s.listSubscriptions(fx.userId));
    expect(empty).toMatchObject({ subscriptions: [], counts: { active: 0, paused: 0, cancelled: 0 }, byCategory: [] });
    await expect(app((s) => s.countActive(fx.userId))).resolves.toBe(0);

    await test.query(
      `INSERT INTO fx_rates (base, quote, rate, provider, rate_type, as_of) VALUES ('USD', 'IDR', '16350', 'test', 'blended', '2026-10-15')`,
    );
    const subs = fx.category('system:subscriptions');
    const fun = fx.category('system:entertainment');
    const create = (input: Partial<SubscriptionInput>) => app((s) => s.createSubscription(fx.userId, netflix(input)));
    const a = await create({});
    const b = await create({
      name: 'Spotify',
      priceMinor: 86_900n,
      nextBillingDate: d('2026-10-20'),
      categoryId: null,
    });
    await create({ name: 'Niagahoster', priceMinor: 660_900n, cycle: 'yearly', nextBillingDate: d('2027-10-05') });
    const paused = await create({ name: 'Headspace', priceMinor: 50_000n, nextBillingDate: d('2026-10-25') });
    const cancelled = await create({ name: 'Canva', priceMinor: 274_100n, nextBillingDate: d('2026-04-01') });
    await create({ name: 'ChatGPT', priceMinor: 2_000n, currency: 'USD', nextBillingDate: d('2026-10-28') });
    await create({ name: 'Disney', priceMinor: 1_000n, currency: 'SGD', nextBillingDate: d('2026-10-26') });
    const h = await create({
      name: 'Fit Hub',
      priceMinor: 50_000n,
      cycle: 'weekly',
      nextBillingDate: d('2026-10-16'),
      categoryId: fun,
    });
    await app((s) => s.pause(fx.userId, paused.id, { months: 1 }, { remindDaysBefore: 3 }));
    await test.query(`DELETE FROM scheduled_occurrences WHERE source_id = $1`, [cancelled.id]);
    await test.query(
      `UPDATE subscriptions SET status = 'cancelled', cancel_mode = 'now', ends_on = '2026-03-31', cancelled_at = now()
       WHERE id = $1`,
      [cancelled.id],
    );
    await app((s) => s.rateUsage(fx.userId, b.id, 'rarely'));
    await setStatus(a.id, '2026-10-18', 'due_review');
    await pastCharge('subscription', a.id, '2026-08-18', 170_000n);
    await pastCharge('subscription', a.id, '2026-09-18', 186_000n);
    await pastCharge('subscription', b.id, '2026-10-01', 86_900n);
    await setStatus(h.id, '2026-10-16', 'skipped');

    const overview = await app((s) => s.listSubscriptions(fx.userId));
    expect(overview.today).toBe('2026-10-15');
    expect(overview.baseCurrency).toBe('IDR');
    expect(overview.counts).toEqual({ active: 6, paused: 1, cancelled: 1 });
    expect(overview.missingRates).toEqual(['SGD']);
    const active = [
      { priceMinor: 186_000n, cycle: 'monthly' as const },
      { priceMinor: 86_900n, cycle: 'monthly' as const },
      { priceMinor: 660_900n, cycle: 'yearly' as const },
      { priceMinor: 327_000n, cycle: 'monthly' as const },
      { priceMinor: 50_000n, cycle: 'weekly' as const },
    ];
    expect(overview.totals).toEqual(subscriptionTotals(active));
    expect(overview.remainingThisMonth).toEqual({
      totalMinor: 186_000n + 86_900n + 327_000n + 100_000n,
      count: 5,
      firstDue: '2026-10-18',
      lastDue: '2026-10-30',
    });
    expect(overview.monthSchedule.map((bill) => [bill.name, bill.dueDate, bill.status, bill.currency])).toEqual([
      ['Spotify', '2026-10-01', 'paid', 'IDR'],
      ['Netflix', '2026-10-18', 'unconfirmed', 'IDR'],
      ['Spotify', '2026-10-20', 'will_charge', 'IDR'],
      ['Fit Hub', '2026-10-23', 'will_charge', 'IDR'],
      ['Disney', '2026-10-26', 'will_charge', 'SGD'],
      ['ChatGPT', '2026-10-28', 'will_charge', 'USD'],
      ['Fit Hub', '2026-10-30', 'will_charge', 'IDR'],
    ]);
    expect(overview.monthSchedule[1]).toMatchObject({ subscriptionId: a.id, icon: 'tv', amountMinor: 186_000n });
    expect(overview.couldSave).toEqual([{ subscriptionId: b.id, yearlyMinor: 1_042_800n }]);
    expect(overview.priceIncreases).toEqual([
      expect.objectContaining({ subscriptionId: a.id, previousMinor: 170_000n, currentMinor: 186_000n }),
    ]);
    expect(overview.cancelledSavedMinor).toBe(
      cancelledSavings([{ priceMinor: 274_100n, cycle: 'monthly', endsOn: d('2026-03-31') }], d('2026-10-15'))
        .totalMinor,
    );
    const yearly = subscriptionTotals(active).yearlyMinor;
    const subsYearly = subscriptionTotals([active[0], active[2], active[3]] as typeof active).yearlyMinor;
    expect(overview.byCategory).toEqual([
      {
        categoryId: subs,
        count: 3,
        monthlyMinor: 513_000n,
        yearlyMinor: subsYearly,
        shareBps: Number((subsYearly * 10_000n) / yearly),
      },
      expect.objectContaining({ categoryId: fun, count: 1, yearlyMinor: 2_600_000n }),
      expect.objectContaining({ categoryId: null, count: 1, yearlyMinor: 1_042_800n }),
    ]);
    expect(overview.subscriptions.map((view) => view.name)).toEqual([
      'Canva',
      'Fit Hub',
      'Netflix',
      'Spotify',
      'Disney',
      'ChatGPT',
      'Headspace',
      'Niagahoster',
    ]);
    const onlyPaused = await app((s) => s.listSubscriptions(fx.userId, { status: 'paused' }));
    expect(onlyPaused.subscriptions.map((view) => view.id)).toEqual([paused.id]);
    // The cost chart ends on today's "Per bulan"; SGD (no rate) is left out, Netflix went up in September.
    expect(overview.history.map((month) => month.month)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(overview.history.at(-1)?.monthlyMinor).toBe(overview.totals.monthlyMinor);
    expect(overview.history[4]?.increased).toEqual([a.id]);
    await expect(app((s) => s.countActive(fx.userId))).resolves.toBe(overview.counts.active);
  });
});

describe('detected subscriptions', () => {
  async function candidate(
    merchant: string,
    lastSeenOn: string,
    day: number,
    options: { status?: string; account?: boolean } = {},
  ) {
    const rows = await test.query<{ id: string }>(
      `INSERT INTO detected_recurring
         (user_id, merchant_key, merchant, day_of_month, amount_minor, currency, occurrences, last_seen_on, account_id, category_id, status)
       VALUES ($1, lower($2), $2, $3, 26900, 'IDR', 3, $4, $5, $6, $7::detected_recurring_status) RETURNING id`,
      [
        fx.userId,
        merchant,
        day,
        lastSeenOn,
        options.account === false ? null : fx.bca,
        fx.category('system:subscriptions'),
        options.status ?? 'new',
      ],
    );
    return firstRow(rows, 'detected_recurring').id;
  }

  it('lists new candidates with the impact, adds and dismisses them', async () => {
    await app((s) => s.createSubscription(fx.userId, netflix()));
    const google = await candidate('Google One', '2026-10-05', 5);
    const play = await candidate('Google Play', '2026-10-15', 16);
    const orphan = await candidate('Vidio', '2026-10-08', 8, { account: false });
    const dismissed = await candidate('Gojek', '2026-10-01', 1, { status: 'dismissed' });

    const listed = await app((s) => s.listDetected(fx.userId));
    expect(listed.candidates.map((row) => row.id)).toEqual([play, orphan, google]);
    expect(listed.candidates[0]).toMatchObject({ merchant: 'Google Play', merchantKey: 'google play', dayOfMonth: 16 });
    expect(listed.impact).toEqual(detectionImpact(186_000n, listed.candidates));

    const { subscriptionIds } = await app((s) => s.addDetected(fx.userId, [google, play]));
    expect(subscriptionIds).toHaveLength(2);
    const added = await Promise.all(subscriptionIds.map((id) => app((s) => s.getSubscription(fx.userId, id))));
    expect(added.map((view) => [view.name, view.nextBillingDate, view.priceMinor, view.remindDaysBefore])).toEqual([
      ['Google One', '2026-11-05', 26_900n, 3],
      ['Google Play', '2026-10-16', 26_900n, 3],
    ]);
    const rows = await test.query<{ status: string; subscription_id: string | null }>(
      `SELECT status, subscription_id FROM detected_recurring WHERE id = $1`,
      [google],
    );
    expect(rows).toEqual([{ status: 'added', subscription_id: subscriptionIds[0] }]);
    await expect(app((s) => s.addDetected(fx.userId, []))).resolves.toEqual({ subscriptionIds: [] });
    await rejects(
      app((s) => s.addDetected(fx.userId, [dismissed])),
      'NOT_FOUND',
    );
    await rejects(
      app((s) => s.addDetected(fx.userId, [orphan])),
      'INVALID_SUBSCRIPTION',
    );
    await expect(app((s) => s.dismissDetected(fx.userId, [orphan, dismissed]))).resolves.toEqual({ dismissed: 1 });
    await expect(app((s) => s.dismissDetected(fx.userId, []))).resolves.toEqual({ dismissed: 0 });
    await expect(app((s) => s.listDetected(fx.userId))).resolves.toMatchObject({ candidates: [] });
  });
});

describe('listScheduled', () => {
  it('refuses ranges that are reversed or longer than 366 days', async () => {
    await rejects(
      app((s) => s.listScheduled(fx.userId, { from: d('2026-10-31'), to: d('2026-10-01') })),
      'INVALID_PERIOD',
    );
    await rejects(
      app((s) => s.listScheduled(fx.userId, { from: d('2026-01-01'), to: d('2027-01-02') })),
      'INVALID_PERIOD',
    );
    await expect(
      app((s) => s.listScheduled(fx.userId, { from: d('2026-01-01'), to: d('2027-01-01') })),
    ).resolves.toEqual([]);
  });

  it('merges stored occurrences with dates computed beyond the horizon', async () => {
    const base = rent();
    const kos = await app((s) =>
      s.createRecurrence(fx.userId, {
        ...base,
        template: { ...base.template, description: null, merchant: 'Ibu Kos' } as RecurrenceTemplate,
      }),
    );
    const income = await app((s) =>
      s.createRecurrence(fx.userId, {
        ...base,
        template: { type: 'income', accountId: fx.jago, amountMinor: 900_000n, categoryId: null },
        startOn: d('2026-11-01'),
      }),
    );
    const misc = await app((s) =>
      s.createRecurrence(fx.userId, {
        ...base,
        template: { type: 'expense', accountId: fx.bca, amountMinor: 1_000n, categoryId: null },
        startOn: d('2026-11-01'),
      }),
    );
    const saving = await app((s) =>
      s.createRecurrence(fx.userId, {
        ...base,
        template: {
          type: 'transfer',
          fromAccountId: fx.bca,
          toAccountId: fx.jago,
          sentMinor: 500_000n,
          receivedMinor: 500_000n,
        },
        startOn: d('2026-11-02'),
      }),
    );
    const ghost = await test.query<{ id: string }>(
      `INSERT INTO recurrences (user_id, template, freq, start_on, month_day)
       VALUES ($1, $2::jsonb, 'monthly', '2026-11-03', 3) RETURNING id`,
      [
        fx.userId,
        JSON.stringify(
          encodeTemplate({ type: 'expense', accountId: fx.bca, amountMinor: 5n, categoryId: randomUUID() }),
        ),
      ],
    );
    expect(ghost).toHaveLength(1);
    const tv = await app((s) => s.createSubscription(fx.userId, netflix()));
    const gone = await app((s) => s.createSubscription(fx.userId, netflix({ name: 'Old' })));
    await pastCharge('subscription', gone.id, '2026-10-01', 186_000n);
    await app((s) => s.deleteSubscription(fx.userId, gone.id));

    const november = await app((s) => s.listScheduled(fx.userId, { from: d('2026-10-01'), to: d('2026-11-14') }));
    expect(november.map((item) => [item.dueDate, item.name, item.sourceId, item.direction, item.icon])).toEqual([
      ['2026-10-18', 'Netflix', tv.id, 'out', 'tv'],
      ...[
        ['2026-11-01', null, income.id, 'in', null],
        ['2026-11-01', null, misc.id, 'out', null],
      ].sort((x, y) => String(x[2]).localeCompare(String(y[2]))),
      ['2026-11-02', null, saving.id, 'transfer', null],
      ['2026-11-14', 'Ibu Kos', kos.id, 'out', 'house'],
    ]);
    expect(november.every((item) => item.occurrenceId !== null)).toBe(true);
    expect(november.find((item) => item.sourceId === income.id)).toMatchObject({
      sourceType: 'recurrence',
      expectedMinor: 900_000n,
      currency: 'IDR',
      status: 'scheduled',
      transactionId: null,
      accountId: fx.jago,
    });

    const spanning = await app((s) => s.listScheduled(fx.userId, { from: d('2027-01-01'), to: d('2027-01-31') }));
    const stored = spanning.filter((item) => item.occurrenceId !== null);
    const computed = spanning.filter((item) => item.occurrenceId === null);
    expect(stored.every((item) => item.dueDate <= '2027-01-13')).toBe(true);
    expect(computed.map((item) => [item.dueDate, item.sourceId])).toEqual([
      ['2027-01-14', kos.id],
      ['2027-01-18', tv.id],
    ]);
    expect(computed[1]).toMatchObject({ sourceType: 'subscription', expectedMinor: 186_000n, status: 'scheduled' });

    const later = await app((s) => s.listScheduled(fx.userId, { from: d('2027-03-01'), to: d('2027-03-02') }));
    expect(later.map((item) => [item.dueDate, item.occurrenceId])).toEqual([
      ['2027-03-01', null],
      ['2027-03-01', null],
      ['2027-03-02', null],
    ]);
  });
});
