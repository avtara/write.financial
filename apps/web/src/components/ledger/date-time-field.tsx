// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When a transaction happened (FR-T2, design `u9c7V`): presets (Hari ini / Kemarin / 2 hari lalu / Sabtu lalu /
 * Awal bulan), a calendar whose days with transactions carry a dot ("ada transaksi", loaded per month), and the
 * time with "Sekarang". Future dates are disabled: scheduling them (M3) comes later, as the hint says.
 */
import type { Locale } from '@wf/domain/money';
import { addDays, parseLocalDate, type LocalDate } from '@wf/domain/period';
import { m } from '@wf/i18n/messages';
import { DatePicker } from '@wf/ui/date-picker';
import { formatDate } from '@wf/ui/dates';
import { useState } from 'react';
import { listTransactionDays } from '../../server/fn/transactions-write.ts';
import { datePresets, wallTime } from './transaction-draft.ts';

export interface DateTimeFieldProps {
  readonly date: LocalDate;
  readonly time: string;
  readonly onChange: (next: { readonly date: LocalDate; readonly time: string }) => void;
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly locale: Locale;
  readonly id?: string;
  readonly size?: 'lg' | 'sm';
  /** Trigger text, e.g. "Hari ini" in the Quick Add bar; default "15 Okt 2026, 19.30". */
  readonly triggerLabel?: string;
}

export function DateTimeField({
  date,
  time,
  onChange,
  today,
  timeZone,
  locale,
  id,
  size = 'lg',
  triggerLabel,
}: DateTimeFieldProps) {
  // Days with transactions, per month already loaded ("2026-10" → dates).
  const [marked, setMarked] = useState<Readonly<Record<string, readonly string[]>>>({});
  const presets = datePresets(today);
  const loadMonth = (month: LocalDate) => {
    const key = month.slice(0, 7);
    if (key in marked) return;
    const from = parseLocalDate(`${key}-01`);
    // The calendar shows up to six weeks around the month.
    void listTransactionDays({ data: { from: addDays(from, -7), to: addDays(from, 44) } }).then((result) => {
      if (result.ok) setMarked((current) => ({ ...current, [key]: result.value }));
    });
  };
  const days = new Set(Object.values(marked).flat());

  return (
    <DatePicker
      {...(id === undefined ? {} : { id })}
      size={size}
      value={date}
      onValueChange={(next) => {
        onChange({ date: next, time });
      }}
      onMonthChange={loadMonth}
      triggerLabel={triggerLabel ?? `${formatDate(date, locale, 'date')}, ${time.replace(':', locale === 'id' ? '.' : ':')}`}
      placeholder={m.date_field_placeholder()}
      today={today}
      locale={locale}
      disableFuture
      isMarked={(day) => days.has(day)}
      markerLabel={m.date_field_marker()}
      labels={{ previousMonth: m.calendar_previous_month(), nextMonth: m.calendar_next_month() }}
      presets={[
        { label: m.date_preset_today(), date: presets.today },
        { label: m.date_preset_yesterday(), date: presets.yesterday },
        { label: m.date_preset_two_days_ago(), date: presets.twoDaysAgo },
        { label: m.date_preset_last_saturday(), date: presets.lastSaturday },
        { label: m.date_preset_month_start(), date: presets.monthStart },
      ]}
      presetsFooter={<p className="px-2 py-1 text-[11px] leading-snug text-subtle">{m.date_field_schedule_later()}</p>}
      footer={
        <>
          <label className="flex items-center gap-2 text-[12.5px] text-muted-fg">
            {m.date_field_time()}
            <input
              type="time"
              value={time}
              onChange={(event) => {
                if (event.currentTarget.value !== '') onChange({ date, time: event.currentTarget.value });
              }}
              className="h-8 rounded-[7px] border border-border-input bg-input px-2 font-mono text-[12.5px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-ring"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              onChange({ date: today, time: wallTime(new Date(), timeZone) });
            }}
            className="h-8 rounded-[7px] border border-border px-2.5 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.date_field_now()}
          </button>
        </>
      }
    />
  );
}
