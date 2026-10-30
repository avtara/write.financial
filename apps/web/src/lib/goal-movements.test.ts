// SPDX-License-Identifier: AGPL-3.0-only
import type { RecurrenceView, ScheduledItem } from '@wf/db/schedules';
import type { TransactionRow } from '@wf/db/transaction-query';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import {
  DANA_DARURAT,
  DANA_PENSIUN,
  LIBURAN_BALI,
  PERPANJANG_STNK,
  goalView,
  plan,
  SERVIS_MOTOR,
} from '../../test/goal-fixtures.ts';
import { BCA, JAGO, OVO } from '../../test/ledger-fixtures.ts';
import { goalAccountIds, goalMovements, nextContributionMonth } from './goal-movements.ts';

const d = (value: string) => value as LocalDate;

function item(overrides: Partial<ScheduledItem> & Pick<ScheduledItem, 'sourceId' | 'dueDate'>): ScheduledItem {
  return {
    occurrenceId: `occ-${overrides.sourceId}-${overrides.dueDate}`,
    sourceType: 'recurrence',
    name: null,
    icon: null,
    expectedMinor: 0n,
    currency: 'IDR',
    status: 'scheduled',
    transactionId: null,
    accountId: BCA.id,
    direction: 'transfer',
    ...overrides,
  };
}

function row(overrides: Partial<TransactionRow> & Pick<TransactionRow, 'id'>): TransactionRow {
  return {
    type: 'transfer',
    occurredAt: new Date('2026-10-07T05:00:00Z'),
    localDate: d('2026-10-07'),
    merchant: null,
    description: null,
    categoryId: null,
    accountId: BCA.id,
    toAccountId: JAGO.id,
    amountMinor: -1_000_000n,
    currency: 'IDR',
    receivedMinor: 1_000_000n,
    receivedCurrency: 'IDR',
    amountBaseMinor: -1_000_000n,
    feeMinor: null,
    fxDiffBaseMinor: null,
    tags: [],
    hasAttachment: false,
    hasNote: false,
    source: 'manual',
    splitParentId: null,
    ...overrides,
  };
}

const goals = [DANA_DARURAT, LIBURAN_BALI, SERVIS_MOTOR, PERPANJANG_STNK, DANA_PENSIUN];

describe('goalMovements', () => {
  it('counts the planned shares of each occurrence and the labeled transfers that are not occurrences', () => {
    const movements = goalMovements(
      goals,
      [
        item({
          sourceId: 'rec-kantong',
          dueDate: d('2026-10-01'),
          name: 'Kantong darurat',
          status: 'confirmed',
          transactionId: 'tx-kantong',
        }),
        item({ sourceId: 'rec-sisihkan', dueDate: d('2026-10-25'), name: 'Sisihkan dana tidak rutin' }),
        // Neither a goal's recurrence nor a recurrence at all.
        item({ sourceId: 'rec-dca', dueDate: d('2026-10-01'), status: 'confirmed', transactionId: 'tx-dca' }),
        item({ sourceId: 'sub-netflix', sourceType: 'subscription', dueDate: d('2026-10-18') }),
      ],
      [
        // The occurrence's own transaction is counted once, through it.
        row({ id: 'tx-kantong', localDate: d('2026-10-01'), tags: ['dana-darurat'] }),
        // A recurring transfer tagged with goals without a plan of theirs (the DCA).
        row({ id: 'tx-dca', source: 'recurring', tags: ['dana-pensiun'] }),
        row({ id: 'tx-dca-unlinked', source: 'recurring', tags: ['dana-pensiun'] }),
        // "Setor manual" into the goal's account, "Tarik dana" out of it, and a labeled transfer elsewhere.
        row({ id: 'tx-in', localDate: d('2026-10-07'), tags: ['dana-darurat'] }),
        row({
          id: 'tx-out',
          localDate: d('2026-10-09'),
          accountId: JAGO.id,
          toAccountId: BCA.id,
          amountMinor: -2_000_000n,
          receivedMinor: 2_000_000n,
          tags: ['dana-darurat'],
        }),
        row({
          id: 'tx-other',
          localDate: d('2026-10-07'),
          toAccountId: OVO.id,
          receivedMinor: null,
          tags: ['dana-pensiun'],
        }),
        row({ id: 'tx-untagged', tags: ['kopi'] }),
        row({ id: 'tx-expense', type: 'expense', tags: ['dana-darurat'] }),
      ],
    );
    expect(movements.map((movement) => [movement.key, movement.amountMinor, movement.status])).toEqual([
      ['rec-kantong:2026-10-01', 500_000n, 'recorded'],
      ['tx-in', 1_000_000n, 'recorded'],
      ['tx-other', 1_000_000n, 'recorded'],
      ['tx-out', -2_000_000n, 'recorded'],
      ['rec-sisihkan:2026-10-25', 1_150_000n, 'scheduled'],
    ]);
    expect(movements[0]).toEqual({
      key: 'rec-kantong:2026-10-01',
      date: '2026-10-01',
      kind: 'plan',
      name: 'Kantong darurat',
      shares: [{ goalId: DANA_DARURAT.id, amountMinor: 500_000n }],
      amountMinor: 500_000n,
      fromAccountId: BCA.id,
      toAccountId: JAGO.id,
      status: 'recorded',
      transactionId: 'tx-kantong',
    });
    expect(movements.at(-1)?.shares.map((share) => share.goalId)).toEqual([
      LIBURAN_BALI.id,
      SERVIS_MOTOR.id,
      PERPANJANG_STNK.id,
    ]);
    expect(movements[3]).toMatchObject({ kind: 'manual', name: null, fromAccountId: JAGO.id, transactionId: 'tx-out' });
  });

  it('keeps a paused plan out of what is still to come but in what it already sent, and maps every status', () => {
    const paused = {
      ...LIBURAN_BALI,
      plans: [plan({ id: 'p', recurrenceId: 'rec-p', amountMinor: 1n, active: false })],
    };
    const statuses = ['scheduled', 'due_review', 'unconfirmed', 'confirmed', 'skipped'] as const;
    const movements = goalMovements(
      [paused],
      statuses.map((status, index) =>
        item({ sourceId: 'rec-p', dueDate: d(`2026-10-0${String(index + 1)}`), status, expectedMinor: 1n }),
      ),
      [],
    );
    expect(movements.map((movement) => movement.status)).toEqual(['recorded']);
    const active = { ...paused, plans: [{ ...paused.plans[0], active: true } as (typeof paused.plans)[number]] };
    expect(
      goalMovements(
        [active],
        statuses.map((status, index) =>
          item({ sourceId: 'rec-p', dueDate: d(`2026-10-0${String(index + 1)}`), status }),
        ),
        [],
      ).map((movement) => movement.status),
    ).toEqual(['scheduled', 'review', 'review', 'recorded', 'skipped']);
  });

  it('leaves a plan stopped before a recorded occurrence out of it when the active plans make up its amount', () => {
    const usedStnk = { ...PERPANJANG_STNK, plans: PERPANJANG_STNK.plans.map((entry) => ({ ...entry, active: false })) };
    // STNK used on the 20th, so the 25th sent Rp1.107.000; STNK paused after the 25th, so it sent Rp1.150.000.
    for (const [expectedMinor, goalIds] of [
      [1_107_000n, [LIBURAN_BALI.id, SERVIS_MOTOR.id]],
      [1_150_000n, [LIBURAN_BALI.id, SERVIS_MOTOR.id, PERPANJANG_STNK.id]],
    ] as const) {
      const [movement] = goalMovements(
        [LIBURAN_BALI, SERVIS_MOTOR, usedStnk],
        [
          item({
            sourceId: 'rec-sisihkan',
            dueDate: d('2026-10-25'),
            status: 'confirmed',
            transactionId: 'tx-sisihkan',
            expectedMinor,
          }),
        ],
        [],
      );
      expect(movement?.amountMinor).toBe(expectedMinor);
      expect(movement?.shares.map((share) => share.goalId)).toEqual(goalIds);
    }
  });

  it('orders a day’s movements by key', () => {
    const movements = goalMovements(
      [DANA_DARURAT],
      [],
      [row({ id: 'b', tags: ['dana-darurat'] }), row({ id: 'a', tags: ['dana-darurat'] })],
    );
    expect(movements.map((movement) => movement.key)).toEqual(['a', 'b']);
  });

  it('gives a plan a share only of the occurrences in its months ("Nov–Apr" is not in October’s)', () => {
    const asuransi = goalView({
      id: 'asuransi',
      name: 'Asuransi motor',
      plans: [
        plan({
          id: 'a',
          recurrenceId: 'rec-sisihkan',
          amountMinor: 250_000n,
          startMonth: '2026-11' as YearMonth,
          endMonth: '2027-04' as YearMonth,
        }),
      ],
    });
    const at = (dueDate: string) => item({ sourceId: 'rec-sisihkan', dueDate: d(dueDate), expectedMinor: 250_000n });
    const movements = goalMovements([asuransi], [at('2026-10-25'), at('2026-11-25')], []);
    expect(movements.map((movement) => [movement.date, movement.amountMinor])).toEqual([['2026-11-25', 250_000n]]);
  });
});

describe('goalAccountIds', () => {
  it('is the source accounts and the "Simpan di" account', () => {
    expect([...goalAccountIds(DANA_DARURAT)]).toEqual([JAGO.id]);
    expect([...goalAccountIds({ sources: LIBURAN_BALI.sources, accountId: OVO.id })]).toEqual([BCA.id, OVO.id]);
  });
});

describe('nextContributionMonth', () => {
  const recurrence = (id: string, dueDate: string | null) =>
    ({ id, nextDue: dueDate === null ? null : { occurrenceId: null, dueDate, status: 'scheduled' } }) as RecurrenceView;
  const october = '2026-10' as YearMonth;

  it('is the earliest next due month of its active plans, never before this month', () => {
    expect(
      nextContributionMonth(
        DANA_DARURAT,
        [recurrence('rec-kantong', '2026-11-01'), recurrence('rec-bibit', '2026-11-14')],
        october,
      ),
    ).toBe('2026-11');
    expect(nextContributionMonth(LIBURAN_BALI, [recurrence('rec-sisihkan', '2026-10-25')], october)).toBe('2026-10');
    // An overdue occurrence still waiting for review.
    expect(nextContributionMonth(LIBURAN_BALI, [recurrence('rec-sisihkan', '2026-09-25')], october)).toBe('2026-10');
  });

  it('is this month without an active plan or a next due date', () => {
    expect(nextContributionMonth(DANA_PENSIUN, [], october)).toBe('2026-10');
    expect(nextContributionMonth(LIBURAN_BALI, [recurrence('rec-sisihkan', null)], october)).toBe('2026-10');
    const paused = { plans: [plan({ id: 'p', recurrenceId: 'rec-sisihkan', active: false })] };
    expect(nextContributionMonth(paused, [recurrence('rec-sisihkan', '2027-01-25')], october)).toBe('2026-10');
  });

  it('waits for a plan’s first month and leaves out a plan that has ended', () => {
    const asuransi = {
      plans: [plan({ id: 'a', recurrenceId: 'rec-sisihkan', startMonth: '2026-11' as YearMonth, endMonth: null })],
    };
    expect(nextContributionMonth(asuransi, [recurrence('rec-sisihkan', '2026-10-25')], october)).toBe('2026-11');
    const ended = {
      plans: [plan({ id: 'e', recurrenceId: 'rec-sisihkan', endMonth: '2026-09' as YearMonth })],
    };
    expect(nextContributionMonth(ended, [recurrence('rec-sisihkan', '2026-12-25')], october)).toBe('2026-10');
  });
});
