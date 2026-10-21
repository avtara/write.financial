// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Ulangi" / "Pemasukan rutin" in the Record sheet (FR-T6, design `ifafu`, `i9gG9u`, `ETzDc`, `lsV22`): Mingguan
 * (weekday), Bulanan (day of month), or Tahunan; ends never or after N times; the next three dates ("Lalu 15 Nov ·
 * 15 Des · 15 Jan") and the H-1 reminder. Every occurrence goes to the Review queue first.
 */
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import type { IsoWeekday, RecurrenceFreq } from '@wf/domain/recurrence';
import { m } from '@wf/i18n/messages';
import { formatDate, weekdayName, weekdayNames } from '@wf/ui/dates';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { Bell, BellOff, CalendarDays, Plus, Repeat, X } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Select } from '../form.tsx';
import { defaultRepeat, repeatPreview, type RepeatValues } from './recurrence-draft.ts';
import type { EntryKind } from './transaction-draft.ts';

export interface RepeatFieldProps {
  readonly value: RepeatValues | null;
  readonly onChange: (next: RepeatValues | null) => void;
  /** The transaction's date: the first occurrence. */
  readonly date: LocalDate;
  readonly kind: EntryKind;
  readonly locale: Locale;
}

const TITLES: Readonly<Record<RecurrenceFreq, () => string>> = {
  weekly: m.record_repeat_title_weekly,
  monthly: m.record_repeat_title_monthly,
  yearly: m.record_repeat_title_yearly,
};

/** The default "Setelah N kali" (design `ETzDc`). */
const DEFAULT_END_COUNT = 6;
const MAX_END_COUNT = 999;

export function RepeatField({ value, onChange, date, kind, locale }: RepeatFieldProps) {
  const id = useId();
  const income = kind === 'income';
  if (value === null) {
    return (
      <button
        type="button"
        onClick={() => {
          onChange(defaultRepeat(date));
        }}
        className="inline-flex h-8 items-center gap-1.5 self-start rounded-[8px] border border-border px-2.5 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Plus aria-hidden="true" className="size-3.5" />
        {income ? m.record_repeat_income() : m.record_repeat_add()}
      </button>
    );
  }
  const weekdays = weekdayNames(locale, 1);
  const title = income ? m.record_repeat_income() : TITLES[value.freq]();
  const every =
    value.freq === 'weekly'
      ? m.record_repeat_every_weekday({ weekday: weekdayName(value.weekday, locale) })
      : value.freq === 'monthly'
        ? m.record_repeat_every_month_day({ day: value.monthDay })
        : m.record_repeat_every_date({ date: formatDate(date, locale, 'day') });
  const preview = repeatPreview(value, date);
  const update = (patch: Partial<RepeatValues>) => {
    onChange({ ...value, ...patch });
  };
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 id={`${id}-title`} className="flex items-center gap-1.5 text-[13px] font-medium text-fg">
            <Repeat aria-hidden="true" className="size-3.5 text-muted-fg" />
            {title}
          </h3>
          <p className="text-[12px] text-muted-fg">{m.record_repeat_summary({ every })}</p>
        </div>
        <button
          type="button"
          aria-label={m.record_repeat_remove()}
          onClick={() => {
            onChange(null);
          }}
          className="flex size-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-muted-fg">{m.record_repeat_frequency()}</span>
          <SegmentedControl<RecurrenceFreq>
            label={m.record_repeat_frequency()}
            value={value.freq}
            onValueChange={(freq) => {
              update({ freq });
            }}
            options={[
              { value: 'weekly', label: m.record_repeat_weekly() },
              { value: 'monthly', label: m.record_repeat_monthly() },
              { value: 'yearly', label: m.record_repeat_yearly() },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {value.freq === 'weekly' ? (
            <Labeled id={`${id}-weekday`} label={m.record_repeat_weekday()}>
              <Select
                id={`${id}-weekday`}
                size="sm"
                value={value.weekday}
                onChange={(event) => {
                  update({ weekday: Number(event.currentTarget.value) as IsoWeekday });
                }}
              >
                {weekdays.map((day, index) => (
                  <option key={day.long} value={index + 1}>
                    {day.long}
                  </option>
                ))}
              </Select>
            </Labeled>
          ) : value.freq === 'monthly' ? (
            <Labeled id={`${id}-day`} label={m.record_repeat_month_day()}>
              <Select
                id={`${id}-day`}
                size="sm"
                value={value.monthDay}
                onChange={(event) => {
                  update({ monthDay: Number(event.currentTarget.value) });
                }}
              >
                {Array.from({ length: 31 }, (_, index) => (
                  <option key={index} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </Select>
            </Labeled>
          ) : (
            <p className="flex items-end pb-1.5 text-[12.5px] text-fg">{every}</p>
          )}
          <Labeled id={`${id}-end`} label={m.record_repeat_end()}>
            <Select
              id={`${id}-end`}
              size="sm"
              value={value.end.type}
              onChange={(event) => {
                update({
                  end:
                    event.currentTarget.value === 'after'
                      ? { type: 'after', count: DEFAULT_END_COUNT }
                      : { type: 'never' },
                });
              }}
            >
              <option value="never">{m.record_repeat_end_never()}</option>
              <option value="after">{m.record_repeat_end_after()}</option>
            </Select>
          </Labeled>
        </div>
        {value.end.type === 'after' ? (
          <label className="flex items-center gap-2 text-[12.5px] text-muted-fg">
            {m.record_repeat_end_count()}
            <input
              type="number"
              min={1}
              max={MAX_END_COUNT}
              value={value.end.count}
              onChange={(event) => {
                const count = Math.trunc(Number(event.currentTarget.value));
                if (count >= 1 && count <= MAX_END_COUNT) update({ end: { type: 'after', count } });
              }}
              className="h-8 w-20 rounded-[7px] border border-border-input bg-input px-2 font-mono text-[12.5px] text-fg outline-none focus-visible:outline-2 focus-visible:outline-ring"
            />
            {m.record_repeat_times()}
          </label>
        ) : null}
        <div className="flex items-center gap-2 text-[12px] text-muted-fg">
          <CalendarDays aria-hidden="true" className="size-3.5" />
          <span>{m.record_repeat_preview()}</span>
          <ol aria-label={m.record_repeat_preview_label()} className="flex flex-1 flex-wrap gap-1">
            {preview.length === 0 ? (
              <li className="text-subtle">{m.record_repeat_preview_none()}</li>
            ) : (
              preview.map((day) => (
                <li key={day} className="rounded-[4px] border border-border px-1.5 font-mono text-[11.5px] text-fg">
                  {formatDate(day, locale, 'day')}
                </li>
              ))
            )}
          </ol>
          <button
            type="button"
            aria-pressed={value.remind}
            aria-label={m.record_repeat_remind_label()}
            onClick={() => {
              update({ remind: !value.remind });
            }}
            className="inline-flex h-7 items-center gap-1 rounded-[6px] px-1.5 text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring aria-pressed:text-fg"
          >
            {value.remind ? (
              <Bell aria-hidden="true" className="size-3.5" />
            ) : (
              <BellOff aria-hidden="true" className="size-3.5" />
            )}
            {m.record_repeat_remind()}
          </button>
        </div>
      </div>
    </section>
  );
}

function Labeled({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11.5px] text-subtle">
        {label}
      </label>
      {children}
    </div>
  );
}
