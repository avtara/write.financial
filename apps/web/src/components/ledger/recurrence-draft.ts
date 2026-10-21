// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Ulangi" in the Record sheet (FR-T6, design `ifafu`, `i9gG9u`, `ETzDc`, `lsV22`): the repeat the user picks
 * (Mingguan on a weekday, Bulanan on a date, Tahunan; ends never or after N times; the H-1 reminder), its preview of
 * the next three dates, and the recurrence it creates — after recording the transaction as the first occurrence, or,
 * for a future date ("Jadwalkan"), instead of recording anything (each occurrence goes to the Review queue).
 */
import type { LocalDate } from '@wf/domain/period';
import { addDays } from '@wf/domain/period';
import {
  nextOccurrences,
  type IsoWeekday,
  type RecurrenceEnd,
  type RecurrenceFreq,
  type RecurrenceRule,
} from '@wf/domain/recurrence';
import type { RecurrenceRequest } from '../../server/fn/schedules.ts';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';

export interface RepeatValues {
  readonly freq: RecurrenceFreq;
  /** Mingguan: "Tiap hari Kamis". */
  readonly weekday: IsoWeekday;
  /** Bulanan: "Tiap tgl 15" (clamped to the month's last day). */
  readonly monthDay: number;
  readonly end: RecurrenceEnd;
  /** "H-1": the 09.00 reminder the day before each occurrence. */
  readonly remind: boolean;
}

/** Days before each occurrence of the "H-1" reminder. */
export const REMIND_DAYS_BEFORE = 1;
/** Dates the preview lists after the first ("Lalu 15 Nov · 15 Des · 15 Jan"). */
const PREVIEW_COUNT = 3;

/** ISO weekday (1 = Monday … 7 = Sunday) of a date. */
export function isoWeekday(date: LocalDate): IsoWeekday {
  return (((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as IsoWeekday;
}

/** "Ulangi setiap bulan" on the transaction's date: its weekday and day of month, never ending, with H-1. */
export function defaultRepeat(date: LocalDate): RepeatValues {
  return {
    freq: 'monthly',
    weekday: isoWeekday(date),
    monthDay: Number(date.slice(8, 10)),
    end: { type: 'never' },
    remind: true,
  };
}

/** The repeat rule starting at the transaction's (or the scheduled) date. */
export function repeatRule(repeat: RepeatValues, startOn: LocalDate): RecurrenceRule {
  return {
    freq: repeat.freq,
    interval: 1,
    startOn,
    weekday: repeat.freq === 'weekly' ? repeat.weekday : null,
    monthDay: repeat.freq === 'monthly' ? repeat.monthDay : null,
    end: repeat.end,
  };
}

/** The next three occurrences after `date` ("Lalu …"); fewer when the repeat ends sooner. */
export function repeatPreview(repeat: RepeatValues, date: LocalDate): LocalDate[] {
  return nextOccurrences(repeatRule(repeat, date), { from: addDays(date, 1), count: PREVIEW_COUNT });
}

/** The transaction every occurrence proposes: the recorded one without its note, time, or exchange rate. */
function templateOf(input: RecordTransactionInput): RecurrenceRequest['template'] {
  const common = { description: input.description ?? null, tags: input.tags ?? [] };
  if (input.type !== 'transfer') {
    return {
      ...common,
      type: input.type,
      accountId: input.accountId,
      amountMinor: input.amountMinor,
      categoryId: input.categoryId,
      merchant: input.merchant ?? null,
    };
  }
  return {
    ...common,
    type: 'transfer',
    fromAccountId: input.fromAccountId,
    toAccountId: input.toAccountId,
    sentMinor: input.sentMinor,
    receivedMinor: input.receivedMinor,
    fee: input.fee ?? null,
  };
}

/**
 * The recurrence to create for `input` on `date`: the chosen repeat, or — for "Jadwalkan" without one — a single
 * occurrence on that date with its H-1 reminder.
 */
export function recurrenceRequest(
  input: RecordTransactionInput,
  repeat: RepeatValues | null,
  date: LocalDate,
): RecurrenceRequest {
  const rule = repeatRule(repeat ?? { ...defaultRepeat(date), end: { type: 'after', count: 1 } }, date);
  return {
    template: templateOf(input),
    freq: rule.freq,
    startOn: date,
    weekday: rule.weekday,
    monthDay: rule.monthDay,
    end: rule.end,
    remindOffsetDays: repeat === null || repeat.remind ? REMIND_DAYS_BEFORE : null,
  };
}
