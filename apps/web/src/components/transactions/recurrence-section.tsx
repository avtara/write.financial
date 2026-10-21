// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Ulangi" in the transaction detail (FR-L8, design `jibQf`, `r892Xi`, `j51Sw`): the recurrence the transaction
 * repeats, its rule and next dates, and the switch that stops it after a confirmation ("Hentikan pengulangan?":
 * future occurrences and their reminders are deleted, past transactions stay) with "Urungkan", or turns it on again.
 */
import type { RecurrenceView } from '@wf/db/schedules';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import { nextOccurrences, type IsoWeekday } from '@wf/domain/recurrence';
import { m } from '@wf/i18n/messages';
import { formatDate, toLocalDate, weekdayName } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Switch } from '@wf/ui/switch';
import { toast } from '@wf/ui/toast';
import { Bell, CircleCheck, Repeat, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { getTransactionRecurrence, stopRecurrence, undoStopRecurrence } from '../../server/fn/schedules.ts';
import { Button } from '../form.tsx';
import { Modal } from '../modal.tsx';

/** The recurrence of `transactionId` (`null` when it repeats nothing; `undefined` while loading). */
export function useTransactionRecurrence(transactionId: string, version: number) {
  const [recurrence, setRecurrence] = useState<RecurrenceView | null | undefined>(undefined);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    void getTransactionRecurrence({ data: { transactionId } }).then((result) => {
      if (live) setRecurrence(result.ok ? result.value : null);
    });
    return () => {
      live = false;
    };
  }, [transactionId, version, reload]);
  return {
    recurrence,
    reload: () => {
      setReload((current) => current + 1);
    },
  };
}

const FREQ_LABEL = {
  weekly: m.recurrence_freq_weekly,
  monthly: m.recurrence_freq_monthly,
  yearly: m.recurrence_freq_yearly,
} as const;

/** "tiap tgl 14" / "tiap Kamis" / "tiap 14 Okt". */
function everyOf(recurrence: RecurrenceView, locale: Locale): string {
  // Weekly rules always have a weekday and monthly ones a day of month (the table's checks).
  if (recurrence.freq === 'weekly') {
    return m.recurrence_every_weekday({ weekday: weekdayName(recurrence.weekday as IsoWeekday, locale) });
  }
  if (recurrence.freq === 'monthly') return m.recurrence_every_month_day({ day: recurrence.monthDay as number });
  return m.recurrence_every_date({ date: formatDate(recurrence.startOn, locale, 'day') });
}

/** "Berulang · bulanan" / "Tidak berulang", next to "Tercatat". */
export function RecurrenceBadge({ recurrence }: { recurrence: RecurrenceView }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 ${recurrence.status === 'active' ? 'bg-blue-tint-2 text-blue-fg' : 'bg-tint-06 text-muted-fg'}`}
    >
      <Repeat aria-hidden="true" className="size-3" />
      {recurrence.status === 'active'
        ? m.recurrence_badge_active({ freq: FREQ_LABEL[recurrence.freq]() })
        : m.recurrence_badge_stopped()}
    </span>
  );
}

export interface RecurrenceSectionProps {
  readonly recurrence: RecurrenceView;
  /** The transaction's name and date, for the confirmation ("Transfer 14 Okt tetap tercatat"). */
  readonly title: string;
  readonly transactionDate: LocalDate;
  /** "BCA Tahapan → Bibit RDPU" or the account. */
  readonly route: string;
  readonly locale: Locale;
  readonly timeZone: string;
  readonly today: LocalDate;
  /** After stopping or resuming: reload the recurrence and the history. */
  readonly onChanged: () => void;
}

export function RecurrenceSection({
  recurrence,
  title,
  transactionDate,
  route,
  locale,
  timeZone,
  today,
  onChanged,
}: RecurrenceSectionProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const active = recurrence.status === 'active';
  const every = everyOf(recurrence, locale);
  // The first date the stop removes (or that resuming brings back).
  const [upcoming] = nextOccurrences(recurrence, {
    from: recurrence.startOn > today ? recurrence.startOn : today,
    count: 1,
  });
  const from = upcoming === undefined ? '' : formatDate(upcoming, locale, 'day');
  const amount =
    recurrence.template.type === 'transfer' ? recurrence.template.sentMinor : recurrence.template.amountMinor;

  const resume = async () => {
    setPending(true);
    const result = await undoStopRecurrence({ data: { id: recurrence.id } });
    setPending(false);
    if (!result.ok) {
      toast({ tone: 'error', title: ledgerErrorMessage(result.code, locale) });
      return;
    }
    toast({ tone: 'info', title: m.recurrence_resumed() });
    onChanged();
  };

  const stop = async () => {
    setPending(true);
    const result = await stopRecurrence({ data: { id: recurrence.id } });
    setPending(false);
    setConfirming(false);
    if (!result.ok) {
      toast({ tone: 'error', title: ledgerErrorMessage(result.code, locale) });
      return;
    }
    toast.undo({
      title: m.recurrence_stopped_title(),
      description: m.recurrence_stopped_description({ name: title, date: from }),
      undoLabel: m.record_undo(),
      onUndo: () => {
        void resume();
      },
    });
    onChanged();
  };

  return (
    <section aria-labelledby="transaction-recurrence" className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <h3 id="transaction-recurrence" className="text-[12.5px] font-medium text-fg">
            {m.recurrence_heading()}
          </h3>
          <p className="text-[12px] text-muted-fg">
            {active
              ? m.recurrence_active_since({ date: formatDate(recurrence.startOn, locale, 'day') })
              : m.recurrence_stopped_on({
                  date:
                    recurrence.stoppedAt === null
                      ? ''
                      : formatDate(toLocalDate(recurrence.stoppedAt, timeZone), locale, 'day'),
                })}
          </p>
        </div>
        <Switch
          label={<span className="sr-only">{m.recurrence_switch()}</span>}
          checked={active}
          disabled={pending}
          onChange={() => {
            if (active) setConfirming(true);
            else void resume();
          }}
        />
      </div>
      {active ? (
        <div className="flex flex-col gap-2 rounded-[10px] border border-border bg-surface-2 p-3 text-[12.5px]">
          <p className="flex items-center gap-1.5 text-fg">
            <Repeat aria-hidden="true" className="size-3.5 text-muted-fg" />
            {FREQ_LABEL[recurrence.freq]()} · {every}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-muted-fg">
            {m.recurrence_next()}
            <ol aria-label={m.recurrence_next()} className="flex flex-wrap gap-1">
              {recurrence.preview.map((day) => (
                <li key={day} className="rounded-[4px] border border-border px-1.5 font-mono text-[11.5px] text-fg">
                  {formatDate(day, locale, 'day')}
                </li>
              ))}
            </ol>
            {recurrence.remindOffsetDays === null ? null : (
              <span className="ml-auto inline-flex items-center gap-1">
                <Bell aria-hidden="true" className="size-3" />
                {m.recurrence_remind({ days: recurrence.remindOffsetDays })}
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-[10px] border border-border bg-surface-2 p-3 text-[12.5px] text-text-secondary">
          {m.recurrence_stopped_note({ date: from, every })}
        </p>
      )}
      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={m.recurrence_stop_title()}
        description={
          recurrence.remindOffsetDays === null
            ? m.recurrence_stop_description_plain({ date: from })
            : m.recurrence_stop_description({ date: from })
        }
      >
        <div className="flex items-center gap-3 rounded-[10px] border border-border p-3 text-[13px]">
          <Repeat aria-hidden="true" className="size-4 shrink-0 text-muted-fg" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{title}</span>
            <span className="truncate text-[12px] text-muted-fg">
              {route} · {every}
            </span>
          </div>
          <Money minor={amount} currency={recurrence.currency} context="amount" locale={locale} />
        </div>
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted-fg">
          <CircleCheck aria-hidden="true" className="size-3.5 text-green-fg" />
          {m.recurrence_stop_keeps({ date: formatDate(transactionDate, locale, 'day') })}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(false);
            }}
          >
            {m.recurrence_stop_cancel()}
          </Button>
          <Button variant="destructive" pending={pending} onClick={() => void stop()}>
            <Trash2 aria-hidden="true" className="size-3.5" />
            {m.recurrence_stop_confirm()}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
