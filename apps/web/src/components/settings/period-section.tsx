// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Periode bulanan (FR-P1–P3, design `kNL3D`, `WpMpY`, `hvzfS`, `d2ztG3`): the start day 1–28 or "Ikuti
 * gajian", the payday the latest salary incomes suggest (with the FR-P2 mismatch warning), the end-month naming rule,
 * a preview of the coming periods, and — when the day changes — the choice between starting from the next period
 * (prorated transition) and recalculating the current one (confirmed in a dialog).
 */
import { useRouter } from '@tanstack/react-router';
import type { Payday, PeriodsOverview, StartDayApply, StartDayPreview } from '@wf/db/periods';
import { addDays, formatPeriodLabel, PRORATION_BASE_DAYS, type LocalDate, type Period } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, formatDateRange } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Popover, PopoverContent, PopoverTrigger } from '@wf/ui/popover';
import { toast } from '@wf/ui/toast';
import {
  ArrowLeftRight,
  CalendarDays,
  ChevronsUpDown,
  CircleAlert,
  Cloud,
  Info,
  Lock,
  RefreshCw,
  Repeat,
  Wallet,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import type { Result } from '../../server/access.ts';
import { changePeriodStart, previewPeriodStart } from '../../server/fn/budget-write.ts';
import { Button, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { RichMessage } from '../rich-message.tsx';
import { settle, type Failure } from '../setup/result.ts';
import { Badge, SettingsGroup, SettingsRow } from './settings-ui.tsx';

const LAST_DAY = 28;
const WEEK = 7;
const DAYS = Array.from({ length: LAST_DAY }, (_, index) => index + 1);
const WEEKS = Array.from({ length: LAST_DAY / WEEK }, (_, week) => DAYS.slice(week * WEEK, (week + 1) * WEEK));
/** The "Ikuti gajian" chip, available or not. */
const FOLLOW =
  'inline-flex h-6 items-center gap-1.5 self-start rounded-[6px] px-2 text-[11.5px] font-medium focus-visible:outline-2 focus-visible:outline-ring';

/** Where an arrow key, Home, or End moves the focus in the 7-column day grid; `null` for other keys. */
export function gridTarget(key: string, day: number): number | null {
  const steps: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -WEEK, ArrowDown: WEEK };
  if (key === 'Home') return 1;
  if (key === 'End') return LAST_DAY;
  const step = steps[key];
  return step === undefined ? null : Math.min(LAST_DAY, Math.max(1, day + step));
}

/**
 * "Mulai periode berikutnya" (`hvzfS`): the current period stays, then the transition with its prorated budget
 * ("batas anggaran Rp18.750.000 → Rp15.000.000 (24/30 hari)"), without the budget clause when nothing is budgeted.
 */
function NextPeriodDetail({
  preview,
  current,
  today,
  locale,
}: {
  preview: StartDayPreview;
  current: Period;
  today: LocalDate;
  locale: Locale;
}) {
  const name = formatPeriodLabel(current.label, locale, 'month');
  const kept = formatDateRange(current, locale, today);
  const { transition } = preview;
  if (transition === null) return m.period_settings_apply_next_plain({ name, range: kept, day: preview.toDay });
  const days = String(transition.period.days);
  const shared = { name, range: kept, transition: formatDateRange(transition.period, locale, today), days };
  if (transition.limitMinor === 0n) return m.period_settings_apply_next_transition(shared);
  return (
    <RichMessage
      message={m.period_settings_apply_next_budget}
      slots={{
        ...shared,
        base: String(PRORATION_BASE_DAYS),
        from: <Money minor={transition.limitMinor} currency={preview.baseCurrency} context="amount" locale={locale} />,
        to: <Money minor={transition.proratedMinor} currency={preview.baseCurrency} context="amount" locale={locale} />,
      }}
    />
  );
}

/**
 * What recalculating the current period changes (`hvzfS`, `d2ztG3`): the period containing today afterwards
 * ("Oktober jadi 25 Sep – 24 Okt"), the days whose transactions change period ("25–30 Sep") and whether they move
 * into it (or out of it, into a transition), and the largest of those transactions ("Tokopedia — Sepatu lari").
 */
export function recalculation(preview: StartDayPreview, current: Period, today: LocalDate, locale: Locale) {
  const after = preview.periods.find((period) => period.start <= today && today <= period.end) ?? preview.current;
  const movedIn = after.start < current.start;
  const moved = movedIn
    ? { start: after.start, end: addDays(current.start, -1) }
    : { start: current.start, end: addDays(after.start, -1) };
  const largest = preview.moved.largest[0];
  return {
    movedIn,
    name: formatPeriodLabel(after.label, locale, 'month'),
    range: formatDateRange(after, locale, today),
    moved: formatDateRange(moved, locale, today),
    largest:
      largest === undefined
        ? null
        : {
            ...largest,
            label:
              [largest.merchant, largest.description].filter((part) => part !== null).join(' — ') ||
              m.period_settings_unnamed(),
          },
  };
}

interface Previews {
  readonly day: number;
  readonly next_period: Result<StartDayPreview>;
  readonly recalculate: Result<StartDayPreview>;
}

/** The "Mulai tiap tanggal" grid (`WpMpY`): arrows, Home, and End move the focus; Enter or Space picks. */
function DayGrid({ selected, onPick }: { selected: number; onPick: (day: number) => void }) {
  const titleId = useId();
  const [focused, setFocused] = useState(selected);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: number) => {
    const next = gridTarget(event.key, day);
    if (next === null) return;
    event.preventDefault();
    setFocused(next);
    buttons.current.get(next)?.focus();
  };
  return (
    <div className="flex flex-col gap-2">
      <h3 id={titleId} className="text-[12px] font-medium text-muted-fg">
        {m.period_settings_picker_title()}
      </h3>
      <div role="grid" aria-labelledby={titleId} className="flex flex-col gap-1">
        {WEEKS.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7 gap-1">
            {week.map((day) => (
              <div key={day} role="gridcell" aria-selected={day === selected}>
                <button
                  ref={(button) => {
                    if (button === null) buttons.current.delete(day);
                    else buttons.current.set(day, button);
                  }}
                  type="button"
                  tabIndex={day === focused ? 0 : -1}
                  aria-label={m.period_settings_day({ day })}
                  onKeyDown={(event) => {
                    onKeyDown(event, day);
                  }}
                  onClick={() => {
                    onPick(day);
                  }}
                  className={`flex h-8 w-full items-center justify-center rounded-[7px] text-[12.5px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${day === selected ? 'bg-surface-3 font-semibold text-fg' : 'text-text-secondary'}`}
                >
                  {day}
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface PeriodSectionProps {
  readonly overview: PeriodsOverview;
  readonly payday: Payday;
}

export function PeriodSection({ overview, payday }: PeriodSectionProps) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const { today, current } = overview;
  const startTitleId = useId();
  const startValueId = useId();
  const followHintId = useId();
  const paydayDay = payday.day;
  const [day, setDay] = useState<number>(overview.startDay);
  const [mode, setMode] = useState(overview.mode);
  const [apply, setApply] = useState<StartDayApply>('next_period');
  const [picking, setPicking] = useState(false);
  const [previews, setPreviews] = useState<Previews | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  const dayChanged = day !== overview.startDay;
  const dirty = dayChanged || mode !== overview.mode;

  // Both previews, so both "Terapkan perubahan" cards show real numbers. A stale answer (the day changed again) is
  // dropped; the shown state is derived from `previews.day`, so nothing is set synchronously here.
  useEffect(() => {
    if (day === overview.startDay) return;
    let live = true;
    const preview = (which: StartDayApply) => settle(() => previewPeriodStart({ data: { day, apply: which } }));
    void Promise.all([preview('next_period'), preview('recalculate')]).then(([next, recalculate]) => {
      if (live) setPreviews({ day, next_period: next, recalculate });
    });
    return () => {
      live = false;
    };
  }, [day, overview.startDay]);

  const loaded = dayChanged && previews?.day === day ? previews : null;
  const failure = [loaded?.next_period, loaded?.recalculate].find((result): result is Failure => result?.ok === false);
  const ready =
    loaded !== null && loaded.next_period.ok && loaded.recalculate.ok
      ? {
          next_period: loaded.next_period.value,
          recalculate: loaded.recalculate.value,
          recalc: recalculation(loaded.recalculate.value, current, today, locale),
        }
      : null;
  const largest = ready?.recalc.largest ?? null;

  const reset = () => {
    setDay(overview.startDay);
    setMode(overview.mode);
    setApply('next_period');
  };

  const pick = (picked: number, pickedMode: typeof mode) => {
    setDay(picked);
    setMode(pickedMode);
    setPicking(false);
  };

  const save = async (applied: StartDayApply) => {
    setSaving(true);
    const result = await settle(() => changePeriodStart({ data: { day, apply: applied, mode } }));
    if (!result.ok) {
      setSaving(false);
      toast({
        title: m.period_settings_save_failed(),
        description: ledgerErrorMessage(result.code, locale),
        tone: 'error',
      });
      return;
    }
    setConfirming(false);
    toast({ title: m.period_settings_saved({ day }) });
    await router.invalidate();
    setApply('next_period');
    setSaving(false);
  };

  const largestAmount =
    largest === null ? null : (
      <Money minor={largest.amountMinor} currency={overview.baseCurrency} context="amount" locale={locale} />
    );

  // FR-P2 "Saran dari transaksi" and the mismatch warning.
  let suggestion: ReactNode = m.period_settings_payday_none();
  let suggestionBadge: ReactNode = null;
  if (payday.day !== null) {
    const { merchant, count } = payday;
    if (payday.day === day) {
      suggestion =
        merchant === null
          ? m.period_settings_payday_match_unnamed({ day, count })
          : m.period_settings_payday_match({ payer: merchant, day, count });
      suggestionBadge = <Badge>{m.period_settings_payday_aligned()}</Badge>;
    } else {
      suggestion =
        merchant === null
          ? m.period_settings_payday_mismatch_unnamed({ payday: payday.day, day })
          : m.period_settings_payday_mismatch({ payer: merchant, payday: payday.day, day });
      suggestionBadge = (
        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-amber-tint-2 px-2 text-[11px] font-medium text-amber-fg">
          {m.period_settings_payday_misaligned()}
        </span>
      );
    }
  }

  // The rule (FR-P1): a period is named after the month it ends in, shown on the new day's first full period.
  const example =
    ready === null
      ? undefined
      : [...ready.recalculate.periods, ...ready.next_period.periods].find(
          (period) => period.kind === 'normal' && Number(period.start.slice(8)) === day,
        );

  const closed = overview.periods.find((period) => period.status === 'closed');

  const rows: { period: Period; note: string; highlight: boolean }[] =
    ready === null
      ? [current, ...overview.upcoming].map((period, index) => ({
          period,
          note: m.period_settings_days({ count: period.days }),
          highlight: index === 0,
        }))
      : ready[apply].periods.map((period) => ({
          period,
          note:
            period.start === current.start && period.end === current.end
              ? m.period_settings_unchanged()
              : m.period_settings_days({ count: period.days }),
          highlight: period.kind === 'transition',
        }));

  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup label={m.period_settings_group_start()}>
        <SettingsRow
          title={<span id={startTitleId}>{m.period_settings_start_day()}</span>}
          description={m.period_settings_start_day_hint()}
        >
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-labelledby={`${startTitleId} ${startValueId}`}
                className="inline-flex h-[34px] w-[150px] shrink-0 items-center gap-2 rounded-[8px] border border-border-input bg-input px-2.5 text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring xl:w-[200px]"
              >
                <CalendarDays aria-hidden="true" className="size-3.5 text-muted-fg" />
                <span id={startValueId} className="flex-1 text-left">
                  {m.period_settings_day({ day })}
                </span>
                <ChevronsUpDown aria-hidden="true" className="size-3.5 text-subtle" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-[280px] flex-col gap-3 p-3">
              <DayGrid
                selected={day}
                onPick={(picked) => {
                  pick(picked, 'fixed_day');
                }}
              />
              {paydayDay === null ? (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    disabled
                    aria-describedby={followHintId}
                    className={`${FOLLOW} bg-muted text-subtle`}
                  >
                    <Wallet aria-hidden="true" className="size-3" />
                    {m.period_settings_follow_payday_unavailable()}
                  </button>
                  <p id={followHintId} className="text-[11px] text-subtle">
                    {m.period_settings_follow_payday_none()}
                  </p>
                </div>
              ) : (
                <button
                  type="button"
                  aria-pressed={mode === 'follow_payday'}
                  onClick={() => {
                    pick(paydayDay, 'follow_payday');
                  }}
                  className={`${FOLLOW} bg-green-tint-1 text-green-fg hover:bg-green-tint-2 aria-pressed:bg-green-tint-3`}
                >
                  <Wallet aria-hidden="true" className="size-3" />
                  {m.period_settings_follow_payday({ day: paydayDay })}
                </button>
              )}
              <p className="flex gap-1.5 border-t border-border pt-3 text-[11px] text-subtle">
                <Info aria-hidden="true" className="mt-px size-3 shrink-0" />
                {m.period_settings_days_note()}
              </p>
            </PopoverContent>
          </Popover>
        </SettingsRow>
        <SettingsRow
          title={m.period_settings_suggestion()}
          description={
            <span className="flex flex-col gap-0.5">
              <span>{suggestion}</span>
              {payday.day === null ? null : (
                <span className="text-[11.5px] text-subtle">{m.period_settings_payday_source()}</span>
              )}
            </span>
          }
        >
          {suggestionBadge}
        </SettingsRow>
        <SettingsRow
          title={m.period_settings_name()}
          description={
            example === undefined
              ? m.period_settings_name_hint()
              : m.period_settings_name_example({
                  range: formatDateRange(example, locale, today),
                  name: formatPeriodLabel(example.label, locale, 'month'),
                })
          }
        >
          <span
            title={m.period_settings_name_rule()}
            className="inline-flex h-7 shrink-0 items-center rounded-[6px] border border-border bg-surface-2 px-2.5 text-[12px] font-medium text-fg"
          >
            {m.period_settings_name_end()}
            <span className="sr-only"> · {m.period_settings_name_rule()}</span>
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label={m.period_settings_group_preview()}>
        {dayChanged && loaded === null ? (
          <p role="status" className="px-3.5 py-3 text-[12.5px] text-subtle">
            {m.period_settings_preview_loading()}
          </p>
        ) : null}
        {failure === undefined ? null : (
          <div className="p-3">
            <FormError>{ledgerErrorMessage(failure.code, locale)}</FormError>
          </div>
        )}
        {dayChanged && ready === null
          ? null
          : rows.map(({ period, note, highlight }) => (
              <div
                key={period.start}
                aria-current={period.start <= today && today <= period.end ? 'true' : undefined}
                className={`grid grid-cols-[minmax(110px,140px)_1fr_auto] items-center gap-3 px-3.5 py-3 text-[12.5px] ${highlight ? 'bg-blue-tint-1' : ''}`}
              >
                <span className="font-medium text-fg">
                  {period.kind === 'transition'
                    ? m.period_settings_transition()
                    : formatPeriodLabel(period.label, locale, 'monthYear')}
                </span>
                <span className="font-mono text-text-secondary">
                  {formatDate(period.start, locale, 'day')} – {formatDate(period.end, locale, 'day')}
                </span>
                <span className="text-[12px] text-subtle">{note}</span>
              </div>
            ))}
      </SettingsGroup>

      {ready === null ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[11px] font-medium text-subtle uppercase">
            {m.period_settings_group_apply()}
          </legend>
          <div className="grid gap-2.5 xl:grid-cols-2">
            <ApplyCard
              value="next_period"
              checked={apply === 'next_period'}
              onSelect={setApply}
              title={m.period_settings_apply_next()}
            >
              <NextPeriodDetail preview={ready.next_period} current={current} today={today} locale={locale} />
            </ApplyCard>
            <ApplyCard
              value="recalculate"
              checked={apply === 'recalculate'}
              onSelect={setApply}
              title={m.period_settings_apply_recalc()}
            >
              {largest === null ? (
                m.period_settings_apply_recalc_none({ name: ready.recalc.name, range: ready.recalc.range })
              ) : (
                <RichMessage
                  message={m.period_settings_apply_recalc_moved}
                  slots={{
                    name: ready.recalc.name,
                    range: ready.recalc.range,
                    moved: ready.recalc.moved,
                    example: largest.merchant ?? largest.label,
                    amount: largestAmount,
                  }}
                />
              )}
            </ApplyCard>
          </div>
        </fieldset>
      )}

      <footer className="sticky bottom-0 z-10 -mx-7 -mb-[22px] flex flex-wrap items-center gap-2 border-t border-border bg-dialog px-7 py-3">
        <span
          role="status"
          className={`flex flex-1 items-center gap-1.5 text-[12px] ${dirty ? 'text-amber-fg' : 'text-subtle'}`}
        >
          {dirty ? (
            <CircleAlert aria-hidden="true" className="size-3.5" />
          ) : (
            <Cloud aria-hidden="true" className="size-3.5" />
          )}
          {dirty ? m.settings_unsaved() : m.settings_synced()}
        </span>
        <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={reset}>
          {m.settings_cancel()}
        </Button>
        <Button
          size="sm"
          disabled={!dirty || (dayChanged && ready === null)}
          pending={saving && !confirming}
          onClick={() => {
            if (dayChanged && apply === 'recalculate') setConfirming(true);
            else void save(dayChanged ? apply : 'next_period');
          }}
        >
          {m.settings_save()}
        </Button>
      </footer>

      {ready === null ? null : (
        <Modal
          open={confirming}
          onOpenChange={setConfirming}
          title={m.period_settings_confirm_title({ name: formatPeriodLabel(current.label, locale, 'month') })}
          description={m.period_settings_confirm_description({ name: ready.recalc.name, range: ready.recalc.range })}
        >
          <ul className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-sunken p-3 text-[12.5px] text-text-secondary">
            <li className="flex gap-2">
              <ArrowLeftRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-subtle" />
              <span>
                {largest === null ? (
                  m.period_settings_confirm_moved_none()
                ) : (
                  <RichMessage
                    message={
                      ready.recalc.movedIn ? m.period_settings_confirm_moved_in : m.period_settings_confirm_moved_out
                    }
                    slots={{
                      moved: ready.recalc.moved,
                      name: ready.recalc.name,
                      example: largest.label,
                      amount: largestAmount,
                      date: formatDate(largest.localDate, locale, 'day'),
                    }}
                  />
                )}
              </span>
            </li>
            <li className="flex gap-2">
              <RefreshCw aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-subtle" />
              {m.period_settings_confirm_budget({ name: ready.recalc.name })}
            </li>
            <li className="flex gap-2">
              <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-subtle" />
              {closed === undefined
                ? m.period_settings_confirm_reports_none()
                : m.period_settings_confirm_reports({ name: formatPeriodLabel(closed.label, locale, 'month') })}
            </li>
            <li className="flex gap-2">
              <Repeat aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-subtle" />
              {m.period_settings_confirm_schedules()}
            </li>
          </ul>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setConfirming(false);
              }}
            >
              {m.settings_cancel()}
            </Button>
            <Button
              size="sm"
              pending={saving}
              onClick={() => {
                void save('recalculate');
              }}
            >
              <RefreshCw aria-hidden="true" className="size-3.5" />
              {m.period_settings_confirm()}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** One "Terapkan perubahan" option: a native radio in a card (no Radix RadioGroup on a server-rendered page). */
function ApplyCard({
  value,
  checked,
  onSelect,
  title,
  children,
}: {
  value: StartDayApply;
  checked: boolean;
  onSelect: (value: StartDayApply) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-[10px] border border-border bg-surface-sunken p-3.5 has-checked:border-blue has-checked:bg-blue-tint-1 has-focus-visible:outline-2 has-focus-visible:outline-ring">
      <input
        type="radio"
        name="period-apply"
        value={value}
        checked={checked}
        onChange={() => {
          onSelect(value);
        }}
        className="mt-0.5 size-4 shrink-0 accent-blue"
      />
      <span className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium text-fg">{title}</span>
        <span className="text-[11.5px] text-subtle">{children}</span>
      </span>
    </label>
  );
}
