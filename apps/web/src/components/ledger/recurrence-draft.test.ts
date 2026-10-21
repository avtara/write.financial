// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';
import { defaultRepeat, isoWeekday, recurrenceRequest, repeatPreview, repeatRule } from './recurrence-draft.ts';

const d = (value: string) => value as LocalDate;
const ID = '0192a6c4-0000-7000-8000-000000000001';
const OTHER = '0192a6c4-0000-7000-8000-000000000002';
const expense: RecordTransactionInput = {
  type: 'expense',
  clientId: ID,
  occurredAt: new Date('2026-10-15T12:30:00Z'),
  accountId: ID,
  amountMinor: 150_000n,
  categoryId: OTHER,
  description: 'Futsal mingguan',
  merchant: 'Lapangan Senayan',
  note: 'private',
  tags: ['futsal'],
};

describe('repeat values', () => {
  it('defaults to every month on the date, never ending, with the H-1 reminder', () => {
    expect(isoWeekday(d('2026-10-15'))).toBe(4);
    expect(isoWeekday(d('2026-10-18'))).toBe(7);
    expect(isoWeekday(d('2026-10-19'))).toBe(1);
    expect(defaultRepeat(d('2026-10-15'))).toEqual({
      freq: 'monthly',
      weekday: 4,
      monthDay: 15,
      end: { type: 'never' },
      remind: true,
    });
  });

  it('previews the next three dates after the first (fewer when it ends sooner)', () => {
    const monthly = defaultRepeat(d('2026-10-15'));
    expect(repeatPreview(monthly, d('2026-10-15'))).toEqual(['2026-11-15', '2026-12-15', '2027-01-15']);
    expect(repeatPreview({ ...monthly, freq: 'weekly' }, d('2026-10-15'))).toEqual([
      '2026-10-22',
      '2026-10-29',
      '2026-11-05',
    ]);
    expect(repeatPreview({ ...monthly, freq: 'yearly', end: { type: 'after', count: 2 } }, d('2026-10-15'))).toEqual([
      '2027-10-15',
    ]);
    expect(repeatRule({ ...monthly, freq: 'weekly', weekday: 1 }, d('2026-10-15'))).toEqual({
      freq: 'weekly',
      interval: 1,
      startOn: '2026-10-15',
      weekday: 1,
      monthDay: null,
      end: { type: 'never' },
    });
  });
});

describe('recurrenceRequest', () => {
  it('repeats the recorded entry without its note, from its date', () => {
    expect(recurrenceRequest(expense, { ...defaultRepeat(d('2026-10-15')), freq: 'weekly' }, d('2026-10-15'))).toEqual({
      template: {
        type: 'expense',
        accountId: ID,
        amountMinor: 150_000n,
        categoryId: OTHER,
        description: 'Futsal mingguan',
        merchant: 'Lapangan Senayan',
        tags: ['futsal'],
      },
      freq: 'weekly',
      startOn: '2026-10-15',
      weekday: 4,
      monthDay: null,
      end: { type: 'never' },
      remindOffsetDays: 1,
    });
  });

  it('repeats a transfer with its fee; a reminder can be turned off', () => {
    const transfer: RecordTransactionInput = {
      type: 'transfer',
      clientId: ID,
      occurredAt: new Date(),
      fromAccountId: ID,
      toAccountId: OTHER,
      sentMinor: 3_000_000n,
      receivedMinor: 3_000_000n,
      fee: { minor: 2_500n, categoryId: OTHER },
    };
    expect(
      recurrenceRequest(transfer, { ...defaultRepeat(d('2026-10-14')), remind: false }, d('2026-10-14')),
    ).toMatchObject({
      template: {
        type: 'transfer',
        fromAccountId: ID,
        toAccountId: OTHER,
        sentMinor: 3_000_000n,
        receivedMinor: 3_000_000n,
        fee: { minor: 2_500n, categoryId: OTHER },
        description: null,
        tags: [],
      },
      monthDay: 14,
      remindOffsetDays: null,
    });
    expect(recurrenceRequest({ ...transfer, fee: undefined }, null, d('2026-10-20')).template).toMatchObject({
      fee: null,
    });
  });

  it('"Jadwalkan" without a repeat schedules one occurrence on the date with its H-1 reminder', () => {
    const bare: RecordTransactionInput = {
      type: 'income',
      clientId: ID,
      occurredAt: new Date(),
      accountId: ID,
      amountMinor: 1n,
      categoryId: null,
    };
    expect(recurrenceRequest(bare, null, d('2026-10-20'))).toMatchObject({
      template: { description: null, merchant: null, tags: [] },
      freq: 'monthly',
      startOn: '2026-10-20',
      monthDay: 20,
      weekday: null,
      end: { type: 'after', count: 1 },
      remindOffsetDays: 1,
    });
  });
});
