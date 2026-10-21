// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A small October 2026 for the calendar (today the 15th): payday on the 1st (salary 18.500.000, rent 4.500.000, a
 * savings transfer), costly Sunday the 11th, Wednesday the 14th with income, Netflix scheduled on the 18th, Spotify on
 * the 20th, and a recurring transfer on the 25th.
 */
import type { CalendarRange } from '../src/server/fn/calendar.ts';
import type { CalendarInputs } from '../src/components/calendar/calendar-model.ts';
import type { LocalDate } from '@wf/domain/period';
import { day, scheduledItem } from './dashboard-fixtures.ts';
import { ACCOUNTS, BCA, CATEGORIES, categoryId, GOTRADE } from './ledger-fixtures.ts';
import { transactionRow } from './transaction-fixtures.ts';

const d = (value: string) => value as LocalDate;
const at = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);

export const OCTOBER_ROWS = [
  transactionRow('salary', {
    type: 'income',
    localDate: d('2026-10-01'),
    occurredAt: at('2026-10-01', '08:00'),
    merchant: 'PT Kinarya',
    description: 'Gaji Oktober',
    categoryId: categoryId('system:salary'),
    amountMinor: 18_500_000n,
    amountBaseMinor: 18_500_000n,
  }),
  transactionRow('rent', {
    localDate: d('2026-10-01'),
    occurredAt: at('2026-10-01', '09:15'),
    merchant: 'Sewa Kos',
    categoryId: categoryId('system:rent'),
    amountMinor: -4_500_000n,
    amountBaseMinor: -4_500_000n,
    tags: ['rumah'],
  }),
  transactionRow('save', {
    type: 'transfer',
    localDate: d('2026-10-01'),
    occurredAt: at('2026-10-01', '10:00'),
    description: 'Ke Gotrade',
    categoryId: null,
    toAccountId: GOTRADE.id,
    amountMinor: -6_000_000n,
    amountBaseMinor: -6_000_000n,
  }),
  transactionRow('move', {
    type: 'transfer',
    localDate: d('2026-10-01'),
    occurredAt: at('2026-10-01', '11:00'),
    description: 'Ke OVO',
    categoryId: null,
    toAccountId: 'acc-ovo',
    amountMinor: -100_000n,
    amountBaseMinor: -100_000n,
  }),
  transactionRow('phone', {
    localDate: d('2026-10-11'),
    occurredAt: at('2026-10-11', '13:00'),
    merchant: 'Erafone',
    description: 'Headphone',
    categoryId: categoryId('system:shopping'),
    amountMinor: -2_150_000n,
    amountBaseMinor: -2_150_000n,
  }),
  transactionRow('lunch', {
    localDate: d('2026-10-11'),
    occurredAt: at('2026-10-11', '12:30'),
    merchant: null,
    description: null,
    categoryId: null,
    amountMinor: -50_000n,
    amountBaseMinor: -50_000n,
  }),
  transactionRow('studio', {
    type: 'income',
    localDate: d('2026-10-14'),
    occurredAt: at('2026-10-14', '21:03'),
    merchant: 'Studio Arunika',
    categoryId: categoryId('system:freelance'),
    amountMinor: 6_200_000n,
    amountBaseMinor: 6_200_000n,
  }),
  transactionRow('coffee', {
    localDate: d('2026-10-14'),
    occurredAt: at('2026-10-14', '10:20'),
    merchant: 'Starbucks',
    categoryId: categoryId('system:food'),
    amountMinor: -48_000n,
    amountBaseMinor: -48_000n,
  }),
  transactionRow('market', {
    localDate: d('2026-10-15'),
    occurredAt: at('2026-10-15', '07:55'),
    merchant: 'Indomaret',
    categoryId: categoryId('system:food'),
    amountMinor: -110_000n,
    amountBaseMinor: -110_000n,
  }),
  transactionRow('ride', {
    localDate: d('2026-10-15'),
    occurredAt: at('2026-10-15', '08:12'),
    merchant: 'Gojek',
    categoryId: categoryId('system:transport'),
    amountMinor: -42_000n,
    amountBaseMinor: -42_000n,
  }),
  transactionRow('refund', {
    type: 'income',
    localDate: d('2026-10-15'),
    occurredAt: at('2026-10-15', '09:00'),
    description: 'Refund',
    categoryId: null,
    amountMinor: 50_000n,
    amountBaseMinor: 50_000n,
  }),
];

export const OCTOBER_DAYS = [
  day('2026-10-01', 4_500_000n, 18_500_000n, 4),
  day('2026-10-05', 1_250_000n),
  day('2026-10-09', 940_000n),
  day('2026-10-11', 2_200_000n, 0n, 2),
  day('2026-10-14', 48_000n, 6_200_000n, 2),
  day('2026-10-15', 152_000n, 50_000n, 3),
];

export const OCTOBER_SCHEDULED = [
  scheduledItem({
    sourceId: 'sub-icloud',
    dueDate: d('2026-10-09'),
    name: 'iCloud+',
    status: 'unconfirmed',
    expectedMinor: 45_000n,
  }),
  scheduledItem({
    sourceId: 'sub-fithub',
    dueDate: d('2026-10-03'),
    name: 'Fit Hub',
    status: 'confirmed',
    expectedMinor: 199_000n,
  }),
  scheduledItem({ sourceId: 'sub-netflix', dueDate: d('2026-10-18'), occurrenceId: 'occ-nf' }),
  scheduledItem({ sourceId: 'sub-spotify', dueDate: d('2026-10-20'), name: 'Spotify', expectedMinor: 86_900n }),
  scheduledItem({
    sourceId: 'rec-fund',
    sourceType: 'recurrence',
    dueDate: d('2026-10-25'),
    name: null,
    direction: 'transfer',
    expectedMinor: 1_150_000n,
  }),
];

export function octoberRange(patch: Partial<CalendarRange> = {}): CalendarRange {
  return { days: OCTOBER_DAYS, rows: OCTOBER_ROWS, scheduled: OCTOBER_SCHEDULED, hasTransactions: true, ...patch };
}

export function octoberInputs(patch: Partial<CalendarInputs> = {}): CalendarInputs {
  return { ...octoberRange(), categories: CATEGORIES, accounts: ACCOUNTS, today: d('2026-10-15'), ...patch };
}

export { BCA };
