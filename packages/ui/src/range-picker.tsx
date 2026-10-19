// SPDX-License-Identifier: AGPL-3.0-only
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { addMonths, parseISO } from 'date-fns';
import { CalendarRange, ChevronDown } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Calendar, type CalendarLabels } from './calendar.tsx';
import { formatDateRange, fromDate, type DateRange, type WeekStart } from './dates.ts';
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx';

export interface RangePreset {
  /** "7 hari terakhir", "Periode ini", "Kuartal ini", "Sejak awal". */
  label: string;
  range: DateRange;
}

export interface RangePickerLabels extends CalendarLabels {
  start: string;
  end: string;
  apply: string;
  cancel: string;
}

export interface RangePickerProps {
  value: DateRange;
  onValueChange: (range: DateRange) => void;
  presets: readonly RangePreset[];
  /**
   * The line next to the actions for the chosen range, e.g. "30 hari · melintasi 2 periode" (FR-S7): the caller
   * counts days and periods with `@wf/domain/period`.
   */
  summary: (range: DateRange) => ReactNode;
  today: LocalDate;
  locale: Locale;
  weekStartsOn?: WeekStart;
  /** Default `true`: reports cover the past (FR-S7). */
  disableFuture?: boolean;
  labels: RangePickerLabels;
  /** Names the trigger, e.g. "Rentang tanggal"; its text is the range itself. */
  'aria-label': string;
}

const DATE_INPUT =
  'h-8 w-full rounded-[7px] border border-border-input bg-input px-2.5 font-mono text-[12.5px] text-fg [color-scheme:light_dark] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The draft while choosing: after the first click only `start` is known. */
type Draft = { start: LocalDate; end: LocalDate | null };

/**
 * A custom date range (FR-S7, design "Popover — Rentang khusus"): presets, start and end fields, and two month
 * calendars. The first click on a day starts a range, the second ends it (in either order); applying after one click
 * chooses that single day. Nothing changes until "Terapkan"; Escape or "Batal" discard the draft. Future dates are
 * disabled by default.
 */
export function RangePicker({
  value,
  onValueChange,
  presets,
  summary,
  today,
  locale,
  weekStartsOn = 1,
  disableFuture = true,
  labels,
  'aria-label': ariaLabel,
}: RangePickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(value);
  // The right-hand calendar's month; the left one shows the month before.
  const [month, setMonth] = useState<LocalDate>(value.end);
  const previousMonth = fromDate(addMonths(parseISO(month), -1));
  const chosen: DateRange = { start: draft.start, end: draft.end ?? draft.start };

  const show = (range: DateRange) => {
    setDraft(range);
    setMonth(range.end);
  };
  const pickDay = (date: LocalDate) => {
    if (draft.end !== null) setDraft({ start: date, end: null });
    else setDraft(date < draft.start ? { start: date, end: draft.start } : { start: draft.start, end: date });
  };
  const typed = (field: 'start' | 'end', text: string) => {
    // A cleared or half-typed native date field reports "".
    if (text === '') return;
    const date = text as LocalDate;
    const [start, end] = field === 'start' ? [date, chosen.end] : [chosen.start, date];
    show(start <= end ? { start, end } : { start: end, end: start });
  };
  const calendar = { onSelect: pickDay, range: draft, today, locale, weekStartsOn, disableFuture, labels };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) show(value);
        setOpen(next);
      }}
    >
      <PopoverTrigger
        aria-label={`${ariaLabel}: ${formatDateRange(value, locale, today)}`}
        className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-border bg-card px-2.5 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <CalendarRange aria-hidden="true" className="size-3.5 text-muted-fg" />
        {formatDateRange(value, locale, today)}
        <ChevronDown aria-hidden="true" className="size-3.5 text-subtle" />
      </PopoverTrigger>
      <PopoverContent className="flex w-max max-w-[calc(100vw-16px)] flex-col">
        <div className="flex">
          <div className="flex w-[160px] shrink-0 flex-col gap-px border-r border-border p-1.5">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                aria-pressed={preset.range.start === draft.start && preset.range.end === draft.end}
                onClick={() => {
                  show(preset.range);
                }}
                className="flex flex-col items-start gap-px rounded-[6px] px-2 py-1.5 text-left text-[12.5px] text-text-secondary hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-muted aria-pressed:font-medium aria-pressed:text-fg"
              >
                {preset.label}
                <span className="font-mono text-[10.5px] font-normal text-subtle">
                  {formatDateRange(preset.range, locale, today)}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3 p-3">
            <div className="flex gap-3">
              {(['start', 'end'] as const).map((field) => (
                <div key={field} className="flex flex-1 flex-col gap-1">
                  <label htmlFor={`${id}-${field}`} className="text-[11.5px] text-muted-fg">
                    {labels[field]}
                  </label>
                  <input
                    id={`${id}-${field}`}
                    type="date"
                    value={draft[field] ?? ''}
                    {...(disableFuture ? { max: today } : {})}
                    onChange={(event) => {
                      typed(field, event.currentTarget.value);
                    }}
                    className={DATE_INPUT}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-4">
              <div className="w-[252px]">
                <Calendar
                  {...calendar}
                  month={previousMonth}
                  onMonthChange={(next) => {
                    setMonth(fromDate(addMonths(parseISO(next), 1)));
                  }}
                  navigation="previous"
                />
              </div>
              <div className="w-[252px]">
                <Calendar {...calendar} month={month} onMonthChange={setMonth} navigation="next" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 border-t border-border px-3.5 py-3">
          <p aria-live="polite" className="flex-1 text-[12px] text-muted-fg">
            {summary(chosen)}
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
            }}
            className="inline-flex h-8 items-center rounded-[8px] border border-border px-3.5 text-[13px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              onValueChange(chosen);
              setOpen(false);
            }}
            className="inline-flex h-8 items-center rounded-[8px] bg-fg px-3.5 text-[13px] font-semibold text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {labels.apply}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
