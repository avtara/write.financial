// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { CalendarDays, ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Calendar, type CalendarLabels } from './calendar.tsx';
import { formatDate, type WeekStart } from './dates.ts';
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx';

export interface DatePreset {
  /** "Hari ini", "Kemarin", "Sabtu lalu", "Awal bulan". */
  label: string;
  date: LocalDate;
}

export interface DatePickerProps {
  value: LocalDate | null;
  onValueChange: (date: LocalDate) => void;
  /** Trigger text while `value` is `null`. */
  placeholder: string;
  today: LocalDate;
  locale: Locale;
  weekStartsOn?: WeekStart;
  disableFuture?: boolean;
  isMarked?: (date: LocalDate) => boolean;
  markerLabel?: string;
  labels: CalendarLabels;
  /** One-click dates in a column beside the calendar (FR-T2), each with its short date (`15 Okt`). */
  presets?: readonly DatePreset[];
  /** Under the presets, e.g. a "Jadwalkan" button for future dates. */
  presetsFooter?: ReactNode;
  /** Under the calendar: a legend ("● ada transaksi"), a time field, actions. */
  footer?: ReactNode;
  /** Trigger text instead of the formatted date, e.g. "15 Okt 2026, 19.30" or "Hari ini". */
  triggerLabel?: string;
  /** The month shown (any day in it) when the popover opens and on every navigation, e.g. to load its markers. */
  onMonthChange?: (month: LocalDate) => void;
  /** `lg` 42 px, `sm` 32 px, like the text inputs. */
  size?: 'lg' | 'sm';
  /** From a `Field`, or `aria-label` when there is no visible label. */
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean;
}

const TRIGGER: Readonly<Record<'lg' | 'sm', string>> = {
  lg: 'h-[42px] rounded-[9px] px-3 text-[14px]',
  sm: 'h-8 rounded-[7px] px-2.5 text-[12.5px]',
};

/**
 * A date field (design "Popover — Tanggal"): a trigger showing the date (`15 Okt 2026`) that opens presets and a
 * calendar in a popover. Picking a preset or a day closes it and returns focus to the trigger.
 */
export function DatePicker({
  value,
  onValueChange,
  placeholder,
  today,
  locale,
  weekStartsOn = 1,
  disableFuture = false,
  isMarked,
  markerLabel,
  triggerLabel,
  onMonthChange,
  labels,
  presets = [],
  presetsFooter,
  footer,
  size = 'lg',
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<LocalDate>(value ?? today);
  const showMonth = (next: LocalDate) => {
    setMonth(next);
    onMonthChange?.(next);
  };
  const pick = (date: LocalDate) => {
    onValueChange(date);
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) showMonth(value ?? today);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        {...(id === undefined ? {} : { id })}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={`flex w-full min-w-0 items-center gap-2 border border-border-input bg-input text-left text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-red ${TRIGGER[size]}`}
      >
        <CalendarDays aria-hidden="true" className="size-3.5 shrink-0 text-muted-fg" />
        <span className={`min-w-0 flex-1 truncate ${value === null ? 'text-subtle' : ''}`}>
          {value === null ? placeholder : (triggerLabel ?? formatDate(value, locale, 'date'))}
        </span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
      </PopoverTrigger>
      <PopoverContent className="flex w-max max-w-[calc(100vw-16px)] flex-col">
        <div className="flex">
          {presets.length === 0 && presetsFooter === undefined ? null : (
            <div className="flex w-[140px] shrink-0 flex-col gap-px border-r border-border p-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={preset.date === value}
                  onClick={() => {
                    pick(preset.date);
                  }}
                  className="flex flex-col items-start gap-px rounded-[6px] px-2 py-1.5 text-left text-[12.5px] text-text-secondary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-fg"
                >
                  {preset.label}
                  <span className="font-mono text-[10.5px] font-normal text-subtle">
                    {formatDate(preset.date, locale, 'day')}
                  </span>
                </button>
              ))}
              {presetsFooter === undefined ? null : (
                <div className="mt-1 border-t border-border pt-1">{presetsFooter}</div>
              )}
            </div>
          )}
          <div className="w-[280px] p-3">
            <Calendar
              month={month}
              onMonthChange={showMonth}
              selected={value}
              onSelect={pick}
              today={today}
              locale={locale}
              weekStartsOn={weekStartsOn}
              disableFuture={disableFuture}
              isMarked={isMarked}
              markerLabel={markerLabel}
              labels={labels}
            />
          </div>
        </div>
        {footer === undefined ? null : (
          <div className="flex items-center gap-2 border-t border-border px-3.5 py-3">{footer}</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
